/**
 * THE RESEARCH PLANNER.
 *
 * Turns a question model into a plan that can be executed and then checked against what actually
 * happened. Three properties are load-bearing:
 *
 *   1. It is pure. The same question yields the same plan, so a plan can be stored beside a run and
 *      compared with the run's real execution afterwards.
 *   2. Every query is built from the question's own words plus generic English modifiers. The planner
 *      never contributes subject knowledge, because subject knowledge it invented would be
 *      indistinguishable from evidence once it reached a search box.
 *   3. Budgets are declared before execution, so a plan cannot quietly grow. Exhausting a budget is a
 *      reported state, not a silent truncation.
 *
 * The planner does not decide what is true. It decides what to go and look at.
 */
import type { Capability, ProviderId } from './providers/types';
import { PROVIDERS, providersFor } from './providers/types';
import type { QuestionModel } from '../question/model';
import { normalizeQueryText } from './query-normalize';

export interface ResearchDimension {
  key: string;
  label: string;
  /** Why this dimension is in the plan, in terms of the question. Printed in the UI. */
  rationale: string;
  capabilities: Capability[];
  /** Providers selected for this dimension, in deterministic order. */
  providers: ProviderId[];
  queries: string[];
}

export interface ResearchBudget {
  /**
   * Hard cap on provider calls for the whole plan. A call, not a query string, is the unit that costs
   * time and hits somebody's API: one query fanned out to three providers is three calls. The planner
   * and the executor count the same thing, which they did not in the first cut of this file.
   */
  max_provider_calls: number;
  /** Hard cap on documents retained per query. */
  max_results_per_query: number;
  /** Hard cap on documents retained for the whole plan. */
  max_documents: number;
  /** Wall-clock ceiling for external retrieval. Exceeding it yields LIMIT_REACHED, never a partial lie. */
  max_ms: number;
}

export interface ResearchPlan {
  question: QuestionModel;
  dimensions: ResearchDimension[];
  internal: {
    search: boolean;
    queries: string[];
    rationale: string;
  };
  external: {
    required: boolean;
    /** False when every provider a dimension needs is proxy-only and the proxy is off. */
    reachable: boolean;
    /** Distinct query strings the plan will issue. */
    query_count: number;
    /** Provider calls the plan will make, which is what the budget is measured in. */
    call_count: number;
    providers: ProviderId[];
  };
  budget: ResearchBudget;
  /** True when the plan is expected to produce something worth proposing to the knowledge base. */
  knowledge_update_expected: boolean;
  notes: string[];
}

export interface PlanOptions {
  /** Whether the operator has enabled the reader proxy. Off by default, everywhere. */
  proxyEnabled?: boolean;
  /** Overrides for the depth-derived budget. Only ever used to make it smaller in tests. */
  budget?: Partial<ResearchBudget>;
}

const BUDGET_BY_DEPTH: Record<QuestionModel['depth'], ResearchBudget> = {
  shallow: { max_provider_calls: 6, max_results_per_query: 5, max_documents: 12, max_ms: 15_000 },
  standard: { max_provider_calls: 14, max_results_per_query: 6, max_documents: 30, max_ms: 30_000 },
  deep: { max_provider_calls: 24, max_results_per_query: 8, max_documents: 60, max_ms: 60_000 },
};

/**
 * Fan-out ceiling per dimension. Without it a dimension asking for two capabilities can reach five
 * providers, which is how a research system quietly turns one question into forty network calls.
 */
const MAX_PROVIDERS_PER_DIMENSION = 3;

/**
 * Dimension shapes. Each is a generic research move - define it, explain it, date it, argue with it -
 * expressed as capabilities and a query suffix. No entry mentions any subject.
 */
interface Shape {
  key: string;
  label: string;
  rationale: string;
  capabilities: Capability[];
  /** Appended to the subject phrase. Empty means search the subject alone. */
  suffix: string;
}

const SHAPES: Record<string, Shape> = {
  definition: { key: 'definition', label: 'Definition', rationale: 'The question asks what something is, so the settled description is retrieved first.', capabilities: ['definition'], suffix: '' },
  entity: { key: 'entity', label: 'Entity resolution', rationale: 'The question names something that could be ambiguous, so the name is resolved to an identifier before anything is claimed about it.', capabilities: ['entity'], suffix: '' },
  mechanism: { key: 'mechanism', label: 'Mechanism', rationale: 'An explanation needs how the thing works, not only what it is called.', capabilities: ['definition', 'academic'], suffix: 'how it works' },
  background: { key: 'background', label: 'Background', rationale: 'Context for why the subject exists in its current form.', capabilities: ['background'], suffix: 'history background' },
  current_state: { key: 'current_state', label: 'Current state', rationale: 'The question requires current information, so dated recent sources are retrieved rather than recalled.', capabilities: ['current', 'news'], suffix: 'latest developments' },
  timeline: { key: 'timeline', label: 'Timeline', rationale: 'A change question needs the sequence, not only the endpoint.', capabilities: ['current', 'background'], suffix: 'timeline of changes' },
  authority: { key: 'authority', label: 'Official position', rationale: 'Where an official or primary source exists, it outranks commentary about it.', capabilities: ['indicator', 'academic', 'definition'], suffix: 'official guidance' },
  criticism: { key: 'criticism', label: 'Criticism and limits', rationale: 'Evidence that argues against the likely answer is retrieved deliberately, so the challenge is not left to chance.', capabilities: ['academic', 'technical'], suffix: 'criticism limitations problems' },
  practice: { key: 'practice', label: 'Practitioner view', rationale: 'How people who use the thing describe it, which often diverges from how it is documented.', capabilities: ['technical'], suffix: 'in practice experience' },
  measurement: { key: 'measurement', label: 'Measurement', rationale: 'A quantitative question needs a series with a stated unit and period, or it cannot be answered at all.', capabilities: ['indicator'], suffix: 'statistics indicator data' },
  comparison_a: { key: 'comparison_a', label: 'First subject', rationale: 'Each side of a comparison is evidenced separately, so one source cannot define both.', capabilities: ['definition', 'background'], suffix: '' },
  comparison_b: { key: 'comparison_b', label: 'Second subject', rationale: 'The other side of the comparison, evidenced independently.', capabilities: ['definition', 'background'], suffix: '' },
  causes: { key: 'causes', label: 'Proposed causes', rationale: 'A causal question needs candidate mechanisms before any of them can be tested.', capabilities: ['academic', 'background'], suffix: 'causes explanation' },
  exposure: { key: 'exposure', label: 'Exposure and incidents', rationale: 'A risk question needs reported incidents, which evidence discussion rather than occurrence.', capabilities: ['news', 'current'], suffix: 'incidents cases reported' },
  controls: { key: 'controls', label: 'Controls and obligations', rationale: 'What is already required or recommended, so a recommendation is not invented from nothing.', capabilities: ['definition', 'academic'], suffix: 'requirements controls guidance' },
};

/** Which shapes each intent uses, most important first. Trimming removes from the end, so the head survives a small budget. */
const INTENT_SHAPES: Record<QuestionModel['intent'], string[]> = {
  definition: ['definition', 'entity', 'background'],
  explanation: ['definition', 'mechanism', 'practice', 'criticism'],
  comparison: ['comparison_a', 'comparison_b', 'definition', 'criticism'],
  temporal_delta: ['current_state', 'timeline', 'authority', 'criticism'],
  current_value: ['measurement', 'entity', 'current_state'],
  quantification: ['measurement', 'authority', 'definition', 'criticism'],
  enumeration: ['definition', 'background', 'authority'],
  causal: ['causes', 'criticism', 'background', 'authority'],
  risk_assessment: ['exposure', 'controls', 'criticism', 'measurement', 'current_state'],
  open: ['definition', 'background', 'current_state', 'criticism'],
};

/**
 * Comparative words that mark a comparison but are not themselves a search term: the intent already
 * captures "largest", so repeating it in a query buys nothing, and the two sides are queried on
 * their own words, not this vocabulary.
 */
const COMPARISON_FILLER = new Set([
  'which', 'has', 'have', 'is', 'are', 'more', 'less', 'better', 'worse', 'bigger', 'smaller', 'higher',
  'lower', 'greater', 'healthier', 'safer', 'stronger', 'weaker', 'faster', 'slower', 'cheaper',
  'largest', 'biggest', 'smallest', 'highest', 'lowest', 'greatest', 'most', 'least',
]);

/** The words a comparison is actually about, once both sides and the comparative itself are removed. */
function comparisonTopic(question: QuestionModel, sides: [string, string]): string[] {
  const sideWords = new Set(`${sides[0]} ${sides[1]}`.toLowerCase().split(/\s+/).filter((w) => w.length > 0));
  return question.keywords.filter((k) => !sideWords.has(k.toLowerCase()) && !COMPARISON_FILLER.has(k.toLowerCase()));
}

/**
 * The subject phrase: quoted spans first, then acronyms, then capitalised names, then - if the
 * question is a comparison with no named entity to anchor on - both sides plus what they are being
 * compared on, then the leading content words. Bounded at eight tokens (four when there are no sides
 * to preserve) because a longer string stops behaving like a search query.
 */
export function subjectOf(question: QuestionModel, sides: [string, string] | null = null): string {
  const quoted = question.entities.filter((e) => e.kind === 'quoted').map((e) => e.text);
  if (quoted.length > 0) return quoted.slice(0, 2).join(' ');
  const named = question.entities.filter((e) => e.kind === 'acronym' || e.kind === 'proper_noun').map((e) => e.text);
  if (named.length > 0) return named.slice(0, 3).join(' ');
  if (sides !== null && question.entities.length === 0) {
    return [...sides[0].split(/\s+/), ...sides[1].split(/\s+/), ...comparisonTopic(question, sides)].slice(0, 8).join(' ');
  }
  return question.keywords.slice(0, 4).join(' ');
}

/**
 * The two sides of a comparison, split on the comparison word the question actually used. "vs"/
 * "versus"/etc. bracket the two sides cleanly, so the string is split in half on the connective. A
 * bare "A or B" does not: it appears only at the tail of the question, with every qualifying word
 * before it ("which planet has largest diameter ... mercury or jupiter"), so halving the whole
 * string would put all the noise in side A. It is therefore matched as its own, narrower fallback.
 */
export function comparisonSides(question: QuestionModel): [string, string] | null {
  const clean = (s: string) => s.replace(/\b(what|is|the|between|and|how|does|do|explain|from|to|with)\b/gi, ' ').replace(/[^\p{L}\p{N}\s\-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const m = question.query.match(/^(.*?)\b(?:vs\.?|versus|compared to|compared with|difference between|differs? from)\b(.*)$/i);
  if (m !== null) {
    const a = clean(m[1]);
    const b = clean(m[2]);
    if (a.length > 0 && b.length > 0) return [a, b];
  }
  const bare = question.query.match(/\b([a-z][\w-]*)\s+(?:or|and)\s+([a-z][\w-]*)[?.!]?\s*$/i);
  if (bare !== null) {
    const a = clean(bare[1]);
    const b = clean(bare[2]);
    if (a.length > 0 && b.length > 0) return [a, b];
  }
  return null;
}

const geoSuffix = (question: QuestionModel): string => (question.geo.length > 0 && question.geo.length <= 3 ? ` ${question.geo.join(' ')}` : '');

function selectProviders(capabilities: Capability[], proxyEnabled: boolean): ProviderId[] {
  const out: ProviderId[] = [];
  for (const cap of capabilities) {
    for (const p of providersFor(cap)) {
      if (p.requires_proxy && !proxyEnabled) continue;
      if (!out.includes(p.id)) out.push(p.id);
    }
  }
  return out.slice(0, MAX_PROVIDERS_PER_DIMENSION);
}

export function planResearch(question: QuestionModel, options: PlanOptions = {}): ResearchPlan {
  const proxyEnabled = options.proxyEnabled ?? false;
  const budget: ResearchBudget = { ...BUDGET_BY_DEPTH[question.depth], ...(options.budget ?? {}) };
  const notes: string[] = [...question.notes];

  const sides = comparisonSides(question);
  const subject = subjectOf(question, sides);
  const keys = INTENT_SHAPES[question.intent];
  // Only used without a named entity to anchor on: when one exists (e.g. "GDPR vs the EU AI Act"),
  // `subject` already carries both sides via `entitiesOf`, and repeating the topic fragment here would
  // just pad an already-correct query.
  const anchorless = sides !== null && question.entities.length === 0;

  const built: ResearchDimension[] = [];
  for (const key of keys) {
    const shape = SHAPES[key];
    if (shape === undefined) continue;

    let phrase = subject;
    if (key === 'comparison_a') {
      if (sides === null) continue;
      phrase = anchorless ? [sides[0], ...comparisonTopic(question, sides)].join(' ') : sides[0];
    }
    if (key === 'comparison_b') {
      if (sides === null) continue;
      phrase = anchorless ? [sides[1], ...comparisonTopic(question, sides)].join(' ') : sides[1];
    }
    if (phrase.length === 0) continue;

    const query = normalizeQueryText(`${phrase}${shape.suffix.length > 0 ? ` ${shape.suffix}` : ''}${key === 'exposure' || key === 'current_state' ? geoSuffix(question) : ''}`.trim());
    const providers = selectProviders(shape.capabilities, proxyEnabled);
    if (providers.length === 0) {
      notes.push(`Dimension "${shape.label}" was dropped: every provider that serves it needs the reader proxy, which is off.`);
      continue;
    }
    built.push({ key: shape.key, label: shape.label, rationale: shape.rationale, capabilities: shape.capabilities, providers, queries: [query] });
  }

  if (sides === null && (question.intent === 'comparison')) {
    notes.push('The question reads as a comparison but the two subjects could not be separated, so both sides are researched as one subject.');
  }

  // Trim to budget from the tail, so the highest-value dimensions survive. Reported, never silent.
  const dimensions: ResearchDimension[] = [];
  let queries = 0;
  let calls = 0;
  for (const d of built) {
    const cost = d.queries.length * d.providers.length;
    if (calls + cost > budget.max_provider_calls) {
      notes.push(`Plan trimmed at the ${budget.max_provider_calls}-call budget: "${d.label}" and any dimension after it were not planned.`);
      break;
    }
    dimensions.push(d);
    queries += d.queries.length;
    calls += cost;
  }

  const providers = [...new Set(dimensions.flatMap((d) => d.providers))].sort((a, b) => PROVIDERS.findIndex((p) => p.id === a) - PROVIDERS.findIndex((p) => p.id === b));
  const reachable = providers.length > 0;
  if (question.requires_external && !reachable) {
    notes.push('External research is required for this question but no provider is reachable, so the answer can only be drawn from pinned knowledge and must say so.');
  }
  if (question.quantitative && !providers.includes('worldbank')) {
    notes.push('No indicator provider was selected, so a rate or percentage cannot be evidenced by this plan.');
  }

  return {
    question,
    dimensions,
    internal: {
      search: question.requires_internal,
      // Internal search uses the question's own words: the index is small and the match is reported with its score.
      queries: [subject, ...question.keywords.slice(0, 6)].filter((q) => q.length > 1),
      rationale: 'Pinned knowledge is searched first so the run can tell the operator what it already held before it went outside.',
    },
    external: { required: question.requires_external, reachable, query_count: queries, call_count: calls, providers },
    budget,
    knowledge_update_expected: question.requires_external && reachable && question.freshness !== 'timeless',
    notes,
  };
}
