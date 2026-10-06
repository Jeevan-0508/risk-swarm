import { configuredTextCapabilities } from '../capabilities';
import { mapHttpStatus, modelError } from '../errors';
import { deterministicPackageHash } from '../../evidence/package';
import { type HttpTransport } from '../transport';
import { type ModelId, type ModelRequest, type ProviderAdapter, type ProviderContext, type ProviderExecution, type UsageMetadata } from '../types';

interface XaiChoice {
  readonly message?: { readonly content?: unknown; readonly refusal?: unknown };
  readonly finish_reason?: unknown;
  readonly tool_calls?: unknown;
}

interface XaiResponseBody {
  readonly choices?: unknown;
  readonly status?: unknown;
  readonly incomplete_details?: { readonly reason?: unknown };
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
  };
}

export interface XaiProviderOptions {
  readonly transport: HttpTransport;
  readonly baseUrl?: string;
}

/** xAI's OpenAI-compatible chat-completions field used for output ceilings. */
export const XAI_WIRE_TOKEN_FIELD = 'max_tokens' as const;

function structuralDiagnostics(request: ModelRequest): Record<string, string | number | boolean | null> {
  const schema = request.output_schema?.json_schema;
  return {
    http_status: null,
    http_ok: null,
    choice_count: 0,
    message_present: false,
    content_present: false,
    text_present: false,
    text_length: 0,
    finish_reason: null,
    json_parsed: false,
    wire_format_type: schema ? 'STRICT_JSON_SCHEMA' : 'GENERIC_JSON',
    wire_schema_present: schema !== undefined,
    wire_schema_name: request.output_schema?.name ?? null,
    wire_schema_strict: schema ? request.output_schema?.strict !== false : null,
    provider_schema_fingerprint: schema ? deterministicPackageHash(schema) : null,
    content_type: 'MISSING',
    leading_non_whitespace_character_class: 'EMPTY',
    trailing_non_whitespace_character_class: 'EMPTY',
    starts_with_json_object_marker: false,
    starts_with_json_array_marker: false,
    starts_with_code_fence: false,
    contains_code_fence_marker: false,
    json_candidate_count: 0,
    bounded_parse_strategy_attempted: false,
    refusal_present: false,
    tool_calls_present: false,
    configured_output_limit: request.max_output_tokens ?? 256,
    request_id: request.request_id,
    provider: 'xai',
    parser_stage: 'REQUEST_BUILD',
    output_count: null,
    truncation_detected: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function usageFrom(value: XaiResponseBody['usage']): UsageMetadata | null {
  if (!value) return null;
  const input_tokens = numberOrUndefined(value.prompt_tokens);
  const output_tokens = numberOrUndefined(value.completion_tokens);
  const total_tokens = numberOrUndefined(value.total_tokens);
  if (input_tokens === undefined && output_tokens === undefined && total_tokens === undefined) return null;
  return { ...(input_tokens === undefined ? {} : { input_tokens }), ...(output_tokens === undefined ? {} : { output_tokens }), ...(total_tokens === undefined ? {} : { total_tokens }) };
}

function contentType(value: unknown): string {
  if (value === undefined) return 'MISSING';
  if (value === null) return 'NULL';
  if (Array.isArray(value)) return 'ARRAY';
  if (typeof value === 'string') return 'STRING';
  if (typeof value === 'object') return 'OBJECT';
  return 'SCALAR';
}

function characterClass(value: string, trailing = false): string {
  const trimmed = value.trim();
  if (!trimmed) return 'EMPTY';
  const character = trailing ? trimmed.at(-1)! : trimmed[0]!;
  if (character === '{' || character === '}') return 'JSON_OBJECT_MARKER';
  if (character === '[' || character === ']') return 'JSON_ARRAY_MARKER';
  if (character === '`') return 'CODE_FENCE_MARKER';
  if (/\p{L}/u.test(character)) return 'LETTER';
  if (/\d/u.test(character)) return 'DIGIT';
  return 'OTHER';
}

function jsonCandidateCount(text: string): number {
  let count = 0;
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') { inString = true; continue; }
      if (character === '{' || character === '[') stack.push(character);
      if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '[';
        if (stack.pop() !== expected) break;
        if (stack.length === 0) { count += 1; break; }
      }
    }
  }
  return count;
}

function textDiagnostics(text: string, content: unknown, choice: XaiChoice | undefined): Record<string, string | number | boolean | null> {
  const trimmed = text.trim();
  return {
    content_type: contentType(content),
    leading_non_whitespace_character_class: characterClass(text),
    trailing_non_whitespace_character_class: characterClass(text, true),
    starts_with_json_object_marker: trimmed.startsWith('{'),
    starts_with_json_array_marker: trimmed.startsWith('['),
    starts_with_code_fence: /^```/.test(trimmed),
    contains_code_fence_marker: trimmed.includes('```'),
    json_candidate_count: jsonCandidateCount(text),
    bounded_parse_strategy_attempted: false,
    refusal_present: typeof choice?.message?.refusal === 'string' && choice.message.refusal.trim().length > 0,
    tool_calls_present: Array.isArray(choice?.tool_calls) && choice.tool_calls.length > 0,
  };
}

function errorForTransport(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') return modelError('TIMEOUT', 'REQUEST', { timeout: true });
  if (error instanceof Error && (error.name === 'NetworkError' || error.name === 'TypeError')) return modelError('NETWORK', 'REQUEST', { network_failure: true });
  return modelError('UNKNOWN_PROVIDER_ERROR', 'REQUEST', { provider_exception: true });
}

/** xAI's OpenAI-compatible chat-completions adapter. Provider-specific shapes stop here. */
export class XaiProviderAdapter implements ProviderAdapter {
  readonly providerId = 'xai';

  constructor(private readonly options: XaiProviderOptions) {}

  getConfiguredCapabilities(_model: ModelId) {
    return configuredTextCapabilities(_model);
  }

  async execute(request: ModelRequest, model: ModelId, context: ProviderContext): Promise<ProviderExecution> {
    const diagnostics = structuralDiagnostics(request);
    const credential = context.credential;
    if (!credential) return { status: 'UNAVAILABLE', error: modelError('AUTHENTICATION', 'REQUEST_BUILD', { credential_configured: false }), diagnostics, provider_request_attempted: false, provider_response_received: false, model_inference_succeeded: false, model_output_present: false, real_model_called: false };

    const url = `${this.options.baseUrl ?? 'https://api.x.ai/v1'}/chat/completions`;
    const responseFormat = request.output_schema?.json_schema
      ? { type: 'json_schema', json_schema: { name: request.output_schema.name, strict: request.output_schema.strict !== false, schema: request.output_schema.json_schema } }
      : { type: 'json_object' };
    const body = JSON.stringify({
      model,
      messages: [
        ...(request.system_instruction ? [{ role: 'system', content: request.system_instruction }] : []),
        { role: 'user', content: `${request.task_instruction}\n\nSEALED_SWARM_CONTEXT_JSON:\n${JSON.stringify(request.context)}` },
      ],
      temperature: 0,
      [XAI_WIRE_TOKEN_FIELD]: request.max_output_tokens ?? 256,
      response_format: responseFormat,
    });

    let response;
    try {
      response = await this.options.transport.request({
        method: 'POST',
        url,
        request_id: request.request_id,
        budget_category: request.purpose.includes('ZEUS_SYNTHESIS') ? 'ZEUS_SYNTHESIS' : request.purpose.includes('CHALLENGE_GENERATION') ? 'CHALLENGE_GENERATION' : request.purpose.includes('CHALLENGE_RESPONSE') ? 'CHALLENGE_RESPONSE' : request.purpose.startsWith('SWARM_') ? 'ROUND1_ANALYSIS' : 'UNCLASSIFIED',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
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
      parsed = JSON.parse(response.body) as XaiResponseBody;
    } catch {
      return { status: 'FAILED', error: modelError('RESPONSE_PARSE_ERROR', 'RESPONSE_PARSE', { ...httpDiagnostics, parser_stage: 'RESPONSE_PARSE', json_parsed: false }), diagnostics: { ...httpDiagnostics, parser_stage: 'RESPONSE_PARSE', json_parsed: false }, provider_request_attempted: true, provider_response_received: true, model_inference_succeeded: false, model_output_present: false, real_model_called: false };
    }

    const parsedBody = isRecord(parsed) ? parsed as XaiResponseBody : {};
    const choices = Array.isArray(parsedBody.choices) ? parsedBody.choices : [];
    const choice = isRecord(choices[0]) ? choices[0] as XaiChoice : undefined;
    const message = isRecord(choice?.message) ? choice.message : undefined;
    const text = typeof message?.content === 'string' ? message.content : '';
    const usage = usageFrom(parsedBody.usage);
    const observed = {
      ...httpDiagnostics,
      choice_count: choices.length,
      message_present: message !== undefined,
      content_present: message?.content !== undefined,
      text_present: text.trim().length > 0,
      text_length: text.length,
      finish_reason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
      json_parsed: true,
      ...textDiagnostics(text, message?.content, choice),
      output_count: usage?.output_tokens ?? null,
      input_usage_count: usage?.input_tokens ?? null,
      total_usage_count: usage?.total_tokens ?? null,
      response_completion_status: typeof parsedBody.status === 'string' ? parsedBody.status : null,
      termination_reason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : typeof parsedBody.incomplete_details?.reason === 'string' ? parsedBody.incomplete_details.reason : null,
      parser_stage: 'RESPONSE_NORMALIZATION',
      truncation_detected: typeof choice?.finish_reason === 'string' && choice.finish_reason.toLowerCase() === 'length',
    };

    // A provider-confirmed length termination is classified by ModelRuntime
    // before content normalization. This also covers an empty content string
    // returned exactly at the token boundary.
    if (observed.truncation_detected) {
      return { status: 'SUCCESS', text, finish_reason: observed.finish_reason, usage, diagnostics: observed, real_model_called: true, provider_request_attempted: true, provider_response_received: true, model_inference_succeeded: true, model_output_present: text.trim().length > 0 };
    }

    if (choices.length === 0 || message === undefined || typeof message.content !== 'string' || text.trim().length === 0) {
      return { status: 'FAILED', error: modelError('EMPTY_RESPONSE', 'RESPONSE_NORMALIZATION', { ...observed, response_shape: choices.length === 0 ? 'NO_CHOICES' : message === undefined ? 'MESSAGE_MISSING' : typeof message.content !== 'string' ? 'CONTENT_NOT_TEXT' : 'TEXT_EMPTY' }), diagnostics: observed, usage, finish_reason: observed.finish_reason, provider_request_attempted: true, provider_response_received: true, model_inference_succeeded: false, model_output_present: false, real_model_called: false };
    }

    return {
      status: 'SUCCESS',
      text,
      finish_reason: observed.finish_reason,
      usage,
      diagnostics: observed,
      real_model_called: true,
      provider_request_attempted: true,
      provider_response_received: true,
      model_inference_succeeded: true,
      model_output_present: true,
    };
  }
}
