import { describe, expect, test } from 'bun:test';
import { ROUND1_SEAT_IDS } from '../contracts';
import { sealEvidence } from '../evidence/package';
import { buildGoldenScenario } from '../evaluation/scenarios';
import { CircuitBreaker } from './circuit';
import { type Clock, type ModelRequest, type ModelRef, type ProviderAdapter, type ProviderContext, type ProviderExecution } from './types';
import { MockCredentialResolver, MockProviderAdapter } from './providers/mock';
import { modelError } from './errors';
import { ModelRouter } from './router';
import { ModelRuntime } from './runtime';
import { GENERIC_MODEL_TASK_SCHEMA, ModelSeatExecutor, type GenericModelTaskOutput } from './seat-executor';
import { jsonSchema, normalizeStructuredOutput } from './structured-output';
import { MockTransport } from './transport';
import { analyzeExecutionDiversity } from './diversity';

class TestClock implements Clock {
  value = 1_000;
  now(): number { return this.value; }
  iso(): string { return new Date(this.value).toISOString(); }
  advance(ms: number): void { this.value += ms; }
}

const MODEL: ModelRef = { provider: 'mock', model: 'mock-model' };

function request(id = 'request-1', overrides: Partial<ModelRequest<GenericModelTaskOutput>> = {}): ModelRequest<GenericModelTaskOutput> {
  return {
    request_id: id,
    case_id: 'case-runtime',
    purpose: 'PHASE3_TEST',
    model_requirements: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'],
    task_instruction: 'Return the generic structured result.',
    context: { test: true },
    output_schema: GENERIC_MODEL_TASK_SCHEMA,
    timeout_ms: 1000,
    ...overrides,
  };
}

function runtime(adapter: ProviderAdapter, clock = new TestClock(), credentials = new MockCredentialResolver()) {
  return { runtime: new ModelRuntime({ providers: new Map([[adapter.providerId, adapter]]), credentials, clock }), clock };
}

class SequenceAdapter implements ProviderAdapter {
  readonly providerId = 'sequence';
  readonly calls = 0;
  private callCount = 0;
  constructor(private readonly results: readonly ProviderExecution[], private readonly capabilities = { capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT', 'JSON_MODE'] as const, source: 'CONFIGURED' as const }) {}
  getConfiguredCapabilities() { return this.capabilities; }
  async execute(_request: ModelRequest, _model: string, _context: ProviderContext): Promise<ProviderExecution> {
    this.callCount += 1;
    return this.results[Math.min(this.callCount - 1, this.results.length - 1)]!;
  }
  get callsMade(): number { return this.callCount; }
}

describe('SWARM 2 Phase 3 model runtime', () => {
  test('normalizes structured success and preserves model identity', async () => {
    const adapter = new MockProviderAdapter({ scenario: 'STRUCTURED_SUCCESS' });
    const { runtime: modelRuntime } = runtime(adapter);
    const response = await modelRuntime.execute(request(), MODEL);
    expect(response.status).toBe('SUCCESS');
    expect(response.structured_output?.summary).toBe('structured-request-1');
    expect(response.requested_model).toEqual(MODEL);
    expect(response.executed_model).toEqual(MODEL);
    expect(response.execution.fallback_used).toBe(false);
    expect(response.execution.real_model_called).toBe(false);
    expect(response.execution.independent).toBe(false);
    expect(response.attempts).toHaveLength(1);
    expect(analyzeExecutionDiversity([response, response])).toEqual({ unique_models: ['mock/mock-model'], unique_providers: ['mock'], fallback_count: 0, same_model_count: 1 });
  });

  test('maps every required provider failure class without fabricating success', async () => {
    const cases = [
      ['EMPTY_RESPONSE', 'FAILED', 'EMPTY_RESPONSE'],
      ['MALFORMED_RESPONSE', 'FAILED', 'RESPONSE_PARSE_ERROR'],
      ['SCHEMA_INVALID_OUTPUT', 'REJECTED', 'STRUCTURED_OUTPUT_INVALID'],
      ['HTTP_ERROR', 'FAILED', 'PROVIDER_HTTP_ERROR'],
      ['HTTP_SERVER_ERROR', 'FAILED', 'PROVIDER_HTTP_ERROR'],
      ['AUTHENTICATION_FAILURE', 'UNAVAILABLE', 'AUTHENTICATION'],
      ['AUTHORIZATION_FAILURE', 'FAILED', 'AUTHORIZATION'],
      ['MODEL_NOT_FOUND', 'UNAVAILABLE', 'MODEL_NOT_FOUND'],
      ['TIMEOUT', 'FAILED', 'TIMEOUT'],
      ['RATE_LIMIT', 'UNAVAILABLE', 'RATE_LIMITED'],
      ['HTTP_UNAVAILABLE', 'UNAVAILABLE', 'PROVIDER_UNAVAILABLE'],
      ['NETWORK_EXCEPTION', 'FAILED', 'NETWORK'],
      ['PROVIDER_EXCEPTION', 'FAILED', 'UNKNOWN_PROVIDER_ERROR'],
      ['CANCELLED', 'FAILED', 'CANCELLED'],
    ] as const;
    for (const [scenario, status, code] of cases) {
      const adapter = new MockProviderAdapter({ scenario });
      const { runtime: modelRuntime } = runtime(adapter);
      const response = await modelRuntime.execute(request(scenario), MODEL);
      expect(response.status, scenario).toBe(status);
      expect(response.error?.code, scenario).toBe(code);
      expect(response.structured_output, scenario).toBeNull();
    }
  });

  test('router keeps primary success primary and preserves attempts on explicit fallback', async () => {
    const primary = new MockProviderAdapter({ providerId: 'primary', model: 'model-a', scenario: 'SUCCESS' });
    const fallback = new MockProviderAdapter({ providerId: 'fallback', model: 'model-b', scenario: 'SUCCESS' });
    const modelRuntime = new ModelRuntime({ providers: new Map([['primary', primary], ['fallback', fallback]]) });
    const router = new ModelRouter(modelRuntime);
    const primaryResponse = await router.execute(request('primary-success'), { primary: { provider: 'primary', model: 'model-a' } });
    expect(primaryResponse.execution.fallback_used).toBe(false);
    expect(primaryResponse.execution.executed_provider).toBe('primary');
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(0);

    const unavailable = new MockProviderAdapter({ providerId: 'primary2', model: 'model-a', scenario: 'HTTP_UNAVAILABLE' });
    const backup = new MockProviderAdapter({ providerId: 'fallback2', model: 'model-b', scenario: 'SUCCESS' });
    const fallbackRuntime = new ModelRuntime({ providers: new Map([['primary2', unavailable], ['fallback2', backup]]) });
    const fallbackResponse = await new ModelRouter(fallbackRuntime).execute(request('fallback-success'), { primary: { provider: 'primary2', model: 'model-a' }, fallback_models: [{ provider: 'fallback2', model: 'model-b' }], fallback_enabled: true, allowed_fallback_reasons: ['PROVIDER_UNAVAILABLE'] });
    expect(fallbackResponse.status).toBe('SUCCESS');
    expect(fallbackResponse.execution.fallback_used).toBe(true);
    expect(fallbackResponse.execution.fallback_reason).toBe('PROVIDER_UNAVAILABLE');
    expect(fallbackResponse.requested_model).toEqual({ provider: 'primary2', model: 'model-a' });
    expect(fallbackResponse.executed_model).toEqual({ provider: 'fallback2', model: 'model-b' });
    expect(fallbackResponse.attempts).toHaveLength(2);
  });

  test('does not fallback for authentication or schema-invalid output unless explicitly allowed', async () => {
    const auth = new MockProviderAdapter({ providerId: 'auth', scenario: 'AUTHENTICATION_FAILURE' });
    const backup = new MockProviderAdapter({ providerId: 'backup', scenario: 'SUCCESS' });
    const authRouter = new ModelRouter(new ModelRuntime({ providers: new Map([['auth', auth], ['backup', backup]]) }));
    const authResponse = await authRouter.execute(request('auth-no-fallback'), { primary: { provider: 'auth', model: 'mock-model' }, fallback_models: [{ provider: 'backup', model: 'mock-model' }], fallback_enabled: true, allowed_fallback_reasons: ['PROVIDER_UNAVAILABLE'] });
    expect(authResponse.status).toBe('UNAVAILABLE');
    expect(backup.calls).toHaveLength(0);

    const invalid = new MockProviderAdapter({ providerId: 'invalid', scenario: 'SCHEMA_INVALID_OUTPUT' });
    const invalidBackup = new MockProviderAdapter({ providerId: 'invalid-backup', scenario: 'SUCCESS' });
    const invalidResponse = await new ModelRouter(new ModelRuntime({ providers: new Map([['invalid', invalid], ['invalid-backup', invalidBackup]]) })).execute(request('schema-no-fallback'), { primary: { provider: 'invalid', model: 'mock-model' }, fallback_models: [{ provider: 'invalid-backup', model: 'mock-model' }], fallback_enabled: true, allowed_fallback_reasons: ['PROVIDER_UNAVAILABLE'] });
    expect(invalidResponse.status).toBe('REJECTED');
    expect(invalidBackup.calls).toHaveLength(0);

    const unavailable = new MockProviderAdapter({ providerId: 'unavailable-no-fallback', scenario: 'HTTP_UNAVAILABLE' });
    const disabledBackup = new MockProviderAdapter({ providerId: 'disabled-backup', scenario: 'SUCCESS' });
    const disabledResponse = await new ModelRouter(new ModelRuntime({ providers: new Map([['unavailable-no-fallback', unavailable], ['disabled-backup', disabledBackup]]) })).execute(request('disabled-fallback'), { primary: { provider: 'unavailable-no-fallback', model: 'mock-model' }, fallback_models: [{ provider: 'disabled-backup', model: 'mock-model' }], fallback_enabled: false, allowed_fallback_reasons: ['PROVIDER_UNAVAILABLE'] });
    expect(disabledResponse.status).toBe('UNAVAILABLE');
    expect(disabledBackup.calls).toHaveLength(0);
  });

  test('missing injected credentials stop before provider invocation', async () => {
    const adapter = new MockProviderAdapter({ scenario: 'SUCCESS' });
    const response = await new ModelRuntime({ providers: new Map([['mock', adapter]]), credentials: new MockCredentialResolver({ mock: undefined }) }).execute(request('missing-credential'), MODEL);
    expect(response.status).toBe('UNAVAILABLE');
    expect(response.error?.code).toBe('AUTHENTICATION');
    expect(adapter.calls).toHaveLength(0);
  });

  test('rejects capability mismatch before provider invocation and records truthful fallback mismatch', async () => {
    const limited = new MockProviderAdapter({ providerId: 'limited', capabilities: { capabilities: ['TEXT_GENERATION'], source: 'CONFIGURED' } });
    const response = await new ModelRouter(new ModelRuntime({ providers: new Map([['limited', limited]]) })).execute(request('capability-mismatch'), { primary: { provider: 'limited', model: 'mock-model' } });
    expect(response.status).toBe('REJECTED');
    expect(response.error?.code).toBe('CAPABILITY_MISMATCH');
    expect(limited.calls).toHaveLength(0);

    const unavailable = new MockProviderAdapter({ providerId: 'unavailable', scenario: 'HTTP_UNAVAILABLE' });
    const fallbackLimited = new MockProviderAdapter({ providerId: 'fallback-limited', capabilities: { capabilities: ['TEXT_GENERATION'], source: 'CONFIGURED' } });
    const fallbackMismatch = await new ModelRouter(new ModelRuntime({ providers: new Map([['unavailable', unavailable], ['fallback-limited', fallbackLimited]]) })).execute(request('fallback-capability-mismatch'), { primary: { provider: 'unavailable', model: 'mock-model' }, fallback_models: [{ provider: 'fallback-limited', model: 'mock-model' }], fallback_enabled: true, allowed_fallback_reasons: ['PROVIDER_UNAVAILABLE'] });
    expect(fallbackMismatch.status).toBe('REJECTED');
    expect(fallbackMismatch.error?.code).toBe('CAPABILITY_MISMATCH');
    expect(fallbackLimited.calls).toHaveLength(0);
  });

  test('retries only configured transient failures without sleeping', async () => {
    const adapter = new SequenceAdapter([{ status: 'FAILED', error: modelError('TIMEOUT', 'REQUEST') }, { status: 'SUCCESS', text: JSON.stringify({ summary: 'recovered', confidence: 0.5 }) }]);
    const delays: number[] = [];
    const modelRuntime = new ModelRuntime({ providers: new Map([['sequence', adapter]]) });
    const response = await new ModelRouter(modelRuntime, { retryScheduler: async (delay) => { delays.push(delay); } }).execute(request('retry'), { primary: { provider: 'sequence', model: 'model' }, retry: { max_attempts: 2, retryable_reasons: ['TIMEOUT'], backoff_ms: [25] } });
    expect(response.status).toBe('SUCCESS');
    expect(response.attempts).toHaveLength(2);
    expect(delays).toEqual([25]);
    expect(adapter.callsMade).toBe(2);
  });

  test('circuit breaker opens, prevents calls, half-opens after cooldown, and closes on success', async () => {
    const clock = new TestClock();
    const adapter = new SequenceAdapter([{ status: 'UNAVAILABLE', error: modelError('PROVIDER_UNAVAILABLE', 'HTTP') }, { status: 'UNAVAILABLE', error: modelError('PROVIDER_UNAVAILABLE', 'HTTP') }, { status: 'SUCCESS', text: JSON.stringify({ summary: 'healthy again', confidence: 0.8 }) }]);
    const breaker = new CircuitBreaker({ threshold: 2, cooldown_ms: 100, clock });
    const router = new ModelRouter(new ModelRuntime({ providers: new Map([['sequence', adapter]]), clock }), { circuitBreaker: breaker });
    const plan = { primary: { provider: 'sequence', model: 'model' } };
    await router.execute(request('breaker-1'), plan);
    await router.execute(request('breaker-2'), plan);
    expect(breaker.state('sequence', 'model')).toBe('OPEN');
    expect(breaker.state('other-provider', 'model')).toBe('CLOSED');
    const prevented = await router.execute(request('breaker-open'), plan);
    expect(prevented.error?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(adapter.callsMade).toBe(2);
    clock.advance(100);
    expect(breaker.state('sequence', 'model')).toBe('HALF_OPEN');
    const recovered = await router.execute(request('breaker-half-open'), plan);
    expect(recovered.status).toBe('SUCCESS');
    expect(breaker.state('sequence', 'model')).toBe('CLOSED');
  });

  test('schema-invalid output does not count as infrastructure outage', async () => {
    const clock = new TestClock();
    const adapter = new MockProviderAdapter({ scenario: 'SCHEMA_INVALID_OUTPUT' });
    const breaker = new CircuitBreaker({ threshold: 1, clock });
    const router = new ModelRouter(new ModelRuntime({ providers: new Map([['mock', adapter]]), clock }), { circuitBreaker: breaker });
    const response = await router.execute(request('schema-breaker'), { primary: MODEL });
    expect(response.status).toBe('REJECTED');
    expect(breaker.state('mock', 'mock-model')).toBe('CLOSED');
  });

  test('structured output allows only explicit fences or one balanced JSON object', () => {
    const schema = jsonSchema<{ value: number }>('value', (value) => {
      if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).value !== 'number') return { success: false, error: 'value required' };
      if (Object.keys(value as object).length !== 1) return { success: false, error: 'strict object' };
      return { success: true, value: value as { value: number } };
    });
    expect(normalizeStructuredOutput({ text: '{"value":1}' }, schema).ok).toBe(true);
    expect(normalizeStructuredOutput({ text: '```json\n{"value":1}\n```' }, schema, { allow_code_fence: true }).ok).toBe(true);
    expect(normalizeStructuredOutput({ text: 'prefix {"value":1} suffix' }, schema, { allow_balanced_object_extraction: true }).ok).toBe(true);
    expect(normalizeStructuredOutput({ text: '{bad}' }, schema, { allow_balanced_object_extraction: true }).error?.code).toBe('RESPONSE_PARSE_ERROR');
    expect(normalizeStructuredOutput({ text: '{"value":1} {"value":2}' }, schema, { allow_balanced_object_extraction: true }).error?.code).toBe('RESPONSE_PARSE_ERROR');
    expect(normalizeStructuredOutput({ text: '{"value":"wrong"}' }, schema).error?.code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(normalizeStructuredOutput({ text: '{"value":1,"extra":2}' }, schema).error?.code).toBe('STRUCTURED_OUTPUT_INVALID');
  });

  test('credential values, authorization-like diagnostics, and provider exceptions never serialize', async () => {
    const secret = 'SWARM_TEST_SECRET_DO_NOT_LEAK';
    const adapter: ProviderAdapter = {
      providerId: 'secret-provider',
      getConfiguredCapabilities: () => ({ capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'], source: 'CONFIGURED' }),
      async execute() {
        return { status: 'FAILED', error: modelError('PROVIDER_HTTP_ERROR', 'HTTP', { detail: secret, authorization: secret }), diagnostics: { detail: secret } };
      },
    };
    const response = await new ModelRuntime({ providers: new Map([['secret-provider', adapter]]), credentials: new MockCredentialResolver({ 'secret-provider': secret }) }).execute(request('secret'), { provider: 'secret-provider', model: 'model' });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('authorization');
    expect(serialized).not.toContain('Authorization');
  });

  test('late transport resolution after cancellation cannot become success', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapter: ProviderAdapter = {
      providerId: 'late',
      getConfiguredCapabilities: () => ({ capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'], source: 'CONFIGURED' }),
      async execute() {
        await gate;
        return { status: 'SUCCESS', text: JSON.stringify({ summary: 'late', confidence: 0.9 }) };
      },
    };
    const controller = new AbortController();
    const promise = new ModelRuntime({ providers: new Map([['late', adapter]]) }).execute(request('cancel', { signal: controller.signal }), { provider: 'late', model: 'model' });
    controller.abort();
    release!();
    const response = await promise;
    expect(response.status).toBe('FAILED');
    expect(response.error?.code).toBe('CANCELLED');
  });

  test('concurrent requests keep request identity and structured outputs isolated', async () => {
    const adapter: ProviderAdapter = {
      providerId: 'concurrent',
      getConfiguredCapabilities: () => ({ capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'], source: 'CONFIGURED' }),
      async execute(input) {
        return { status: 'SUCCESS', text: JSON.stringify({ summary: input.request_id, confidence: input.request_id.endsWith('a') ? 0.2 : 0.8 }) };
      },
    };
    const modelRuntime = new ModelRuntime({ providers: new Map([['concurrent', adapter]]) });
    const [a, b] = await Promise.all([modelRuntime.execute(request('a'), { provider: 'concurrent', model: 'model' }), modelRuntime.execute(request('b'), { provider: 'concurrent', model: 'model' })]);
    expect(a.structured_output?.summary).toBe('a');
    expect(b.structured_output?.summary).toBe('b');
    expect(a.structured_output?.confidence).toBe(0.2);
    expect(b.structured_output?.confidence).toBe(0.8);
  });

  test('transport, discovery, and health remain injectable observations', async () => {
    const transport = new MockTransport((input) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, url: input.url }) }));
    const result = await transport.request({ method: 'POST', url: 'https://mock.invalid', headers: { Authorization: 'SWARM_TEST_SECRET_DO_NOT_LEAK' }, body: '{}' });
    expect(result.status).toBe(200);
    expect(transport.requests).toHaveLength(1);
    const adapter = new MockProviderAdapter();
    const discovery = await adapter.discoverModels!();
    const health = await adapter.healthCheck!();
    expect(discovery.models[0]?.status).toBe('LISTED');
    expect(discovery.models[0]?.status).not.toBe('EXECUTION_VERIFIED');
    expect(health.status).toBe('HEALTHY');
  });

  test('ModelSeatExecutor bridges generic structured output without risk-seat semantics or fixture labeling', async () => {
    const adapter = new MockProviderAdapter({ scenario: 'STRUCTURED_SUCCESS' });
    const modelRuntime = new ModelRuntime({ providers: new Map([['mock', adapter]]) });
    const executor = new ModelSeatExecutor(new ModelRouter(modelRuntime), { primary: MODEL });
    const scenario = buildGoldenScenario('SUPPORTED_RISK');
    const evidencePackage = sealEvidence(scenario.case, scenario.evidence, { sealed_at: scenario.sealed_at });
    const input = { seat_id: ROUND1_SEAT_IDS[0], case: { case_id: scenario.case.case_id, protocol_version: scenario.case.protocol_version, question: scenario.case.question, scope: scenario.case.scope, policy: scenario.case.policy }, evidence_package: evidencePackage, execution_context: { invocation: 1, phase: 'ROUND_1' as const } };
    const result = await executor.execute(input);
    expect(result.status).toBe('SUCCESS');
    expect(result.output?.summary).toContain('structured');
    expect(result.response.execution.executed_provider).toBe('mock');
    expect(result.response.execution.real_model_called).toBe(false);
    expect(result.response.execution.independent).toBe(false);
    expect(result.response).not.toHaveProperty('position');

    const unavailable = new MockProviderAdapter({ providerId: 'primary-seat', scenario: 'HTTP_UNAVAILABLE' });
    const fallback = new MockProviderAdapter({ providerId: 'fallback-seat', scenario: 'STRUCTURED_SUCCESS' });
    const fallbackExecutor = new ModelSeatExecutor(new ModelRouter(new ModelRuntime({ providers: new Map([['primary-seat', unavailable], ['fallback-seat', fallback]]) })), { primary: { provider: 'primary-seat', model: 'mock-model' }, fallback_models: [{ provider: 'fallback-seat', model: 'mock-model' }], fallback_enabled: true, allowed_fallback_reasons: ['PROVIDER_UNAVAILABLE'] });
    const fallbackResult = await fallbackExecutor.execute(input);
    expect(fallbackResult.status).toBe('SUCCESS');
    expect(fallbackResult.response.execution.fallback_used).toBe(true);

    const abstaining: ProviderAdapter = { providerId: 'abstaining', getConfiguredCapabilities: () => ({ capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'], source: 'CONFIGURED' }), async execute() { return { status: 'SUCCESS', text: JSON.stringify({ summary: 'abstain', confidence: 0.1, abstained: true, abstention_reason: 'generic test abstention' }) }; } };
    const abstainExecutor = new ModelSeatExecutor(new ModelRouter(new ModelRuntime({ providers: new Map([['abstaining', abstaining]]) })), { primary: { provider: 'abstaining', model: 'model' } });
    const abstainResult = await abstainExecutor.execute(input);
    expect(abstainResult.status).toBe('ABSTAINED');
  });
});
