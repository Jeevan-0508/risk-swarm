import { describe, expect, test } from 'bun:test';
import { MockTransport } from '../src/swarm/models/transport';
import { buildCertifiedPhase6Scenario } from '../src/swarm/evaluation/scenarios';
import { runOfflineAdversarialDeliberation } from '../src/swarm/engine/offline';
import { buildZeusInput, defaultZeusSynthesis, ZEUS_PROMPT_VERSION, validateZeusSynthesis, zeusSynthesisFingerprint } from '../src/swarm/governance/zeus';
import { ZEUS_CONTROL_EFFECTIVENESS_VALUES, ZeusSynthesisBodySchema, type ZeusSynthesisBody, type ZeusSynthesisBrief } from '../src/swarm/contracts';
import { replayZeusArtifact } from '../src/swarm/governance/zeus-artifact';
import { PHASE6B_EXPECTED_INPUT_FINGERPRINT, PHASE6B_MODEL, PHASE6B_PROVIDER, Phase6bRequestBudget } from './phase6b1-pretransport';
import { formatPhase6bReport, measurePhase6bContract, runPhase6bDryRun, runPhase6bHarness, ZEUS_SYNTHESIS_PROVIDER_SCHEMA, type Phase6bHarnessResult } from './phase6b-live-zeus';

const SECRET = 'phase6b-offline-secret-must-never-escape';
const CANONICAL_ENV = {
  SWARM_LIVE_ZEUS_SYNTHESIS_CONFIRM: 'YES',
  SWARM_COUNCIL_PROVIDER: PHASE6B_PROVIDER,
  SWARM_COUNCIL_MODEL: PHASE6B_MODEL,
  SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '1600',
  XAI_API_KEY: SECRET,
};

async function canonical(): Promise<Phase6bHarnessResult> {
  return runPhase6bDryRun(CANONICAL_ENV);
}

function jsonResponse(body: unknown) {
  return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

async function canonicalInput() {
  const phase5 = await runOfflineAdversarialDeliberation(buildCertifiedPhase6Scenario());
  return buildZeusInput(phase5.blackboard);
}

function providerBody(fixture: ZeusSynthesisBrief): ZeusSynthesisBody {
  const { synthesis_id: _synthesisId, case_id: _caseId, seat_id: _seatId, human_decision_required: _humanDecisionRequired, authority_statement: _authorityStatement, execution: _execution, synthesis_fingerprint: _fingerprint, human_decision_status: _humanDecisionStatus, ...body } = fixture;
  return body;
}

async function fakeSuccessfulZeusResponse() {
  const input = await canonicalInput();
  const body = providerBody(defaultZeusSynthesis(input));
  return jsonResponse({ choices: [{ message: { content: JSON.stringify(body) }, finish_reason: 'stop' }], usage: { prompt_tokens: 7000, completion_tokens: 2152, total_tokens: 9152 } });
}

type FixtureMutation = (fixture: ZeusSynthesisBody) => unknown;

async function fakeZeusResponse(mutate: FixtureMutation = (fixture) => fixture) {
  const input = await canonicalInput();
  const fixture = providerBody(defaultZeusSynthesis(input));
  const candidate = mutate(fixture);
  return jsonResponse({ choices: [{ message: { content: JSON.stringify(candidate) }, finish_reason: 'stop' }], usage: { prompt_tokens: 9267, completion_tokens: 1963, total_tokens: 11230 } });
}

async function runFixture(mutate: FixtureMutation) {
  const transport = new MockTransport(async () => fakeZeusResponse(mutate));
  return runPhase6bHarness({ env: { ...CANONICAL_ENV, SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096' }, dry_run: false, transport });
}

describe('canonical Phase 6B live Zeus harness, offline proof', () => {
  test('missing authorization blocks before request admission', async () => {
    const result = await runPhase6bDryRun({ ...CANONICAL_ENV, SWARM_LIVE_ZEUS_SYNTHESIS_CONFIRM: 'NO' });
    expect(result.status).toBe('BLOCKED');
    expect(result.preflight.blocking_gate).toBe('AUTHORIZATION_GATE');
    expect(result.request_ledger.admissible_requests).toBe(0);
  });

  test('missing credential blocks before request admission', async () => {
    const result = await runPhase6bDryRun({ ...CANONICAL_ENV, XAI_API_KEY: undefined });
    expect(result.status).toBe('BLOCKED');
    expect(result.preflight.blocking_gate).toBe('CREDENTIAL_PRESENCE');
    expect(result.preflight.credential_available).toBe('NO');
  });

  test('wrong provider blocks before request admission', async () => {
    const result = await runPhase6bDryRun({ ...CANONICAL_ENV, SWARM_COUNCIL_PROVIDER: 'other-provider' });
    expect(result.status).toBe('BLOCKED');
    expect(result.preflight.blocking_gate).toBe('PROVIDER_MODEL');
  });

  test('wrong model blocks before request admission', async () => {
    const result = await runPhase6bDryRun({ ...CANONICAL_ENV, SWARM_COUNCIL_MODEL: 'grok-wrong-model' });
    expect(result.status).toBe('BLOCKED');
    expect(result.preflight.blocking_gate).toBe('PROVIDER_MODEL');
  });

  test('canonical configuration reaches the WOULD_EXECUTE_ONE_ZEUS_REQUEST boundary', async () => {
    const result = await canonical();
    expect(result.status).toBe('WOULD_EXECUTE_ONE_ZEUS_REQUEST');
    expect(result.transport_boundary).toBe('NOT_CROSSED');
    expect(result.request_ledger.admissible_requests).toBe(1);
  });

  test('dry-run never crosses an injected transport', async () => {
    const transport = new MockTransport(() => { throw new Error('DRY_RUN_TRANSPORT_CROSSED'); });
    const result = await runPhase6bHarness({ env: CANONICAL_ENV, dry_run: true, transport });
    expect(result.transport_boundary).toBe('NOT_CROSSED');
    expect(transport.requests).toHaveLength(0);
  });

  test('exactly one request is admissible', async () => {
    const result = await canonical();
    expect(result.request_ledger.request_budget).toBe(1);
    expect(result.request_ledger.admissible_requests).toBe(1);
    expect(result.request_ledger.transport_requests).toBe(0);
  });

  test('the second request is blocked by the one-request budget', async () => {
    const budget = new Phase6bRequestBudget();
    expect(budget.reserve()).toBe(true);
    expect(budget.reserve()).toBe(false);
    expect(budget.stats()).toEqual({ maximum: 1, attempted: 1, blocked: 1 });
    expect((await canonical()).request_ledger.second_request_blocked).toBe('PASS');
  });

  test('retry and fallback cannot occur', async () => {
    const result = await canonical();
    expect(result.request_ledger.retry_requests).toBe(0);
    expect(result.request_ledger.fallback_requests).toBe(0);
    expect(formatPhase6bReport(result).join('\n')).toMatch(/RETRY_DISABLED=PASS/);
    expect(formatPhase6bReport(result).join('\n')).toMatch(/FALLBACK_DISABLED=PASS/);
  });

  test('dry-run emits the strict Zeus schema and canonical wire identity', async () => {
    const result = await canonical();
    expect(result.wire_request).toMatchObject({ method: 'POST', budget_category: 'ZEUS_SYNTHESIS', model: PHASE6B_MODEL, schema_name: 'zeus_synthesis_v2', strict_schema: true, prompt_version: ZEUS_PROMPT_VERSION, input_fingerprint: PHASE6B_EXPECTED_INPUT_FINGERPRINT });
  });

  test('secret does not appear in reports or durable result data', async () => {
    const result = await canonical();
    const report = formatPhase6bReport(result).join('\n');
    expect(report).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.secret_scan).toBe('PASS');
  });

  test('canonical input fingerprint remains fnv1a:b2b37683', async () => {
    expect((await canonical()).preflight.input_fingerprint).toBe(PHASE6B_EXPECTED_INPUT_FINGERPRINT);
  });

  test('offline 4096-token repair changes only the output ceiling and preserves the Zeus contract', async () => {
    const repaired = await runPhase6bDryRun({ ...CANONICAL_ENV, SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096' });
    expect(repaired.status).toBe('WOULD_EXECUTE_ONE_ZEUS_REQUEST');
    expect(repaired.wire_request).toMatchObject({ max_output_tokens: 4096, model: PHASE6B_MODEL, prompt_version: ZEUS_PROMPT_VERSION, input_fingerprint: PHASE6B_EXPECTED_INPUT_FINGERPRINT });
    expect(repaired.preflight.input_fingerprint).toBe((await canonical()).preflight.input_fingerprint);
    expect(repaired.request_ledger).toEqual({ request_budget: 1, admissible_requests: 1, transport_requests: 0, retry_requests: 0, fallback_requests: 0, second_request_blocked: 'PASS' });
    expect(repaired.secret_scan).toBe('PASS');
    expect(repaired.hidden_reasoning_scan).toBe('PASS');
    expect(repaired.human_decision).toBe('PENDING');
  });

  test('offline contract measurements separate input, prompt, schema, and fixture output budgets', async () => {
    const measurements = measurePhase6bContract(await canonicalInput());
    expect(measurements.zeus_schema_size_bytes).toBeLessThan(8000);
    expect(measurements.zeus_prompt_size_bytes).toBeLessThan(1200);
    expect(measurements.zeus_fixture_output_estimated_tokens).toBeLessThan(1600);
    expect(measurements.zeus_fixture_output_estimated_tokens).toBeLessThan(4096);
    expect(measurements.zeus_context_size_bytes).toBeGreaterThan(measurements.zeus_input_size_bytes);
  });

  test('fake xAI length response is classified before structured parsing and retains safe termination telemetry', async () => {
    const transport = new MockTransport(() => jsonResponse({ choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { prompt_tokens: 7000, completion_tokens: 4096, total_tokens: 11096 } }));
    const result = await runPhase6bHarness({ env: { ...CANONICAL_ENV, SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096' }, dry_run: false, transport });
    expect(result.status).toBe('FAILED');
    expect(result.failure_code).toBe('OUTPUT_TOKEN_LIMIT');
    expect(result.termination_telemetry).toMatchObject({ http_status: 200, provider_finish_reason: 'length', output_limit: 4096, output_usage_count: 4096, parser_stage: 'RESPONSE_TRUNCATED', request_id: 'phase6b-zeus-synthesis-1', provider: 'xai', model: 'grok-4.7' });
    expect(result.real_provider_calls).toBe(0);
    expect(result.artifact).toBeNull();
    expect(JSON.parse(transport.requests[0]!.body!).max_tokens).toBe(4096);
  });

  test('fake successful xAI structured response near the prior 2152-token fixture size parses and passes semantic validation', async () => {
    const transport = new MockTransport(async () => fakeSuccessfulZeusResponse());
    const result = await runPhase6bHarness({ env: { ...CANONICAL_ENV, SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096' }, dry_run: false, transport });
    expect(result.status).toBe('EXECUTED_ONE_ZEUS_REQUEST');
    expect(result.failure_code).toBeNull();
    expect(result.artifact).not.toBeNull();
    expect(result.artifact_only_replay).toBe('PASS');
    expect(result.termination_telemetry).toMatchObject({ provider_finish_reason: 'stop', output_limit: 4096, output_usage_count: 2152, parser_stage: 'RESPONSE_NORMALIZATION' });
    expect(result.real_provider_calls).toBe(0);
  });

  test('realistic provider body without synthesis_fingerprint receives a system-computed fingerprint', async () => {
    const result = await runFixture();
    const artifact = result.artifact!;
    expect(artifact.synthesis.synthesis_fingerprint).toBe(zeusSynthesisFingerprint(artifact.synthesis));
    expect(artifact.synthesis.execution.input_fingerprint).toBe(PHASE6B_EXPECTED_INPUT_FINGERPRINT);
    expect(artifact.synthesis.human_decision_required).toBe(true);
    expect(artifact.synthesis.human_decision_status).toBe('PENDING');
    expect(result.artifact_only_replay).toBe('PASS');
  });

  test('persisted canonical body tampering fails replay with the synthesis fingerprint code', async () => {
    const result = await runFixture();
    const artifact = result.artifact!;
    let thrown: unknown;
    try { replayZeusArtifact({ ...artifact, synthesis: { ...artifact.synthesis, executive_summary: 'tampered canonical body' } }); } catch (error) { thrown = error; }
    expect((thrown as { code?: string }).code).toBe('ZEUS_SYNTHESIS_FINGERPRINT_MISMATCH');
  });

  test('persisted fingerprint tampering fails replay with the synthesis fingerprint code', async () => {
    const result = await runFixture();
    const artifact = result.artifact!;
    let thrown: unknown;
    try { replayZeusArtifact({ ...artifact, synthesis_fingerprint: 'provider-controlled-fingerprint', synthesis: { ...artifact.synthesis, synthesis_fingerprint: 'provider-controlled-fingerprint' } }); } catch (error) { thrown = error; }
    expect((thrown as { code?: string }).code).toBe('ZEUS_SYNTHESIS_FINGERPRINT_MISMATCH');
  });

  test('provider fingerprint injection is rejected before canonical construction', async () => {
    const input = await canonicalInput();
    const body = providerBody(defaultZeusSynthesis(input));
    const transport = new MockTransport(async () => jsonResponse({ choices: [{ message: { content: JSON.stringify({ ...body, synthesis_fingerprint: 'provider-controlled-fingerprint' }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 9267, completion_tokens: 1963, total_tokens: 11230 } }));
    const result = await runPhase6bHarness({ env: { ...CANONICAL_ENV, SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096' }, dry_run: false, transport });
    expect(result.status).toBe('FAILED');
    expect(result.failure_code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(result.validation_failure_path).toBe('$.synthesis_fingerprint');
    expect(result.artifact).toBeNull();
    expect(result.real_provider_calls).toBe(0);
  });

  test('fake malformed xAI structured response is rejected and cannot become a successful synthesis', async () => {
    const transport = new MockTransport(() => jsonResponse({ choices: [{ message: { content: '{"synthesis_id":' }, finish_reason: 'stop' }] }));
    const result = await runPhase6bHarness({ env: { ...CANONICAL_ENV, SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096' }, dry_run: false, transport });
    expect(result.status).toBe('FAILED');
    expect(result.failure_code).toBe('RESPONSE_PARSE_ERROR');
    expect(result.artifact).toBeNull();
    expect(result.termination_telemetry).toMatchObject({ http_status: 200, provider_finish_reason: 'stop', parser_stage: 'RESPONSE_PARSE' });
    expect(result.real_provider_calls).toBe(0);
  });

  test('verbose seat positions cannot expand the bounded synthesis without bound', async () => {
    const input = await canonicalInput();
    const riskSeed = input.final_positions.flatMap((position) => position.risk_findings)[0];
    const controlSeed = input.final_positions.flatMap((position) => position.control_gaps)[0];
    const verboseInput = {
      ...input,
      final_positions: input.final_positions.map((position) => ({
        ...position,
        conclusion: 'seat-report '.repeat(500),
        assumptions: Array.from({ length: 64 }, (_, index) => `assumption-${index}-` + 'x'.repeat(480)),
        uncertainties: Array.from({ length: 64 }, (_, index) => `uncertainty-${index}-` + 'x'.repeat(980)),
        risk_findings: riskSeed ? Array.from({ length: 64 }, (_, index) => ({ ...riskSeed, position_id: position.position_id, finding_id: `${riskSeed.finding_id}-${index}`, statement: 'risk '.repeat(400), uncertainty: 'uncertainty '.repeat(240) })) : [],
        control_gaps: controlSeed ? Array.from({ length: 64 }, (_, index) => ({ ...controlSeed, position_id: position.position_id, gap_id: `${controlSeed.gap_id}-${index}`, statement: 'control '.repeat(400), uncertainty: 'uncertainty '.repeat(240) })) : [],
      })),
    };
    const bounded = defaultZeusSynthesis(verboseInput);
    const bytes = Buffer.byteLength(JSON.stringify(bounded), 'utf8');
    expect(bytes).toBeLessThan(16384);
    expect(Math.ceil(bytes / 4)).toBeLessThan(4096);
    expect(() => validateZeusSynthesis(bounded, verboseInput)).not.toThrow();
  });

  test('compact references preserve every material disagreement, minority, Apollo finding, and valid source ID', async () => {
    const input = await canonicalInput();
    const synthesis = defaultZeusSynthesis(input);
    const expectedDisagreements = input.post_challenge_disagreements
      .filter((item) => (item.status === 'OPEN' || item.status === 'NARROWED') && item.materiality !== 'MINOR')
      .map((item) => item.disagreement_id);
    expect(synthesis.material_disagreements.map((item) => item.disagreement_id)).toEqual(expectedDisagreements);
    expect(synthesis.minority_positions).toHaveLength(input.minority_positions.length);
    expect(synthesis.audit_summary.finding_ids).toEqual(input.audit_findings.map((finding) => finding.finding_id));
    expect(synthesis.source_position_ids.every((id) => input.final_positions.some((position) => position.position_id === id))).toBe(true);
    expect(synthesis.source_disagreement_ids.every((id) => input.post_challenge_disagreements.some((item) => item.disagreement_id === id))).toBe(true);
    expect(synthesis.source_evidence_ids.every((id) => input.evidence_metadata.some((item) => item.evidence_id === id))).toBe(true);
    expect(() => validateZeusSynthesis(synthesis, input)).not.toThrow();
    expect(synthesis.human_decision_required).toBe(true);
    expect(synthesis.human_decision_status).toBe('PENDING');
  });

  test('malformed and over-limit synthesis fails closed before protocol admission', async () => {
    const input = await canonicalInput();
    const synthesis = defaultZeusSynthesis(input);
    expect(() => validateZeusSynthesis({ ...synthesis, executive_summary: 'x'.repeat(641) }, input)).toThrow();
    expect(() => validateZeusSynthesis({ ...synthesis, material_risks: Array.from({ length: 9 }, () => synthesis.material_risks[0]!) }, input)).toThrow();
    expect(() => validateZeusSynthesis({ ...synthesis, human_decision_required: false }, input)).toThrow();
    expect(() => validateZeusSynthesis({ ...synthesis, executive_summary: 'The deployment is compliant.' }, input)).toThrow();
  });

  test('provider schema and Zeus DTO use the same closed enums and execution constants', () => {
    const schema = ZEUS_SYNTHESIS_PROVIDER_SCHEMA as { readonly properties: Record<string, any> };
    const control = schema.properties.control_assessment.items.properties;
    const evidence = schema.properties.evidence_assessment.properties;
    expect(control.effectiveness.enum).toEqual([...ZEUS_CONTROL_EFFECTIVENESS_VALUES]);
    expect(control.effectiveness.enum).not.toContain('NOT_ASSESSED');
    expect(evidence.quality.enum).toEqual(['STRONG', 'MIXED', 'WEAK', 'INSUFFICIENT']);
    expect(schema.properties).not.toHaveProperty('synthesis_fingerprint');
    expect(schema.properties).not.toHaveProperty('execution');
    expect(schema.properties).not.toHaveProperty('input_fingerprint');
    expect(schema.properties).not.toHaveProperty('synthesis_id');
    expect(schema.properties).not.toHaveProperty('case_id');
    expect(schema.properties).not.toHaveProperty('authority_statement');
  });

  test('SYSTEM_OWNED_FIELDS audit leaves no deterministic metadata in the provider body contract', () => {
    const schema = ZEUS_SYNTHESIS_PROVIDER_SCHEMA as { readonly properties: Record<string, unknown> };
    const systemOwnedTopLevel = ['synthesis_id', 'case_id', 'seat_id', 'execution', 'synthesis_fingerprint', 'human_decision_required', 'human_decision_status', 'authority_statement'];
    for (const field of systemOwnedTopLevel) expect(schema.properties).not.toHaveProperty(field);
  });

  test('the schema-permitted DTO-invalid regression fixture fails before semantic conversion with safe diagnostics', async () => {
    const input = await canonicalInput();
    const baseline = defaultZeusSynthesis(input);
    const invalid = { ...baseline, control_assessment: baseline.control_assessment.map((item, index) => index === 0 ? { ...item, effectiveness: 'NOT_ASSESSED' } : item) };
    expect((ZEUS_SYNTHESIS_PROVIDER_SCHEMA as any).properties.control_assessment.items.properties.effectiveness.enum).not.toContain('NOT_ASSESSED');
    expect(ZeusSynthesisBodySchema.safeParse({ ...providerBody(baseline), control_assessment: invalid.control_assessment }).success).toBe(false);
    const result = await runFixture((fixture) => ({ ...fixture, control_assessment: (fixture.control_assessment as any[]).map((item, index) => index === 0 ? { ...item, effectiveness: 'NOT_ASSESSED' } : item) }));
    expect(result.status).toBe('FAILED');
    expect(result.failure_code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(result.validation_failure_path).toBe('$.control_assessment[0].effectiveness');
    expect(result.validation_failure_code).toBe('ENUM');
    expect(result.validation_expected).toBe('EFFECTIVE|PARTIAL|UNVERIFIED|INEFFECTIVE|NOT_APPLICABLE');
    expect(result.validation_actual_type).toBe('string');
    expect(formatPhase6bReport(result)).toEqual(expect.arrayContaining([
      'VALIDATION_FAILURE_PATH=$.control_assessment[0].effectiveness',
      'VALIDATION_FAILURE_CODE=ENUM',
      'VALIDATION_EXPECTED=EFFECTIVE|PARTIAL|UNVERIFIED|INEFFECTIVE|NOT_APPLICABLE',
      'VALIDATION_ACTUAL_TYPE=string',
    ]));
    expect(result.real_provider_calls).toBe(0);
  });

  test('valid bounded Zeus response passes the aligned provider, DTO, semantic, and protocol contracts', async () => {
    const result = await runFixture();
    expect(result.status).toBe('EXECUTED_ONE_ZEUS_REQUEST');
    expect(result.artifact).not.toBeNull();
    expect(result.artifact_only_replay).toBe('PASS');
    expect(result.validation_failure_path).toBeNull();
    expect(result.real_provider_calls).toBe(0);
  });

  test('missing required field is rejected with a required-field diagnostic', async () => {
    const result = await runFixture((fixture) => { const copy = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>; delete copy.audit_summary; return copy; });
    expect(result.failure_code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(result.validation_failure_path).toBe('$.audit_summary');
    expect(result.validation_failure_code).toBe('REQUIRED');
    expect(result.validation_actual_type).toBe('missing');
  });

  test('wrong enum is rejected before semantic validation', async () => {
    const result = await runFixture((fixture) => ({ ...fixture, evidence_assessment: { ...fixture.evidence_assessment, quality: 'MODERATE' } }));
    expect(result.failure_code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(result.validation_failure_path).toBe('$.evidence_assessment.quality');
    expect(result.validation_failure_code).toBe('ENUM');
  });

  test('wrong type is rejected before semantic validation', async () => {
    const result = await runFixture((fixture) => ({ ...fixture, confidence: '0.65' }));
    expect(result.failure_code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(result.validation_failure_path).toBe('$.confidence');
    expect(result.validation_failure_code).toBe('TYPE');
    expect(result.validation_expected).toBe('number');
    expect(result.validation_actual_type).toBe('string');
  });

  test('invalid source IDs fail semantic source-reference validation', async () => {
    const result = await runFixture((fixture) => ({ ...fixture, source_evidence_ids: ['EV-UNKNOWN'] }));
    expect(result.status).toBe('FAILED');
    expect(result.failure_code).toBe('UNKNOWN_EVIDENCE');
    expect(result.unknown_reference_path).toBe('$.source_evidence_ids[0]');
    expect(result.unknown_reference_value).toBe('EV-UNKNOWN');
    expect(result.reference_class).toBe('EVIDENCE');
    expect(result.allowed_reference_count).toBe(2);
    expect(result.artifact).toBeNull();
  });

  test('missing material disagreement and missing minority fail preservation checks', async () => {
    const input = await canonicalInput();
    const baseline = defaultZeusSynthesis(input);
    expect(baseline.material_disagreements.length).toBeGreaterThan(0);
    expect(baseline.minority_positions.length).toBeGreaterThan(0);
    const disagreementResult = await runFixture((fixture) => ({ ...fixture, material_disagreements: (fixture.material_disagreements as unknown[]).slice(1) }));
    const minorityResult = await runFixture((fixture) => ({ ...fixture, minority_positions: (fixture.minority_positions as unknown[]).slice(1) }));
    expect(disagreementResult.failure_code).toBe('AUTHORITY_VIOLATION');
    expect(minorityResult.failure_code).toBe('AUTHORITY_VIOLATION');
  });

  test('human decision false and forbidden authority fail closed', async () => {
    const humanResult = await runFixture((fixture) => ({ ...fixture, human_decision_required: false }));
    const authorityResult = await runFixture((fixture) => ({ ...fixture, executive_summary: 'The deployment is compliant.' }));
    expect(humanResult.failure_code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(humanResult.validation_failure_path).toBe('$.human_decision_required');
    expect(authorityResult.failure_code).toBe('AUTHORITY_VIOLATION');
  });

  test('additional properties and over-limit fields fail the strict provider contract', async () => {
    const extraResult = await runFixture((fixture) => ({ ...fixture, unexpected: true }));
    const overLimitResult = await runFixture((fixture) => ({ ...fixture, executive_summary: 'x'.repeat(641) }));
    expect(extraResult.failure_code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(extraResult.validation_failure_code).toBe('ADDITIONAL_PROPERTY');
    expect(overLimitResult.failure_code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(overLimitResult.validation_failure_code).toBe('MAX_LENGTH');
  });

  test('prompt requires bounded synthesis and forbids report reproduction, duplication, and hidden reasoning', async () => {
    const { zeusPrompt } = await import('../src/swarm/governance/zeus');
    const prompt = zeusPrompt();
    expect(prompt).toContain('Synthesize; do not restate agent reports');
    expect(prompt).toContain('canonical source IDs');
    expect(prompt).toContain('Preserve every material unresolved disagreement and minority position');
    expect(prompt).toContain('no chain-of-thought');
    expect(prompt).toContain('do not duplicate rationale');
    expect(prompt).toContain('strict schema limits');
  });

  test('human decision remains PENDING and the harness does not close the case', async () => {
    const result = await canonical();
    expect(result.human_decision).toBe('PENDING');
    expect(result.artifact).toBeNull();
    expect(result.hidden_reasoning_scan).toBe('PASS');
  });
});
