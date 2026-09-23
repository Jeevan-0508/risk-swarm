/**
 * `callJev()` — SYSTEM-1 directive §4, §26. A real (if currently unusable) HTTP client behind
 * `JEV_API_KEY`, so the moment an invite arrives this becomes a live call with no rewrite — not a
 * placeholder that pretends to try. Today `JEV_API_KEY` is never set anywhere in this repo (no
 * invite exists — see `registry.ts`), so every real call fails closed at the "no key" check before
 * any network request is attempted. This module never simulates a Jev response.
 *
 * `deps.fetchImpl`/`deps.apiKey` exist so tests can exercise both the "no key" and "key present but
 * endpoint rejects/errors" paths without a real invite or a real network call.
 */
import { findJevProfile } from './registry';
import { unavailableResult, errorResult, type System1Case, type System1Result } from '../types';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type JevCallDeps = {
  apiKey?: string | undefined;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** TypeSafe AI's real endpoint is not publicly documented (invite-only product) — kept as an
   * overridable constant rather than hardcoded three times, honestly labeled as unconfirmed. */
  endpoint?: string;
};

const UNCONFIRMED_ENDPOINT = 'https://api.typesafe.ai/v1/jev/predict';

export async function callJev(input: System1Case, deps: JevCallDeps = {}): Promise<System1Result> {
  const profile = findJevProfile('jev');
  const now = deps.now ?? (() => Date.now());
  const t0 = now();

  const apiKey = deps.apiKey ?? (typeof process !== 'undefined' ? process.env?.JEV_API_KEY : undefined);
  if (!apiKey) {
    return unavailableResult({
      case_id: input.case_id,
      model_id: 'jev',
      model_version: profile?.checkpoint ?? null,
      reason: 'JEV_API_KEY is not set — Jev access is invite-only and no invite exists in this '
        + 'environment (see jev/registry.ts). Failing closed rather than fabricating a result.',
      latency_ms: now() - t0,
    });
  }

  const fetchImpl: FetchLike | undefined = deps.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!fetchImpl) {
    return errorResult({
      case_id: input.case_id,
      model_id: 'jev',
      model_version: profile?.checkpoint ?? null,
      reason: 'no fetch implementation available to call Jev in this runtime.',
      latency_ms: now() - t0,
    });
  }

  try {
    const res = await fetchImpl(deps.endpoint ?? UNCONFIRMED_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        state: input.state,
        question: input.question,
        choices: input.candidate_stances,
      }),
    });

    if (!res.ok) {
      return errorResult({
        case_id: input.case_id,
        model_id: 'jev',
        model_version: profile?.checkpoint ?? null,
        reason: `Jev endpoint responded ${res.status} ${res.statusText}.`,
        latency_ms: now() - t0,
      });
    }

    const body = (await res.json()) as { decision?: unknown; confidence?: unknown; uncertainty?: unknown };
    if (typeof body.decision !== 'string' || typeof body.confidence !== 'number') {
      return errorResult({
        case_id: input.case_id,
        model_id: 'jev',
        model_version: profile?.checkpoint ?? null,
        reason: 'Jev response did not include a valid decision/confidence — failing closed rather than guessing a shape for an endpoint this repo has never actually seen respond.',
        latency_ms: now() - t0,
      });
    }

    return {
      case_id: input.case_id,
      model_id: 'jev',
      model_version: profile?.checkpoint ?? null,
      decision: body.decision,
      confidence: body.confidence,
      uncertainty: typeof body.uncertainty === 'number' ? body.uncertainty : null,
      rationale: 'Jev returns a typed decision (floats), never natural-language reasoning.',
      evidence_ids: [],
      latency_ms: now() - t0,
      status: 'LIVE',
      raw: body as Record<string, unknown>,
    };
  } catch (e) {
    return errorResult({
      case_id: input.case_id,
      model_id: 'jev',
      model_version: profile?.checkpoint ?? null,
      reason: `Jev call threw: ${e instanceof Error ? e.message : String(e)}`,
      latency_ms: now() - t0,
    });
  }
}
