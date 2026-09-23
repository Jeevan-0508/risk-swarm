/**
 * The System-1 router's deterministic policy (directive §8, §9) — pure decision logic only, no
 * model calls. Two decision points, matching the directive's own lazy cascade (§32's diagram:
 * LAYA -> confident? -> JEV -> agree?/disagree -> SWARM), which is deliberately *not* the same thing
 * as `arena/run.ts`'s eager "call both, always" - that one exists for evaluation/benchmarking
 * (directive §21), where every case needs both opinions to score Laya-alone vs Laya+Jev vs SWARM.
 * A real production case should not pay for a Jev call it does not need (directive §23).
 *
 * Every branch is a named directive §8 rule, kept as an ordered if-chain rather than a scored
 * function - directive §8's own closing line is explicit: "Never allow confidence alone to override
 * risk policy." A weighted score would let a high enough confidence buy its way past a risk gate;
 * an ordered chain with `risk_hint` checked first cannot.
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
  action: 'ACCEPT_SYSTEM1' | 'CALL_JEV' | 'ESCALATE_SWARM' | 'ABSTAIN';
  reason: string;
  escalation_trigger: EscalationTrigger;
}

export interface AfterJevDecision {
  action: 'ACCEPT_SYSTEM1' | 'ESCALATE_SWARM';
  reason: string;
  escalation_trigger: EscalationTrigger;
}

/** `ASSUMED` scaffolding (directive §8's own numbers are unspecified: "confident", "sufficient
 * evidence") - same placeholder-ordering convention `core/scoring/policy.ts` already uses
 * elsewhere in this repo, not a value fit to any measured outcome yet (directive §19). */
export const LAYA_CONFIDENT_THRESHOLD = 0.65;

function hasSufficientEvidence(input: System1Case): boolean {
  // System1Case carries no evidence list of its own today (directive Step 2/3 scope) - `state`
  // being non-empty is the only signal available. A real evidence-sufficiency gate needs SWARM's
  // own evidence model (`core/domain/model.ts`'s Evidence nodes), wired in a later slice -
  // documented here rather than faked with an invented threshold.
  return input.state.trim().length > 0;
}

/** First decision point: after Laya answers, before Jev is ever called. */
export function decideAfterLaya(input: System1Case, layaResult: System1Result): AfterLayaDecision {
  if (layaResult.status === 'ERROR') {
    return { action: 'ABSTAIN', reason: `Laya failed (${layaResult.rationale}); no second model has been called yet to fall back to.`, escalation_trigger: 'MODEL_FAILURE' };
  }

  if (input.risk_hint === 'high') {
    return { action: 'ESCALATE_SWARM', reason: 'Case is caller-flagged high-risk; System-1 speed is never traded for risk policy.', escalation_trigger: 'HIGH_RISK' };
  }

  if (!hasSufficientEvidence(input)) {
    return { action: 'ESCALATE_SWARM', reason: 'Case state carries no usable context for a fast call.', escalation_trigger: 'INSUFFICIENT_EVIDENCE' };
  }

  const layaConfident = layaResult.confidence >= LAYA_CONFIDENT_THRESHOLD;

  if (layaConfident && input.risk_hint !== 'medium') {
    return { action: 'ACCEPT_SYSTEM1', reason: `Laya is confident (${layaResult.confidence.toFixed(2)}) on a low-risk case with no contradiction on record.`, escalation_trigger: null };
  }

  return { action: 'CALL_JEV', reason: input.risk_hint === 'medium' ? 'Medium-risk case: a single model is never sufficient alone, regardless of confidence.' : `Laya is not confident enough to accept alone (${layaResult.confidence.toFixed(2)} < ${LAYA_CONFIDENT_THRESHOLD}).`, escalation_trigger: null };
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
    return { action: 'ACCEPT_SYSTEM1', reason: 'Laya and Jev independently agree, with sufficient evidence.', escalation_trigger: null };
  }

  return { action: 'ESCALATE_SWARM', reason: `Laya and Jev disagree (${arena.disagreement?.disagreement_type ?? 'unclassified'}); SWARM must diagnose it.`, escalation_trigger: 'DISAGREEMENT' };
}
