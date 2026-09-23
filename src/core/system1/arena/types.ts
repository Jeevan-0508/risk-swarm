/**
 * The System-1 Arena's own result shape (SYSTEM-1 directive §6, §7). `positions` mirrors
 * `core/council/types.ts`'s `DisagreementAssessment` shape deliberately (same idea: independent
 * stances + a real agreement signal, never averaged) — but stays its own small type rather than
 * importing the Council's, since that one is typed to exactly three named Olympian agents and this
 * one is typed to whichever System-1 models actually ran.
 */
import type { System1Result } from '../types';

export type DisagreementType =
  | 'CLASSIFICATION'
  | 'CONFIDENCE'
  | 'NOVELTY'
  | 'RISK'
  | 'EVIDENCE'
  | 'POLICY';

export interface ModelDisagreement {
  case_id: string;
  task: string;
  laya_decision: string;
  jev_decision: string | null;
  laya_confidence: number;
  jev_confidence: number | null;
  disagreement_type: DisagreementType;
  detail: string;
}

export interface System1ArenaResult {
  case_id: string;
  laya_result: System1Result;
  /** Null, not a fabricated stand-in, when Jev was never actually callable for this case
   * (directive §9: "SWARM must not blindly trust either model" — an absent second opinion is not
   * the same as an opinion of "no comment", and must not be silently coerced into one). */
  jev_result: System1Result | null;
  agreement: boolean;
  /** `ASSUMED` scaffolding (no measured outcome data exists yet to calibrate against, matching the
   * placeholder-ordering convention `core/scoring/policy.ts` already uses elsewhere in this repo). */
  agreement_score: number;
  confidence_delta: number | null;
  evidence_overlap: number | null;
  latency_ms: { laya: number; jev: number | null; total: number };
  disagreement: ModelDisagreement | null;
}
