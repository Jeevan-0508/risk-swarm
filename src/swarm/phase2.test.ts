import { describe, expect, test } from 'bun:test';
import { ROUND1_SEAT_IDS, SEAT_IDS, type PositionId, type SwarmExecutionEvent } from './contracts';
import { buildChallengeInput } from './debate/challenges';
import { runOfflineSwarmCase } from './engine/offline';
import { allGoldenScenarios, buildGoldenScenario, GOLDEN_SCENARIO_NAMES } from './evaluation/scenarios';
import { parseFixtureResult } from './engine/executor';
import { assertPositionValid, SwarmProtocolError } from './governance/verifier';
import { projectTimeline } from './projection/timeline';
import { stableStringify } from './evidence/package';

async function run(name: typeof GOLDEN_SCENARIO_NAMES[number]) {
  return runOfflineSwarmCase(buildGoldenScenario(name));
}

describe('SWARM 2.0 Phase 2 offline deliberation', () => {
  test('defines five stable seats and only four Round 1 participants', () => {
    expect(SEAT_IDS).toEqual(['ATHENA', 'ARES', 'HADES', 'APOLLO', 'ZEUS']);
    expect(ROUND1_SEAT_IDS).toEqual(['ATHENA', 'ARES', 'HADES', 'APOLLO']);
    expect(ROUND1_SEAT_IDS).not.toContain('ZEUS');
  });

  test('runs every golden scenario to HUMAN_REVIEW with no real model call', async () => {
    for (const scenario of allGoldenScenarios()) {
      const result = await runOfflineSwarmCase(scenario);
      expect(result.blackboard.state, scenario.name).toBe('HUMAN_REVIEW');
      expect(result.blackboard.synthesis?.human_decision_status, scenario.name).toBe('PENDING');
      expect(result.blackboard.synthesis?.audit_findings.length, scenario.name).toBeGreaterThan(0);
      for (const event of result.events) {
        if ('execution' in event && event.execution) expect(event.execution.executed_provider).not.toBe('gemini');
      }
    }
  });

  test('accepts results in stable seat order regardless of fixture completion timing', async () => {
    const result = await run('SUPPORTED_RISK');
    const proposed = result.events.filter((event): event is Extract<SwarmExecutionEvent, { type: 'POSITION_PROPOSED' }> => event.type === 'POSITION_PROPOSED');
    expect(proposed.map((event) => event.position.seat_id)).toEqual([...ROUND1_SEAT_IDS]);
    expect(result.executor_invocations).toBe(5);
  });

  test('keeps disagreement materiality, challenge privacy, and evidence requests explicit', async () => {
    const result = await run('CONTRADICTION');
    expect(result.blackboard.disagreements.length).toBeGreaterThan(0);
    expect(result.blackboard.challenges.length).toBeGreaterThan(0);
    expect(result.blackboard.evidence_requests.length).toBeGreaterThan(0);
    const challenge = result.blackboard.challenges[0]!;
    const input = buildChallengeInput(result.blackboard, challenge);
    expect(input.prior_position.seat_id).toBe(challenge.to_seat);
    expect(input).not.toHaveProperty('all_positions');
    expect(input).not.toHaveProperty('other_seat_inputs');
  });

  test('preserves false consensus and supported minority evidence', async () => {
    const falseConsensus = await run('FALSE_CONSENSUS');
    expect(falseConsensus.blackboard.audit_findings.some((finding) => finding.check_id === 'shared_unsupported_assumption' && finding.status === 'BLOCKED')).toBe(true);
    const minority = await run('MAJORITY_WRONG_MINORITY_SUPPORTED');
    expect(minority.blackboard.synthesis?.majority_position).toBeTruthy();
    expect(minority.blackboard.synthesis?.minority_positions).toContain('position-ares-1' as PositionId);
    expect(minority.blackboard.audit_findings.some((finding) => finding.check_id === 'majority_basis_integrity' && finding.status === 'BLOCKED')).toBe(true);
  });

  test('preserves unavailable seats and hostile evidence as non-authoritative inputs', async () => {
    const unavailable = await run('ONE_SEAT_UNAVAILABLE');
    expect(unavailable.blackboard.seat_execution_state.HADES.status).toBe('UNAVAILABLE');
    expect(unavailable.blackboard.positions.some((position) => position.seat_id === 'HADES')).toBe(false);
    const hostile = await run('HOSTILE_EVIDENCE');
    expect(hostile.blackboard.audit_findings.find((finding) => finding.check_id === 'seat_authority_boundaries')?.status).toBe('VERIFIED');
    expect(hostile.blackboard.synthesis?.human_decision_status).toBe('PENDING');
  });

  test('keeps response, revision, defense, and concession lineage', async () => {
    const revised = await run('REVISION_AFTER_CHALLENGE');
    expect(revised.blackboard.revisions).toHaveLength(1);
    expect(revised.blackboard.challenge_responses.some((response) => response.action === 'REVISE')).toBe(true);
    expect(revised.blackboard.positions.some((position) => position.seat_id === 'ATHENA' && position.round === 2)).toBe(true);
    const defended = await run('DEFENDED_POSITION');
    expect(defended.blackboard.challenge_responses.some((response) => response.action === 'DEFEND')).toBe(true);
    expect(defended.blackboard.revisions).toHaveLength(0);
    const conceded = await run('CONCEDED_POSITION');
    expect(conceded.blackboard.challenge_responses.some((response) => response.action === 'CONCEDE')).toBe(true);
    expect(conceded.blackboard.revisions).toHaveLength(1);
    expect(conceded.blackboard.positions.some((position) => position.round === 2 && position.claims[0]?.status === 'WITHDRAWN')).toBe(true);
  });

  test('replays and projects deterministically', async () => {
    const first = await run('REVISION_AFTER_CHALLENGE');
    const second = await run('REVISION_AFTER_CHALLENGE');
    expect(stableStringify(first.events)).toBe(stableStringify(second.events));
    expect(stableStringify(projectTimeline(first.events))).toBe(stableStringify(projectTimeline(second.events)));
    expect(projectTimeline(first.events).at(-1)?.state_after).toBe('HUMAN_REVIEW');
  });

  test('rejects malformed, fabricated-citation, and authority-violating fixture output', async () => {
    expect(parseFixtureResult({ status: 'SUCCESS' })).toBeNull();
    const result = await run('HOSTILE_EVIDENCE');
    const original = result.blackboard.positions[0]!;
    const fabricatedEvidenceId = 'EV-999' as typeof original.evidence_ids[number];
    const fabricated = { ...original, evidence_ids: [fabricatedEvidenceId], claims: original.claims.map((claim) => ({ ...claim, evidence_ids: [fabricatedEvidenceId] })) };
    expect(() => assertPositionValid(fabricated, result.blackboard.case!, result.blackboard.evidence_package!)).toThrow(SwarmProtocolError);
    const authority = { ...original, conclusion: 'Approve deployment and declare it legally compliant.' };
    expect(() => assertPositionValid(authority, result.blackboard.case!, result.blackboard.evidence_package!)).toThrow(SwarmProtocolError);
  });

  test('enforces challenge and invocation budgets without hidden loops', async () => {
    const boundedChallenges = buildGoldenScenario('CONTRADICTION');
    const limitedCase = { ...boundedChallenges.case, policy: { ...boundedChallenges.case.policy, max_challenges: 1 } };
    const limited = await runOfflineSwarmCase({ ...boundedChallenges, case: limitedCase });
    expect(limited.blackboard.challenges).toHaveLength(1);
    const boundedInvocations = buildGoldenScenario('SUPPORTED_RISK');
    const noSynthesisBudget = { ...boundedInvocations.case, policy: { ...boundedInvocations.case.policy, max_provider_calls: 4 } };
    await expect(runOfflineSwarmCase({ ...boundedInvocations, case: noSynthesisBudget })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });
});
