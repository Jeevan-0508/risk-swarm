export interface InvestigationClaim {
  id: string; asserted_type: 'FACT' | 'INFERENCE' | 'HYPOTHESIS' | 'UNKNOWN';
  epistemic_type: 'INFERENCE' | 'HYPOTHESIS' | 'UNKNOWN'; text: string;
  evidence_ids: string[]; verification: 'unverified'; confidence: null;
}
export interface InvestigationPosition {
  agent: 'ATHENA' | 'ARES' | 'HADES'; role: 'evidence_analysis' | 'adversarial_challenge' | 'alternative_explanations';
  provider: string; model: string | null; model_revision: null; provider_version: null;
  status: 'independent' | 'fallback' | 'unavailable'; stance: string; reasoning_summary: string;
  claims: InvestigationClaim[]; evidence_ids: string[]; evidence_requests: string[]; assumptions: string[];
  latency_ms: number; degraded_reason: string | null;
}
export interface InvestigationDecision {
  data_class: 'model_or_policy_proposal'; state: 'proposed' | 'abstained';
  verdict_type: 'CONSENSUS' | 'MAJORITY' | 'MINORITY_PRESERVED' | 'UNRESOLVED'; answer: string;
  rationale: string[]; minority_view: string | null; unresolved: string[]; cited_evidence_ids: string[];
  provider: string; model: string | null; model_revision: null; provider_version: null;
}
export interface InvestigationSnapshot<C = any> {
  schema_version: 'swarm-investigation-snapshot.v1'; kind: 'risk_swarm_investigation_snapshot'; captured_at: string;
  capture: C;
  analysis: {
    status: 'recorded' | 'not_run'; selected_source_ids: string[]; omitted_source_ids: string[];
    positions: InvestigationPosition[];
    disagreement: null | { independent_count: number; distinct_stances: string[]; agreement: string; independence_scope: 'separate_requests_not_verified_model_independence' };
    decision: InvestigationDecision | null;
    trace: Array<{ at: string; kind: string; agent: string | null; detail: string }>;
  };
  outcome: { status: 'not_observed'; correctness: 'unknown'; record: null };
  unknowns: string[]; knowledge_promotion: 'prohibited';
}
export interface InvestigationReconstruction {
  algorithm: 'frozen-context.v1'; question: string; source_record_ids: string[]; consulted_source_ids: string[];
  context_status: 'incomplete_omitted_sources' | 'complete_for_recorded_analysis'; unavailable_source_ids: string[];
  analysis_status: 'recorded' | 'not_run';
  models: Array<{ agent: string; provider: string; model: string | null; model_revision: null; status: string }>;
  disagreement: InvestigationSnapshot['analysis']['disagreement']; decision: InvestigationDecision | null;
  outcome: InvestigationSnapshot['outcome']; unknowns: string[];
  synthetic_context_used_as_evidence: false; live_provider_calls: 0; knowledge_promoted: false; limitation: string;
}
export interface InvestigationHandoff<C = any> {
  schema_version: 'risk-replay-investigation-handoff.v1'; kind: 'risk_replay_investigation_handoff'; created_at: string;
  review_state: 'unreviewed'; replay_status: 'frozen_context_reconstructed';
  snapshot: InvestigationSnapshot<C>; reconstruction: InvestigationReconstruction;
}
export const INVESTIGATION_CONTRACT_VERSION: 'swarm-investigation-snapshot.v1';
export function validateInvestigationSnapshot<C = any>(value: unknown, validateCapture: (value: unknown) => boolean): {ok: true; value: InvestigationSnapshot<C>} | {ok: false; error: string};
export function reconstructInvestigation(snapshot: InvestigationSnapshot): InvestigationReconstruction;
export function buildReplayInvestigationHandoff<C>(snapshot: InvestigationSnapshot<C>, createdAt: string, validateCapture: (value: unknown) => boolean): InvestigationHandoff<C>;
export function validateReplayInvestigationHandoff<C = any>(value: unknown, validateCapture: (value: unknown) => boolean): {ok: true; value: InvestigationHandoff<C>} | {ok: false; error: string};
