/**
 * The System-1 router's deterministic policy — pure decision logic only, no
 * model calls. Two decision points, matching the directive's own lazy cascade (§32's diagram:
 * LAYA -> confident? -> JEV -> agree?/disagree -> SWARM), which is deliberately *not* the same thing
 * as `arena/run.ts`'s eager "call both, always" - that one exists for evaluation/benchmarking
 * (directive §21), where every case needs both opinions to score Laya-alone vs Laya+Jev vs SWARM.
 * A real production case should not pay for a Jev call it does not need (directive §23).
 *
 * System-1 cases currently have no source-evidence manifest. Laya/Jev outputs are therefore
 * proposals only: a non-empty state string, a model-reported score, or model agreement cannot
 * establish that a claim is supported. Route every usable proposal to SWARM for evidence review.
 */
import type { System1ArenaResult } from '../arena/types';
import type { System1Case, System1Result } from '../types';

export type EscalationTrigger =
  | 'DISAGREEMENT'
  | 'HIGH_RISK'
  | 'INSUFFICIENT_EVIDENCE'
  | 'LOW_CONFIDENCE_NO_JEV'
  | 'MODEL_FAILURE'
  | null;

export interface AfterLayaDecision {
  action: 'CALL_JEV' | 'ESCALATE_SWARM' | 'ABSTAIN';
  reason: string;
  escalation_trigger: EscalationTrigger;
}

export interface AfterJevDecision {
  action: 'ESCALATE_SWARM';
  reason: string;
  escalation_trigger: EscalationTrigger;
}

/** First decision point: after Laya answers, before Jev is ever called. */
export function decideAfterLaya(input: System1Case, layaResult: System1Result): AfterLayaDecision {
  if (layaResult.status === 'ERROR') {
    return { action: 'ABSTAIN', reason: `Laya failed (${layaResult.rationale}); no second model has been called yet to fall back to.`, escalation_trigger: 'MODEL_FAILURE' };
  }

  if (input.risk_hint === 'high') {
    return { action: 'ESCALATE_SWARM', reason: 'Case is caller-flagged high-risk; System-1 speed is never traded for risk policy.', escalation_trigger: 'HIGH_RISK' };
  }

  if (input.state.trim().length === 0) {
    return { action: 'ESCALATE_SWARM', reason: 'Case state is empty; no model proposal can be reviewed.', escalation_trigger: 'INSUFFICIENT_EVIDENCE' };
  }

  return {
    action: 'CALL_JEV',
    reason: input.risk_hint === 'medium'
      ? 'Medium-risk case: obtain a second model proposal, then route both through evidence review.'
      : `Laya returned a model proposal (self-reported score ${layaResult.confidence.toFixed(2)}); this score is not calibrated evidence, so obtain a second proposal and route both for evidence review.`,
    escalation_trigger: null,
  };
}

/** Second decision point: after Jev was actually called (or found unreachable). Reuses the Arena's
 * own comparison (`arena.agreement`/`arena.disagreement`) rather than re-deriving agreement here -
 * one place decides what "agreement" means. */
export function decideAfterJev(arena: System1ArenaResult): AfterJevDecision {
  const jevUsable = arena.jev_result !== null && (arena.jev_result.status === 'LIVE' || arena.jev_result.status === 'SHADOW');

  if (!jevUsable) {
    return { action: 'ESCALATE_SWARM', reason: 'Jev is unavailable - no second opinion exists to resolve an unconfident Laya call.', escalation_trigger: 'LOW_CONFIDENCE_NO_JEV' };
  }

  if (arena.agreement) {
    return { action: 'ESCALATE_SWARM', reason: 'Laya and Jev agree on a proposal, but model agreement is not verification and this case has no source-evidence manifest. Send it for evidence-backed review.', escalation_trigger: 'INSUFFICIENT_EVIDENCE' };
  }

  return { action: 'ESCALATE_SWARM', reason: `Laya and Jev disagree (${arena.disagreement?.disagreement_type ?? 'unclassified'}); SWARM must diagnose it.`, escalation_trigger: 'DISAGREEMENT' };
}
