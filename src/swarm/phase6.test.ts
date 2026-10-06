import { describe, expect, test } from 'bun:test';
import { buildCertifiedPhase6Scenario } from './evaluation/scenarios';
import { runOfflineAdversarialDeliberation } from './engine/offline';
import { replayOfflineZeus, runOfflineZeusSynthesis } from './engine/zeus';
import {
  assessZeusReadiness,
  buildZeusInput,
  defaultZeusSynthesis,
  FixtureZeusSynthesisExecutor,
  validateZeusSynthesis,
  ZEUS_PROMPT_VERSION,
  ZEUS_SYNTHESIS_REQUEST_BUDGET,
} from './governance/zeus';
import { SwarmProtocolError } from './governance/verifier';
import { buildZeusArtifact, replayZeusArtifact } from './governance/zeus-artifact';

async function phase5() {
  return runOfflineAdversarialDeliberation(buildCertifiedPhase6Scenario());
}

describe('SWARM 2.0 Phase 6A Zeus synthesis', () => {
  test('golden fixture runs one bounded offline synthesis and stops at human review', async () => {
    const before = await phase5();
    const result = await runOfflineZeusSynthesis(before);
    expect(result.provider_requests).toBe(0);
    expect(result.executor_invocations).toBe(1);
    expect(result.blackboard.state).toBe('HUMAN_REVIEW');
    expect(result.blackboard.human_decision).toBeNull();
    expect(result.blackboard.zeus_synthesis?.seat_id).toBe('ZEUS');
    expect(result.blackboard.zeus_synthesis?.human_decision_required).toBe(true);
    expect(result.blackboard.zeus_synthesis?.human_decision_status).toBe('PENDING');
    expect(result.events.slice(-4).map((event) => event.type)).toEqual([
      'ZEUS_SYNTHESIS_REQUESTED', 'ZEUS_SYNTHESIS_STARTED', 'ZEUS_SYNTHESIS_COMPLETED', 'HUMAN_REVIEW_REQUIRED',
    ]);
  });

  test('readiness is one deterministic gate and the certified fixture has the required Phase 5 shape', async () => {
    const result = await phase5();
    const readiness = assessZeusReadiness(result.blackboard);
    expect(readiness.ready).toBe(true);
    expect(Object.values(readiness.required_inputs_present).every(Boolean)).toBe(true);
    expect(result.blackboard.challenges.length).toBe(2);
    expect(result.blackboard.challenge_responses.map((response) => response.action)).toEqual(['DEFEND', 'REVISE']);
    expect(result.blackboard.revisions.length).toBe(1);
    expect(result.blackboard.disagreements.filter((item) => item.status === 'OPEN' && item.materiality !== 'MINOR').length).toBe(4);
    expect(result.blackboard.audit_findings.filter((finding) => finding.status === 'BLOCKED').length).toBe(0);
    expect(result.blackboard.audit_findings.filter((finding) => finding.status === 'WARNING').length).toBe(1);
  });

  test('output preserves every open disagreement, minority position, and Apollo warning', async () => {
    const result = await runOfflineZeusSynthesis(await phase5());
    const synthesis = result.blackboard.zeus_synthesis!;
    expect(synthesis.material_disagreements.length).toBe(4);
    expect(synthesis.minority_positions.length).toBe(4);
    expect(synthesis.audit_summary.warning_count).toBe(1);
    expect(synthesis.audit_summary.finding_ids.length).toBe(10);
    expect(synthesis.executive_summary.toLowerCase()).not.toContain('unanimous consensus');
  });

  test('fail-closed validation rejects false consensus, unknown sources, and authority claims', async () => {
    const result = await phase5();
    const input = buildZeusInput(result.blackboard);
    const valid = defaultZeusSynthesis(input);
    expect(() => validateZeusSynthesis({ ...valid, material_disagreements: [], minority_positions: [] }, input)).toThrow(SwarmProtocolError);
    expect(() => validateZeusSynthesis({ ...valid, source_evidence_ids: ['unknown-evidence'], synthesis_fingerprint: 'tampered' }, input)).toThrow(SwarmProtocolError);
    try {
      validateZeusSynthesis({ ...valid, synthesis_fingerprint: 'tampered' }, input);
      throw new Error('EXPECTED_FINGERPRINT_FAILURE');
    } catch (error) {
      expect(error).toBeInstanceOf(SwarmProtocolError);
      expect((error as SwarmProtocolError).code).toBe('ZEUS_SYNTHESIS_FINGERPRINT_MISMATCH');
    }
    expect(() => validateZeusSynthesis({ ...valid, executive_summary: 'All seats agree: unanimous consensus; approve deployment.', synthesis_fingerprint: 'tampered' }, input)).toThrow(SwarmProtocolError);
  });

  test('input fingerprint and replay are deterministic, with no hidden reasoning or provider calls', async () => {
    const before = await phase5();
    const input = buildZeusInput(before.blackboard);
    const result = await runOfflineZeusSynthesis(before, new FixtureZeusSynthesisExecutor());
    const replay = replayOfflineZeus(result.events);
    expect(input.input_fingerprint).toBe(replay.zeus_input!.input_fingerprint);
    expect(result.blackboard.zeus_synthesis?.synthesis_fingerprint).toBe(replay.zeus_synthesis?.synthesis_fingerprint);
    const serialized = JSON.stringify(input);
    expect(serialized).not.toMatch(/reasoning_content|chain.of.thought|authorization|api[_-]?key|secret/i);
    expect(ZEUS_PROMPT_VERSION).toBe('ZEUS_PHASE6_SYNTHESIS_V2');
    expect(ZEUS_SYNTHESIS_REQUEST_BUDGET).toBe(1);
  });

  test('a second Zeus request cannot be admitted by the reducer', async () => {
    const result = await runOfflineZeusSynthesis(await phase5());
    const input = result.blackboard.zeus_input!;
    expect(() => {
      // Reusing the same request event is a duplicate protocol event and is
      // rejected before any executor/provider seam could be reached.
      return replayOfflineZeus(result.events.concat(result.events[result.events.length - 4]!));
    }).toThrow();
    expect(input.readiness.ready).toBe(true);
  });

  test('durable Zeus artifact replays without provider access or process memory', async () => {
    const result = await runOfflineZeusSynthesis(await phase5());
    const artifact = buildZeusArtifact(result.blackboard);
    const replay = replayZeusArtifact(JSON.parse(JSON.stringify(artifact)));
    expect(artifact.request_ledger.provider_requests).toBe(0);
    expect(artifact.authority_attestation).toBe('HUMAN_DECISION_REQUIRED');
    expect(replay.artifact_only_replay).toBe('PASS');
    expect(replay.synthesis.synthesis_fingerprint!).toBe(artifact.synthesis_fingerprint);
    expect(replay.human_decision).toBeNull();
  });
});
