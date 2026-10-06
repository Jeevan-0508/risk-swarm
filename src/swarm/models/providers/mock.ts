import { configuredTextCapabilities } from '../capabilities';
import { modelError } from '../errors';
import { type CredentialResolver, type CredentialResult, type DiscoveryResult, type HealthObservation, type ModelId, type ModelRequest, type ProviderAdapter, type ProviderContext, type ProviderExecution } from '../types';

export const MOCK_SCENARIOS = [
  'SUCCESS',
  'STRUCTURED_SUCCESS',
  'TIMEOUT',
  'HTTP_UNAVAILABLE',
  'AUTHENTICATION_FAILURE',
  'AUTHORIZATION_FAILURE',
  'RATE_LIMIT',
  'MALFORMED_RESPONSE',
  'EMPTY_RESPONSE',
  'SCHEMA_INVALID_OUTPUT',
  'PROVIDER_EXCEPTION',
  'NETWORK_EXCEPTION',
  'MODEL_NOT_FOUND',
  'HTTP_ERROR',
  'HTTP_SERVER_ERROR',
  'CANCELLED',
] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export interface MockProviderOptions {
  readonly providerId?: string;
  readonly model?: string;
  readonly scenario?: MockScenario;
  readonly capabilities?: ReturnType<typeof configuredTextCapabilities>;
}

export class MockCredentialResolver implements CredentialResolver {
  constructor(private readonly values: Readonly<Record<string, string | undefined>> = {}) {}

  resolve(provider: string): CredentialResult {
    const value = Object.prototype.hasOwnProperty.call(this.values, provider) ? this.values[provider] : 'mock-credential';
    return value ? { configured: true, value } : { configured: false, reason: 'credential not configured' };
  }
}

export class MockProviderAdapter implements ProviderAdapter {
  readonly providerId: string;
  readonly calls: ModelRequest[] = [];
  private readonly model: string;
  private readonly scenario: MockScenario;
  private readonly capabilities: ReturnType<typeof configuredTextCapabilities>;

  constructor(options: MockProviderOptions = {}) {
    this.providerId = options.providerId ?? 'mock';
    this.model = options.model ?? 'mock-model';
    this.scenario = options.scenario ?? 'SUCCESS';
    this.capabilities = options.capabilities ?? configuredTextCapabilities(this.model);
  }

  getConfiguredCapabilities(_model: ModelId) {
    return this.capabilities;
  }

  async execute(request: ModelRequest, _model: ModelId, context: ProviderContext): Promise<ProviderExecution> {
    this.calls.push(request);
    if (context.signal?.aborted || this.scenario === 'CANCELLED') return { status: 'FAILED', error: modelError('CANCELLED', 'REQUEST', { cancelled: true }) };
    switch (this.scenario) {
      case 'TIMEOUT': return { status: 'FAILED', error: modelError('TIMEOUT', 'REQUEST', { timeout: true }) };
      case 'HTTP_UNAVAILABLE': return { status: 'UNAVAILABLE', error: modelError('PROVIDER_UNAVAILABLE', 'HTTP', { http_status: 503 }) };
      case 'AUTHENTICATION_FAILURE': return { status: 'UNAVAILABLE', error: modelError('AUTHENTICATION', 'HTTP', { http_status: 401 }) };
      case 'AUTHORIZATION_FAILURE': return { status: 'FAILED', error: modelError('AUTHORIZATION', 'HTTP', { http_status: 403 }) };
      case 'RATE_LIMIT': return { status: 'UNAVAILABLE', error: modelError('RATE_LIMITED', 'HTTP', { http_status: 429 }) };
      case 'MODEL_NOT_FOUND': return { status: 'UNAVAILABLE', error: modelError('MODEL_NOT_FOUND', 'HTTP', { http_status: 404 }) };
      case 'HTTP_ERROR': return { status: 'FAILED', error: modelError('PROVIDER_HTTP_ERROR', 'HTTP', { http_status: 400 }) };
      case 'HTTP_SERVER_ERROR': return { status: 'FAILED', error: modelError('PROVIDER_HTTP_ERROR', 'HTTP', { http_status: 500 }) };
      case 'MALFORMED_RESPONSE': return { status: 'FAILED', text: '{not-json', error: modelError('RESPONSE_PARSE_ERROR', 'RESPONSE_PARSE', { response_shape: 'MALFORMED' }) };
      case 'EMPTY_RESPONSE': return { status: 'SUCCESS', text: '', finish_reason: 'STOP' };
      case 'SCHEMA_INVALID_OUTPUT': return { status: 'SUCCESS', text: JSON.stringify({ summary: 42, confidence: 'not-a-number' }), finish_reason: 'STOP' };
      case 'PROVIDER_EXCEPTION': throw new Error('synthetic provider exception');
      case 'NETWORK_EXCEPTION': throw Object.assign(new Error('synthetic network exception'), { name: 'NetworkError' });
      case 'STRUCTURED_SUCCESS': return { status: 'SUCCESS', structured_output: { summary: `structured-${request.request_id}`, confidence: 0.75 }, finish_reason: 'STOP', usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } };
      case 'SUCCESS': return { status: 'SUCCESS', text: JSON.stringify({ summary: `success-${request.request_id}`, confidence: 0.75 }), finish_reason: 'STOP', usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 } };
      default: return { status: 'FAILED', error: modelError('UNKNOWN_PROVIDER_ERROR', 'RESPONSE_NORMALIZATION') };
    }
  }

  async discoverModels(): Promise<DiscoveryResult> {
    return { provider: this.providerId, observed_at: 'MOCK', status: 'SUCCESS', models: [{ model: this.model, status: 'LISTED', capabilities: this.capabilities }], diagnostics: { source: 'mock' } };
  }

  async healthCheck(model?: ModelId): Promise<HealthObservation> {
    return { provider: this.providerId, model: model ?? this.model, observed_at: 'MOCK', source: 'mock', status: 'HEALTHY', reason_code: null };
  }
}
