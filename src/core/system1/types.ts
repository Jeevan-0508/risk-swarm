/**
 * QUARANTINED EXPERIMENTAL SYSTEM-1 / SYSTEM-2 compatibility contract.
 * This architecture is not imported by the normal application entrypoint or freight orchestrator;
 * it remains testable in isolation until a future phase assigns it a production owner.
 *
 * Laya and Jev are typed-decision models: they return a stance from a fixed candidate set plus a
 * confidence, never generated prose. This is a different shape from `core/reasoner/types.ts`'s
 * `Reasoner` (which produces free-text-shaped JSON from an LLM) on purpose — forcing a typed-decision
 * model through the LLM reasoning seam would mean fabricating a `reasoning_summary` neither model
 * actually produced. System-1 gets its own, narrower contract instead.
 *
 * Field names follow this repo's snake_case convention (`core/domain/model.ts`), not the directive's
 * illustrative camelCase pseudocode — same fields, this repo's casing.
 */
import { z } from 'zod';

/** SYSTEM-1 directive §3/§4: the only four honest states a model integration may report. */
export const ModelStatus = z.enum(['LIVE', 'SHADOW', 'UNAVAILABLE', 'ERROR']);
export type ModelStatus = z.infer<typeof ModelStatus>;

/**
 * A case System-1 is asked to make a fast call on. `state` is the natural-language context Laya's
 * `predict()` reads (its `state` argument accepts string/dict/array; a string is the honest choice
 * here since System-1 has no structured fraud-case object to hand it — that lives in SWARM's own
 * domain model). `candidate_stances` is the fixed choice set both models answer over; it defaults to
 * SWARM's own `ACTION_LADDER` (`core/domain/model.ts`) for freight-fraud cases, but is a parameter so
 * an open-domain question (Council) can supply its own set rather than being forced through a
 * taxonomy that doesn't apply to it.
 */
export const System1Case = z.object({
  case_id: z.string().min(1),
  question: z.string().min(1),
  state: z.string().min(1),
  candidate_stances: z.array(z.string().min(1)).min(2),
  /** Caller-supplied, never inferred by System-1 itself — SYSTEM-1 directive §8: "Never allow
   * confidence alone to override risk policy." A model must not be trusted to grade its own stakes. */
  risk_hint: z.enum(['low', 'medium', 'high']).nullable().default(null),
});
export type System1Case = z.infer<typeof System1Case>;

/** SYSTEM-1 directive §5's common result contract. */
export const System1Result = z.object({
  case_id: z.string(),
  model_id: z.string(),
  model_version: z.string().nullable(),
  decision: z.string(),
  confidence: z.number().min(0).max(1),
  /** Normalized Shannon entropy in [0,1] of a real probability distribution, or null when the model
   * exposes none. Never derived from `confidence` — that would just be confidence twice. */
  uncertainty: z.number().min(0).max(1).nullable(),
  /** Laya/Jev return floats, not text — there is no natural-language rationale to report. Stating
   * that honestly beats fabricating one to fill the field (directive §5: "never flatten into prose"). */
  rationale: z.string(),
  evidence_ids: z.array(z.string()),
  latency_ms: z.number().min(0),
  status: ModelStatus,
  /** Model-specific metadata, kept separate from the common contract above (directive §5). */
  raw: z.record(z.unknown()).nullable(),
});
export type System1Result = z.infer<typeof System1Result>;

export function unavailableResult(args: {
  case_id: string;
  model_id: string;
  model_version: string | null;
  reason: string;
  latency_ms?: number;
}): System1Result {
  return {
    case_id: args.case_id,
    model_id: args.model_id,
    model_version: args.model_version,
    decision: 'UNAVAILABLE',
    confidence: 0,
    uncertainty: null,
    rationale: args.reason,
    evidence_ids: [],
    latency_ms: args.latency_ms ?? 0,
    status: 'UNAVAILABLE',
    raw: null,
  };
}

export function errorResult(args: {
  case_id: string;
  model_id: string;
  model_version: string | null;
  reason: string;
  latency_ms: number;
}): System1Result {
  return {
    case_id: args.case_id,
    model_id: args.model_id,
    model_version: args.model_version,
    decision: 'ERROR',
    confidence: 0,
    uncertainty: null,
    rationale: args.reason,
    evidence_ids: [],
    latency_ms: args.latency_ms,
    status: 'ERROR',
    raw: null,
  };
}
