import { assertNoFabricatedCitations, type ReasonRequest, type ReasonResult, type Reasoner } from './types';
import { buildPrompt, DEFAULT_REASONER_TIMEOUT_MS, estimateTokens, extractJson } from './shared';

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
      const degrade = (reason: string, est_tokens = 0): ReasonResult<T> => ({
        value: fallback(),
        provider: this.id,
        degraded: true,
        degraded_reason: reason,
        est_tokens,
        ms: Date.now() - started,
      });

      const key = options.getApiKey();
      if (!key) return degrade('no api key configured');

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
          if (!res.ok) return degrade(`provider returned HTTP ${res.status}`, est_tokens);
          const body = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        return degrade(
          err instanceof Error && err.name === 'AbortError' ? `provider timed out after ${(timeoutMs / 1000).toFixed(1)}s` : 'provider request failed',
          est_tokens,
        );
      }

      if (!text.trim()) return degrade('empty response', est_tokens);

      let parsed: unknown;
      try {
        parsed = extractJson(text);
      } catch {
        return degrade('response was not valid JSON', est_tokens);
      }

      try {
        const value = req.validate(parsed);
        assertNoFabricatedCitations(value, req.allowed_evidence_ids);
        return { value, provider: this.id, degraded: false, degraded_reason: null, est_tokens: est_tokens + estimateTokens(text), ms: Date.now() - started };
      } catch (err) {
        return degrade(err instanceof Error ? err.message : 'output failed validation', est_tokens);
      }
    },
  };
}
