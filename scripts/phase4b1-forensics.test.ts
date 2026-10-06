import { describe, expect, test } from 'bun:test';
import { normalizeStructuredOutput, jsonSchema } from '../src/swarm/models/structured-output';
import { MockTransport, type HttpResponse } from '../src/swarm/models/transport';
import { XaiProviderAdapter } from '../src/swarm/models/providers/xai';
import { SEAT_ASSESSMENT_PROVIDER_SCHEMA, SEAT_ASSESSMENT_SCHEMA, validateSeatAssessmentSemantics, validateSeatAssessmentShape } from '../src/swarm/seats/validation';
import { outputContractDescription } from '../src/swarm/seats/prompt';
import { runOfflineDryRun } from './certify-swarm-live-council';

const SECRET = 'PHASE4B1_FORENSIC_SECRET_DO_NOT_LEAK';

function response(body: string): HttpResponse {
  return { status: 200, headers: { 'content-type': 'application/json' }, body };
}

function assessment(evidenceId = 'EV-003'): Record<string, unknown> {
  return {
    conclusion: 'The supplied sample indicates a bounded review-control risk without establishing financial loss.',
    risk_level: 'HIGH',
    confidence: 0.7,
    claims: [{ statement: 'Some sampled high-risk transactions lack a recorded reviewer identifier.', type: 'OBSERVATION', evidence_ids: [evidenceId], assumptions: [], uncertainty: 'The logging-defect alternative remains unresolved.', status: 'SUPPORTED' }],
    assumptions: ['The supplied sample is relevant to the scoped review process.'],
    uncertainties: ['The supplied records do not establish financial loss.'],
    risk_findings: [{ statement: 'The review control may not reliably produce an auditable reviewer record.', evidence_ids: [evidenceId], assumptions: [], uncertainty: 'The logging-defect alternative limits causal certainty.', risk_level: 'HIGH' }],
    control_gaps: [{ statement: 'Control effectiveness and reviewer-record completeness require follow-up.', evidence_ids: ['EV-002', 'EV-003', 'EV-004'], assumptions: [], uncertainty: 'The evidence does not distinguish process bypass from logging omission.', priority: 'HIGH' }],
    counterarguments: ['A logging defect may explain missing reviewer identifiers.'],
    evidence_requests: [{ request: 'Obtain a bounded sample linking processing to reviewer records.', reason: 'The current evidence cannot distinguish control bypass from logging omission.', evidence_ids: ['EV-004'] }],
    recommendation: 'Preserve human review and obtain bounded control-effectiveness evidence.',
    abstained: false,
    abstention_reason: null,
  };
}

describe('Phase 4B.1 offline response-contract forensics', () => {
  test('classifies model text parse failure before DTO validation without retaining text', () => {
    const schema = jsonSchema('forensic_schema', () => ({ success: true as const, value: {} }));
    const result = normalizeStructuredOutput({ text: 'not-json' }, schema, { allow_code_fence: true, allow_balanced_object_extraction: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'RESPONSE_PARSE_ERROR', stage: 'RESPONSE_PARSE' });
    expect(result.diagnostics).toMatchObject({ provider_output_extracted: true, json_parse: 'FAIL', schema_validation: 'NOT_RUN' });
    expect(JSON.stringify(result)).not.toContain('not-json');
  });

  test('distinguishes valid JSON with invalid DTO schema from parse failure', () => {
    const result = normalizeStructuredOutput({ text: JSON.stringify({ unexpected: true }) }, SEAT_ASSESSMENT_SCHEMA);
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'STRUCTURED_OUTPUT_INVALID', stage: 'STRUCTURED_VALIDATION' });
    expect(result.diagnostics).toMatchObject({ provider_output_extracted: true, json_parse: 'PASS', schema_validation: 'FAIL' });
  });

  test('records the supported xAI extraction shape and rejects unsupported content arrays', async () => {
    const supported = new MockTransport(() => response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) }, finish_reason: 'stop' }] })));
    const adapter = new XaiProviderAdapter({ transport: supported });
    const request = { request_id: 'forensic-supported', case_id: 'forensic-case', purpose: 'FORENSICS', model_requirements: ['TEXT_GENERATION'] as const, task_instruction: 'Return JSON.', context: {}, timeout_ms: 500 };
    const first = await adapter.execute(request, 'grok-4.7', { credential: 'offline-only' });
    expect(first.model_output_present).toBe(true);
    expect(first.diagnostics).toMatchObject({ choice_count: 1, message_present: true, content_present: true, text_present: true, json_parsed: true });

    const unsupported = new MockTransport(() => response(JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: '{"ok":true}' }] } }] })));
    const second = await new XaiProviderAdapter({ transport: unsupported }).execute(request, 'grok-4.7', { credential: 'offline-only' });
    expect(second.status).toBe('FAILED');
    expect(second.error?.code).toBe('EMPTY_RESPONSE');
    expect(second.diagnostics).toMatchObject({ choice_count: 1, message_present: true, content_present: true, text_present: false });
  });

  test('provider schema and prompt describe the same exact top-level DTO contract', () => {
    const schema = SEAT_ASSESSMENT_PROVIDER_SCHEMA as { readonly properties: Record<string, unknown>; readonly required: readonly string[]; readonly additionalProperties: boolean };
    const expected = ['conclusion', 'risk_level', 'confidence', 'claims', 'assumptions', 'uncertainties', 'risk_findings', 'control_gaps', 'counterarguments', 'evidence_requests', 'recommendation', 'abstained', 'abstention_reason'];
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expected);
    expect(Object.keys(schema.properties)).toEqual(expected);
    expect(outputContractDescription()).toContain('No additional fields');
    expect(SEAT_ASSESSMENT_SCHEMA.json_schema).toBe(SEAT_ASSESSMENT_PROVIDER_SCHEMA);
  });

  test('all four seats accept corrected DTOs through the offline council path', async () => {
    const dry = await runOfflineDryRun();
    expect(dry.baseline.seat_reports.map((report) => [report.seat, report.position_accepted])).toEqual([['ATHENA', true], ['ARES', true], ['HADES', true], ['APOLLO', true]]);
    expect(dry.baseline.seat_reports.every((report) => report.provider_output_extracted === 'PASS' && report.json_parse === 'PASS' && report.model_dto_schema_validation === 'PASS' && report.seat_semantic_validation === 'PASS' && report.agent_position_conversion === 'PASS')).toBe(true);
    expect(dry.baseline.budget).toEqual({ request_count: 4, attempted_count: 4, blocked_count: 0 });
    expect(dry.baseline.blackboard.disagreements.length).toBeGreaterThan(0);
    expect(dry.baseline.audit.finding_count).toBeGreaterThan(0);
    expect(dry.baseline.position_summaries).toHaveLength(4);
    expect(dry.baseline.replay_deterministic).toBe(true);
  });

  test('retains strict negative validation across shape and semantic layers', async () => {
    const dry = await runOfflineDryRun();
    const base = assessment();
    const shapeCases: Record<string, unknown>[] = [];
    const missing = { ...base }; delete missing.conclusion; shapeCases.push(missing);
    shapeCases.push({ ...base, unknown_field: true });
    shapeCases.push({ ...base, risk_level: 'UNKNOWN' });
    shapeCases.push({ ...base, confidence: 1.1 });
    shapeCases.push({ ...base, seat_id: 'ARES' });
    shapeCases.push({ ...base, case_id: 'other-case' });
    shapeCases.push({ ...base, chain_of_thought: 'hidden' });
    shapeCases.push({ ...base, risk_findings: [{ statement: 'bad', evidence_ids: [], assumptions: [], uncertainty: 'unknown', risk_level: 'HIGH' }] });
    shapeCases.push({ ...base, evidence_requests: [{ request: 'missing reason', reason: '', evidence_ids: [] }] });
    for (const candidate of shapeCases) expect(validateSeatAssessmentShape(candidate).success).toBe(false);
    expect(validateSeatAssessmentShape('not-an-object').success).toBe(false);
    expect(validateSeatAssessmentShape(['not-an-object']).success).toBe(false);
    const unknownCitation = validateSeatAssessmentShape(assessment('EV-999'));
    expect(unknownCitation.success).toBe(true);
    if (unknownCitation.success) expect(validateSeatAssessmentSemantics(unknownCitation.value, dry.baseline.evidence_package).success).toBe(false);
    const authority = validateSeatAssessmentShape({ ...base, conclusion: 'The final decision is approved.' });
    expect(authority.success).toBe(true);
    if (authority.success) expect(validateSeatAssessmentSemantics(authority.value, dry.baseline.evidence_package).success).toBe(false);
  });

  test('accepts bounded abstention without fabricating an assessment', async () => {
    const dry = await runOfflineDryRun();
    const abstention = { ...assessment(), conclusion: '', risk_level: 'UNDETERMINED', confidence: null, claims: [], assumptions: [], uncertainties: ['The evidence is insufficient for a reliable conclusion.'], risk_findings: [], control_gaps: [], counterarguments: [], evidence_requests: [], recommendation: null, abstained: true, abstention_reason: 'The evidence package is insufficient to support a reliable assessment.' };
    const shape = validateSeatAssessmentShape(abstention);
    expect(shape.success).toBe(true);
    if (shape.success) expect(validateSeatAssessmentSemantics(shape.value, dry.baseline.evidence_package).success).toBe(true);
  });

  test('keeps secrets out of request, schema, parser diagnostics, and forensic report surfaces', async () => {
    const transport = new MockTransport(() => response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: SECRET }) } }] })));
    const adapter = new XaiProviderAdapter({ transport });
    const schema = jsonSchema('secret_schema', () => ({ success: false as const, error: SECRET }));
    const result = await adapter.execute({ request_id: 'secret-test', case_id: 'secret-case', purpose: 'SECRET_TEST', model_requirements: ['TEXT_GENERATION'], task_instruction: SECRET, context: { marker: SECRET }, output_schema: schema, timeout_ms: 500 }, 'grok-4.7', { credential: SECRET });
    expect(JSON.stringify(result.diagnostics)).not.toContain(SECRET);
    expect(JSON.stringify(result.error) ?? '').not.toContain(SECRET);
    expect(transport.requests[0]!.headers?.authorization).toContain(SECRET);
    expect(JSON.stringify(schema.json_schema ?? {})).not.toContain(SECRET);
    const dry = await runOfflineDryRun();
    expect(dry.secretLeakCheck).toBe('PASS');
    expect(JSON.stringify(dry.baseline.seat_reports)).not.toContain(SECRET);
  });
});
