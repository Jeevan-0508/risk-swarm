/**
 * EVOLUTION 6.0 — disagreement assessment and Zeus's verdict request.
 *
 * `assessDisagreement` is pure and small on purpose: it reads what the three positions actually said
 * and computes a real spread, and never claims a consensus the stances don't show. `score.ts`'s
 * `computeDisagreementIndex` was evaluated for reuse and is not: its four terms are wired to the
 * freight/fraud hypothesis pipeline (challenge/red-team objection severities, evidence-cluster gates,
 * a fixed policy) that has no equivalent for an open-domain question with no hypothesis graph. Reusing
 * it would mean inventing fake objection objects to satisfy its shape — the fabrication this evolution
 * exists to avoid. The confidence-variance idea is the one genuinely portable piece, so it is
 * recomputed here, small and standalone, rather than imported from a module that stays untouched.
 */
import type { Reasoner, ReasonRequest, ReasonResult } from '../reasoner/types';
import type { CouncilVerdict, DisagreementAssessment, OlympianPosition, ReasoningAgent } from './types';
import { REASONING_AGENTS } from './types';

/** Shown wherever a disagreement or verdict would otherwise be computed over zero real opinions. */
export const NO_INDEPENDENT_POSITIONS_MESSAGE = 'No independent LLM positions available — every agent was deterministic fallback or degraded.';

/**
 * A position only counts as an independent opinion if a real model actually answered: `degraded` false
 * rules out a failed call, and `provider !== 'deterministic'` rules out an agent that was never enabled
 * and so never left this machine. Two deterministic fallbacks that happen to agree are not a consensus —
 * they are the same non-LLM code path run twice, and must not be counted or narrated as independent.
 */
const isIndependentPosition = (r: ReasonResult<OlympianPosition>): boolean => !r.degraded && r.provider !== 'deterministic';

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
};

/** Normalises stance text loosely enough that "Tiger" and "the tiger" group together, tightly enough that distinct answers stay distinct. */
const normaliseStance = (stance: string): string => stance.trim().toLowerCase().replace(/^the\s+/, '').replace(/[.!?]+$/, '');

export function assessDisagreement(positions: Record<ReasoningAgent, ReasonResult<OlympianPosition>>): DisagreementAssessment {
  const independent = REASONING_AGENTS.filter((a) => isIndependentPosition(positions[a]));
  const stances = {} as Record<ReasoningAgent, string>;
  for (const a of REASONING_AGENTS) stances[a] = positions[a].value.stance;

  const independentStances = independent.map((a) => normaliseStance(positions[a].value.stance));
  const distinct_stances = [...new Set(independentStances)];
  const confidence_variance = clamp01(stdev(independent.map((a) => positions[a].value.confidence)) / 0.35);

  let agreement: DisagreementAssessment['agreement'];
  if (independent.length < 2) agreement = 'inconclusive';
  else if (distinct_stances.length === 1) agreement = 'strong_consensus';
  else if (distinct_stances.length === independent.length) agreement = 'split';
  else agreement = 'majority';

  return { independent_count: independent.length, stances, distinct_stances, confidence_variance, agreement };
}

const VERDICT_SCHEMA_HINT =
  '{ verdict_type: "CONSENSUS"|"MAJORITY"|"MINORITY_PRESERVED"|"UNRESOLVED", answer: string, confidence: number (0-1), rationale: string[], minority_view: string|null, unresolved: string[], cited_evidence_ids: string[] }';

function positionBlock(agent: ReasoningAgent, result: ReasonResult<OlympianPosition>): string {
  const p = result.value;
  return [
    `<<<POSITION agent="${agent}" degraded="${result.degraded}">>>`,
    `stance: ${p.stance}`,
    `confidence: ${p.confidence}`,
    `reasoning: ${p.reasoning_summary}`,
    `claims: ${p.claims.join(' | ') || 'none'}`,
    `evidence_ids: ${p.evidence_ids.join(', ') || 'none'}`,
    `assumptions: ${p.assumptions.join(' | ') || 'none'}`,
    '<<<END>>>',
  ].join('\n');
}

function validateVerdict(raw: unknown): CouncilVerdict {
  const r = raw as Partial<CouncilVerdict>;
  const validTypes: CouncilVerdict['verdict_type'][] = ['CONSENSUS', 'MAJORITY', 'MINORITY_PRESERVED', 'UNRESOLVED'];
  if (
    !r || typeof r.verdict_type !== 'string' || !validTypes.includes(r.verdict_type as CouncilVerdict['verdict_type']) ||
    typeof r.answer !== 'string' || typeof r.confidence !== 'number' || !Number.isFinite(r.confidence) ||
    !Array.isArray(r.rationale) || !Array.isArray(r.unresolved) || !Array.isArray(r.cited_evidence_ids) ||
    (r.minority_view !== null && typeof r.minority_view !== 'string')
  ) {
    throw new Error('SHAPE_MISMATCH: expected a full CouncilVerdict');
  }
  return {
    verdict_type: r.verdict_type as CouncilVerdict['verdict_type'],
    answer: r.answer,
    confidence: clamp01(r.confidence),
    rationale: r.rationale.map(String),
    minority_view: r.minority_view,
    unresolved: r.unresolved.map(String),
    cited_evidence_ids: r.cited_evidence_ids.map(String),
  };
}

/** The mechanical, no-model verdict: never averages away a real split, never invents a rationale beyond the positions it was given. */
function fallbackVerdict(positions: Record<ReasoningAgent, ReasonResult<OlympianPosition>>, disagreement: DisagreementAssessment): CouncilVerdict {
  const independent = REASONING_AGENTS.filter((a) => isIndependentPosition(positions[a]));
  const confidences = independent.map((a) => positions[a].value.confidence);
  const meanConfidence = confidences.length === 0 ? 0 : confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const rationale = independent.map((a) => `${a}: ${positions[a].value.stance} (${positions[a].value.reasoning_summary})`);

  if (independent.length === 0) {
    return { verdict_type: 'UNRESOLVED', answer: 'insufficient_evidence', confidence: 0, rationale: [], minority_view: null, unresolved: [NO_INDEPENDENT_POSITIONS_MESSAGE], cited_evidence_ids: [] };
  }
  if (disagreement.agreement === 'strong_consensus') {
    return { verdict_type: 'CONSENSUS', answer: positions[independent[0]!].value.stance, confidence: clamp01(meanConfidence), rationale, minority_view: null, unresolved: [], cited_evidence_ids: [...new Set(independent.flatMap((a) => positions[a].value.evidence_ids))] };
  }
  if (disagreement.agreement === 'majority') {
    const counts = new Map<string, number>();
    for (const a of independent) counts.set(normaliseStance(positions[a].value.stance), (counts.get(normaliseStance(positions[a].value.stance)) ?? 0) + 1);
    const [topStance] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const majorityAgent = independent.find((a) => normaliseStance(positions[a].value.stance) === topStance)!;
    const minorityAgent = independent.find((a) => normaliseStance(positions[a].value.stance) !== topStance);
    return {
      verdict_type: 'MAJORITY',
      answer: positions[majorityAgent]!.value.stance,
      confidence: clamp01(meanConfidence * 0.85),
      rationale,
      minority_view: minorityAgent ? `${minorityAgent}: ${positions[minorityAgent].value.stance} — ${positions[minorityAgent].value.reasoning_summary}` : null,
      unresolved: [],
      cited_evidence_ids: [...new Set(independent.flatMap((a) => positions[a].value.evidence_ids))],
    };
  }
  return {
    verdict_type: disagreement.agreement === 'split' ? 'UNRESOLVED' : 'UNRESOLVED',
    answer: 'unresolved',
    confidence: clamp01(meanConfidence * 0.5),
    rationale,
    minority_view: null,
    unresolved: [`The Council's independent positions did not converge: ${disagreement.distinct_stances.join(' vs. ')}.`],
    cited_evidence_ids: [...new Set(independent.flatMap((a) => positions[a].value.evidence_ids))],
  };
}

export function buildVerdictRequest(
  question: string,
  positions: Record<ReasoningAgent, ReasonResult<OlympianPosition>>,
  disagreement: DisagreementAssessment,
): ReasonRequest<CouncilVerdict> {
  const allowed_evidence_ids = [...new Set(REASONING_AGENTS.flatMap((a) => positions[a].value.evidence_ids))];
  return {
    task: 'council.zeus.verdict',
    instruction:
      'You are ZEUS: authoritative, calm, a strategic judge. You have received the independent positions of ' +
      'three Olympians on one question, plus a mechanical disagreement assessment. Synthesize a verdict. ' +
      'Do NOT simply average the positions or declare consensus because most agents agree — reserve ' +
      '"CONSENSUS" for when the independent positions genuinely converge, "MAJORITY" for two-against-one with ' +
      'a real minority view, "MINORITY_PRESERVED" when a minority position has strong independent merit even ' +
      'outnumbered, and "UNRESOLVED" when the positions do not support a confident answer. Preserve any real ' +
      'minority view explicitly rather than erasing it. State genuine uncertainty rather than manufacturing ' +
      `confidence. THE QUESTION: "${question}"`,
    data_blocks: [
      ...REASONING_AGENTS.map((a) => positionBlock(a, positions[a])),
      `<<<DISAGREEMENT>>> agreement=${disagreement.agreement} distinct_stances=${disagreement.distinct_stances.join(',')} independent_count=${disagreement.independent_count} confidence_variance=${disagreement.confidence_variance.toFixed(2)} <<<END>>>`,
    ],
    allowed_evidence_ids,
    schema_hint: VERDICT_SCHEMA_HINT,
    validate: validateVerdict,
    fallback: () => fallbackVerdict(positions, disagreement),
  };
}

export async function requestVerdict(
  reasoner: Reasoner,
  question: string,
  positions: Record<ReasoningAgent, ReasonResult<OlympianPosition>>,
  disagreement: DisagreementAssessment,
): Promise<ReasonResult<CouncilVerdict>> {
  return reasoner.propose(buildVerdictRequest(question, positions, disagreement));
}
