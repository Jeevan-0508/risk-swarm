import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPhase5GoldenScenario } from '../src/swarm/evaluation/scenarios';
import { runOfflineAdversarialDeliberation } from '../src/swarm/engine/offline';
import { sealEvidence } from '../src/swarm/evidence/package';
import { ModelRouter } from '../src/swarm/models/router';
import { ModelRuntime } from '../src/swarm/models/runtime';
import { MockTransport } from '../src/swarm/models/transport';
import { XaiProviderAdapter } from '../src/swarm/models/providers/xai';
import { ModelBackedSeatExecutor } from '../src/swarm/seats/executor';
import { SEAT_ASSESSMENT_PROVIDER_SCHEMA, SEAT_ASSESSMENT_SCHEMA, validateSeatAssessmentSemantics, validateSeatAssessmentShape } from '../src/swarm/seats/validation';
import { evaluateRound1Blindness } from './phase5h1-blindness-forensics';
import { Phase5gArtifactSession, loadPhase5gArtifact } from './phase5g-durable-artifact';
import { certifyPhase5hArtifactOnly } from './phase5h-artifact-certification';

const SECRET = 'phase5h2-offline-secret-must-not-leak';

function assessment(evidence_id = 'ev-a') {
  return {
    conclusion: 'The supplied evidence supports a bounded governance risk with disclosed uncertainty.',
    risk_level: 'HIGH',
    confidence: 0.72,
    claims: [{ statement: 'The supplied evidence records an observable control signal.', type: 'OBSERVATION', evidence_ids: [evidence_id], assumptions: [], uncertainty: 'The downstream effect is not fully observed.', status: 'SUPPORTED' }],
    assumptions: [],
    uncertainties: ['The sealed package does not establish downstream harm.'],
    risk_findings: [{ statement: 'The control may not reliably produce an auditable record.', evidence_ids: [evidence_id], assumptions: [], uncertainty: 'The alternative explanation remains unresolved.', risk_level: 'HIGH' }],
    control_gaps: [{ statement: 'Bounded control-effectiveness evidence is incomplete.', evidence_ids: [evidence_id], assumptions: [], uncertainty: 'The package does not distinguish bypass from logging omission.', priority: 'HIGH' }],
    counterarguments: ['A logging defect may explain the observed gap.'],
    evidence_requests: [],
    recommendation: 'Preserve human review and obtain bounded control-effectiveness evidence.',
    abstained: false,
    abstention_reason: null,
  };
}

function recordedXaiBody(value: unknown): string {
  return JSON.stringify({ id: 'phase5h2-recorded', choices: [{ message: { content: JSON.stringify(value) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 } });
}

function fixtureSession(directory: string) {
  const scenario = buildPhase5GoldenScenario();
  const packageValue = sealEvidence(scenario.case, scenario.evidence, { package_id: scenario.package_id, sealed_at: scenario.sealed_at });
  const session = new Phase5gArtifactSession({
    provider: 'mock',
    model: 'phase5h2-offline-recorded',
    case_value: scenario.case as unknown as Record<string, unknown>,
    evidence_package: packageValue as unknown as Record<string, unknown>,
    global_budget: 11,
    max_output_tokens: 4096,
  }, { directory, now: () => '2026-01-01T00:00:00.000Z', run_id: 'phase5h2-offline-certification-candidate' });
  return { scenario, session };
}

describe('Phase 5H.2 Apollo structured-output hardening', () => {
  test('A canonical Apollo DTO passes the domain and strict provider contract', () => {
    const value = assessment();
    expect(validateSeatAssessmentShape(value).success).toBe(true);
    expect(SEAT_ASSESSMENT_SCHEMA.validate(value).success).toBe(true);
    const providerSchema = SEAT_ASSESSMENT_PROVIDER_SCHEMA as { readonly additionalProperties: boolean; readonly required: readonly string[]; readonly properties: Record<string, unknown> };
    expect(providerSchema.additionalProperties).toBe(false);
    expect(providerSchema.required).toHaveLength(13);
    expect(Object.keys(providerSchema.properties)).toEqual(expect.arrayContaining(providerSchema.required));
  });

  test('B historical field-level failure is not reconstructed when the artifact retained no model object or issue path', () => {
    const sanitizedHistoricalMetadata = { json_parse: 'PASS', dto_schema_validation: 'FAIL', model_output_present: true, output_accepted: false };
    expect(sanitizedHistoricalMetadata).not.toHaveProperty('validation_path');
    expect('validation_path' in sanitizedHistoricalMetadata).toBe(false);
  });

  test('C through H invalid Apollo outputs fail closed without rewriting', () => {
    const cases = [
      { ...assessment(), conclusion: undefined },
      { ...assessment(), risk_level: 'SEVERE' },
      { ...assessment(), confidence: 1.1 },
      { ...assessment(), risk_findings: [{ ...assessment().risk_findings[0], evidence_ids: [3] }] },
      { ...assessment(), forbidden_field: 'must reject' },
    ];
    for (const value of cases) expect(validateSeatAssessmentShape(value).success).toBe(false);
    expect(validateSeatAssessmentShape({ ...assessment(), reasoning_content: 'hidden' }).success).toBe(false);
  });

  test('unknown evidence is rejected at semantic validation and no position is fabricated', () => {
    const scenario = buildPhase5GoldenScenario();
    const packageValue = sealEvidence(scenario.case, scenario.evidence, { sealed_at: scenario.sealed_at });
    const shape = validateSeatAssessmentShape(assessment('ev-unknown'));
    expect(shape.success).toBe(true);
    if (shape.success) expect(validateSeatAssessmentSemantics(shape.value, packageValue).success).toBe(false);
  });

  test('recorded xAI provider shape survives extraction, parse, DTO, semantic validation, conversion, and protocol checks', async () => {
    const transport = new MockTransport(() => ({ status: 200, headers: { 'content-type': 'application/json' }, body: recordedXaiBody(assessment()) }));
    const adapter = new XaiProviderAdapter({ transport });
    const runtime = new ModelRuntime({ providers: new Map([['xai', adapter]]), credentials: { resolve: () => ({ configured: true, value: SECRET }) } });
    const router = new ModelRouter(runtime);
    const executor = new ModelBackedSeatExecutor(router, { primary: { provider: 'xai', model: 'grok-4.7' }, required_capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'], fallback_enabled: false, retry: { max_attempts: 1, retryable_reasons: [] } }, 'APOLLO', { max_output_tokens: 4096 });
    const scenario = buildPhase5GoldenScenario();
    const packageValue = sealEvidence(scenario.case, scenario.evidence, { sealed_at: scenario.sealed_at });
    const input = {
      seat_id: 'APOLLO' as const,
      case: { case_id: scenario.case.case_id, protocol_version: scenario.case.protocol_version, question: scenario.case.question, scope: scenario.case.scope, policy: scenario.case.policy },
      evidence_package: packageValue,
      execution_context: { invocation: 1, phase: 'ROUND_1' as const },
    };
    const result = await executor.execute(input);
    expect(result.status).toBe('SUCCESS');
    expect(result.position?.seat_id).toBe('APOLLO');
    expect(result.position?.round).toBe(1);
    expect(result.execution.diagnostics.output_accepted).toBe(true);
    expect(result.execution.diagnostics.provider_output_extracted).toBe(true);
    expect(result.execution.diagnostics.json_parse).toBe('PASS');
    expect(result.execution.diagnostics.dto_schema_validation).toBe('PASS');
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.body).not.toContain(SECRET);
  });

  test('validation diagnostics expose only a sanitized failure reason for future forensic capture', async () => {
    const transport = new MockTransport(() => ({ status: 200, headers: { 'content-type': 'application/json' }, body: recordedXaiBody({ ...assessment(), reasoning_content: 'hidden' }) }));
    const adapter = new XaiProviderAdapter({ transport });
    const runtime = new ModelRuntime({ providers: new Map([['xai', adapter]]), credentials: { resolve: () => ({ configured: true, value: SECRET }) } });
    const result = await runtime.execute({ request_id: 'phase5h2-invalid', case_id: 'case-phase5h2', seat_id: 'APOLLO', purpose: 'SWARM_APOLLO_ROUND1_ASSESSMENT', model_requirements: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'], task_instruction: 'Return the strict Apollo contract.', context: {}, output_schema: SEAT_ASSESSMENT_SCHEMA, max_output_tokens: 4096, timeout_ms: 500 }, { provider: 'xai', model: 'grok-4.7' });
    expect(result.status).toBe('REJECTED');
    expect(result.error?.code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(result.diagnostics.validation_reason).toContain('unknown field');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain('hidden');
  });

  test('J valid Apollo with zero peer context passes position and blindness independently', () => {
    const attestation = { seat_id: 'APOLLO', round: 1 as const, peer_position_count: 0, peer_position_ids: [], peer_context_present: false, peer_reasoning_present: false, evidence_fingerprint: 'fnv1a:evidence', request_context_fingerprint: 'fnv1a:context', seat_contract_version: 'APOLLO_PROMPT_V1' };
    expect(validateSeatAssessmentShape(assessment()).success).toBe(true);
    expect(evaluateRound1Blindness(attestation, 'fnv1a:evidence')).toBe('PASS');
  });

  test('K valid Apollo with peer position context evaluates position separately but fails blindness', () => {
    const attestation = { seat_id: 'APOLLO', round: 1 as const, peer_position_count: 1, peer_position_ids: ['position-athena-1'], peer_context_present: true, peer_reasoning_present: false, evidence_fingerprint: 'fnv1a:evidence', request_context_fingerprint: 'fnv1a:context', seat_contract_version: 'APOLLO_PROMPT_V1' };
    expect(validateSeatAssessmentShape(assessment()).success).toBe(true);
    expect(evaluateRound1Blindness(attestation, 'fnv1a:evidence')).toBe('FAIL');
  });

  test('four-seat offline Round 1 records four valid positions and four pre-transport attestations', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-phase5h2-round1-'));
    try {
      const { scenario, session } = fixtureSession(directory);
      const result = await runOfflineAdversarialDeliberation({ ...scenario, request_observer: session, event_observer: (event) => session.observeEvent(event), challenge_generator: { generate: async () => [] } });
      const artifact = session.finalize(result);
      const round1 = artifact.request_ledger.filter((entry) => entry.operation === 'ROUND1_ANALYSIS');
      expect(round1).toHaveLength(4);
      expect(artifact.round1.seats).toHaveLength(4);
      expect(artifact.round1.seats.map((seat) => seat.seat_id)).toEqual(['ATHENA', 'ARES', 'HADES', 'APOLLO']);
      expect(round1.every((entry) => entry.round1_context_attestation?.round === 1 && entry.round1_context_attestation.peer_position_count === 0 && entry.round1_context_attestation.peer_context_present === false)).toBe(true);
      expect(new Set(round1.map((entry) => entry.round1_context_attestation?.evidence_fingerprint)).size).toBe(1);
      expect(artifact.round1.positions_locked).toBe(true);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('full offline Phase 5 artifact passes the actual Phase 5H certifier without Zeus or network', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-phase5h2-certification-'));
    try {
      const scenario = buildPhase5GoldenScenario();
      const transport = new MockTransport((request) => {
        const body = JSON.parse(request.body ?? '{}') as { readonly messages?: readonly { readonly role?: string; readonly content?: string }[] };
        const user = body.messages?.find((message) => message.role === 'user')?.content ?? '';
        if (user.includes('Respond to challenge')) return { status: 200, headers: { 'content-type': 'application/json' }, body: recordedXaiBody({ action: 'DEFEND', rationale: 'The bounded evidence remains sufficient for the assigned response.', evidence_ids: ['ev-a'], revised_assessment: null, concession: null, abstention_reason: null }) };
        const seat = /"seat_id":"([A-Z]+)"/.exec(user)?.[1] ?? 'APOLLO';
        const risk = seat === 'ARES' ? 'LOW' : seat === 'APOLLO' ? 'MEDIUM' : 'HIGH';
        return { status: 200, headers: { 'content-type': 'application/json' }, body: recordedXaiBody({ ...assessment(), risk_level: risk }) };
      });
      const adapter = new XaiProviderAdapter({ transport });
      const runtime = new ModelRuntime({ providers: new Map([['xai', adapter]]), credentials: { resolve: () => ({ configured: true, value: SECRET }) } });
      const router = new ModelRouter(runtime);
      const plan = { primary: { provider: 'xai', model: 'grok-4.7' }, required_capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'] as const, fallback_enabled: false, retry: { max_attempts: 1, retryable_reasons: [] as const } };
      const seat_executors = Object.fromEntries((['ATHENA', 'ARES', 'HADES', 'APOLLO'] as const).map((seat) => [seat, new ModelBackedSeatExecutor(router, plan, seat, { max_output_tokens: 4096 })]));
      const packageValue = sealEvidence(scenario.case, scenario.evidence, { package_id: scenario.package_id, sealed_at: scenario.sealed_at });
      const session = new Phase5gArtifactSession({ provider: 'xai', model: 'grok-4.7', case_value: scenario.case as unknown as Record<string, unknown>, evidence_package: packageValue as unknown as Record<string, unknown>, global_budget: 11, max_output_tokens: 4096, secrets: [SECRET] }, { directory, now: () => '2026-01-01T00:00:00.000Z', run_id: 'phase5h2-offline-certification-candidate' });
      const result = await runOfflineAdversarialDeliberation({ ...scenario, seat_executors, request_observer: session, event_observer: (event) => session.observeEvent(event), challenge_generator: { generate: async (input) => (await import('../src/swarm/debate/challenges')).planPhase5Challenges(input.positions, input.disagreements, input.case) }, challenge_admission_observer: (report) => session.observeChallengeAdmission(report) });
      session.finalize(result);
      const artifact = loadPhase5gArtifact(session.artifact_path);
      const report = certifyPhase5hArtifactOnly(session.artifact_path, { run_id: artifact.run_id, run_fingerprint: artifact.run_fingerprint! });
      expect(report.final_certification).toBe('PASS');
      expect(report.round1).toEqual({ ATHENA: 'PASS', ARES: 'PASS', HADES: 'PASS', APOLLO: 'PASS' });
      expect(report.round1_blindness).toBe('PASS');
      expect(report.security).toEqual({ secret_scan: 'PASS', hidden_reasoning_scan: 'PASS' });
      expect(report.zeus_readiness_gate).toBe('PASS');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
