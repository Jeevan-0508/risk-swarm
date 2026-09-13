/**
 * DECISION ENGINE. Assembles the record into one recommendation and its actions.
 *
 * It decides nothing on its own authority: the band comes from the scorer's published gates, the
 * actions come from real countermeasure ids in the taxonomy, and the rationale is built only from
 * sentences that reference nodes already in the graph. `decided_by` stays `system_recommendation`
 * until a human records a verdict.
 */
import type { AnalystFinding } from './analyst';
import type { Countermeasure } from '../integrations/atlas';
import type { Action, ActionBand, Challenge, Decision, Evidence, RedTeamFinding, RegulatoryImplication, Urgency } from '../domain/model';
import { computeScore, type EvidenceRef, type ScoreResult, type ScoringInput } from '../scoring/score';
import { DEFAULT_POLICY, type ScoringPolicy } from '../scoring/policy';
import { sourceIdentity } from '../ingest/sanitize';
import { emptyCost, type AgentContext, type AgentOutput } from './types';

export interface DecisionInput {
  question: string;
  findings: AnalystFinding[];
  evidence: Evidence[];
  challenges: Challenge[];
  red_team: RedTeamFinding[];
  implications: RegulatoryImplication[];
  agent_positions: ScoringInput['agent_positions'];
  cluster_count: number;
  possible_duplicate_pairs: number;
  recurrence_buckets: number;
  window_buckets: number;
  scope_breadth: number;
  evidence_conflicts: number;
  ungated_false_positives: number;
  total_false_positive_gates: number;
  circular_support_count: number;
  declared_uncertainties: number;
  reversibility: ScoringInput['reversibility'];
  regulatory_deadline_days: number | null;
  policy?: ScoringPolicy;
  maxActions?: number;
}

export interface DecisionOutput extends AgentOutput<Decision> {
  decision: Decision;
  actions: Action[];
  score: ScoreResult;
  scoring_input: ScoringInput;
}

const REVIEW_DAYS: Record<Urgency, number> = { IMMEDIATE: 7, ELEVATED: 14, ROUTINE: 30 };

/** Owner is a role, never a person: this repo has no org data and will not invent one. */
const OWNER_BY_CATEGORY: Record<string, string> = {
  identity: 'Carrier Onboarding & Vetting',
  theft: 'Physical Security / Loss Prevention',
  chain_integrity: 'Procurement & Subcontracting Compliance',
  documentation: 'Freight Audit & Claims',
  insider: 'Internal Investigations',
  technical: 'Transport Technology & Telematics',
};

const ACTION_CLASS: Record<Countermeasure['class'], Action['class']> = {
  preventive: 'preventive',
  detective: 'detective',
  responsive: 'responsive',
};

const addDays = (iso: string, days: number): string => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

function toRefs(evidence: Evidence[]): EvidenceRef[] {
  return evidence.map((e) => ({
    id: e.id,
    tier: e.tier,
    relevance: e.relevance,
    cluster_id: e.cluster_id,
    source_identity: sourceIdentity(e.url, e.source),
    incident_claim: e.incident_claim,
    injection_suspected: e.injection_suspected,
  }));
}

export async function runDecision(ctx: AgentContext, input: DecisionInput): Promise<DecisionOutput> {
  const started = Date.now();
  ctx.assertAlive();
  ctx.spend('agent_call');

  const lead = input.findings[0] ?? null;
  const newest = input.evidence
    .map((e) => e.publication_date)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1) ?? null;

  const scoring_input: ScoringInput = {
    evidence: toRefs(input.evidence),
    cluster_count: input.cluster_count,
    possible_duplicate_pairs: input.possible_duplicate_pairs,
    recurrence_buckets: input.recurrence_buckets,
    window_buckets: input.window_buckets,
    pattern: lead ? { severity: lead.match.severity, unknown_share: 1 - lead.coverage.completeness } : null,
    scope_breadth: input.scope_breadth,
    newest_evidence_at: newest,
    now: ctx.now,
    regulatory_deadline_days: input.regulatory_deadline_days,
    agent_positions: input.agent_positions,
    challenges: input.challenges.map((c) => ({ severity: c.severity, resolution: c.resolution })),
    red_team: input.red_team.map((f) => ({ severity: f.severity, resolution: f.resolution, finding_class: f.finding_class })),
    evidence_conflicts: input.evidence_conflicts,
    ungated_false_positives: input.ungated_false_positives,
    total_false_positive_gates: input.total_false_positive_gates,
    circular_support_count: input.circular_support_count,
    declared_uncertainties: input.declared_uncertainties,
    reversibility: input.reversibility,
    policy: input.policy ?? DEFAULT_POLICY,
  };

  const score = computeScore(scoring_input);

  const unresolved = [...input.challenges, ...input.red_team]
    .filter((o) => o.resolution === 'open' && o.severity !== 'note')
    .map((o) => `${o.id}: ${o.argument}`);

  const headline_risk = lead
    ? `${lead.match.pattern_name} exposure in the ${lead.hypothesis.scope.geo.join('/') || 'in-scope'} network`
    : 'No pattern could be named from the evidence retrieved';

  const rationale = buildRationale(input, score, lead);

  const category = lead?.match.category ?? '';
  const owner_role = OWNER_BY_CATEGORY[category] ?? 'Risk Management';

  const decision = ctx.minter.decision('decision_engine', {
    question: input.question,
    hypothesis_ids: input.findings.map((f) => f.hypothesis.id),
    headline_risk,
    severity_band: score.severity_band,
    severity_score: score.severity_score,
    confidence: score.confidence,
    confidence_blocked_reason: score.confidence_blocked_reason,
    urgency: score.urgency,
    action_band: score.action_band,
    gates_failed: score.gates_failed,
    caps_applied: score.caps_applied,
    rationale,
    unresolved_objections: unresolved,
    owner_role,
    review_by: addDays(ctx.now, REVIEW_DAYS[score.urgency]),
    regulatory_implications: input.implications,
    decided_by: 'system_recommendation',
    human_note: null,
    human_verdict: null,
  });

  const actions = lead ? await buildActions(ctx, input, decision, lead, score.action_band, owner_role) : [];

  const uncertainties: string[] = [];
  if (score.confidence === null) uncertainties.push(`Confidence is withheld: ${score.confidence_blocked_reason}`);
  for (const cap of score.caps_applied) uncertainties.push(`Cap applied: ${cap}`);
  for (const gate of score.gates_failed) uncertainties.push(`Gate not met: ${gate}`);
  if (actions.length === 0) uncertainties.push('No countermeasure was attached, so this recommendation is not yet actionable.');

  return {
    agent: 'decision_engine',
    run_id: ctx.run_id,
    findings: [decision],
    evidence_created: [],
    evidence_cited: input.evidence.map((e) => e.id),
    confidence: score.confidence ?? 0,
    uncertainties,
    reasoning_status: score.confidence === null ? 'insufficient_evidence' : score.action_band === 'NOTE' ? 'hypothesis_only' : 'partially_supported',
    recommended_next_step: actions[0]?.text ?? 'Widen retrieval or supply operational data before deciding.',
    cost: { ...emptyCost(), calls: 1, ms: Date.now() - started },
    decision,
    actions,
    score,
    scoring_input,
  };
}

/** Every sentence references a fact already in the record, so the rationale cannot drift from it. */
function buildRationale(input: DecisionInput, score: ScoreResult, lead: AnalystFinding | null): string[] {
  const lines: string[] = [];
  if (!lead) {
    lines.push('No taxonomy pattern was named by the surviving signals, so no risk statement is made.');
    return lines;
  }
  lines.push(
    `${input.evidence.filter((e) => e.incident_claim).length} incident-claim evidence object(s) reduce to ${input.cluster_count} distinct event cluster(s) across ${score.independent_evidence_count} independent publisher(s).`,
  );
  lines.push(
    `The link to ${lead.match.pattern_name} (${lead.match.pattern_id}) is a ${lead.match.basis.replace(/_/g, ' ')} on ${lead.match.matched_terms.map((t) => `"${t}"`).join(', ')}; it evidences discussion of the pattern, not its occurrence here.`,
  );
  lines.push(
    `${lead.coverage.unknown_indicator_ids.length} of ${lead.coverage.unknown_indicator_ids.length + lead.coverage.present_indicator_ids.length} operational indicator(s) are unassessed (completeness ${Math.round(lead.coverage.completeness * 100)}%), so occurrence is untested rather than disproved.`,
  );
  if (input.ungated_false_positives > 0) {
    lines.push(`${input.ungated_false_positives} of ${input.total_false_positive_gates} documented false-positive gate(s) remain open, and each one is a benign explanation that fits the same evidence.`);
  }
  if (score.gates_failed.length > 0) {
    lines.push(`The recommendation is held at ${score.action_band} because ${score.gates_failed.length} escalation gate(s) were not met: ${score.gates_failed.join('; ')}.`);
  }
  lines.push(`Disagreement index ${score.disagreement_index.value} across ${input.agent_positions.length} agent position(s); the objections are published rather than averaged away.`);
  return lines;
}

async function buildActions(
  ctx: AgentContext,
  input: DecisionInput,
  decision: Decision,
  lead: AnalystFinding,
  band: ActionBand,
  owner_role: string,
): Promise<Action[]> {
  const max = input.maxActions ?? 4;
  const cms = await ctx.tools.atlas.countermeasures(lead.match.pattern_id);
  ctx.spend('retrieval');

  // Below TARGETED_INVESTIGATION the only honest action is to look, not to intervene: a preventive
  // control imposed on a carrier on this evidence would itself be the false-positive cost.
  const wanted: Countermeasure['class'][] = band === 'ESCALATE' ? ['responsive', 'detective', 'preventive'] : band === 'TARGETED_INVESTIGATION' ? ['detective', 'preventive'] : ['detective'];
  const ordered = wanted.flatMap((cls) => cms.filter((c) => c.class === cls));

  const actions: Action[] = ordered.slice(0, max).map((cm) =>
    ctx.minter.action('decision_engine', {
      decision_id: decision.id,
      text: cm.text,
      owner_role,
      due: decision.review_by,
      countermeasure_id: cm.id,
      class: ACTION_CLASS[cm.class],
    }),
  );

  // The first open gate is always worth stating as an action, because closing it is what changes the band.
  const firstGate = lead.gates[0];
  if (firstGate && actions.length < max) {
    actions.unshift(
      ctx.minter.action('decision_engine', {
        decision_id: decision.id,
        text: `Rule out the documented false positive "${firstGate.looks_like}": ${firstGate.how_to_rule_out}`,
        owner_role,
        due: decision.review_by,
        countermeasure_id: null,
        class: 'investigative',
      }),
    );
  }
  return actions.slice(0, max);
}
