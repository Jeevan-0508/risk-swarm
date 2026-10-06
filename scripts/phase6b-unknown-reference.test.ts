import { describe, expect, test } from 'bun:test';
import { buildCertifiedPhase6Scenario } from '../src/swarm/evaluation/scenarios';
import { runOfflineAdversarialDeliberation } from '../src/swarm/engine/offline';
import { runOfflineZeusSynthesis } from '../src/swarm/engine/zeus';
import {
  buildZeusAllowedReferenceSets,
  buildZeusInput,
  canonicalizeZeusSynthesis,
  defaultZeusSynthesis,
  resolveZeusReferences,
  validateZeusSynthesis,
} from '../src/swarm/governance/zeus';
import { ZeusSynthesisBriefSchema, type ZeusSynthesisBrief } from '../src/swarm/contracts';
import { SwarmProtocolError } from '../src/swarm/governance/verifier';
import { buildZeusProviderSchema } from './phase6b-live-zeus';

async function canonical() {
  const phase5 = await runOfflineAdversarialDeliberation(buildCertifiedPhase6Scenario());
  const input = buildZeusInput(phase5.blackboard);
  return { phase5, input, synthesis: defaultZeusSynthesis(input) };
}

function expectProtocol(mutated: unknown, input: Awaited<ReturnType<typeof canonical>>['input'], code: string, path: string, referenceClass: string, count: number) {
  try {
    validateZeusSynthesis(mutated, input);
    throw new Error('EXPECTED_FAIL_CLOSED');
  } catch (error) {
    expect(error).toBeInstanceOf(SwarmProtocolError);
    const protocol = error as SwarmProtocolError;
    expect(protocol.code).toBe(code);
    expect(protocol.diagnostics.UNKNOWN_REFERENCE_PATH).toBe(path);
    expect(protocol.diagnostics.REFERENCE_CLASS).toBe(referenceClass);
    expect(protocol.diagnostics.ALLOWED_REFERENCE_COUNT).toBe(count);
  }
}

describe('Phase 6B Zeus unknown-reference root fix, offline certification', () => {
  test('canonical allowed reference sets are immutable, enumerated, and match exact Zeus input', async () => {
    const { input } = await canonical();
    const allowed = buildZeusAllowedReferenceSets(input);
    expect(allowed.counts).toEqual({ POSITION: 4, DISAGREEMENT: 4, EVIDENCE: 2, AUDIT_FINDING: 10 });
    expect([...allowed.position_ids]).toEqual(input.final_positions.map((item) => item.position_id));
    expect([...allowed.disagreement_ids]).toEqual(input.post_challenge_disagreements.map((item) => item.disagreement_id));
    expect([...allowed.evidence_ids]).toEqual(input.evidence_metadata.map((item) => item.evidence_id));
    expect([...allowed.audit_finding_ids]).toEqual(input.audit_findings.map((item) => item.finding_id));
    expect(Object.isFrozen(allowed)).toBe(true);
    expect(Object.isFrozen(allowed.counts)).toBe(true);
    expect(() => (allowed.position_ids as Set<string>).add('fabricated')).toThrow();
    expect(allowed.position_ids.has('fabricated')).toBe(false);
  });

  test('fully valid synthetic Zeus output validates every generated reference', async () => {
    const { input, synthesis } = await canonical();
    const resolved = resolveZeusReferences(synthesis, input);
    expect(resolved.normalizations).toHaveLength(0);
    expect(() => validateZeusSynthesis(synthesis, input)).not.toThrow();
    expect(ZeusSynthesisBriefSchema.safeParse(synthesis).success).toBe(true);
    expect(synthesis.execution.reference_normalizations).toEqual([]);
  });

  test('provider schema receives the exact canonical domains and cannot admit an unknown source to synthesis', async () => {
    const { phase5, input, synthesis } = await canonical();
    const schema = buildZeusProviderSchema(input) as any;
    const allowed = buildZeusAllowedReferenceSets(input);
    expect(schema.properties.source_position_ids.items.enum).toEqual([...allowed.position_ids]);
    expect(schema.properties.source_disagreement_ids.items.enum).toEqual([...allowed.disagreement_ids]);
    expect(schema.properties.source_evidence_ids.items.enum).toEqual([...allowed.evidence_ids]);
    expect(schema.properties.source_audit_finding_ids.items.enum).toEqual([...allowed.audit_finding_ids]);
    expect(schema.properties).not.toHaveProperty('synthesis_id');
    expect(schema.properties).not.toHaveProperty('execution');
    expect(schema.properties).not.toHaveProperty('synthesis_fingerprint');
    await expect(runOfflineZeusSynthesis(phase5, { synthesize: async () => ({ ...synthesis, source_position_ids: ['fabricated-position'] }) })).rejects.toBeInstanceOf(SwarmProtocolError);
  });

  test('unknown position ID fails closed with exact diagnostics', async () => {
    const { input, synthesis } = await canonical();
    expectProtocol({ ...synthesis, source_position_ids: ['position-does-not-exist'] }, input, 'UNKNOWN_REFERENCE', '$.source_position_ids[0]', 'POSITION', 4);
  });

  test('unknown disagreement ID fails closed with exact diagnostics', async () => {
    const { input, synthesis } = await canonical();
    expectProtocol({ ...synthesis, source_disagreement_ids: ['disagreement-does-not-exist'] }, input, 'UNKNOWN_REFERENCE', '$.source_disagreement_ids[0]', 'DISAGREEMENT', 4);
  });

  test('unknown evidence ID fails closed with exact diagnostics', async () => {
    const { input, synthesis } = await canonical();
    expectProtocol({ ...synthesis, source_evidence_ids: ['evidence-does-not-exist'] }, input, 'UNKNOWN_EVIDENCE', '$.source_evidence_ids[0]', 'EVIDENCE', 2);
  });

  test('plausible fabricated UUID and cross-class ID cannot enter a source field', async () => {
    const { input, synthesis } = await canonical();
    expectProtocol({ ...synthesis, source_audit_finding_ids: ['550e8400-e29b-41d4-a716-446655440000'] }, input, 'UNKNOWN_REFERENCE', '$.source_audit_finding_ids[0]', 'AUDIT_FINDING', 10);
    expectProtocol({ ...synthesis, source_position_ids: ['ev-a'] }, input, 'UNKNOWN_REFERENCE', '$.source_position_ids[0]', 'POSITION', 4);
  });

  test('duplicate, empty, and mixed valid/invalid references fail closed', async () => {
    const { input, synthesis } = await canonical();
    expectProtocol({ ...synthesis, source_evidence_ids: ['ev-a', 'ev-a'] }, input, 'DUPLICATE_REFERENCE', '$.source_evidence_ids', 'EVIDENCE', 2);
    expect(() => validateZeusSynthesis({ ...synthesis, source_position_ids: [''] }, input)).toThrow(SwarmProtocolError);
    expectProtocol({ ...synthesis, source_evidence_ids: ['ev-a', 'evidence-does-not-exist'] }, input, 'UNKNOWN_EVIDENCE', '$.source_evidence_ids[1]', 'EVIDENCE', 2);
  });

  test('case and whitespace changes are losslessly normalized and explicitly recorded', async () => {
    const { input, synthesis } = await canonical();
    const { synthesis_id: _synthesisId, case_id: _caseId, seat_id: _seatId, human_decision_required: _humanDecisionRequired, authority_statement: _authorityStatement, execution: _execution, synthesis_fingerprint: _fingerprint, human_decision_status: _humanDecisionStatus, ...body } = synthesis;
    const mutated = { ...body, source_position_ids: [' POSITION-APOLLO-1 '], source_evidence_ids: [' ev-a '] };
    const normalized = canonicalizeZeusSynthesis(mutated, input);
    expect(normalized.source_position_ids).toEqual(['position-apollo-1']);
    expect(normalized.source_evidence_ids).toEqual(['ev-a']);
    expect(normalized.execution.reference_normalizations).toEqual([
      { path: '$.source_position_ids[0]', reference_class: 'POSITION', emitted_value: ' POSITION-APOLLO-1 ', canonical_value: 'position-apollo-1' },
      { path: '$.source_evidence_ids[0]', reference_class: 'EVIDENCE', emitted_value: ' ev-a ', canonical_value: 'ev-a' },
    ]);
    expect(ZeusSynthesisBriefSchema.safeParse(normalized).success).toBe(true);
  });

  test('closed-domain audit rejects deterministic ID, enum, authority, and cross-field mutations offline', async () => {
    const { input, synthesis } = await canonical();
    const cases: readonly [string, (value: ZeusSynthesisBrief) => unknown][] = [
      ['deterministic synthesis ID', (value) => ({ ...value, synthesis_id: 'zeus-synthesis-fabricated' })],
      ['control enum', (value) => ({ ...value, control_assessment: value.control_assessment.map((item, index) => index === 0 ? { ...item, effectiveness: 'NOT_ASSESSED' } : item) })],
      ['authority language', (value) => ({ ...value, executive_summary: 'The deployment is compliant.' })],
      ['disagreement cross-field semantics', (value) => ({ ...value, material_disagreements: value.material_disagreements.map((item, index) => index === 0 ? { ...item, status: item.status === 'OPEN' ? 'NARROWED' : 'OPEN' } : item) })],
    ];
    for (const [name, mutate] of cases) {
      try {
        validateZeusSynthesis(mutate(synthesis), input);
        throw new Error(`EXPECTED_FAIL_CLOSED:${name}`);
      } catch (error) {
        expect(error).toBeInstanceOf(SwarmProtocolError);
      }
    }
  });

  test('final offline certification fixture contains realistic mixed LLM mistakes and never produces a synthesis', async () => {
    const { input, synthesis } = await canonical();
    const realisticMistakes = [
      { ...synthesis, source_position_ids: ['position-athena-1', 'position-fabricated'], control_assessment: synthesis.control_assessment.map((item, index) => index === 0 ? { ...item, effectiveness: 'NOT_ASSESSED' } : item), executive_summary: 'All seats agree; approve deployment.' },
      { ...synthesis, source_evidence_ids: ['ev-a', 'ev-a'], material_disagreements: synthesis.material_disagreements.map((item, index) => index === 0 ? { ...item, status: 'RESOLVED' } : item), human_decision_required: false },
      { ...synthesis, source_position_ids: ['ev-a'], authority_statement: { ...synthesis.authority_statement, may_approve_deployment: true } },
    ];
    for (const candidate of realisticMistakes) {
      expect(() => validateZeusSynthesis(candidate, input)).toThrow(SwarmProtocolError);
      expect(ZeusSynthesisBriefSchema.safeParse(candidate).success).toBe(false);
    }
  });
});
