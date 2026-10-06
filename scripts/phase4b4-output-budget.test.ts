import { describe, expect, test } from 'bun:test';
import { ModelRuntime } from '../src/swarm/models/runtime';
import { XaiProviderAdapter } from '../src/swarm/models/providers/xai';
import { MockTransport } from '../src/swarm/models/transport';
import { jsonSchema } from '../src/swarm/models/structured-output';
import { SEAT_ASSESSMENT_PROVIDER_SCHEMA } from '../src/swarm/seats/validation';
import { DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS, LIVE_MODEL, LIVE_PROVIDER, RequestContractGuardTransport, councilMaxOutputTokens, runOfflineDryRun } from './certify-swarm-live-council';
import { diagnosticConfigFromEnvironment, diagnosticPreflight, runDiagnosticWithTransport, runOfflineDiagnosticFixtures, validateDiagnosticConfiguration } from './diagnose-xai-structured-output';

const SIMPLE_SCHEMA = jsonSchema<{ readonly ok: boolean }>('budget_test', (value) => {
  if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).ok !== 'boolean') return { success: false, error: 'ok required' };
  return { success: true, value: { ok: (value as { ok: boolean }).ok } };
}, { strict: true, json_schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } });

function runtimeFor(body: string) {
  return new ModelRuntime({
    providers: new Map([[LIVE_PROVIDER, new XaiProviderAdapter({ transport: new MockTransport(() => ({ status: 200, headers: {}, body })) })]]),
    credentials: { resolve: () => ({ configured: true, value: 'PHASE4B4_OFFLINE_SECRET_DO_NOT_LEAK' }) },
  });
}

function request(max_output_tokens: number) {
  return { request_id: 'phase4b4-test', case_id: 'phase4b4-case', seat_id: 'ATHENA', purpose: 'PHASE4B4_OFFLINE', model_requirements: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'] as const, task_instruction: 'Return the bounded test object.', context: {}, output_schema: SIMPLE_SCHEMA, max_output_tokens, timeout_ms: 500 };
}

function validWireBody(max_tokens: number): string {
  return JSON.stringify({
    model: LIVE_MODEL,
    max_tokens,
    messages: [{ role: 'system', content: 'contract' }, { role: 'user', content: 'task\n\nSEALED_SWARM_CONTEXT_JSON:\n{"seat_id":"ATHENA","prompt_version":"ATHENA_PROMPT_V1","prompt_fingerprint":"fnv1a-test","evidence_package":{"package_hash":"fnv1a:cd48b0a4"}}' }],
    response_format: { type: 'json_schema', json_schema: { name: 'swarm_seat_assessment_v1', strict: true, schema: SEAT_ASSESSMENT_PROVIDER_SCHEMA } },
  });
}

describe('Phase 4B.4 bounded Council output budget repair', () => {
  test('256-token length-truncated structured output is rejected without completion', async () => {
    const runtime = runtimeFor(JSON.stringify({ choices: [{ message: { content: '{"ok":' }, finish_reason: 'length' }], usage: { completion_tokens: 256 } }));
    const response = await runtime.execute(request(256), { provider: LIVE_PROVIDER, model: LIVE_MODEL });
    expect(response.status).toBe('REJECTED');
    expect(response.error).toMatchObject({ code: 'OUTPUT_TOKEN_LIMIT', stage: 'RESPONSE_TRUNCATED' });
    expect(response.execution.model_output_present).toBe(true);
    expect(response.execution.structured_validation_performed).toBe(false);
    expect(response.diagnostics).toMatchObject({ truncation_detected: true, configured_output_limit: 256, output_count: 256, finish_reason: 'length' });
  });

  test('complete structured output within the bounded budget is accepted', async () => {
    const runtime = runtimeFor(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { completion_tokens: 12 } }));
    const response = await runtime.execute(request(DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS), { provider: LIVE_PROVIDER, model: LIVE_MODEL });
    expect(response.status).toBe('SUCCESS');
    expect(response.structured_output).toEqual({ ok: true });
    expect(response.diagnostics.truncation_detected).toBe(false);
  });

  test('Council harness serializes the bounded 1600-token budget and preserves Round 1 blindness', async () => {
    const dry = await runOfflineDryRun();
    expect(dry.baseline.wire_requests.every((projection) => projection.configured_max_output_tokens === DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS)).toBe(true);
    expect(dry.baseline.seat_reports.every((report) => report.configured_max_output_tokens === DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS && report.truncation_detected === false)).toBe(true);
    expect(dry.baseline.wire_requests.every((projection) => projection.peer_positions_present === false && projection.evidence_fingerprint === dry.baseline.evidence_package.package_hash)).toBe(true);
    expect(dry.baseline.budget).toEqual({ request_count: 4, attempted_count: 4, blocked_count: 0 });
  });

  test('request contract guard fails closed when the bounded budget is not serialized', async () => {
    let delegateCalls = 0;
    const guard = new RequestContractGuardTransport(new MockTransport(() => { delegateCalls += 1; return { status: 200, headers: {}, body: '{}' }; }), {
      provider: LIVE_PROVIDER,
      model: LIVE_MODEL,
      evidence_fingerprint: 'fnv1a:cd48b0a4',
      provider_schema: SEAT_ASSESSMENT_PROVIDER_SCHEMA,
      retry_disabled: true,
      fallback_disabled: true,
      max_output_tokens: DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS,
    });
    await expect(guard.request({ method: 'POST', url: 'https://api.x.ai/v1/chat/completions', body: validWireBody(256) })).rejects.toThrow('MAX_OUTPUT_TOKENS');
    expect(delegateCalls).toBe(0);
  });

  test('diagnostic harness adopts the same bounded budget and classifies truncation safely', async () => {
    const result = await runOfflineDiagnosticFixtures();
    expect(result.secretLeakCheck).toBe('PASS');
    expect(result.reports.every((report) => report.CONFIGURED_MAX_OUTPUT_TOKENS === DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS && report.PROVIDER_SCHEMA_FINGERPRINT === 'fnv1a:835100c1')).toBe(true);
    const truncated = result.reports.find((report) => report.FINISH_REASON === 'length');
    expect(truncated).toMatchObject({ TRUNCATION_DETECTED: true, FINAL_EXECUTION_STATUS: 'REJECTED', FAILURE_STAGE: 'RESPONSE_TRUNCATED', FAILURE_CODE: 'OUTPUT_TOKEN_LIMIT' });
  });

  test('budget configuration defaults to 1600 when absent', () => {
    const config = diagnosticConfigFromEnvironment({ XAI_API_KEY: 'synthetic', SWARM_XAI_DIAGNOSTIC_CONFIRM: 'YES' });
    expect(config).toMatchObject({ requested_max_output_tokens: null, max_output_tokens: 1600, output_budget_error: null });
    expect(diagnosticPreflight(config)).toEqual({ REQUESTED_MAX_OUTPUT_TOKENS: null, EFFECTIVE_MAX_OUTPUT_TOKENS: 1600, REQUESTED_EFFECTIVE_MISMATCH_GATE: 'PASS' });
    expect(validateDiagnosticConfiguration(config)).toEqual([]);
  });

  test('4096 environment override reaches diagnostic projection and serialized request', async () => {
    const config = diagnosticConfigFromEnvironment({ XAI_API_KEY: 'synthetic', SWARM_XAI_DIAGNOSTIC_CONFIRM: 'YES', SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096' });
    expect(config).toMatchObject({ requested_max_output_tokens: '4096', max_output_tokens: 4096, output_budget_error: null });
    expect(diagnosticPreflight(config)).toEqual({ REQUESTED_MAX_OUTPUT_TOKENS: 4096, EFFECTIVE_MAX_OUTPUT_TOKENS: 4096, REQUESTED_EFFECTIVE_MISMATCH_GATE: 'PASS' });
    const report = await runDiagnosticWithTransport(new MockTransport(() => ({ status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }) })), 'synthetic', config.max_output_tokens!, 4096);
    expect(report).toMatchObject({ REQUESTED_MAX_OUTPUT_TOKENS: 4096, EFFECTIVE_MAX_OUTPUT_TOKENS: 4096, CONFIGURED_MAX_OUTPUT_TOKENS: 4096, REQUESTED_EFFECTIVE_MISMATCH_GATE: 'PASS' });
    expect(report.PROVIDER_SCHEMA_PROJECTION.configured_max_output_tokens).toBe(4096);
  });

  test('invalid, zero, negative, and over-maximum environment values fail closed', () => {
    for (const value of ['not-an-integer', '0', '-1', '8193']) {
      const config = diagnosticConfigFromEnvironment({ XAI_API_KEY: 'synthetic', SWARM_XAI_DIAGNOSTIC_CONFIRM: 'YES', SWARM_COUNCIL_MAX_OUTPUT_TOKENS: value });
      expect(config.max_output_tokens).toBeNull();
      expect(config.output_budget_error).toBeString();
      expect(validateDiagnosticConfiguration(config)).toContain('output_budget');
      expect(diagnosticPreflight(config).REQUESTED_EFFECTIVE_MISMATCH_GATE).toBe('BLOCKED');
    }
  });

  test('requested/effective mismatch blocks before any transport request', async () => {
    let calls = 0;
    const transport = new MockTransport(() => { calls += 1; return { status: 200, headers: {}, body: '{}' }; });
    await expect(runDiagnosticWithTransport(transport, 'synthetic', 1600, 4096)).rejects.toThrow('REQUESTED_EFFECTIVE_OUTPUT_TOKEN_MISMATCH');
    expect(calls).toBe(0);
  });

  test('shared Council helper rejects invalid values rather than substituting 1600', () => {
    expect(councilMaxOutputTokens({ SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '1600' })).toBe(1600);
    expect(() => councilMaxOutputTokens({ SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '0' })).toThrow('INVALID_COUNCIL_OUTPUT_TOKEN_BUDGET');
    expect(() => councilMaxOutputTokens({ SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '-1' })).toThrow('INVALID_COUNCIL_OUTPUT_TOKEN_BUDGET');
    expect(() => councilMaxOutputTokens({ SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '8193' })).toThrow('INVALID_COUNCIL_OUTPUT_TOKEN_BUDGET');
  });

  test('malformed non-truncated output remains rejected under the strict parser', async () => {
    const runtime = runtimeFor(JSON.stringify({ choices: [{ message: { content: '{"ok":' }, finish_reason: 'stop' }] }));
    const response = await runtime.execute(request(DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS), { provider: LIVE_PROVIDER, model: LIVE_MODEL });
    expect(response.status).toBe('REJECTED');
    expect(response.error).toMatchObject({ code: 'RESPONSE_PARSE_ERROR', stage: 'RESPONSE_PARSE' });
    expect(response.execution.structured_validation_performed).toBe(false);
  });
});
