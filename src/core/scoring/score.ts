/**
 * The scorer. Ten factors, three published results, every number traceable to its inputs.
 *
 * Two rules hold everywhere in this file:
 *   - confidence is computed over evidence clusters and source tiers, never over how many agents
 *     agree, so repetition cannot manufacture certainty;
 *   - a gate failure is named in the output, so the brief can print why a band was not reached.
 */
import { TIER_WEIGHT, type ActionBand, type FindingSeverity, type ReasoningStatus, type SeverityBand, type Tier, type Urgency } from '../domain/model';
import { DEFAULT_POLICY, type ScoringPolicy } from './policy';

export interface EvidenceRef {
  id: string;
  tier: Tier;
  relevance: number;
  cluster_id: string | null;
  source_identity: string;
  incident_claim: boolean;
  injection_suspected: boolean;
}

export interface ScoringInput {
  /** Evidence supporting the lead hypothesis, already resolved from the graph. */
  evidence: EvidenceRef[];
  /** Clusters covering that evidence. One cluster is one underlying event. */
  cluster_count: number;
  possible_duplicate_pairs: number;
  recurrence_buckets: number;
  window_buckets: number;
  pattern: { severity: 'low' | 'medium' | 'high' | 'critical'; unknown_share: number } | null;
  /** Breadth of the exposure the hypothesis claims: geography x mode x stage, 0..1. */
  scope_breadth: number;
  newest_evidence_at: string | null;
  now: string;
  regulatory_deadline_days: number | null;
  agent_positions: Array<{ agent: string; reasoning_status: ReasoningStatus; confidence: number }>;
  challenges: Array<{ severity: FindingSeverity; resolution: 'open' | 'accepted' | 'rebutted' }>;
  red_team: Array<{ severity: FindingSeverity; resolution: 'open' | 'accepted' | 'rebutted'; finding_class: string }>;
  evidence_conflicts: number;
  ungated_false_positives: number;
  total_false_positive_gates: number;
  circular_support_count: number;
  declared_uncertainties: number;
  reversibility: 'reversible' | 'hard_to_reverse' | 'irreversible';
  policy?: ScoringPolicy;
}

export type FactorKey =
  | 'evidence_strength'
  | 'source_reliability'
  | 'signal_recurrence'
  | 'independent_evidence_count'
  | 'potential_impact'
  | 'time_sensitivity'
  | 'false_positive_risk'
  | 'agent_agreement'
  | 'agent_disagreement'
  | 'uncertainty';

export interface Factor {
  key: FactorKey;
  label: string;
  value: number;
  /** Human-readable arithmetic. The UI prints this next to the number. */
  explanation: string;
}

export interface DisagreementIndex {
  value: number;
  terms: Array<{ key: string; weight: number; normalised: number; contribution: number; explanation: string }>;
}

export interface ScoreResult {
  factors: Record<FactorKey, Factor>;
  disagreement_index: DisagreementIndex;
  independent_evidence_count: number;
  confidence: number | null;
  confidence_blocked_reason: string | null;
  confidence_raw: number;
  severity_score: number;
  severity_band: SeverityBand;
  urgency: Urgency;
  action_band: ActionBand;
  caps_applied: string[];
  gates_failed: string[];
  policy: ScoringPolicy;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round = (n: number, dp = 3): number => Number(n.toFixed(dp));

const SEVERITY_WEIGHT: Record<'low' | 'medium' | 'high' | 'critical', number> = { low: 0.25, medium: 0.5, high: 0.75, critical: 1 };

/** Tier weight, halved when the source tried to behave like an instruction. */
export const effectiveReliability = (e: EvidenceRef): number => TIER_WEIGHT[e.tier] * (e.injection_suspected ? 0.5 : 1);

/** Best evidence per cluster. Duplicates inside a cluster add nothing, by construction. */
function bestPerCluster(evidence: EvidenceRef[]): EvidenceRef[] {
  const best = new Map<string, EvidenceRef>();
  for (const e of evidence) {
    const key = e.cluster_id ?? `singleton:${e.id}`;
    const current = best.get(key);
    if (!current || effectiveReliability(e) * e.relevance > effectiveReliability(current) * current.relevance) best.set(key, e);
  }
  return [...best.values()];
}

const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
};

const objectionWeight = (severity: FindingSeverity): number => (severity === 'blocking' ? 2 : severity === 'material' ? 1 : 0);

export function computeDisagreementIndex(input: ScoringInput): DisagreementIndex {
  const openObjections = [...input.challenges, ...input.red_team].filter((o) => o.resolution === 'open');
  const conflicting = openObjections.filter((o) => o.severity !== 'note').length;
  const unresolvedWeight = openObjections.reduce((n, o) => n + objectionWeight(o.severity), 0);
  const variance = stdev(input.agent_positions.map((p) => p.confidence));

  const terms = [
    { key: 'conflicting_findings', weight: 30, normalised: clamp01(conflicting / 4), explanation: `${conflicting} open material or blocking findings / 4` },
    { key: 'evidence_conflicts', weight: 25, normalised: clamp01(input.evidence_conflicts / 3), explanation: `${input.evidence_conflicts} evidence conflicts / 3` },
    { key: 'confidence_variance', weight: 25, normalised: clamp01(variance / 0.35), explanation: `stdev of ${input.agent_positions.length} agent confidences = ${round(variance)} / 0.35` },
    { key: 'unresolved_objections', weight: 20, normalised: clamp01(unresolvedWeight / 4), explanation: `weighted open objections ${unresolvedWeight} / 4 (blocking counts double)` },
  ].map((t) => ({ ...t, contribution: round(t.weight * t.normalised, 2) }));

  return { value: round(terms.reduce((n, t) => n + t.contribution, 0), 1), terms };
}

export function computeScore(input: ScoringInput): ScoreResult {
  const policy = input.policy ?? DEFAULT_POLICY;
  const perCluster = bestPerCluster(input.evidence);
  const clusters = Math.max(input.cluster_count, perCluster.length === 0 ? 0 : perCluster.length);

  // ---- factor 1: evidence strength, over distinct clusters only
  const strengthSum = perCluster.reduce((n, e) => n + effectiveReliability(e) * e.relevance, 0);
  const evidence_strength = clamp01(strengthSum / policy.evidence_reference_clusters);

  // ---- factor 2: source reliability
  const source_reliability = perCluster.length === 0 ? 0 : clamp01(perCluster.reduce((n, e) => n + effectiveReliability(e), 0) / perCluster.length);

  // ---- factor 3: recurrence across distinct time buckets
  const signal_recurrence = clamp01(input.recurrence_buckets / Math.max(1, input.window_buckets));

  // ---- factor 4: independent sources (distinct publishers, one per cluster)
  // Independence is about corroboration of an *incident*. A regulatory citation is tier 1 and does
  // count towards source quality, but it can never make an event independently reported, so structure
  // evidence is excluded here. Without this, the governance officer could satisfy the escalation gate
  // on its own by citing more law.
  const identities = new Set(perCluster.filter((e) => e.incident_claim).map((e) => e.source_identity));
  const independent_evidence_count = identities.size;
  const independence_norm = clamp01(independent_evidence_count / policy.escalate_min_independent_sources);

  // ---- factor 5: potential impact (modelled upper bound, not a probability)
  const potential_impact = input.pattern === null ? 0 : clamp01(SEVERITY_WEIGHT[input.pattern.severity] * clamp01(input.scope_breadth));

  // ---- factor 6: time sensitivity
  const ageDays = input.newest_evidence_at === null ? null : Math.max(0, (Date.parse(input.now) - Date.parse(input.newest_evidence_at)) / 86_400_000);
  const recency = ageDays === null || Number.isNaN(ageDays) ? 0 : Math.exp(-ageDays / 60);
  const deadline = input.regulatory_deadline_days === null ? 0 : clamp01(1 - input.regulatory_deadline_days / 180);
  const time_sensitivity = clamp01(Math.max(recency, deadline));

  // ---- factor 7: false positive risk
  const ungated_ratio = input.total_false_positive_gates === 0 ? 0 : clamp01(input.ungated_false_positives / input.total_false_positive_gates);
  const duplicate_ratio = clamp01(input.possible_duplicate_pairs / Math.max(1, clusters));
  const single_cluster_dependence = clusters <= 1 ? 1 : clamp01(1 / clusters);
  const circularity = input.circular_support_count > 0 ? 1 : 0;
  const false_positive_risk = clamp01(
    (0.4 * ungated_ratio + 0.3 * duplicate_ratio + 0.2 * single_cluster_dependence + 0.1 * circularity) * policy.fp_risk_multiplier,
  );

  // ---- factors 8 and 9: agreement and disagreement
  const supporting = input.agent_positions.filter((p) => p.reasoning_status === 'supported' || p.reasoning_status === 'partially_supported').length;
  const agent_agreement = input.agent_positions.length === 0 ? 0 : clamp01(supporting / input.agent_positions.length);
  const disagreement_index = computeDisagreementIndex(input);
  const agent_disagreement = clamp01(disagreement_index.value / 100);

  // ---- factor 10: uncertainty
  const unknownShare = input.pattern === null ? 1 : clamp01(input.pattern.unknown_share);
  const uncertainty = clamp01(0.7 * unknownShare + 0.3 * clamp01(input.declared_uncertainties / 5));

  const factors: Record<FactorKey, Factor> = {
    evidence_strength: {
      key: 'evidence_strength',
      label: 'Evidence strength',
      value: round(evidence_strength),
      explanation: `${perCluster.length} distinct cluster(s), summed reliability x relevance = ${round(strengthSum)}, over a reference base of ${policy.evidence_reference_clusters}`,
    },
    source_reliability: {
      key: 'source_reliability',
      label: 'Source reliability',
      value: round(source_reliability),
      explanation: perCluster.length === 0 ? 'no supporting evidence' : `mean tier weight of ${perCluster.length} cluster representative(s): ${perCluster.map((e) => `${e.id} T${e.tier}=${round(effectiveReliability(e), 2)}`).join(', ')}`,
    },
    signal_recurrence: {
      key: 'signal_recurrence',
      label: 'Signal recurrence',
      value: round(signal_recurrence),
      explanation: `${input.recurrence_buckets} distinct 7-day bucket(s) with an independent cluster / ${Math.max(1, input.window_buckets)} bucket(s) in the window`,
    },
    independent_evidence_count: {
      key: 'independent_evidence_count',
      label: 'Independent sources',
      value: round(independence_norm),
      explanation: `${independent_evidence_count} distinct publisher(s) across clusters (${[...identities].join(', ') || 'none'}), against ${policy.escalate_min_independent_sources} required for escalation`,
    },
    potential_impact: {
      key: 'potential_impact',
      label: 'Potential impact',
      value: round(potential_impact),
      explanation: input.pattern === null ? 'no taxonomy pattern matched, so no modelled impact' : `pattern severity ${input.pattern.severity} (${SEVERITY_WEIGHT[input.pattern.severity]}) x scope breadth ${round(clamp01(input.scope_breadth), 2)}; modelled upper bound, not a probability`,
    },
    time_sensitivity: {
      key: 'time_sensitivity',
      label: 'Time sensitivity',
      value: round(time_sensitivity),
      explanation: `newest evidence ${ageDays === null ? 'undated' : `${Math.round(ageDays)} day(s) old`} (recency ${round(recency, 2)})${input.regulatory_deadline_days === null ? ', no dated regulatory obligation' : `, obligation in ${input.regulatory_deadline_days} day(s) (${round(deadline, 2)})`}`,
    },
    false_positive_risk: {
      key: 'false_positive_risk',
      label: 'False-positive risk',
      value: round(false_positive_risk),
      explanation: `0.4 x ungated gates ${round(ungated_ratio, 2)} + 0.3 x possible duplicates ${round(duplicate_ratio, 2)} + 0.2 x single-cluster dependence ${round(single_cluster_dependence, 2)} + 0.1 x circular support ${circularity}${policy.fp_risk_multiplier !== 1 ? `, x lesson multiplier ${policy.fp_risk_multiplier}` : ''}`,
    },
    agent_agreement: {
      key: 'agent_agreement',
      label: 'Agent agreement',
      value: round(agent_agreement),
      explanation: `${supporting} of ${input.agent_positions.length} agent position(s) support the lead hypothesis; agreement never raises confidence on its own`,
    },
    agent_disagreement: {
      key: 'agent_disagreement',
      label: 'Agent disagreement',
      value: round(agent_disagreement),
      explanation: `disagreement index ${disagreement_index.value} / 100`,
    },
    uncertainty: {
      key: 'uncertainty',
      label: 'Uncertainty',
      value: round(uncertainty),
      explanation: `0.7 x unknown indicator weight ${round(unknownShare, 2)} + 0.3 x declared uncertainties ${input.declared_uncertainties}/5`,
    },
  };

  // ---- composites
  const confidence_raw =
    0.34 * evidence_strength + 0.22 * source_reliability + 0.18 * signal_recurrence + 0.16 * independence_norm + 0.1 * agent_agreement;
  let confidence: number | null = clamp01(confidence_raw * (1 - 0.5 * false_positive_risk) * (1 - 0.4 * uncertainty));

  const caps_applied: string[] = [];
  const gates_failed: string[] = [];

  const incidentEvidence = perCluster.filter((e) => e.incident_claim);
  const allTierFive = perCluster.length > 0 && perCluster.every((e) => e.tier === 5);
  const onlyPortfolioKb = incidentEvidence.length > 0 && incidentEvidence.every((e) => e.tier === 4);
  const blocking = [...input.challenges, ...input.red_team].filter((o) => o.severity === 'blocking' && o.resolution === 'open');

  if (independent_evidence_count < policy.min_independent_sources) {
    confidence = Math.min(confidence, 0.35);
    caps_applied.push(`confidence capped at 0.35: ${independent_evidence_count} independent source(s), policy requires ${policy.min_independent_sources}`);
  }
  if (allTierFive) {
    confidence = 0;
    caps_applied.push('confidence set to 0: every supporting item is tier-5 model reasoning, which is not evidence');
  }
  if (onlyPortfolioKb) {
    confidence = Math.min(confidence, 0.45);
    caps_applied.push('confidence capped at 0.45: the incident claim rests only on tier-4 knowledge base structure, which is not an incident');
  }
  if (policy.required_min_tier !== null && !perCluster.some((e) => e.tier <= (policy.required_min_tier as number))) {
    confidence = Math.min(confidence, 0.35);
    caps_applied.push(`confidence capped at 0.35: a lesson requires at least one tier-${policy.required_min_tier} source and none is present`);
  }

  let confidence_blocked_reason: string | null = null;
  if (blocking.length > 0) {
    confidence_blocked_reason = `${blocking.length} unresolved blocking finding(s): no confidence figure is published while the investigation is contested`;
    confidence = null;
  }

  const severity_score = round(potential_impact);
  const severity_band: SeverityBand = severity_score >= 0.75 ? 'CRITICAL' : severity_score >= 0.5 ? 'HIGH' : severity_score >= 0.25 ? 'MEDIUM' : 'LOW';

  const severityIndex = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[severity_band];
  const irreversibility = { reversible: 0, hard_to_reverse: 0.5, irreversible: 1 }[input.reversibility];
  const urgencyScore = 0.5 * (severityIndex / 3) + 0.35 * time_sensitivity + 0.15 * irreversibility;
  const urgency: Urgency = urgencyScore >= 0.66 ? 'IMMEDIATE' : urgencyScore >= 0.4 ? 'ELEVATED' : 'ROUTINE';

  // ---- action band: the highest rung whose requirements are all met.
  //
  // This is a ladder of requirements, not a penalty count. Subtracting one rung per failed gate would
  // let four ordinary shortfalls collapse a real, multi-publisher signal to "nothing to see", which is
  // how a system trains its users to ignore it. Every unmet escalation requirement is still named in
  // gates_failed so the brief can print exactly what was missing.
  const bestIncidentTier = incidentEvidence.length === 0 ? null : Math.min(...incidentEvidence.map((e) => e.tier));

  const escalateRequirements: Array<[boolean, string]> = [
    [confidence !== null, 'unresolved blocking finding(s): escalation withheld'],
    [confidence !== null && confidence >= policy.escalate_min_confidence, `confidence ${confidence === null ? 'withheld' : round(confidence, 2)} below ${policy.escalate_min_confidence}`],
    [independent_evidence_count >= policy.escalate_min_independent_sources, `${independent_evidence_count} independent source(s), ${policy.escalate_min_independent_sources} required to escalate`],
    [false_positive_risk < policy.escalate_max_fp_risk, `false-positive risk ${round(false_positive_risk, 2)} at or above ${policy.escalate_max_fp_risk}`],
    // The tier gate is judged on incident evidence only. A regulator citation is tier 1 and belongs in
    // the record, but it describes an obligation - it can never be well-sourced proof of an event.
    [bestIncidentTier !== null && bestIncidentTier <= 2, bestIncidentTier === null ? 'no incident evidence at all: there is nothing to act on' : 'no tier-1 or tier-2 source supports the incident claim'],
    [input.pattern !== null, 'no taxonomy pattern matched, so an escalation has no described mechanism'],
  ];
  for (const [met, reason] of escalateRequirements) if (!met) gates_failed.push(reason);

  // Investigating is how an open objection gets resolved, so a blocking finding does not forbid it.
  const canInvestigate = incidentEvidence.length > 0 && independent_evidence_count >= policy.min_independent_sources && false_positive_risk <= 0.6;
  const canMonitor = incidentEvidence.length > 0;

  let band: ActionBand = gates_failed.length === 0 ? 'ESCALATE' : canInvestigate ? 'TARGETED_INVESTIGATION' : canMonitor ? 'MONITOR' : 'NOTE';

  if (false_positive_risk > 0.6) {
    band = 'NOTE';
    caps_applied.push(`action band capped at NOTE: false-positive risk ${round(false_positive_risk, 2)} above 0.6`);
  }
  if (blocking.length > 0 && band !== 'NOTE') {
    band = 'MONITOR';
    caps_applied.push('action band capped at MONITOR: an unresolved blocking finding stands');
  }
  return {
    factors,
    disagreement_index,
    independent_evidence_count,
    confidence: confidence === null ? null : round(confidence),
    confidence_blocked_reason,
    confidence_raw: round(confidence_raw),
    severity_score,
    severity_band,
    urgency,
    action_band: band,
    caps_applied,
    gates_failed,
    policy,
  };
}
