import { assertNoFabricatedCitations, type ReasonRequest, type ReasonResult, type Reasoner } from './types';
import { buildPrompt, DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_REASONER_TIMEOUT_MS, estimateTokens, extractJson, sanitizeProviderMessage } from './shared';

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

type ChatToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: string } };
type ChatMessage = {
  content?: string;
  refusal?: string;
  // Present-but-never-printed fields: a "thinking" model can spend its whole output budget here and
  // leave `content` empty. We only ever check *presence*, never read or log the actual text (TASK 6) —
  // reading it into the answer would also mean fabricating a position from an unvalidated field.
  reasoning?: string;
  reasoning_details?: unknown;
  tool_calls?: ChatToolCall[];
};
type ChatChoice = { message?: ChatMessage; finish_reason?: string };
type ChatBody = { error?: { message?: string; code?: number }; content?: Array<{ text?: string }>; choices?: ChatChoice[] };

/** True if a field actually carries something (non-empty string/array/object), not just a present-but-vacant key. */
function isNonEmpty(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return Boolean(value);
}

/**
 * Diagnoses why `choices[0].message.content` came back empty when the HTTP call itself succeeded.
 * A provider that answers 200 OK with nothing usable can mean several different things — a
 * moderation refusal, a tool-call-only turn, a truncated/filtered generation, or a response shape
 * this adapter doesn't recognise — and each deserves a different, honest message instead of one
 * generic "empty response". Order matters: a real refusal is the most actionable signal even if a
 * non-`stop` `finish_reason` is also present, so it is checked first.
 */
function diagnoseEmptyContent(status: number, body: ChatBody): string {
  const choice = body.choices?.[0];
  const message = choice?.message;

  if (message?.refusal) return `provider returned HTTP ${status} — model refused: ${sanitizeProviderMessage(message.refusal)}`;

  if (isNonEmpty(message?.tool_calls)) return `provider returned HTTP ${status} — model returned only a tool call, no assistant content`;

  if (choice?.finish_reason && choice.finish_reason !== 'stop') {
    const spentBudgetOnReasoning = choice.finish_reason === 'length' && (isNonEmpty(message?.reasoning) || isNonEmpty(message?.reasoning_details));
    const reasoningNote = spentBudgetOnReasoning ? ' — the model spent its output budget on reasoning before an answer' : '';
    return `provider returned HTTP ${status} but no final content (finish_reason: ${choice.finish_reason})${reasoningNote}`;
  }

  if (!body.choices && !body.content) return `provider returned HTTP ${status} — response had no "choices" or "content" field`;
  return `provider returned HTTP ${status} — no usable assistant content`;
}

export function createLlmReasoner(options: LlmReasonerOptions): Reasoner {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REASONER_TIMEOUT_MS;

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
      let finishReasonForDiagnostics: string | null = null;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetchImpl(options.endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: options.model,
              max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
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
          finishReasonForDiagnostics = body.choices?.[0]?.finish_reason ?? null;

          // Phase 1 live-debug brief: dev-only, safe-metadata-only diagnostic. `import.meta.env.DEV`
          // is a Vite build-time constant — false (and dead-code-eliminated) in `bun run build`'s
          // production bundle, so this line and everything in it never ships. Only ever the shape of
          // the exchange, never its content: no prompt text, no response body, no reasoning/tool_calls
          // text, no key, no header.
          if (import.meta.env.DEV) {
            console.debug('[llm reasoner] request/response diagnostic', {
              model: options.model,
              max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
              prompt_chars: prompt.length,
              status: res.status,
              finish_reason: body.choices?.[0]?.finish_reason ?? null,
              content_present: text.trim().length > 0,
              elapsed_ms: Date.now() - started,
            });
          }

          if (!text.trim()) emptyReason = diagnoseEmptyContent(res.status, body);
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        // Deliberately not interpolating the error: provider errors can echo request headers.
        return degrade(
          err instanceof Error && err.name === 'AbortError' ? `provider timed out after ${(timeoutMs / 1000).toFixed(1)}s` : 'provider request failed',
          est_tokens,
        );
      }

      if (emptyReason) return degrade(emptyReason, est_tokens);

      let parsed: unknown;
      try {
        parsed = extractJson(text);
      } catch (err) {
        // Phase 1.7a live-debug brief: dev-only, safe-metadata-only. Never the response text itself —
        // only enough shape to tell markdown-fenced/prose-wrapped/schema-echoed/truncated apart without
        // ever printing what the model actually said.
        if (import.meta.env.DEV) {
          console.debug('[llm reasoner] JSON extraction failed', {
            model: options.model,
            finish_reason: finishReasonForDiagnostics,
            content_present: text.trim().length > 0,
            content_length: text.length,
            looks_fenced: /```/.test(text),
            parse_error: err instanceof Error ? sanitizeProviderMessage(err.message) : 'unknown',
          });
        }
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
