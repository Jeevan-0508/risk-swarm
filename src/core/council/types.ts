/**
 * EVOLUTION 6.0 — Council types. An `OlympianPosition` is the structured output of one independent
 * `Reasoner.propose()` call (real or deterministic-fallback); a `CouncilVerdict` is Zeus's synthesis
 * over three such positions. Neither type carries hidden chain-of-thought — `reasoning_summary` is a
 * short, displayable string, never a private scratchpad.
 */
import type { OlympianAgent } from '../reasoner/registry';

export type ReasoningAgent = Exclude<OlympianAgent, 'ZEUS'>;
export const REASONING_AGENTS: ReasoningAgent[] = ['ATHENA', 'ARES', 'HADES'];

export interface OlympianPosition {
  agent: ReasoningAgent;
  /** A short answer/side, e.g. "tiger", "AWS Security Specialty", "insufficient_evidence". Never empty. */
  stance: string;
  confidence: number;
  /** Displayable summary of the reasoning. Not chain-of-thought; a few sentences at most. */
  reasoning_summary: string;
  claims: string[];
  /** Ids from the evidence this agent was given, cited in support of `claims`. Citing an id never supplied is rejected by `assertNoFabricatedCitations`, the same fence every existing agent uses. */
  evidence_ids: string[];
  evidence_requests: string[];
  assumptions: string[];
}

export type VerdictType = 'CONSENSUS' | 'MAJORITY' | 'MINORITY_PRESERVED' | 'UNRESOLVED';

export interface CouncilVerdict {
  verdict_type: VerdictType;
  answer: string;
  confidence: number;
  rationale: string[];
  minority_view: string | null;
  unresolved: string[];
  /** Ids actually used to support the rationale, subject to the same fabrication fence as everything else. */
  cited_evidence_ids: string[];
}

export interface DisagreementAssessment {
  /** True positions only — a degraded (fallback) position does not count as an independent opinion. */
  independent_count: number;
  stances: Record<ReasoningAgent, string>;
  distinct_stances: string[];
  confidence_variance: number;
  agreement: 'strong_consensus' | 'majority' | 'split' | 'inconclusive';
}

export interface CouncilTraceEvent {
  at: string;
  kind:
    | 'summoned' | 'agent_called' | 'position_ready' | 'agent_degraded'
    | 'disagreement_assessed' | 'zeus_called' | 'verdict_ready';
  agent?: OlympianAgent;
  detail: string;
}

export interface CouncilResult {
  question: string;
  positions: Record<ReasoningAgent, { position: OlympianPosition; provider: string; degraded: boolean; degraded_reason: string | null; ms: number; est_tokens: number }>;
  disagreement: DisagreementAssessment;
  verdict: { verdict: CouncilVerdict; provider: string; degraded: boolean; degraded_reason: string | null };
  trace: CouncilTraceEvent[];
  model_diversity: { active_agents: number; providers: number; label: string };
}
