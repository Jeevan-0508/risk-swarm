import { describe, expect, test } from 'bun:test';
import { deterministicPackageHash } from '../src/swarm/evidence/package';
import { SEAT_ASSESSMENT_PROVIDER_SCHEMA } from '../src/swarm/seats/validation';
import { MockTransport } from '../src/swarm/models/transport';
import { PHASE4B_PROVIDER_SCHEMA_FINGERPRINT, RequestContractGuardTransport, BudgetedTransport, type WireContractExpectation } from './certify-swarm-live-council';
import { DIAGNOSTIC_EVIDENCE_FINGERPRINT, DIAGNOSTIC_MODEL, DIAGNOSTIC_PROMPT_FINGERPRINT, DIAGNOSTIC_PROMPT_VERSION, DIAGNOSTIC_REQUEST_BUDGET, DIAGNOSTIC_SEAT, DIAGNOSTIC_PROVIDER, formatDiagnosticReport, runOfflineDiagnosticFixtures, diagnosticConfigFromEnvironment, validateDiagnosticConfiguration } from './diagnose-xai-structured-output';

// Keep the diagnostic constants explicit at the test boundary; they are part of the third-run contract.
const EXPECTATION: WireContractExpectation = {
  provider: DIAGNOSTIC_PROVIDER,
  model: DIAGNOSTIC_MODEL,
  evidence_fingerprint: DIAGNOSTIC_EVIDENCE_FINGERPRINT,
  provider_schema: SEAT_ASSESSMENT_PROVIDER_SCHEMA,
  retry_disabled: true,
  fallback_disabled: true,
  max_output_tokens: 1600,
  expected_seat_id: DIAGNOSTIC_SEAT,
  expected_prompt_version: DIAGNOSTIC_PROMPT_VERSION,
  expected_prompt_fingerprint: DIAGNOSTIC_PROMPT_FINGERPRINT,
};

describe('Phase 4B.3 single-call xAI diagnostic preparation', () => {
  test('requires explicit confirmation and the existing credential without constructing a request', () => {
    expect(validateDiagnosticConfiguration(diagnosticConfigFromEnvironment({}))).toEqual(['credential', 'confirmation']);
    expect(validateDiagnosticConfiguration(diagnosticConfigFromEnvironment({ XAI_API_KEY: 'synthetic', SWARM_XAI_DIAGNOSTIC_CONFIRM: 'NO' }))).toEqual(['confirmation']);
    expect(diagnosticConfigFromEnvironment({ XAI_API_KEY: 'synthetic', SWARM_XAI_DIAGNOSTIC_CONFIRM: 'YES' })).toMatchObject({ provider: 'xai', model: 'grok-4.7', confirm: 'YES' });
  });

  test('offline fixtures cover all requested structural response classes without semantic leakage', async () => {
    const result = await runOfflineDiagnosticFixtures();
    expect(result.reports).toHaveLength(11);
    expect(result.secretLeakCheck).toBe('PASS');
    expect(result.reports[0]).toMatchObject({ HTTP_STATUS: 200, HTTP_BODY_IS_JSON: true, CHOICE_COUNT: 1, CONTENT_TYPE: 'string', JSON_PARSE_DIRECT: 'PASS', DTO_VALIDATION_ATTEMPTED: 'PASS', DTO_VALIDATION_RESULT: 'FAIL' });
    expect(result.reports[1]).toMatchObject({ CONTENT_TYPE: 'string', STARTS_WITH_CODE_FENCE: true, JSON_PARSE_DIRECT: 'FAIL', JSON_PARSE_FENCED: 'PASS' });
    expect(result.reports[2]).toMatchObject({ CONTENT_TYPE: 'string', JSON_PARSE_BOUNDED_OBJECT: 'PASS', JSON_CANDIDATE_COUNT: 1 });
    expect(result.reports[3]).toMatchObject({ FINISH_REASON: 'length', JSON_PARSE_DIRECT: 'FAIL', JSON_PARSE_BOUNDED_OBJECT: 'FAIL', JSON_PARSE_BOUNDED_OBJECT_REASON: 'UNTERMINATED_JSON' });
    expect(result.reports[4]).toMatchObject({ CONTENT_TYPE: 'string', JSON_PARSE_DIRECT_REASON: 'NO_JSON_CANDIDATE' });
    expect(result.reports[5]).toMatchObject({ CONTENT_TYPE: 'array', CONTENT_PRESENT: true, JSON_PARSE_DIRECT: 'NOT_RUN', DTO_VALIDATION_ATTEMPTED: 'NOT_RUN' });
    expect(result.reports[6]).toMatchObject({ CONTENT_TYPE: 'object', CONTENT_PRESENT: true, JSON_PARSE_DIRECT: 'NOT_RUN' });
    expect(result.reports[7]).toMatchObject({ CONTENT_TYPE: 'null', CONTENT_PRESENT: true, JSON_PARSE_DIRECT: 'NOT_RUN' });
    expect(result.reports[8]).toMatchObject({ TOOL_CALLS_PRESENT: true, TOOL_CALL_COUNT: 1, CONTENT_TYPE: 'null' });
    expect(result.reports[9]).toMatchObject({ REFUSAL_PRESENT: true, CONTENT_TYPE: 'null' });
    expect(result.reports[10]).toMatchObject({ JSON_PARSE_BOUNDED_OBJECT: 'FAIL', JSON_PARSE_BOUNDED_OBJECT_REASON: 'MULTIPLE_CANDIDATES', JSON_CANDIDATE_COUNT: 2 });
    for (const report of result.reports) expect(formatDiagnosticReport(report)).not.toMatch(/plain refusal prose|refused|tool-1|reasoning/);
  });

  test('preserves the exact third-run request contract and one-request budget', async () => {
    const result = await runOfflineDiagnosticFixtures();
    for (const report of result.reports) {
      expect(report).toMatchObject({ REQUEST_PRECHECK: 'PASS', PROVIDER: 'xai', MODEL: 'grok-4.7', SEAT: 'ATHENA', PROMPT_VERSION: 'ATHENA_PROMPT_V1', PROMPT_FINGERPRINT: DIAGNOSTIC_PROMPT_FINGERPRINT, PROVIDER_SCHEMA_FINGERPRINT: PHASE4B_PROVIDER_SCHEMA_FINGERPRINT, EVIDENCE_FINGERPRINT: DIAGNOSTIC_EVIDENCE_FINGERPRINT, STRICT_JSON_SCHEMA: 'PASS', REQUEST_BUDGET: DIAGNOSTIC_REQUEST_BUDGET, REQUEST_BUDGET_ENFORCED: 'PASS', RETRY_DISABLED: 'PASS', FALLBACK_DISABLED: 'PASS', HTTP_METHOD: 'POST', API_FAMILY: 'CHAT_COMPLETIONS', CONFIGURED_MAX_OUTPUT_TOKENS: 1600 });
      expect(report.PROVIDER_SCHEMA_PROJECTION).toMatchObject({ response_format_type: 'STRICT_JSON_SCHEMA', json_schema_present: true, json_schema_name: 'swarm_seat_assessment_v1', strict_value: true, provider_schema_fingerprint: PHASE4B_PROVIDER_SCHEMA_FINGERPRINT, peer_positions_present: false });
    }
  });

  test('blocks a second request before the delegate transport', async () => {
    let calls = 0;
    const delegate = new MockTransport(() => { calls += 1; return { status: 200, headers: {}, body: '{}' }; });
    const budget = new BudgetedTransport(delegate, 1);
    const guard = new RequestContractGuardTransport(budget, EXPECTATION);
    const body = JSON.stringify({ model: 'grok-4.7', messages: [{ role: 'system', content: 'contract' }, { role: 'user', content: 'task\n\nSEALED_SWARM_CONTEXT_JSON:\n{"seat_id":"ATHENA","prompt_version":"ATHENA_PROMPT_V1","prompt_fingerprint":"fnv1a-8c2a6636","evidence_package":{"package_hash":"fnv1a:cd48b0a4"}}' }], max_tokens: 1600, response_format: { type: 'json_schema', json_schema: { name: 'swarm_seat_assessment_v1', strict: true, schema: SEAT_ASSESSMENT_PROVIDER_SCHEMA } } });
    await guard.request({ method: 'POST', url: 'https://api.x.ai/v1/chat/completions', body });
    await expect(guard.request({ method: 'POST', url: 'https://api.x.ai/v1/chat/completions', body })).rejects.toThrow('LIVE_COUNCIL_REQUEST_BUDGET_EXCEEDED');
    expect(calls).toBe(1);
    expect(PHASE4B_PROVIDER_SCHEMA_FINGERPRINT).toBe(deterministicPackageHash(SEAT_ASSESSMENT_PROVIDER_SCHEMA));
  });

  test('manual entrypoint requires confirmation and does not route through dist', async () => {
    const source = await Bun.file(new URL('./diagnose-xai-structured-output.mjs', import.meta.url)).text();
    expect(source).toContain("SWARM_XAI_DIAGNOSTIC_CONFIRM");
    expect(source).toContain("./diagnose-xai-structured-output.ts");
    expect(source).not.toMatch(/dist[\\/]|Council|Zeus|ARES|HADES|APOLLO/);
  });
});
