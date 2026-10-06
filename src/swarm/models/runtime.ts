import { modelError, safeProviderException, sanitizeDiagnostics } from './errors';
import { normalizeStructuredOutput } from './structured-output';
import { type Clock, type CredentialResolver, type ModelCapabilities, type ModelRequest, type ModelResponse, type ModelRef, type ModelRuntimeOptions, type ProviderAdapter, type ProviderExecution, type SafeDiagnostics } from './types';

interface ExecutionTelemetry {
  readonly real_model_called: boolean;
  readonly provider_request_attempted: boolean;
  readonly provider_response_received: boolean;
  readonly model_inference_succeeded: boolean;
  readonly model_output_present: boolean;
  readonly model_output_accepted: boolean;
  readonly structured_validation_performed: boolean;
}

function telemetryFrom(providerResult: ProviderExecution, model_output_accepted = false, structured_validation_performed = false): ExecutionTelemetry {
  return {
    real_model_called: providerResult.real_model_called === true,
    provider_request_attempted: providerResult.provider_request_attempted === true,
    provider_response_received: providerResult.provider_response_received === true,
    model_inference_succeeded: providerResult.model_inference_succeeded === true,
    model_output_present: providerResult.model_output_present === true || typeof providerResult.text === 'string' && providerResult.text.trim().length > 0 || providerResult.structured_output !== undefined && providerResult.structured_output !== null,
    model_output_accepted,
    structured_validation_performed,
  };
}

export class SystemClock implements Clock {
  now(): number { return Date.now(); }
  iso(): string { return new Date(this.now()).toISOString(); }
}

function providerFrom(options: ModelRuntimeOptions, provider: string): ProviderAdapter | undefined {
  return options.providers instanceof Map ? options.providers.get(provider) : (options.providers as Readonly<Record<string, ProviderAdapter>>)[provider];
}

function freezeResponse<T>(response: ModelResponse<T>): ModelResponse<T> {
  return Object.freeze({ ...response, execution: Object.freeze({ ...response.execution }), attempts: Object.freeze([...response.attempts]), diagnostics: Object.freeze({ ...response.diagnostics }) });
}

function safeError(error: ReturnType<typeof modelError>, secret?: string) {
  return Object.freeze({ ...error, diagnostics: sanitizeDiagnostics(error.diagnostics, secret) });
}

export class ModelRuntime {
  private readonly clock: Clock;
  private readonly credentials: CredentialResolver;

  constructor(private readonly options: ModelRuntimeOptions) {
    this.clock = options.clock ?? new SystemClock();
    this.credentials = options.credentials ?? { resolve: () => ({ configured: true, value: 'runtime-injected-credential' }) };
  }

  capabilities(model: ModelRef) {
    return providerFrom(this.options, model.provider)?.getConfiguredCapabilities(model.model);
  }

  async execute<T>(request: ModelRequest<T>, model: ModelRef): Promise<ModelResponse<T>> {
    const started = this.clock.now();
    const adapter = providerFrom(this.options, model.provider);
    this.options.onEvent?.({ type: 'ATTEMPT_STARTED', request_id: request.request_id, attempt_number: 1, model });
    if (!adapter) return this.failed(request, model, 'PROVIDER_UNAVAILABLE', 'ROUTING', started, { provider_known: false }, undefined, undefined, 'UNAVAILABLE');

    const capabilities = adapter.getConfiguredCapabilities(model.model);
    const credentials = await this.credentials.resolve(model.provider);
    if (!credentials.configured) return this.failed(request, model, 'AUTHENTICATION', 'REQUEST_BUILD', started, { credential_configured: false }, capabilities, undefined, 'UNAVAILABLE');

    let providerResult: ProviderExecution;
    try {
      providerResult = await adapter.execute(request, model.model, { credential: credentials.value, signal: request.signal });
    } catch (error) {
      const mapped = safeProviderException(error);
      return this.failed(request, model, mapped.code, mapped.stage, started, mapped.diagnostics, capabilities, credentials.value);
    }

    if (request.signal?.aborted) return this.failed(request, model, 'CANCELLED', 'REQUEST', started, { cancelled: true }, capabilities, credentials.value, 'FAILED', providerResult.finish_reason, telemetryFrom(providerResult));
    const finishReasonIsLength = providerResult.finish_reason?.toLowerCase() === 'length';
    const providerConfirmedLength = finishReasonIsLength && providerResult.provider_response_received === true;
    if (providerResult.status !== 'SUCCESS') {
      const reported = providerResult.error ?? modelError('UNKNOWN_PROVIDER_ERROR', 'RESPONSE_NORMALIZATION');
      const error = reported.code === 'OUTPUT_TOKEN_LIMIT' && !providerConfirmedLength
        ? modelError('UNKNOWN_PROVIDER_ERROR', 'RESPONSE_NORMALIZATION', { unconfirmed_output_limit: true })
        : reported;
      return this.failed(request, model, error.code, error.stage, started, sanitizeDiagnostics({ ...(providerResult.diagnostics ?? {}), ...error.diagnostics, parser_stage: error.stage }, credentials.value), capabilities, credentials.value, providerResult.status, providerResult.finish_reason, telemetryFrom(providerResult), providerResult.usage ?? null);
    }

    const diagnostics = sanitizeDiagnostics(providerResult.diagnostics, credentials.value);
    if (finishReasonIsLength && !providerConfirmedLength) {
      return this.failed(request, model, 'UNKNOWN_PROVIDER_ERROR', 'RESPONSE_NORMALIZATION', started, sanitizeDiagnostics({ ...diagnostics, unconfirmed_output_limit: true, parser_stage: 'RESPONSE_NORMALIZATION' }, credentials.value), capabilities, credentials.value, 'FAILED', providerResult.finish_reason, telemetryFrom(providerResult), providerResult.usage ?? null);
    }
    if (providerConfirmedLength) {
      return this.failed(request, model, 'OUTPUT_TOKEN_LIMIT', 'RESPONSE_TRUNCATED', started, sanitizeDiagnostics({
        ...diagnostics,
        configured_output_limit: request.max_output_tokens ?? 256,
        output_count: providerResult.usage?.output_tokens ?? null,
        finish_reason: providerResult.finish_reason ?? null,
        truncation_detected: true,
        parser_stage: 'RESPONSE_TRUNCATED',
      }, credentials.value), capabilities, credentials.value, 'REJECTED', providerResult.finish_reason, telemetryFrom(providerResult, false, false), providerResult.usage ?? null);
    }
    if (!request.output_schema) {
      const hasContent = typeof providerResult.text === 'string' && providerResult.text.trim().length > 0 || providerResult.structured_output !== undefined && providerResult.structured_output !== null;
      if (!hasContent) return this.failed(request, model, 'EMPTY_RESPONSE', 'RESPONSE_NORMALIZATION', started, diagnostics, capabilities, credentials.value, 'FAILED', providerResult.finish_reason, telemetryFrom(providerResult), providerResult.usage ?? null);
      return this.success(request, model, providerResult, (providerResult.structured_output ?? null) as T | null, started, capabilities, diagnostics, false, false);
    }

    const normalized = normalizeStructuredOutput(providerResult, request.output_schema, { allow_code_fence: true, allow_balanced_object_extraction: true });
    if (!normalized.ok) {
      const error = normalized.error!;
      const status = error.code === 'EMPTY_RESPONSE' ? 'FAILED' : 'REJECTED';
      const schemaValidationPerformed = normalized.diagnostics.schema_validation === 'PASS' || normalized.diagnostics.schema_validation === 'FAIL';
      return this.failed(request, model, error.code, error.stage, started, sanitizeDiagnostics({ ...diagnostics, ...normalized.diagnostics, parser_stage: error.stage }), capabilities, credentials.value, status, providerResult.finish_reason, telemetryFrom(providerResult, false, schemaValidationPerformed), providerResult.usage ?? null);
    }
    return this.success(request, model, providerResult, normalized.value, started, capabilities, sanitizeDiagnostics({ ...diagnostics, ...normalized.diagnostics }), true, true);
  }

  private success<T>(request: ModelRequest<T>, model: ModelRef, providerResult: ProviderExecution, structured: T | null, started: number, capabilities: ReturnType<ProviderAdapter['getConfiguredCapabilities']>, diagnostics: SafeDiagnostics, output_validated: boolean, structured_validation_performed: boolean): ModelResponse<T> {
    const ended = this.clock.now();
    const telemetry = telemetryFrom(providerResult, output_validated, structured_validation_performed);
    const attempt = Object.freeze({ attempt_number: 1, provider: model.provider, model: model.model, started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString(), duration_ms: Math.max(0, ended - started), status: 'SUCCESS' as const, failure_stage: null, failure_reason_code: null, capability_snapshot: capabilities, diagnostics, ...telemetry });
    const response = freezeResponse({ request_id: request.request_id, requested_model: model, executed_model: model, status: 'SUCCESS', text: providerResult.text ?? null, structured_output: structured, finish_reason: providerResult.finish_reason ?? null, usage: providerResult.usage ?? null, execution: { requested_provider: model.provider, requested_model: model.model, executed_provider: model.provider, executed_model: model.model, fallback_used: false, fallback_reason: null, ...telemetry, output_validated, independent: telemetry.real_model_called && output_validated }, error: null, diagnostics, attempts: [attempt] });
    this.options.onEvent?.({ type: 'ATTEMPT_SUCCEEDED', request_id: request.request_id, attempt_number: 1, model });
    this.options.onEvent?.({ type: 'EXECUTION_COMPLETED', request_id: request.request_id, status: response.status, executed_model: response.executed_model });
    return response;
  }

  private failed<T>(request: ModelRequest<T>, model: ModelRef, code: Parameters<typeof modelError>[0], stage: Parameters<typeof modelError>[1], started: number, diagnostics: SafeDiagnostics, capabilities: ModelCapabilities = { capabilities: [], source: 'CONFIGURED' }, secret?: string, status: 'UNAVAILABLE' | 'FAILED' | 'REJECTED' = 'FAILED', finish_reason: string | null = null, telemetry: ExecutionTelemetry = { real_model_called: false, provider_request_attempted: false, provider_response_received: false, model_inference_succeeded: false, model_output_present: false, model_output_accepted: false, structured_validation_performed: false }, usage: ModelResponse<T>['usage'] = null): ModelResponse<T> {
    const ended = this.clock.now();
    const error = safeError(modelError(code, stage, diagnostics), secret);
    const safeDiagnostics = sanitizeDiagnostics(diagnostics, secret);
    const attempt = Object.freeze({ attempt_number: 1, provider: model.provider, model: model.model, started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString(), duration_ms: Math.max(0, ended - started), status, failure_stage: stage, failure_reason_code: code, capability_snapshot: capabilities, diagnostics: safeDiagnostics, ...telemetry });
    const response = freezeResponse({ request_id: request.request_id, requested_model: model, executed_model: null, status, text: null, structured_output: null as T | null, finish_reason, usage, execution: { requested_provider: model.provider, requested_model: model.model, executed_provider: null, executed_model: null, fallback_used: false, fallback_reason: null, ...telemetry, output_validated: telemetry.model_output_accepted, independent: false }, error, diagnostics: safeDiagnostics, attempts: [attempt] });
    this.options.onEvent?.({ type: 'ATTEMPT_FAILED', request_id: request.request_id, attempt_number: 1, model, code, stage });
    this.options.onEvent?.({ type: 'EXECUTION_COMPLETED', request_id: request.request_id, status: response.status, executed_model: null });
    return response;
  }
}
