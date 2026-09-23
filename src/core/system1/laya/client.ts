/**
 * `callLaya()` — SYSTEM-1 directive §3, common contract §5. One real success path: the requested
 * checkpoint's `runtime.ts` subprocess call to the actual `laya` package. Any registry miss, missing
 * input, or a real runtime error fails closed to `ERROR`/`UNAVAILABLE` — this module never invents a
 * result (directive §26: "do not fabricate inference").
 *
 * `deps.runner` exists so tests can inject a fixture-backed stand-in instead of spawning a real
 * subprocess that needs torch/uv/network; the default (`callLayaSubprocess`) is what production and
 * the evaluation harness actually use.
 */
import { findLayaProfile } from './registry';
import { callLayaSubprocess, mapLayaAnswer, type LayaInferenceInput, type LayaQuestion, type LayaRuntimeResult } from './runtime';
import { errorResult, type System1Case, type System1Result } from '../types';

export type LayaCallDeps = {
  runner?: (input: LayaInferenceInput) => LayaRuntimeResult;
  now?: () => number;
};

const QUESTION_ID = 'q';

export async function callLaya(
  modelId: string,
  input: System1Case,
  deps: LayaCallDeps = {},
): Promise<System1Result> {
  const profile = findLayaProfile(modelId);
  const now = deps.now ?? (() => Date.now());
  const t0 = now();

  if (!profile) {
    return errorResult({
      case_id: input.case_id,
      model_id: modelId,
      model_version: null,
      reason: `"${modelId}" is not a known Laya checkpoint — see laya/registry.ts.`,
      latency_ms: now() - t0,
    });
  }

  const question: LayaQuestion = {
    type: 'choice',
    instructions: input.question,
    criteria: input.candidate_stances,
  };

  const runner = deps.runner ?? callLayaSubprocess;
  const raw = runner({
    checkpoint: profile.checkpoint,
    state: input.state,
    questions: { [QUESTION_ID]: question },
  });

  if (!raw.ok) {
    return errorResult({
      case_id: input.case_id,
      model_id: modelId,
      model_version: profile.checkpoint,
      reason: `laya runtime call failed: ${raw.error}`,
      latency_ms: now() - t0,
    });
  }

  const answer = raw.result.answers[QUESTION_ID];
  if (!answer) {
    return errorResult({
      case_id: input.case_id,
      model_id: modelId,
      model_version: profile.checkpoint,
      reason: 'laya runtime returned no answer for the submitted question — failing closed rather than fabricating one.',
      latency_ms: now() - t0,
    });
  }

  const mapped = mapLayaAnswer(answer);

  return {
    case_id: input.case_id,
    model_id: modelId,
    model_version: profile.checkpoint,
    decision: mapped.decision,
    confidence: mapped.confidence,
    uncertainty: mapped.uncertainty,
    rationale: 'Laya returns a typed decision (float scores/choices), never natural-language reasoning — see `raw` for the exact answer.',
    evidence_ids: [],
    latency_ms: Math.round(raw.infer_seconds * 1000),
    status: 'SHADOW',
    raw: mapped.raw,
  };
}
