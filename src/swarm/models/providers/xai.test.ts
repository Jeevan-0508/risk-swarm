import { describe, expect, it } from '../../../core/test/bdd';
import { CircuitBreaker } from '../circuit';
import { analyzeExecutionDiversity } from '../diversity';
import { ModelRouter } from '../router';
import { ModelRuntime } from '../runtime';
import { jsonSchema } from '../structured-output';
import { MockTransport, type HttpResponse } from '../transport';
import { type ModelRequest } from '../types';
import { GeminiProviderAdapter } from './gemini';
import { XaiProviderAdapter } from './xai';
import { certificationTestSecret, formatCertificationReport, runCertification } from '../../../../scripts/certify-swarm-model-runtime';

const XAI_SECRET = 'SWARM_XAI_PHASE3C_SECRET_DO_NOT_LEAK';
const MODEL = 'grok-model-configured-by-test';

function response(status: number, body: string): HttpResponse {
  return { status, headers: { 'content-type': 'application/json' }, body };
}

function successBody(text = '{"summary":"OK","confidence":1}') {
  return JSON.stringify({ id: 'synthetic', choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 } });
}

function request(id: string, model = MODEL, signal?: AbortSignal): ModelRequest<{ summary: string; confidence: number }> {
  void model;
  const schema = jsonSchema<{ summary: string; confidence: number }>('xai_test_schema', (value) => {
    if (!value || typeof value !== 'object') return { success: false, error: 'object required' };
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2 || record.summary !== 'OK' || record.confidence !== 1) return { success: false, error: 'strict result required' };
    return { success: true, value: { summary: 'OK', confidence: 1 } };
  });
  return { request_id: id, case_id: 'xai-test-case', purpose: 'PORTABILITY_TEST', model_requirements: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'], task_instruction: 'Return exactly {"summary":"OK","confidence":1}.', context: {}, output_schema: schema, timeout_ms: 500, signal };
}

function xaiRuntime(transport: MockTransport) {
  const adapter = new XaiProviderAdapter({ transport });
  return { adapter, runtime: new ModelRuntime({ providers: new Map([['xai', adapter]]), credentials: { resolve: () => ({ configured: true, value: XAI_SECRET }) } }) };
}

describe('SWARM 2 Phase 3C xAI provider portability', () => {
  it('uses the provider boundary and normalizes the OpenAI-compatible xAI shape', async () => {
    const transport = new MockTransport(() => response(200, successBody()));
    const run = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, transport);
    expect(run.report.CERTIFICATION_RESULT).toBe('PASS');
    expect(run.report.CERT_PROVIDER).toBe('xai');
    expect(run.report.REQUESTED_PROVIDER).toBe('xai');
    expect(run.report.REQUESTED_MODEL).toBe(MODEL);
    expect(run.report.ATTEMPTED_PROVIDER).toBe('xai');
    expect(run.report.ATTEMPTED_MODEL).toBe(MODEL);
    expect(run.report.EXECUTED_PROVIDER).toBe('xai');
    expect(run.report.EXECUTED_MODEL).toBe(MODEL);
    expect(run.report.PROVIDER_REQUEST_ATTEMPTED).toBe(true);
    expect(run.report.PROVIDER_RESPONSE_RECEIVED).toBe(true);
    expect(run.report.MODEL_INFERENCE_SUCCEEDED).toBe(true);
    expect(run.report.MODEL_OUTPUT_PRESENT).toBe(true);
    expect(run.report.MODEL_OUTPUT_ACCEPTED).toBe(true);
    expect(run.report.STRUCTURED_VALIDATION).toBe('PASS');
    expect(run.response?.usage).toEqual({ input_tokens: 4, output_tokens: 5, total_tokens: 9 });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url).toBe('https://api.x.ai/v1/chat/completions');
    expect(transport.requests[0]?.method).toBe('POST');
    expect(transport.requests[0]?.headers?.authorization).toBe(`Bearer ${XAI_SECRET}`);
    expect(transport.requests[0]?.url).not.toContain(XAI_SECRET);
    expect(transport.requests[0]?.body).not.toContain(XAI_SECRET);
  });

  it('sends the composed system contract and sealed runtime context through the provider boundary', async () => {
    const transport = new MockTransport(() => response(200, successBody()));
    const { adapter } = xaiRuntime(transport);
    await adapter.execute({ ...request('context'), system_instruction: 'seat contract', context: { evidence_package: { package_hash: 'sealed-fingerprint' }, seat_id: 'ATHENA' } }, MODEL, { credential: XAI_SECRET });
    const body = JSON.parse(transport.requests[0]!.body!);
    expect(body.messages).toEqual([
      { role: 'system', content: 'seat contract' },
      { role: 'user', content: expect.stringContaining('sealed-fingerprint') },
    ]);
    expect(body.messages[1].content).toContain('Return exactly');
  });

  it('sends a supplied DTO schema as strict native JSON schema without exposing credentials', async () => {
    const transport = new MockTransport(() => response(200, successBody()));
    const { adapter } = xaiRuntime(transport);
    const schema = jsonSchema('phase4_assessment', () => ({ success: true as const, value: { summary: 'OK', confidence: 1 } }), {
      strict: true,
      json_schema: { type: 'object', additionalProperties: false, properties: { summary: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 } }, required: ['summary', 'confidence'] },
    });
    await adapter.execute({ ...request('schema'), output_schema: schema }, MODEL, { credential: XAI_SECRET });
    const body = JSON.parse(transport.requests[0]!.body!);
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'phase4_assessment', strict: true, schema: schema.json_schema } });
    expect(transport.requests[0]!.body).not.toContain(XAI_SECRET);
  });

  it('keeps the same ModelSeatExecutor certification semantics for Gemini and xAI', async () => {
    const gemini = await runCertification({ provider: 'gemini', model: 'gemini-test', credential: certificationTestSecret }, new MockTransport(() => response(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"OK","confidence":1}' }] } }] }))));
    const xai = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => response(200, successBody())));
    expect(gemini.report.CERTIFICATION_RESULT).toBe('PASS');
    expect(xai.report.CERTIFICATION_RESULT).toBe('PASS');
    expect(gemini.report.ATTEMPT_COUNT).toBe(1);
    expect(xai.report.ATTEMPT_COUNT).toBe(1);
    expect(gemini.report.STRUCTURED_VALIDATION).toBe('PASS');
    expect(xai.report.STRUCTURED_VALIDATION).toBe('PASS');
  });

  it('normalizes xAI HTTP statuses without retry, fallback, or fabricated output', async () => {
    const cases = [
      [400, 'PROVIDER_HTTP_ERROR'], [401, 'AUTHENTICATION'], [403, 'AUTHORIZATION'], [404, 'MODEL_NOT_FOUND'],
      [408, 'TIMEOUT'], [429, 'RATE_LIMITED'], [500, 'PROVIDER_HTTP_ERROR'], [502, 'PROVIDER_HTTP_ERROR'], [503, 'PROVIDER_UNAVAILABLE'],
    ] as const;
    for (const [status, code] of cases) {
      const run = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => response(status, JSON.stringify({ error: { message: XAI_SECRET } }))));
      expect(run.report.CERTIFICATION_RESULT, String(status)).toBe('FAIL');
      expect(run.report.REQUEST_COUNT, String(status)).toBe(1);
      expect(run.report.ATTEMPTED_PROVIDER, String(status)).toBe('xai');
      expect(run.report.ATTEMPTED_MODEL, String(status)).toBe(MODEL);
      expect(run.report.EXECUTED_PROVIDER, String(status)).toBe(null);
      expect(run.report.EXECUTED_MODEL, String(status)).toBe(null);
      expect(run.report.FAILURE_REASON_CODE, String(status)).toBe(code);
      expect(run.report.PROVIDER_REQUEST_ATTEMPTED, String(status)).toBe(true);
      expect(run.report.PROVIDER_RESPONSE_RECEIVED, String(status)).toBe(true);
      expect(run.report.MODEL_OUTPUT_PRESENT, String(status)).toBe(false);
      expect(run.report.MODEL_OUTPUT_ACCEPTED, String(status)).toBe(false);
      expect(run.report.STRUCTURED_VALIDATION, String(status)).toBe('NOT_RUN');
      expect(run.report.FALLBACK_USED, String(status)).toBe(false);
    }
  });

  it('distinguishes empty/provider-malformed/model-malformed/schema-invalid/provider/network failures', async () => {
    const empty = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => response(200, JSON.stringify({ choices: [{ message: { content: '' } }] }))));
    expect(empty.report.FAILURE_REASON_CODE).toBe('EMPTY_RESPONSE');
    expect(empty.report.STRUCTURED_VALIDATION).toBe('NOT_RUN');
    expect(empty.report.MODEL_OUTPUT_PRESENT).toBe(false);

    const malformedProvider = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => response(200, '{not-json')));
    expect(malformedProvider.report.FAILURE_REASON_CODE).toBe('RESPONSE_PARSE_ERROR');
    expect(malformedProvider.report.STRUCTURED_VALIDATION).toBe('NOT_RUN');

    const malformedModel = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => response(200, successBody('not-json'))));
    expect(malformedModel.report.FAILURE_REASON_CODE).toBe('RESPONSE_PARSE_ERROR');
    expect(malformedModel.report.STRUCTURED_VALIDATION).toBe('NOT_RUN');
    expect(malformedModel.report.MODEL_INFERENCE_SUCCEEDED).toBe(true);
    expect(malformedModel.report.MODEL_OUTPUT_PRESENT).toBe(true);

    const invalid = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => response(200, successBody('{"summary":"NO","confidence":0.5}'))));
    expect(invalid.report.FAILURE_REASON_CODE).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(invalid.report.STRUCTURED_VALIDATION).toBe('FAIL');
    expect(invalid.report.MODEL_OUTPUT_ACCEPTED).toBe(false);

    const provider = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => Promise.reject(new Error('provider exception'))));
    expect(provider.report.FAILURE_REASON_CODE).toBe('UNKNOWN_PROVIDER_ERROR');
    expect(provider.report.PROVIDER_REQUEST_ATTEMPTED).toBe(true);
    expect(provider.report.PROVIDER_RESPONSE_RECEIVED).toBe(false);

    const networkError = new Error('network');
    networkError.name = 'NetworkError';
    const network = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => Promise.reject(networkError)));
    expect(network.report.FAILURE_REASON_CODE).toBe('NETWORK');

    const timeout = new Error('timeout');
    timeout.name = 'AbortError';
    const timed = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => Promise.reject(timeout)));
    expect(timed.report.FAILURE_REASON_CODE).toBe('TIMEOUT');
  });

  it('isolates secrets from model records, errors, diagnostics, report, and console-safe output', async () => {
    const run = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => response(500, JSON.stringify({ error: { message: XAI_SECRET, authorization: `Bearer ${XAI_SECRET}` } }))));
    expect(JSON.stringify(run.response)).not.toContain(XAI_SECRET);
    expect(JSON.stringify(run.response?.attempts)).not.toContain('Bearer');
    expect(JSON.stringify(run.response?.error)).not.toContain(XAI_SECRET);
    expect(JSON.stringify(run.report)).not.toContain(XAI_SECRET);
    expect(formatCertificationReport(run.report)).not.toContain(XAI_SECRET);
    expect(run.report.SECRET_LEAK_CHECK).toBe('PASS');
  });

  it('keeps provider/model circuit state independent and reports two-provider diversity', async () => {
    const breaker = new CircuitBreaker({ threshold: 1, clock: { now: () => Date.now(), iso: () => new Date().toISOString() } });
    const xaiTransport = new MockTransport(() => response(503, '{}'));
    const { runtime: xaiRuntime } = xaiRuntimeFor(xaiTransport);
    const xaiFailure = await new ModelRouter(xaiRuntime, { circuitBreaker: breaker }).execute(request('xai-failure'), { primary: { provider: 'xai', model: MODEL } });
    expect(xaiFailure.error?.code).toBe('PROVIDER_UNAVAILABLE');
    expect(breaker.state('xai', MODEL)).toBe('OPEN');
    expect(breaker.state('gemini', 'gemini-model')).toBe('CLOSED');

    const geminiTransport = new MockTransport(() => response(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"OK","confidence":1}' }] } }] })));
    const geminiAdapter = new GeminiProviderAdapter({ transport: geminiTransport });
    const geminiRuntime = new ModelRuntime({ providers: new Map([['gemini', geminiAdapter]]), credentials: { resolve: () => ({ configured: true, value: 'gemini-test' }) } });
    const geminiSuccess = await new ModelRouter(geminiRuntime, { circuitBreaker: breaker }).execute(request('gemini-success', 'gemini-model'), { primary: { provider: 'gemini', model: 'gemini-model' } });
    expect(geminiSuccess.status).toBe('SUCCESS');

    const xaiSuccess = await runCertification({ provider: 'xai', model: MODEL, credential: XAI_SECRET }, new MockTransport(() => response(200, successBody())));
    const geminiCert = await runCertification({ provider: 'gemini', model: 'gemini-model', credential: 'gemini-test' }, new MockTransport(() => response(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"summary":"OK","confidence":1}' }] } }] }))));
    expect(analyzeExecutionDiversity([xaiSuccess.response!, geminiCert.response!]).unique_providers).toEqual(['gemini', 'xai']);
  });

  it('preserves cancellation and concurrent identity through the xAI adapter', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const transport = new MockTransport(async () => { await gate; return response(200, successBody()); });
    const { runtime } = xaiRuntime(transport);
    const controller = new AbortController();
    const pending = runtime.execute(request('cancel', MODEL, controller.signal), { provider: 'xai', model: MODEL });
    controller.abort();
    release!();
    const cancelled = await pending;
    expect(cancelled.error?.code).toBe('CANCELLED');
    expect(cancelled.status).toBe('FAILED');

    const concurrentTransport = new MockTransport(async () => response(200, successBody()));
    const { runtime: concurrent } = xaiRuntime(concurrentTransport);
    const [a, b] = await Promise.all([
      concurrent.execute(request('a', 'grok-a'), { provider: 'xai', model: 'grok-a' }),
      concurrent.execute(request('b', 'grok-b'), { provider: 'xai', model: 'grok-b' }),
    ]);
    expect(a.executed_model).toEqual({ provider: 'xai', model: 'grok-a' });
    expect(b.executed_model).toEqual({ provider: 'xai', model: 'grok-b' });
    expect(a.structured_output?.summary).toBe('OK');
    expect(b.structured_output?.summary).toBe('OK');
    expect(a.attempts[0]?.model).toBe('grok-a');
    expect(b.attempts[0]?.model).toBe('grok-b');
  });

  it('keeps xAI capabilities configured and provider-specific seat constructs absent', async () => {
    const adapter = new XaiProviderAdapter({ transport: new MockTransport(() => response(200, successBody())) });
    expect(adapter.getConfiguredCapabilities(MODEL).source).toBe('CONFIGURED');
    expect('discoverModels' in adapter).toBe(false);
    const source = await Bun.file(new URL('../seat-executor.ts', import.meta.url)).text();
    for (const forbidden of ['GrokSeat', 'XaiSeat', 'AthenaGrok', 'AresGrok', 'GeminiSeat', 'GeminiAthena']) expect(source).not.toContain(forbidden);
  });
});

function xaiRuntimeFor(transport: MockTransport) {
  const adapter = new XaiProviderAdapter({ transport });
  return { runtime: new ModelRuntime({ providers: new Map([['xai', adapter]]), credentials: { resolve: () => ({ configured: true, value: XAI_SECRET }) } }) };
}
