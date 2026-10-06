import { CircuitBreaker } from './circuit';
import { missingCapabilities } from './capabilities';
import { isRetryable, modelError } from './errors';
import { ModelRuntime } from './runtime';
import { type ModelAttempt, type ModelExecutionPlan, type ModelRef, type ModelRequest, type ModelResponse, type RetryPolicy, type RuntimeEvent } from './types';

export interface RouterOptions {
  readonly retryScheduler?: (delay_ms: number) => Promise<void>;
  readonly circuitBreaker?: CircuitBreaker;
  readonly onEvent?: (event: RuntimeEvent) => void;
}

function defaultRetry(): RetryPolicy {
  return { max_attempts: 1, retryable_reasons: [], backoff_ms: [] };
}

function withAttemptNumbers(attempts: readonly ModelAttempt[], offset: number): readonly ModelAttempt[] {
  return attempts.map((attempt) => Object.freeze({ ...attempt, attempt_number: offset + attempt.attempt_number }));
}

export class ModelRouter {
  private readonly scheduler: (delay_ms: number) => Promise<void>;
  private readonly breaker?: CircuitBreaker;

  constructor(private readonly runtime: ModelRuntime, options: RouterOptions = {}) {
    this.scheduler = options.retryScheduler ?? (async () => undefined);
    this.breaker = options.circuitBreaker;
    this.onEvent = options.onEvent;
  }

  private readonly onEvent?: (event: RuntimeEvent) => void;

  async execute<T>(request: ModelRequest<T>, plan: ModelExecutionPlan): Promise<ModelResponse<T>> {
    this.onEvent?.({ type: 'ROUTING_STARTED', request_id: request.request_id, model: plan.primary });
    const required = plan.required_capabilities ?? request.model_requirements;
    const candidates = [plan.primary, ...(plan.fallback_models ?? [])];
    const retry = plan.retry ?? defaultRetry();
    const allAttempts: ModelAttempt[] = [];
    let last: ModelResponse<T> | null = null;
    let fallbackReason: ModelResponse<T>['error'] = null;

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex]!;
      const capabilities = this.runtime.capabilities(candidate);
      const missing = capabilities ? missingCapabilities(capabilities, required) : required;
      if (missing.length > 0) {
        last = this.capabilityFailure(request, candidate, missing);
        if (candidateIndex === 0) continue;
        continue;
      }
      if (this.breaker && !this.breaker.allow(candidate.provider, candidate.model)) {
        last = this.circuitFailure(request, candidate);
      } else {
        for (let retryIndex = 0; retryIndex < Math.max(1, retry.max_attempts); retryIndex += 1) {
          const response = await this.runtime.execute(request, candidate);
          const numbered = { ...response, attempts: withAttemptNumbers(response.attempts, allAttempts.length) };
          allAttempts.push(...numbered.attempts);
          last = numbered;
          if (response.status === 'SUCCESS') {
            this.breaker?.recordSuccess(candidate.provider, candidate.model);
            return this.finalize(request, plan.primary, candidate, numbered, allAttempts, candidateIndex > 0, fallbackReason?.code ?? null);
          }
          const code = response.error?.code;
          if (code) this.breaker?.recordFailure(candidate.provider, candidate.model, code);
          if (!code || !isRetryable(code, retry.retryable_reasons) || retryIndex + 1 >= Math.max(1, retry.max_attempts)) break;
          const delay = retry.backoff_ms?.[retryIndex] ?? 0;
          this.onEvent?.({ type: 'RETRY_SCHEDULED', request_id: request.request_id, attempt_number: allAttempts.length, delay_ms: delay, reason: code });
          await this.scheduler(delay);
        }
      }

      const reason = last?.error;
      const canFallback = candidateIndex === 0 && plan.fallback_enabled === true && reason !== null && reason !== undefined && (plan.allowed_fallback_reasons ?? []).includes(reason.code);
      if (!canFallback) break;
      fallbackReason = reason;
      const next = candidates[candidateIndex + 1];
      if (next) this.onEvent?.({ type: 'FALLBACK_SELECTED', request_id: request.request_id, from: candidate, to: next, reason: reason.code });
    }

    if (!last) last = this.capabilityFailure(request, plan.primary, request.model_requirements);
    return this.finalize(request, plan.primary, last.executed_model ?? plan.primary, last, allAttempts, fallbackReason !== null, fallbackReason?.code ?? null);
  }

  private capabilityFailure<T>(request: ModelRequest<T>, candidate: ModelRef, missing: readonly string[]): ModelResponse<T> {
    const error = modelError('CAPABILITY_MISMATCH', 'CAPABILITY_CHECK', { required: request.model_requirements.join(','), missing: missing.join(',') });
    return { request_id: request.request_id, requested_model: candidate, executed_model: null, status: 'REJECTED', text: null, structured_output: null, finish_reason: null, usage: null, execution: { requested_provider: candidate.provider, requested_model: candidate.model, executed_provider: null, executed_model: null, fallback_used: false, fallback_reason: null, real_model_called: false, provider_request_attempted: false, provider_response_received: false, model_inference_succeeded: false, model_output_present: false, model_output_accepted: false, structured_validation_performed: false, output_validated: false, independent: false }, error, diagnostics: error.diagnostics, attempts: [] };
  }

  private circuitFailure<T>(request: ModelRequest<T>, candidate: ModelRef): ModelResponse<T> {
    const error = modelError('PROVIDER_UNAVAILABLE', 'ROUTING', { circuit: 'OPEN' });
    return { request_id: request.request_id, requested_model: candidate, executed_model: null, status: 'UNAVAILABLE', text: null, structured_output: null, finish_reason: null, usage: null, execution: { requested_provider: candidate.provider, requested_model: candidate.model, executed_provider: null, executed_model: null, fallback_used: false, fallback_reason: null, real_model_called: false, provider_request_attempted: false, provider_response_received: false, model_inference_succeeded: false, model_output_present: false, model_output_accepted: false, structured_validation_performed: false, output_validated: false, independent: false }, error, diagnostics: error.diagnostics, attempts: [] };
  }

  private finalize<T>(request: ModelRequest<T>, primary: ModelRef, executed: ModelRef, response: ModelResponse<T>, attempts: readonly ModelAttempt[], fallback_used: boolean, fallback_reason: ModelResponse<T>['execution']['fallback_reason']): ModelResponse<T> {
    const result = Object.freeze({ ...response, requested_model: primary, executed_model: response.status === 'SUCCESS' ? executed : null, attempts: Object.freeze([...attempts]), execution: Object.freeze({ ...response.execution, requested_provider: primary.provider, requested_model: primary.model, executed_provider: response.status === 'SUCCESS' ? executed.provider : null, executed_model: response.status === 'SUCCESS' ? executed.model : null, fallback_used, fallback_reason }) });
    this.onEvent?.({ type: 'EXECUTION_COMPLETED', request_id: request.request_id, status: result.status, executed_model: result.executed_model });
    return result;
  }
}
