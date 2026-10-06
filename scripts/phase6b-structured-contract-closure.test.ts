import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildCertifiedPhase6Scenario } from '../src/swarm/evaluation/scenarios';
import { runOfflineAdversarialDeliberation } from '../src/swarm/engine/offline';
import { buildZeusInput, defaultZeusSynthesis } from '../src/swarm/governance/zeus';
import { ZEUS_AUTHORITY_CONTRACT, ZEUS_CONTROL_EFFECTIVENESS_VALUES, ZEUS_DISAGREEMENT_REFERENCE_MATERIALITY_VALUES, ZEUS_DISAGREEMENT_REFERENCE_STATUS_VALUES, ZEUS_EVIDENCE_QUALITY_VALUES, ZEUS_RISK_LEVEL_VALUES, ZeusAuthorityStatementSchema, ZeusControlEffectivenessSchema, ZeusDisagreementReferenceMaterialitySchema, ZeusDisagreementReferenceStatusSchema, ZeusEvidenceQualitySchema, ZeusSynthesisBriefSchema, RiskLevelSchema, ROUND1_SEAT_IDS, type ZeusSynthesisBody, type ZeusSynthesisBrief } from '../src/swarm/contracts';
import { MockTransport } from '../src/swarm/models/transport';
import { PHASE6B_MODEL, PHASE6B_PROVIDER } from './phase6b1-pretransport';
import { runPhase6bHarness, ZEUS_SYNTHESIS_PROVIDER_SCHEMA } from './phase6b-live-zeus';

const ENV = {
  SWARM_LIVE_ZEUS_SYNTHESIS_CONFIRM: 'YES',
  SWARM_COUNCIL_PROVIDER: PHASE6B_PROVIDER,
  SWARM_COUNCIL_MODEL: PHASE6B_MODEL,
  SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096',
  XAI_API_KEY: 'phase6b-offline-secret-must-never-escape',
};

type Mutation = (fixture: ZeusSynthesisBody) => unknown;

function providerBody(fixture: ZeusSynthesisBrief): ZeusSynthesisBody {
  const { synthesis_id: _synthesisId, case_id: _caseId, seat_id: _seatId, human_decision_required: _humanDecisionRequired, authority_statement: _authorityStatement, execution: _execution, synthesis_fingerprint: _fingerprint, human_decision_status: _humanDecisionStatus, ...body } = fixture;
  return body;
}

async function fixtureInput() {
  const phase5 = await runOfflineAdversarialDeliberation(buildCertifiedPhase6Scenario());
  return buildZeusInput(phase5.blackboard);
}

async function runMutation(mutate: Mutation = (fixture) => fixture) {
  const fixture = defaultZeusSynthesis(await fixtureInput());
  const candidate = mutate(providerBody(fixture));
  const response = { choices: [{ message: { content: JSON.stringify(candidate) }, finish_reason: 'stop' }], usage: { prompt_tokens: 7000, completion_tokens: 2084, total_tokens: 9084 } };
  const transport = new MockTransport(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(response) }));
  return runPhase6bHarness({ env: ENV, dry_run: false, transport });
}

describe('Phase 6B final structured-contract closure', () => {
  test('machine-readable matrix covers every post-generation validator stage', () => {
    const matrix = JSON.parse(readFileSync(new URL('../docs/phase6b-validation-matrix.json', import.meta.url), 'utf8')) as unknown[];
    expect(matrix.length).toBe(41);
    expect(new Set((matrix as Array<{ rule_id: string }>).map((row) => row.rule_id)).size).toBe(matrix.length);
    expect(new Set((matrix as Array<{ validator: string }>).map((row) => row.validator))).toEqual(new Set([
      'provider-json-schema', 'dto-schema', 'normalization', 'zeus-semantic', 'source-reference', 'disagreement-preservation', 'minority-preservation', 'Apollo-audit-preservation', 'false-consensus', 'authority', 'provider-metadata', 'protocol-reducer', 'artifact-build', 'artifact-schema', 'artifact-integrity', 'publication-artifact-gate',
    ]));
    for (const row of matrix as Array<Record<string, unknown>>) {
      expect(typeof row.validator).toBe('string');
      expect(typeof row.rule_id).toBe('string');
      expect(typeof row.json_path).toBe('string');
      expect(typeof row.accepted_shape).toBe('string');
      expect('accepted_enum' in row).toBe(true);
      expect(typeof row.semantic_requirement).toBe('string');
      expect('cross_field_requirement' in row).toBe(true);
      expect('source_reference_requirement' in row).toBe(true);
      expect('authority_requirement' in row).toBe(true);
      expect(typeof row.failure_code).toBe('string');
    }
  });

  test('provider schema, DTO, and protocol share exact enum contracts', async () => {
    const schema = ZEUS_SYNTHESIS_PROVIDER_SCHEMA as any;
    expect(schema.properties.material_risks.items.properties.risk_level.enum).toEqual([...ZEUS_RISK_LEVEL_VALUES]);
    expect(schema.properties.control_assessment.items.properties.effectiveness.enum).toEqual([...ZEUS_CONTROL_EFFECTIVENESS_VALUES]);
    expect(schema.properties.evidence_assessment.properties.quality.enum).toEqual([...ZEUS_EVIDENCE_QUALITY_VALUES]);
    expect(schema.properties.material_disagreements.items.properties.status.enum).toEqual([...ZEUS_DISAGREEMENT_REFERENCE_STATUS_VALUES]);
    expect(schema.properties.material_disagreements.items.properties.materiality.enum).toEqual([...ZEUS_DISAGREEMENT_REFERENCE_MATERIALITY_VALUES]);
    expect(schema.properties.minority_positions.items.properties.seat_id.enum).toEqual([...ROUND1_SEAT_IDS]);
    expect(schema.properties).not.toHaveProperty('human_decision_status');
    expect(schema.properties).not.toHaveProperty('authority_statement');
    expect(schema.properties).not.toHaveProperty('synthesis_fingerprint');
    expect((RiskLevelSchema as any)._def.values).toEqual([...ZEUS_RISK_LEVEL_VALUES]);
    expect((ZeusControlEffectivenessSchema as any)._def.values).toEqual([...ZEUS_CONTROL_EFFECTIVENESS_VALUES]);
    expect((ZeusEvidenceQualitySchema as any)._def.values).toEqual([...ZEUS_EVIDENCE_QUALITY_VALUES]);
    expect((ZeusDisagreementReferenceStatusSchema as any)._def.values).toEqual([...ZEUS_DISAGREEMENT_REFERENCE_STATUS_VALUES]);
    expect((ZeusDisagreementReferenceMaterialitySchema as any)._def.values).toEqual([...ZEUS_DISAGREEMENT_REFERENCE_MATERIALITY_VALUES]);
    expect(ZeusAuthorityStatementSchema.safeParse(ZEUS_AUTHORITY_CONTRACT).success).toBe(true);
    expect(ZeusSynthesisBriefSchema.safeParse(defaultZeusSynthesis(await fixtureInput())).success).toBe(true);
  });

  test('one valid synthetic Zeus response passes the live-shaped path; adversarial source identity is certified separately', async () => {
    const result = await runMutation();
    expect(result.status).toBe('EXECUTED_ONE_ZEUS_REQUEST');
    expect(result.failure_code).toBeNull();
    expect(result.artifact_only_replay).toBe('PASS');
    expect(result.real_provider_calls).toBe(0);
  });

  const mutations: Array<[string, Mutation]> = [
    ['authority_statement', (fixture) => ({ ...fixture, authority_statement: { ...fixture.authority_statement, final_decision_authority: 'ZEUS' } })],
    ['human_decision_required', (fixture) => ({ ...fixture, human_decision_required: false })],
    ['compliance declaration', (fixture) => ({ ...fixture, executive_summary: 'Compliance is confirmed.' })],
    ['deployment approval/rejection', (fixture) => ({ ...fixture, decision_context: 'Zeus approves deployment.' })],
    ['source_position_ids', (fixture) => ({ ...fixture, source_position_ids: ['POSITION-UNKNOWN'] })],
    ['source_disagreement_ids', (fixture) => ({ ...fixture, source_disagreement_ids: ['DISAGREEMENT-UNKNOWN'] })],
    ['source_evidence_ids', (fixture) => ({ ...fixture, source_evidence_ids: ['EVIDENCE-UNKNOWN'] })],
    ['material disagreements', (fixture) => ({ ...fixture, material_disagreements: [] })],
    ['minority positions', (fixture) => ({ ...fixture, minority_positions: [] })],
    ['Apollo audit preservation', (fixture) => ({ ...fixture, audit_summary: { ...fixture.audit_summary, finding_ids: [] } })],
    ['false consensus', (fixture) => ({ ...fixture, executive_summary: 'All seats agree; unanimous consensus.' })],
    ['control effectiveness enum', (fixture) => ({ ...fixture, control_assessment: fixture.control_assessment.map((item, index) => index === 0 ? { ...item, effectiveness: 'NOT_ASSESSED' } : item) })],
    ['confidence', (fixture) => ({ ...fixture, confidence: 1.1 })],
    ['decision options', (fixture) => ({ ...fixture, decision_options: [...fixture.decision_options, 'over-limit option', 'another over-limit option'] })],
    ['evidence assessment', (fixture) => ({ ...fixture, evidence_assessment: { ...fixture.evidence_assessment, quality: 'MODERATE' } })],
    ['malformed/extra fields', (fixture) => ({ ...fixture, unexpected: true })],
  ];

  test('independent mutation tests reject every governed dimension', async () => {
    for (const [name, mutation] of mutations) {
      const result = await runMutation(mutation);
      expect(result.status, name).toBe('FAILED');
      expect(result.failure_code, name).not.toBeNull();
      expect(result.artifact, name).toBeNull();
      expect(result.real_provider_calls, name).toBe(0);
    }
  });
});
