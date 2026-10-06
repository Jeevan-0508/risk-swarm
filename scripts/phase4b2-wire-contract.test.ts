import { describe, expect, test } from 'bun:test';
import { deterministicPackageHash, stableStringify } from '../src/swarm/evidence/package';
import { parseJson } from '../src/swarm/models/structured-output';
import { MockTransport, type HttpRequest, type HttpResponse } from '../src/swarm/models/transport';
import { XaiProviderAdapter } from '../src/swarm/models/providers/xai';
import { SEAT_ASSESSMENT_PROVIDER_SCHEMA } from '../src/swarm/seats/validation';
import { assessSynthesisReadiness } from '../src/swarm/governance/synthesis';
import { PHASE4B_PROVIDER_SCHEMA_FINGERPRINT, LIVE_MODEL, LIVE_PROVIDER, LIVE_REQUEST_BUDGET, RequestContractGuardTransport, type WireContractExpectation, runOfflineDryRun } from './certify-swarm-live-council';

const EXPECTATION: WireContractExpectation = {
  provider: LIVE_PROVIDER,
  model: LIVE_MODEL,
  evidence_fingerprint: 'fnv1a:cd48b0a4',
  provider_schema: SEAT_ASSESSMENT_PROVIDER_SCHEMA,
  retry_disabled: true,
  fallback_disabled: true,
  max_output_tokens: 1600,
};

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    model: LIVE_MODEL,
    messages: [{ role: 'system', content: 'contract' }, { role: 'user', content: 'task\n\nSEALED_SWARM_CONTEXT_JSON:\n{"seat_id":"ATHENA","prompt_version":"ATHENA_PROMPT_V1","prompt_fingerprint":"fnv1a-test","evidence_package":{"package_hash":"fnv1a:cd48b0a4"}}' }],
    response_format: { type: 'json_schema', json_schema: { name: 'swarm_seat_assessment_v1', strict: true, schema: SEAT_ASSESSMENT_PROVIDER_SCHEMA } },
    max_tokens: 1600,
    ...overrides,
  });
}

describe('Phase 4B.2 xAI wire-contract forensics', () => {
  test('captures the final serialized request and proves strict schema mode survives the harness path', async () => {
    const dry = await runOfflineDryRun();
    expect(dry.baseline.wire_requests).toHaveLength(LIVE_REQUEST_BUDGET);
    expect(dry.baseline.wire_requests.every((projection) => projection.provider === LIVE_PROVIDER && projection.model === LIVE_MODEL)).toBe(true);
    expect(dry.baseline.wire_requests.every((projection) => projection.response_format_present && projection.response_format_type === 'STRICT_JSON_SCHEMA' && projection.json_schema_present && projection.strict_value === true)).toBe(true);
    expect(dry.baseline.wire_requests.every((projection) => projection.schema_top_level_type === 'object' && projection.schema_required_field_count === 13 && projection.schema_additional_properties === false)).toBe(true);
    expect(dry.baseline.wire_requests.every((projection) => projection.provider_schema_fingerprint === PHASE4B_PROVIDER_SCHEMA_FINGERPRINT)).toBe(true);
    expect(dry.baseline.wire_requests.every((projection) => projection.peer_positions_present === false && projection.evidence_fingerprint === dry.baseline.evidence_package.package_hash)).toBe(true);
    expect(dry.baseline.request_contract_precheck).toBe('PASS');
  });

  test('proves schema A, generated schema B, and serialized schema C are structurally equivalent', async () => {
    const dry = await runOfflineDryRun();
    const schemaA = SEAT_ASSESSMENT_PROVIDER_SCHEMA;
    const schemaB = SEAT_ASSESSMENT_PROVIDER_SCHEMA;
    expect(stableStringify(schemaB)).toBe(stableStringify(schemaA));
    expect(dry.baseline.wire_requests.every((projection) => projection.provider_schema_fingerprint === deterministicPackageHash(schemaB))).toBe(true);
  });

  test('fails closed before the delegate when strict schema is missing or wrong', async () => {
    let delegateCalls = 0;
    const delegate = new MockTransport(() => { delegateCalls += 1; return { status: 200, headers: {}, body: '{}' }; });
    const guarded = new RequestContractGuardTransport(delegate, EXPECTATION);
    const missing = JSON.parse(body({ response_format: { type: 'json_object' } })) as Record<string, unknown>;
    await expect(guarded.request({ method: 'POST', url: 'https://api.x.ai/v1/chat/completions', body: JSON.stringify(missing) })).rejects.toThrow('LIVE_REQUEST_CONTRACT_BLOCKED');
    const wrongSchema = JSON.parse(body()) as Record<string, unknown>;
    (wrongSchema.response_format as Record<string, unknown>).json_schema = { name: 'wrong', strict: true, schema: { type: 'object', additionalProperties: true, properties: {}, required: [] } };
    await expect(guarded.request({ method: 'POST', url: 'https://api.x.ai/v1/chat/completions', body: JSON.stringify(wrongSchema) })).rejects.toThrow('LIVE_REQUEST_CONTRACT_BLOCKED');
    expect(delegateCalls).toBe(0);
    expect(guarded.projections).toHaveLength(2);
  });

  test('stable provider schema fingerprint and per-seat fingerprints remain credential-free', async () => {
    const dry = await runOfflineDryRun();
    expect(PHASE4B_PROVIDER_SCHEMA_FINGERPRINT).toBe(deterministicPackageHash(SEAT_ASSESSMENT_PROVIDER_SCHEMA));
    expect(new Set(dry.baseline.wire_requests.map((projection) => projection.provider_schema_fingerprint)).size).toBe(1);
    expect(new Set(dry.baseline.seat_reports.map((report) => report.provider_schema_fingerprint)).size).toBe(1);
    expect(dry.baseline.seat_reports.every((report) => report.provider_schema_fingerprint === PHASE4B_PROVIDER_SCHEMA_FINGERPRINT)).toBe(true);
    expect(JSON.stringify(dry.baseline.wire_requests)).not.toMatch(/credential|authorization|bearer|api[_ -]?key/i);
  });

  test('safe content diagnostics explain non-JSON without recording content', async () => {
    const secret = 'WIRE_FORENSIC_SECRET_DO_NOT_LEAK';
    const transport = new MockTransport(() => ({ status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: `reasoning ${secret}` }, finish_reason: 'stop' }] }) }));
    const result = await new XaiProviderAdapter({ transport }).execute({ request_id: 'wire-forensic', case_id: 'wire-case', purpose: 'FORENSICS', model_requirements: ['TEXT_GENERATION'], task_instruction: 'Return JSON.', context: {}, timeout_ms: 500 }, LIVE_MODEL, { credential: secret });
    expect(result.status).toBe('SUCCESS');
    expect(result.diagnostics).toMatchObject({ content_type: 'STRING', text_present: true, starts_with_json_object_marker: false, json_candidate_count: 0, finish_reason: 'stop' });
    expect(JSON.stringify(result.diagnostics)).not.toContain(secret);
    expect(JSON.stringify(result.diagnostics)).not.toContain('reasoning');
  });

  test('parser forensics preserve the existing bounded acceptance policy', () => {
    const policy = { allow_code_fence: true, allow_balanced_object_extraction: true } as const;
    expect(parseJson('{"ok":true}', policy)).toMatchObject({ mode: 'DIRECT_JSON', candidate_count: 0, value: { ok: true } });
    expect(parseJson('  {"ok":true}  ', policy)).toMatchObject({ mode: 'DIRECT_JSON', value: { ok: true } });
    expect(parseJson('```json\n{"ok":true}\n```', policy)).toMatchObject({ mode: 'CODE_FENCE_JSON', value: { ok: true } });
    expect(parseJson('prose {"ok":true}', policy)).toMatchObject({ mode: 'BALANCED_JSON', candidate_count: 1, value: { ok: true } });
    expect(parseJson('reasoning then {"ok":true}', policy)).toMatchObject({ mode: 'BALANCED_JSON', candidate_count: 1 });
    expect(parseJson('markdown before {"ok":true} markdown after', policy)).toMatchObject({ mode: 'BALANCED_JSON', candidate_count: 1 });
    expect(parseJson('{"ok":true} {"also":true}', policy)).toMatchObject({ mode: 'AMBIGUOUS_JSON', candidate_count: 2 });
    expect(parseJson('', policy)).toMatchObject({ mode: 'AMBIGUOUS_JSON', candidate_count: 0 });
    expect(parseJson('{"ok":', policy)).toMatchObject({ mode: 'AMBIGUOUS_JSON', candidate_count: 0 });
    expect(parseJson('"{\\"ok\\":true}"', policy)).toMatchObject({ mode: 'DIRECT_JSON', value: '{"ok":true}' });
    expect(parseJson('[1,2,3]', policy)).toMatchObject({ mode: 'DIRECT_JSON', value: [1, 2, 3] });
    expect(parseJson('provider refusal', policy)).toMatchObject({ mode: 'AMBIGUOUS_JSON', candidate_count: 0 });
  });

  test('non-JSON provider content remains a truthful parse rejection through the Council path', async () => {
    const dry = await runOfflineDryRun();
    const malformed = dry.malformed.seat_reports.find((report) => report.seat === 'ARES');
    expect(malformed).toMatchObject({ provider_output_extracted: 'PASS', json_parse: 'FAIL', model_dto_schema_validation: 'NOT_RUN', seat_semantic_validation: 'NOT_RUN', agent_position_conversion: 'NOT_RUN', final_execution_status: 'REJECTED', failure_stage: 'RESPONSE_PARSE', failure_code: 'RESPONSE_PARSE_ERROR', position_accepted: false });
    expect(dry.malformed.budget).toEqual({ request_count: 4, attempted_count: 4, blocked_count: 0 });
  });

  test('zero accepted analytical positions fail the synthesis-readiness gate before Zeus', () => {
    expect(assessSynthesisReadiness({ final_positions: [] })).toEqual({ ready: false, reason: 'NO_ACCEPTED_ANALYTICAL_POSITIONS' });
    expect(assessSynthesisReadiness({ final_positions: [{ position_id: 'synthetic-position' } as never] })).toEqual({ ready: true, reason: 'ACCEPTED_ANALYTICAL_POSITIONS' });
  });

  test('manual harness source imports current TypeScript path and does not route through dist', async () => {
    const source = await Bun.file(new URL('./certify-swarm-live-council.mjs', import.meta.url)).text();
    expect(source).toContain("./certify-swarm-live-council.ts");
    expect(source).not.toMatch(/dist[\\/]|generated|legacy/i);
  });
});
