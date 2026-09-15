import { assertNoFabricatedCitations, type ReasonRequest, type ReasonResult, type Reasoner } from './types';
import { buildPrompt, estimateTokens, extractJson, sanitizeProviderMessage } from './shared';

/**
 * Optional model-backed reasoner, bring-your-own key. OpenAI-compatible: bearer auth,
 * `/chat/completions` shape. Covers OpenAI and OpenRouter unchanged — only `endpoint`/`model` differ.
 *
 * The key is read through a getter at call time and never stored in this module, never logged and
 * never included in an error message. The model's answer is untrusted: it must parse as JSON, pass
 * the agent's validator, and cite only evidence the agent supplied. Any failure returns the
 * deterministic fallback with `degraded: true`, so a bad model can slow the investigation down but
 * cannot change what it concludes.
 */
export interface LlmReasonerOptions {
  endpoint: string;
  model: string;
  getApiKey: () => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

type ChatChoice = { message?: { content?: string; refusal?: string }; finish_reason?: string };
type ChatBody = { error?: { message?: string; code?: number }; content?: Array<{ text?: string }>; choices?: ChatChoice[] };

/**
 * Diagnoses why `choices[0].message.content` came back empty when the HTTP call itself succeeded.
 * A provider that answers 200 OK with nothing usable can mean several different things — a
 * moderation refusal, a truncated/filtered generation, or a response shape this adapter doesn't
 * recognise — and each deserves a different, honest message instead of one generic "empty response".
 */
function diagnoseEmptyContent(status: number, body: ChatBody): string {
  const choice = body.choices?.[0];
  if (choice?.message?.refusal) return `HTTP ${status} — model refused: ${sanitizeProviderMessage(choice.message.refusal)}`;
  if (choice?.finish_reason && choice.finish_reason !== 'stop') return `HTTP ${status} — no usable content (finish_reason: ${choice.finish_reason})`;
  if (!body.choices && !body.content) return `HTTP ${status} — response had no "choices" or "content" field`;
  return `HTTP ${status} — no usable assistant content`;
}

export function createLlmReasoner(options: LlmReasonerOptions): Reasoner {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  return {
    id: `llm:${options.model}`,
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

      let text: string;
      let emptyReason: string | null = null;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetchImpl(options.endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: options.model,
              max_tokens: options.maxOutputTokens ?? 800,
              temperature: 0,
              messages: [{ role: 'user', content: prompt }],
            }),
            signal: controller.signal,
          });

          if (!res.ok) {
            let providerMessage: string | undefined;
            try {
              providerMessage = ((await res.json()) as ChatBody)?.error?.message;
            } catch {
              // Error body wasn't JSON — the status code alone still tells the real story.
            }
            return degrade(
              providerMessage
                ? `provider returned HTTP ${res.status} — ${sanitizeProviderMessage(providerMessage)}`
                : `provider returned HTTP ${res.status}`,
              est_tokens,
            );
          }

          const body = (await res.json()) as ChatBody;
          // OpenRouter documents errors as always carrying a matching non-200 status, but proxied and
          // free-tier models have been reported to answer 200 OK with a top-level `error` anyway.
          if (body.error) {
            return degrade(`HTTP ${res.status} — provider error: ${sanitizeProviderMessage(body.error.message ?? 'unknown error')}`, est_tokens);
          }
          text = body.content?.[0]?.text ?? body.choices?.[0]?.message?.content ?? '';
          if (!text.trim()) emptyReason = diagnoseEmptyContent(res.status, body);
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        // Deliberately not interpolating the error: provider errors can echo request headers.
        return degrade(err instanceof Error && err.name === 'AbortError' ? 'provider timed out' : 'provider request failed', est_tokens);
      }

      if (emptyReason) return degrade(emptyReason, est_tokens);

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
