import { assertNoFabricatedCitations, type ModelExecution, type ProviderDiagnostics, type ReasonRequest, type ReasonResult, type Reasoner } from './types';
import { buildPrompt, DEFAULT_REASONER_TIMEOUT_MS, estimateTokens, extractJson, sanitizeProviderMessage } from './shared';

/**
 * Google Gemini reasoner, bring-your-own key. Same contract and the same failure discipline as
 * `llm.ts`'s OpenAI-compatible reasoner, but Gemini's REST shape differs: the key travels as a query
 * parameter (Google's own API design, not a choice made here) rather than a bearer header, and the
 * request/response bodies use `contents`/`parts` instead of `messages`/`choices`.
 *
 * The key still never appears in any returned or thrown string: every degrade path below is a static
 * reason, never the request URL (which contains the key) and never the raw provider error.
 *
 * `thinkingConfig.thinkingBudget: 0` is sent on every call (EVOLUTION 6.0 Phase 1.10): every Gemini
 * generation from 2.5 onward defaults "thinking" on, which can spend the whole `maxOutputTokens`
 * budget on invisible reasoning tokens before any visible answer - the same failure `registry.ts`
 * already documents for ARES's free OpenRouter router. This adapter never opts in to reasoning,
 * matching that same discipline, regardless of which model string the registry or a user supplies.
 */
export interface GeminiReasonerOptions {
  model: string;
  getApiKey: () => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** Overridable only for tests; production always talks to Google's real endpoint. */
  baseUrl?: string;
}

type GeminiCandidate = {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
  safetyRatings?: unknown;
};

type GeminiBody = {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string; safetyRatings?: unknown };
};

function emptyDiagnostics(): ProviderDiagnostics {
  return {
    provider: 'google',
    http_status: null,
    http_ok: null,
    candidate_count: 0,
    content_present: false,
    part_count: 0,
    text_present: false,
    text_length: 0,
    finish_reason: null,
    prompt_blocked: false,
    safety_metadata_present: false,
    response_json_parsed: false,
    model_json_extracted: false,
    specialist_validation_reached: false,
    failure_stage: 'REQUEST',
    failure_reason_code: 'PROVIDER_REQUEST_FAILED',
  };
}

function failedDiagnostics(diagnostics: ProviderDiagnostics, failure_stage: ProviderDiagnostics['failure_stage'], failure_reason_code: ProviderDiagnostics['failure_reason_code']): ProviderDiagnostics {
  return { ...diagnostics, failure_stage, failure_reason_code };
}

export function createGeminiReasoner(options: GeminiReasonerOptions): Reasoner {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REASONER_TIMEOUT_MS;
  const baseUrl = options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/models';

  return {
    id: `gemini:${options.model}`,
    uses_network: true,
    async propose<T>(req: ReasonRequest<T>): Promise<ReasonResult<T>> {
      const started = Date.now();
      const fallback = (): T => req.validate(req.fallback());
      let diagnostics = emptyDiagnostics();
      const degrade = (reason: string, est_tokens = 0, status: ModelExecution['status'] = 'DEGRADED', model_called = true, observed = diagnostics): ReasonResult<T> => ({
        value: fallback(),
        provider: this.id,
        degraded: true,
        degraded_reason: reason,
        est_tokens,
        ms: Date.now() - started,
        execution: { model_called, provider: 'google', model_id: options.model, status, degraded: true, degraded_reason: reason, independent: false, diagnostics: observed },
      });

      const key = options.getApiKey();
      if (!key) return degrade('no api key configured', 0, 'DISABLED', false, failedDiagnostics(diagnostics, 'REQUEST', 'PROVIDER_REQUEST_FAILED'));

      const prompt = buildPrompt(req);
      const est_tokens = estimateTokens(prompt);
      const url = `${baseUrl}/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(key)}`;

      let text: string;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0,
                maxOutputTokens: options.maxOutputTokens ?? 800,
                thinkingConfig: { thinkingBudget: 0 },
              },
            }),
            signal: controller.signal,
          });
          diagnostics = { ...diagnostics, http_status: res.status, http_ok: res.ok };
          if (!res.ok) {
            diagnostics = failedDiagnostics(diagnostics, 'HTTP', 'PROVIDER_HTTP_ERROR');
            return degrade(`provider returned HTTP ${res.status}`, est_tokens, 'DEGRADED', true, diagnostics);
          }

          let body: GeminiBody;
          try {
            body = (await res.json()) as GeminiBody;
          } catch {
            diagnostics = failedDiagnostics({ ...diagnostics, response_json_parsed: false }, 'RESPONSE_JSON', 'PROVIDER_RESPONSE_JSON_INVALID');
            return degrade('provider response was not valid JSON', est_tokens, 'DEGRADED', true, diagnostics);
          }

          const candidates = Array.isArray(body.candidates) ? body.candidates : [];
          const candidate = candidates[0];
          const content = candidate?.content;
          const parts = content && Array.isArray(content.parts) ? content.parts : [];
          const firstText = parts[0]?.text;
          diagnostics = {
            ...diagnostics,
            candidate_count: candidates.length,
            content_present: content !== undefined,
            part_count: parts.length,
            text_present: typeof firstText === 'string' && firstText.trim().length > 0,
            text_length: typeof firstText === 'string' ? firstText.length : 0,
            finish_reason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : null,
            prompt_blocked: typeof body.promptFeedback?.blockReason === 'string',
            safety_metadata_present: candidate?.safetyRatings !== undefined || body.promptFeedback?.safetyRatings !== undefined,
            response_json_parsed: true,
          };

          if (candidates.length === 0) {
            diagnostics = failedDiagnostics(diagnostics, 'RESPONSE_STRUCTURE', 'PROVIDER_NO_CANDIDATES');
            return degrade('provider returned HTTP 200 — no candidates', est_tokens, 'DEGRADED', true, diagnostics);
          }
          if (content === undefined) {
            diagnostics = failedDiagnostics(diagnostics, 'RESPONSE_STRUCTURE', 'PROVIDER_CONTENT_MISSING');
            return degrade('provider returned HTTP 200 — candidate content missing', est_tokens, 'DEGRADED', true, diagnostics);
          }
          if (!Array.isArray(content.parts) || content.parts.length === 0) {
            diagnostics = failedDiagnostics(diagnostics, 'RESPONSE_STRUCTURE', 'PROVIDER_PARTS_MISSING');
            return degrade('provider returned HTTP 200 — candidate parts missing', est_tokens, 'DEGRADED', true, diagnostics);
          }
          if (typeof firstText !== 'string' || !firstText.trim()) {
            diagnostics = failedDiagnostics(diagnostics, 'MODEL_TEXT', 'PROVIDER_TEXT_EMPTY');
            return degrade('provider returned HTTP 200 — candidate text empty', est_tokens, 'DEGRADED', true, diagnostics);
          }
          // Preserve the existing first-part extraction contract. Multi-part joining would be a
          // provider behavior change, so this phase observes part structure without broadening it.
          text = firstText;
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        // Same fix as the sibling OpenAI/OpenRouter adapter (`llm.ts`): a thrown fetch used to
        // degrade to a static, uninformative string regardless of cause. `sanitizeProviderMessage`
        // redacts any header/key it could echo, so the real reason is safe to surface.
        const reason =
          err instanceof Error && err.name === 'AbortError'
            ? `provider timed out after ${(timeoutMs / 1000).toFixed(1)}s`
            : err instanceof Error
              ? `provider request failed — ${sanitizeProviderMessage(err.message)}`
              : 'provider request failed';
        const failure_stage = err instanceof Error && err.name === 'AbortError' ? 'REQUEST' : 'REQUEST';
        const failure_reason_code = err instanceof Error && err.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_REQUEST_FAILED';
        diagnostics = failedDiagnostics(diagnostics, failure_stage, failure_reason_code);
        return degrade(reason, est_tokens, 'DEGRADED', true, diagnostics);
      }

      let parsed: unknown;
      try {
        parsed = extractJson(text);
      } catch {
        diagnostics = failedDiagnostics({ ...diagnostics, model_json_extracted: false }, 'MODEL_JSON', 'MODEL_JSON_INVALID');
        return degrade('response was not valid JSON', est_tokens, 'DEGRADED', true, diagnostics);
      }

      diagnostics = { ...diagnostics, model_json_extracted: true, specialist_validation_reached: true };

      try {
        const value = req.validate(parsed);
        assertNoFabricatedCitations(value, req.allowed_evidence_ids);
        return {
          value,
          provider: this.id,
          degraded: false,
          degraded_reason: null,
          est_tokens: est_tokens + estimateTokens(text),
          ms: Date.now() - started,
          execution: { model_called: true, provider: 'google', model_id: options.model, status: 'SUCCESS', degraded: false, degraded_reason: null, independent: true, diagnostics: { ...diagnostics, failure_stage: 'NONE', failure_reason_code: 'NONE' } },
        };
      } catch (err) {
        diagnostics = failedDiagnostics(diagnostics, 'SPECIALIST_VALIDATION', 'SPECIALIST_OUTPUT_INVALID');
        return degrade(err instanceof Error ? err.message : 'output failed validation', est_tokens, 'DEGRADED', true, diagnostics);
      }
    },
  };
}
