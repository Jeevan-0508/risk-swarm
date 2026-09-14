/**
 * The RISK//SWARM domain model. Zod is the single source of truth: every type is inferred from
 * the schema that validates it, so an agent cannot introduce a node shape the graph does not know.
 */
import { z } from 'zod';

export const AGENT_IDS = [
  'scout',
  'intelligence',
  'risk_analyst',
  'governance_officer',
  'challenger',
  'red_team',
  'decision_engine',
] as const;
export const AgentId = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof AgentId>;

export const Author = z.union([AgentId, z.literal('human'), z.literal('orchestrator')]);
export type Author = z.infer<typeof Author>;

/** Source hierarchy. 1 is strongest, 5 (LLM reasoning) carries zero evidential weight. */
export const Tier = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type Tier = z.infer<typeof Tier>;

/**
 * Source kinds. The first five are the original set and their tiers are unchanged. `academic`,
 * `statistical_body` and `reference_work` were added when research stopped being freight-only: an
 * OpenAlex paper, a World Bank series and a Wikipedia article are none of the original five, and
 * calling any of them `news` or `portfolio_kb` would have been a lie about where the claim came from.
 */
export const SourceType = z.enum([
  'regulator', 'industry_body', 'news', 'portfolio_kb', 'llm_reasoning',
  'academic', 'statistical_body', 'reference_work',
]);
export type SourceType = z.infer<typeof SourceType>;

/**
 * Fixed mapping. Agents never choose their own tier.
 *
 * `reference_work` sits at tier 3 rather than tier 4 on purpose: tier 4 carries a higher weight than
 * news because it is our own reviewed knowledge base, and an encyclopedia is not that. It is a
 * secondary summary of other sources and is weighted like one.
 */
export const TIER_OF_SOURCE_TYPE: Record<SourceType, Tier> = {
  regulator: 1,
  industry_body: 2,
  news: 3,
  portfolio_kb: 4,
  llm_reasoning: 5,
  academic: 2,
  statistical_body: 2,
  reference_work: 3,
};

/** Reliability weight per tier. Tier 5 is deliberately 0: reasoning is not evidence. */
export const TIER_WEIGHT: Record<Tier, number> = { 1: 1.0, 2: 0.8, 3: 0.55, 4: 0.7, 5: 0.0 };

export const Phase = z.enum(['pre_award', 'in_transit', 'post_event']);
export type Phase = z.infer<typeof Phase>;

/** Unknown is a first-class state and is never folded into 'absent'. */
export const IndicatorState = z.enum(['present', 'absent', 'unknown']);
export type IndicatorState = z.infer<typeof IndicatorState>;

export const FindingSeverity = z.enum(['note', 'material', 'blocking']);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const SeverityBand = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type SeverityBand = z.infer<typeof SeverityBand>;

export const Urgency = z.enum(['ROUTINE', 'ELEVATED', 'IMMEDIATE']);
export type Urgency = z.infer<typeof Urgency>;

export const ActionBand = z.enum(['NOTE', 'MONITOR', 'TARGETED_INVESTIGATION', 'ESCALATE']);
export type ActionBand = z.infer<typeof ActionBand>;
export const ACTION_LADDER: ActionBand[] = ['NOTE', 'MONITOR', 'TARGETED_INVESTIGATION', 'ESCALATE'];

export const ReasoningStatus = z.enum([
  'supported',
  'partially_supported',
  'hypothesis_only',
  'insufficient_evidence',
]);
export type ReasoningStatus = z.infer<typeof ReasoningStatus>;

export const NodeKind = z.enum([
  'signal',
  'observation',
  'hypothesis',
  'evidence',
  'challenge',
  'red_team_finding',
  'decision',
  'action',
  'outcome',
  'lesson',
]);
export type NodeKind = z.infer<typeof NodeKind>;

export const EdgeKind = z.enum([
  'observed_as',
  'supports',
  'weakens',
  'corroborates',
  'based_on',
  'triggers',
  'realised_by',
  'derived_from',
  'cites',
  'supersedes',
]);
export type EdgeKind = z.infer<typeof EdgeKind>;

const unit = z.number().min(0).max(1);
const isoDate = z.string().min(4);

const envelope = {
  id: z.string().min(2),
  created_at: isoDate,
  created_by: Author,
  run_id: z.string().min(1),
  supersedes: z.string().nullable().default(null),
};

// ---------------------------------------------------------------------------- evidence

export const Evidence = z.object({
  ...envelope,
  kind: z.literal('evidence'),
  source: z.string().min(1),
  source_type: SourceType,
  tier: Tier,
  url: z.string().url().nullable(),
  title: z.string().min(1),
  /** ISO date or null. Never inferred from retrieval time. */
  publication_date: isoDate.nullable(),
  retrieved_at: isoDate,
  /** The single assertion this evidence is offered in support of. */
  claim: z.string().min(1),
  excerpt_or_summary: z.string(),
  reliability: unit,
  relevance: unit,
  agents_that_used_it: z.array(AgentId).default([]),
  /** Set by INTELLIGENCE. Same cluster means NOT independent. */
  cluster_id: z.string().nullable().default(null),
  injection_suspected: z.boolean().default(false),
  /** True when the claim is about a concrete incident rather than about structure/knowledge. */
  incident_claim: z.boolean().default(false),
});
export type Evidence = z.infer<typeof Evidence>;

// ---------------------------------------------------------------------------- signal

export const Signal = z.object({
  ...envelope,
  kind: z.literal('signal'),
  title: z.string().min(1),
  source: z.string().min(1),
  occurred_at: isoDate.nullable(),
  geo: z.array(z.string()).default([]),
  mode: z.array(z.string()).default([]),
  /** Category as published upstream. Not trusted. */
  category_upstream: z.string(),
  /** Category re-derived here by keyword check. */
  category_derived: z.string(),
  category_confidence: unit,
  category_disagreement: z.boolean(),
  source_severity_hint: z.string().nullable().default(null),
  evidence_ids: z.array(z.string()).min(1),
  cluster_id: z.string().nullable().default(null),
});
export type Signal = z.infer<typeof Signal>;

// ---------------------------------------------------------------------------- observation

export const Observation = z.object({
  ...envelope,
  kind: z.literal('observation'),
  /** A deterministic statement over signals: a count, a rate, a cluster, a delta. */
  statement: z.string().min(1),
  method: z.string().min(1),
  inputs: z.array(z.string()),
  computed_value: z.union([z.number(), z.string()]),
  window: z.object({ from: isoDate, to: isoDate }),
});
export type Observation = z.infer<typeof Observation>;

// ---------------------------------------------------------------------------- hypothesis

export const HypothesisStatus = z.enum([
  'open',
  'supported',
  'insufficient_evidence',
  'refuted',
  'blocked',
]);
export type HypothesisStatus = z.infer<typeof HypothesisStatus>;

export const Hypothesis = z.object({
  ...envelope,
  kind: z.literal('hypothesis'),
  statement: z.string().min(1),
  /** A hypothesis with no stated falsification test is invalid. */
  falsification_test: z.string().min(8),
  pattern_id: z.string().nullable().default(null),
  status: HypothesisStatus,
  scope: z.object({ geo: z.array(z.string()), mode: z.array(z.string()) }),
});
export type Hypothesis = z.infer<typeof Hypothesis>;

// ---------------------------------------------------------------------------- challenge / red team

export const Challenge = z.object({
  ...envelope,
  kind: z.literal('challenge'),
  target_id: z.string().min(2),
  severity: FindingSeverity,
  argument: z.string().min(1),
  /** A challenge must name a concrete deficiency, gate or benign alternative. */
  basis: z.enum(['ungated_false_positive', 'alternative_explanation', 'evidence_deficiency']),
  alternative_explanation: z.string().nullable(),
  evidence_ids: z.array(z.string()).default([]),
  resolution: z.enum(['open', 'accepted', 'rebutted']).default('open'),
  rebuttal: z.string().nullable().default(null),
});
export type Challenge = z.infer<typeof Challenge>;

export const RedTeamClass = z.enum([
  'hallucination',
  'unsupported_claim',
  'weak_source_chain',
  'duplicate_evidence',
  'same_source_echo',
  'confirmation_bias',
  'circular_reasoning',
  'correlation_as_causation',
  'normal_variation',
  'regulatory_misinterpretation',
  'impact_overestimate',
  'missing_evidence',
]);
export type RedTeamClass = z.infer<typeof RedTeamClass>;

export const RedTeamFinding = z.object({
  ...envelope,
  kind: z.literal('red_team_finding'),
  target_id: z.string().min(2),
  finding_class: RedTeamClass,
  severity: FindingSeverity,
  argument: z.string().min(1),
  evidence_ids: z.array(z.string()).default([]),
  /** What would clear it. Deliberately explicit: a finding is not a mood. */
  clears_when: z.string().min(1),
  resolution: z.enum(['open', 'accepted', 'rebutted']).default('open'),
});
export type RedTeamFinding = z.infer<typeof RedTeamFinding>;

// ---------------------------------------------------------------------------- governance

export const RegulatoryImplication = z.object({
  requirement_id: z.string(),
  framework: z.string(),
  ref: z.string(),
  citation: z.string(),
  url: z.string().url().nullable(),
  title: z.string(),
  /** 'established' demands a tier-1 citation naming the obligation. */
  applicability: z.enum(['established', 'possible', 'not_established']),
  reasoning: z.string(),
  control_ids: z.array(z.string()).default([]),
  evidence_ids: z.array(z.string()).default([]),
});
export type RegulatoryImplication = z.infer<typeof RegulatoryImplication>;

// ---------------------------------------------------------------------------- decision chain

export const Decision = z.object({
  ...envelope,
  kind: z.literal('decision'),
  question: z.string(),
  hypothesis_ids: z.array(z.string()),
  headline_risk: z.string(),
  severity_band: SeverityBand,
  severity_score: unit,
  confidence: unit.nullable(),
  confidence_blocked_reason: z.string().nullable().default(null),
  urgency: Urgency,
  action_band: ActionBand,
  /** Every gate that reduced the band, named. */
  gates_failed: z.array(z.string()).default([]),
  caps_applied: z.array(z.string()).default([]),
  rationale: z.array(z.string()),
  unresolved_objections: z.array(z.string()).default([]),
  owner_role: z.string(),
  review_by: isoDate,
  regulatory_implications: z.array(RegulatoryImplication).default([]),
  decided_by: z.enum(['system_recommendation', 'human']),
  human_note: z.string().nullable().default(null),
  human_verdict: z.enum(['accepted', 'overridden', 'rejected']).nullable().default(null),
});
export type Decision = z.infer<typeof Decision>;

export const Action = z.object({
  ...envelope,
  kind: z.literal('action'),
  decision_id: z.string(),
  text: z.string().min(1),
  owner_role: z.string(),
  due: isoDate,
  /** Recommended actions come from real countermeasure ids, never generated prose. */
  countermeasure_id: z.string().nullable().default(null),
  class: z.enum(['preventive', 'detective', 'responsive', 'investigative']),
});
export type Action = z.infer<typeof Action>;

export const Outcome = z.object({
  ...envelope,
  kind: z.literal('outcome'),
  decision_id: z.string(),
  what_happened: z.string().min(1),
  verdict: z.enum(['correct', 'false_positive', 'false_negative', 'partially_correct']),
  useful_evidence_ids: z.array(z.string()).default([]),
  misleading_evidence_ids: z.array(z.string()).default([]),
  agent_scorecard: z.record(AgentId, z.enum(['correct', 'wrong', 'mixed', 'not_assessed'])),
});
export type Outcome = z.infer<typeof Outcome>;

/** A lesson may only tighten. It can never lower a gate, so it cannot be poisoned. */
export const ScoringPolicyDelta = z.object({
  pattern_key: z.string().min(1),
  min_independent_sources: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  fp_risk_multiplier: z.number().min(1).max(1.5).optional(),
  required_min_tier: z.union([z.literal(1), z.literal(2)]).optional(),
  expires_after_runs: z.number().int().positive().optional(),
});
export type ScoringPolicyDelta = z.infer<typeof ScoringPolicyDelta>;

export const Lesson = z.object({
  ...envelope,
  kind: z.literal('lesson'),
  outcome_id: z.string(),
  pattern_key: z.string(),
  rule: ScoringPolicyDelta,
  rationale: z.string().min(1),
  runs_applied: z.number().int().min(0).default(0),
});
export type Lesson = z.infer<typeof Lesson>;

// ---------------------------------------------------------------------------- graph

export const GraphNode = z.discriminatedUnion('kind', [
  Evidence,
  Signal,
  Observation,
  Hypothesis,
  Challenge,
  RedTeamFinding,
  Decision,
  Action,
  Outcome,
  Lesson,
]);
export type GraphNode = z.infer<typeof GraphNode>;

export const Edge = z.object({
  from: z.string(),
  to: z.string(),
  kind: EdgeKind,
  weight: z.number().min(0).max(5).default(1),
  created_by: Author,
});
export type Edge = z.infer<typeof Edge>;

export const NODE_KIND_OF: Record<NodeKind, true> = {
  signal: true,
  observation: true,
  hypothesis: true,
  evidence: true,
  challenge: true,
  red_team_finding: true,
  decision: true,
  action: true,
  outcome: true,
  lesson: true,
};

// ---------------------------------------------------------------------------- deliberation (Council)

/**
 * The Council's event vocabulary. A `DeliberationEvent` is deliberately never a `GraphNode`: it does
 * not revise or supersede anything the seven agents produced, and the append-only graph's
 * citation/cycle guards are the wrong shape for a conversation tree of who asked whom. It is its own
 * append-only log, generated once, in one deterministic pass, over an already-completed `RunResult`
 * (see `core/deliberation/coordinator.ts`). It may *reference* a real graph node id (evidence,
 * hypothesis, challenge, finding, decision) by string - exactly what SENTINEL's existing citation
 * check already knows how to validate - but it is never itself a citable id.
 */
export const DeliberationEventType = z.enum([
  'question',
  'answer',
  'challenge',
  'defense',
  'rebuttal',
  'revision',
  'agreement',
  'disagreement',
  'objection',
  'clarification',
  'escalation',
  'resolution',
]);
export type DeliberationEventType = z.infer<typeof DeliberationEventType>;

/** The status of this event itself, fixed at the moment it was generated. Never mutated afterward - a
 *  later development in the deliberation is always a new event with a `parent_event_id`, not an edit
 *  to this one. Council's deliberation is a synthesis over a completed run, not a live interactive
 *  loop, so the final resolution of everything this event is about is already known when it is minted. */
export const DeliberationEventStatus = z.enum(['open', 'resolved', 'unresolved']);
export type DeliberationEventStatus = z.infer<typeof DeliberationEventStatus>;

/**
 * The council's final position. Never `CONSENSUS` by default: it is derived from
 * `ScoreResult.disagreement_index` and `Decision.unresolved_objections`, which are already
 * authoritative, never recomputed or asserted independently of them. `LIMIT_REACHED` is published
 * when a termination budget stopped the deliberation before it could resolve - this is never silently
 * read as agreement.
 */
export const DeliberationOutcome = z.enum(['CONSENSUS', 'QUALIFIED_CONSENSUS', 'MATERIAL_DISAGREEMENT', 'UNRESOLVED', 'LIMIT_REACHED']);
export type DeliberationOutcome = z.infer<typeof DeliberationOutcome>;

export const DeliberationEvent = z.object({
  id: z.string().min(2),
  run_id: z.string().min(1),
  sequence: z.number().int().min(0),
  /** The run's own completion instant (the decision node's `created_at`), not a distinct per-event
   *  wall-clock moment - this system has no live per-event clock, and inventing one would fabricate a
   *  precision it does not have. `sequence`, not `timestamp`, is the event's true ordering. */
  timestamp: isoDate,
  from_agent: AgentId,
  /** `null` means addressed to the council as a whole, not to one named agent. */
  to_agent: AgentId.nullable(),
  type: DeliberationEventType,
  /** Deterministic content only: every substring is copied from a real field on a real agent output
   *  (an argument, a rationale line, a `recommended_next_step`), never phrased freely. */
  content: z.string().min(1),
  /** Real evidence node ids this event rests on. Filtered against the graph at generation time, so a
   *  dangling id can never enter this array in the first place - see `keepKnown` in the coordinator. */
  evidence_ids: z.array(z.string()).default([]),
  /** Ids of the real graph nodes (hypothesis, challenge, finding, decision) this event is about. */
  claim_ids: z.array(z.string()).default([]),
  parent_event_id: z.string().nullable().default(null),
  status: DeliberationEventStatus,
  requires_response: z.boolean().default(false),
});
export type DeliberationEvent = z.infer<typeof DeliberationEvent>;

