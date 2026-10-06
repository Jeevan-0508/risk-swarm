import { configuredTextCapabilities } from '../capabilities';
import { mapHttpStatus, modelError } from '../errors';
import { type HttpTransport } from '../transport';
import { type ModelId, type ModelRequest, type ProviderAdapter, type ProviderContext, type ProviderExecution } from '../types';

interface GeminiCandidate {
  readonly content?: { readonly parts?: readonly { readonly text?: unknown }[] };
  readonly finishReason?: unknown;
  readonly safetyRatings?: unknown;
}

interface GeminiResponseBody {
  readonly candidates?: unknown;
  readonly promptFeedback?: { readonly blockReason?: unknown; readonly safetyRatings?: unknown };
}

export interface GeminiProviderOptions {
  readonly transport: HttpTransport;
  readonly baseUrl?: string;
}

function structuralDiagnostics(): Record<string, string | number | boolean | null> {
  return {
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
    json_parsed: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorForTransport(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') return modelError('TIMEOUT', 'REQUEST', { timeout: true });
  return modelError('NETWORK', 'REQUEST', { network_failure: true });
}

/**
 * SWARM 2's first real provider adapter. The API key is used only while building
 * the provider URL and is never copied into a ProviderExecution or diagnostic.
 */
export class GeminiProviderAdapter implements ProviderAdapter {
  readonly providerId = 'gemini';

  constructor(private readonly options: GeminiProviderOptions) {}

  getConfiguredCapabilities(_model: ModelId) {
    return configuredTextCapabilities(_model);
  }

  async execute(request: ModelRequest, model: ModelId, context: ProviderContext): Promise<ProviderExecution> {
    const diagnostics = structuralDiagnostics();
    const credential = context.credential;
    if (!credential) return { status: 'UNAVAILABLE', error: modelError('AUTHENTICATION', 'REQUEST_BUILD', { credential_configured: false }), diagnostics, provider_request_attempted: false, provider_response_received: false, model_inference_succeeded: false, model_output_present: false, real_model_called: false };

    const url = `${this.options.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/models'}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(credential)}`;
    const body = JSON.stringify({
      contents: [{ parts: [{ text: request.task_instruction }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: request.max_output_tokens ?? 256,
        responseMimeType: 'application/json',
      },
    });

    let response;
    try {
      response = await this.options.transport.request({
        method: 'POST',
        url,
        headers: { 'content-type': 'application/json' },
        body,
        signal: context.signal,
      });
    } catch (error) {
      return { status: 'FAILED', error: errorForTransport(error), diagnostics, provider_request_attempted: true, provider_response_received: false, model_inference_succeeded: false, model_output_present: false, real_model_called: false };
    }

    const httpDiagnostics = { ...diagnostics, http_status: response.status, http_ok: response.status >= 200 && response.status < 300 };
    if (response.status < 200 || response.status >= 300) {
      const mapped = mapHttpStatus(response.status);
      return { status: mapped.code === 'AUTHENTICATION' || mapped.code === 'MODEL_NOT_FOUND' || mapped.code === 'RATE_LIMITED' || mapped.code === 'PROVIDER_UNAVAILABLE' ? 'UNAVAILABLE' : 'FAILED', error: modelError(mapped.code, mapped.stage, { http_status: response.status }), diagnostics: httpDiagnostics, provider_request_attempted: true, provider_response_received: true, model_inference_succeeded: false, model_output_present: false, real_model_called: false };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body) as GeminiResponseBody;
    } catch {
      return { status: 'FAILED', error: modelError('RESPONSE_PARSE_ERROR', 'RESPONSE_PARSE', { json_parsed: false }), diagnostics: httpDiagnostics, provider_request_attempted: true, provider_response_received: true, model_inference_succeeded: false, model_output_present: false, real_model_called: false };
    }

    const parsedBody = isRecord(parsed) ? parsed as GeminiResponseBody : {};
    const candidates = Array.isArray(parsedBody.candidates) ? parsedBody.candidates : [];
    const candidate = isRecord(candidates[0]) ? candidates[0] as GeminiCandidate : undefined;
    const content = isRecord(candidate?.content) ? candidate.content as { readonly parts?: unknown } : undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const textParts = parts.filter((part): part is { readonly text: string } => isRecord(part) && typeof part.text === 'string' && part.text.trim().length > 0);
    const text = textParts.map((part) => part.text).join('\n');
    const observed = {
      ...httpDiagnostics,
      candidate_count: candidates.length,
      content_present: content !== undefined,
      part_count: parts.length,
      text_present: text.length > 0,
      text_length: text.length,
      finish_reason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : null,
      prompt_blocked: isRecord(parsedBody.promptFeedback) && typeof parsedBody.promptFeedback.blockReason === 'string',
      safety_metadata_present: candidate?.safetyRatings !== undefined || (isRecord(parsedBody.promptFeedback) && parsedBody.promptFeedback.safetyRatings !== undefined),
      json_parsed: true,
    };

    if (candidates.length === 0 || content === undefined || parts.length === 0 || text.length === 0) {
      return { status: 'FAILED', error: modelError('EMPTY_RESPONSE', 'RESPONSE_NORMALIZATION', { ...observed, response_shape: candidates.length === 0 ? 'NO_CANDIDATES' : content === undefined ? 'CONTENT_MISSING' : parts.length === 0 ? 'PARTS_MISSING' : 'TEXT_EMPTY' }), diagnostics: observed, provider_request_attempted: true, provider_response_received: true, model_inference_succeeded: false, model_output_present: false, real_model_called: false };
    }

    return {
      status: 'SUCCESS',
      text,
      finish_reason: observed.finish_reason,
      diagnostics: observed,
      real_model_called: true,
      provider_request_attempted: true,
      provider_response_received: true,
      model_inference_succeeded: true,
      model_output_present: true,
    };
  }
}
