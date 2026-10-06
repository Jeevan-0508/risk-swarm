import { type FailureStage, type ModelError, type ModelErrorCode, type SafeDiagnostics } from './types';

const SAFE_MESSAGES: Readonly<Record<ModelErrorCode, string>> = {
  AUTHENTICATION: 'provider authentication was unavailable',
  AUTHORIZATION: 'provider authorization was rejected',
  MODEL_NOT_FOUND: 'requested model was not found',
  CAPABILITY_MISMATCH: 'model capabilities did not satisfy the request',
  RATE_LIMITED: 'provider rate limit was reached',
  TIMEOUT: 'provider request timed out',
  NETWORK: 'provider network request failed',
  PROVIDER_UNAVAILABLE: 'provider was unavailable',
  PROVIDER_HTTP_ERROR: 'provider returned an HTTP error',
  OUTPUT_TOKEN_LIMIT: 'model output reached the configured token limit',
  RESPONSE_PARSE_ERROR: 'provider response could not be parsed',
  EMPTY_RESPONSE: 'provider returned no usable content',
  STRUCTURED_OUTPUT_INVALID: 'structured output failed validation',
  CANCELLED: 'provider request was cancelled',
  UNKNOWN_PROVIDER_ERROR: 'provider returned an unknown error',
};

export function modelError(code: ModelErrorCode, stage: FailureStage, diagnostics: SafeDiagnostics = {}): ModelError {
  return Object.freeze({ code, stage, message: SAFE_MESSAGES[code], diagnostics: Object.freeze({ ...diagnostics }) });
}

export function isRetryable(code: ModelErrorCode, reasons: readonly ModelErrorCode[]): boolean {
  return reasons.includes(code);
}

export function isInfrastructureFailure(code: ModelErrorCode): boolean {
  return code === 'TIMEOUT' || code === 'NETWORK' || code === 'RATE_LIMITED' || code === 'PROVIDER_UNAVAILABLE' || code === 'PROVIDER_HTTP_ERROR';
}

export function mapHttpStatus(status: number): { readonly code: ModelErrorCode; readonly stage: FailureStage } {
  if (status === 401) return { code: 'AUTHENTICATION', stage: 'HTTP' };
  if (status === 403) return { code: 'AUTHORIZATION', stage: 'HTTP' };
  if (status === 404) return { code: 'MODEL_NOT_FOUND', stage: 'HTTP' };
  if (status === 408) return { code: 'TIMEOUT', stage: 'HTTP' };
  if (status === 429) return { code: 'RATE_LIMITED', stage: 'HTTP' };
  if (status === 503) return { code: 'PROVIDER_UNAVAILABLE', stage: 'HTTP' };
  if (status >= 400) return { code: 'PROVIDER_HTTP_ERROR', stage: 'HTTP' };
  return { code: 'UNKNOWN_PROVIDER_ERROR', stage: 'HTTP' };
}

export function sanitizeDiagnostics(value: SafeDiagnostics | undefined, secret?: string): SafeDiagnostics {
  const forbidden = /(key|secret|authorization|bearer|credential|token|password|prompt|response|raw|body)/i;
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value ?? {})) {
    if (forbidden.test(key)) continue;
    if (typeof raw === 'string') {
      let safe = secret && secret.length > 0 ? raw.split(secret).join('[REDACTED]') : raw;
      safe = safe.replace(/([?&](?:key|api_key|token|credential)=[^&\s]+)/gi, '$1=[REDACTED]');
      output[key] = safe.slice(0, 500);
    } else output[key] = raw;
  }
  return Object.freeze(output);
}

export function safeProviderException(error: unknown): ModelError {
  const name = error instanceof Error ? error.name : 'ProviderException';
  const code = name === 'AbortError' ? 'TIMEOUT' : name === 'NetworkError' ? 'NETWORK' : 'UNKNOWN_PROVIDER_ERROR';
  return modelError(code, 'REQUEST', { exception: name });
}
