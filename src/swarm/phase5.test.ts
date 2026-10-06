import { describe, expect, test } from 'bun:test';
import {
  ChallengeResponseSchema,
  Phase5ChallengeResponseSchema,
  Phase5ChallengeSchema,
  type ChallengeResponse,
} from './contracts';
import { Phase5ChallengeGenerationOutputSchema } from './models/challenge-generator';
import { buildChallengeInput } from './debate/challenges';
import { buildPhase5GoldenScenario } from './evaluation/scenarios';
import { runOfflineAdversarialDeliberation } from './engine/offline';
import { replaySwarmEvents } from './engine/reducer';
import { stableStringify } from './evidence/package';

describe('SWARM 2.0 Phase 5 bounded adversarial deliberation', () => {
  test('runs the required protocol and never calls Zeus or synthesizes', async () => {
    const result = await runOfflineAdversarialDeliberation(buildPhase5GoldenScenario());
    expect(result.blackboard.state).toBe('AUDIT');
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'POSITIONS_LOCKED', 'DISAGREEMENTS_FINALIZED', 'CHALLENGE_ROUND_STARTED',
      'CHALLENGE_GENERATION_STARTED', 'CHALLENGES_GENERATED', 'REVISIONS_LOCKED',
      'DISAGREEMENTS_REEVALUATED', 'AUDIT_STARTED', 'AUDIT_COMPLETED',
      'POST_CHALLENGE_AUDIT_COMPLETED', 'ZEUS_READINESS_EVALUATED',
    ]));
    expect(result.events.some((event) => event.type === 'SYNTHESIS_STARTED')).toBe(false);
    expect(result.events.some((event) => event.actor === 'ZEUS')).toBe(false);
    expect(result.blackboard.synthesis).toBeNull();
  });

  test('ARES is the sole challenger and routing is targeted and bounded', async () => {
    const result = await runOfflineAdversarialDeliberation(buildPhase5GoldenScenario());
    expect(result.blackboard.challenges.length).toBeGreaterThan(0);
    expect(result.blackboard.challenges.length).toBeLessThanOrEqual(6);
    expect(result.blackboard.challenges.every((challenge) => challenge.from_seat === 'ARES')).toBe(true);
    expect(result.blackboard.challenges.every((challenge) => ['ATHENA', 'HADES', 'APOLLO'].includes(challenge.to_seat))).toBe(true);
    expect(result.blackboard.challenges.every((challenge) => Phase5ChallengeSchema.safeParse(challenge).success)).toBe(true);
    expect(new Set(result.blackboard.challenges.map((challenge) => challenge.disagreement_id)).size).toBe(result.blackboard.challenges.length);
    expect(Math.max(...['ATHENA', 'HADES', 'APOLLO'].map((seat) => result.blackboard.challenges.filter((challenge) => challenge.to_seat === seat).length))).toBeLessThanOrEqual(3);
  });

  test('strict Challenge and ChallengeResponse contracts reject incomplete Phase 5 envelopes', async () => {
    const result = await runOfflineAdversarialDeliberation(buildPhase5GoldenScenario());
    const challenge = result.blackboard.challenges[0]!;
    const response = result.blackboard.challenge_responses[0]!;
    expect(Phase5ChallengeSchema.safeParse({ ...challenge, challenge_text: undefined }).success).toBe(false);
    expect(Phase5ChallengeResponseSchema.safeParse({ ...response, source_position: undefined }).success).toBe(false);
    expect(result.blackboard.challenge_responses.every((item) => Phase5ChallengeResponseSchema.safeParse(item).success)).toBe(true);
  });

  test('challenge privacy exposes the target position but no peer reasoning or Zeus context', async () => {
    const result = await runOfflineAdversarialDeliberation(buildPhase5GoldenScenario());
    const challenge = result.blackboard.challenges[0]!;
    const input = buildChallengeInput(result.blackboard, challenge);
    expect(input.prior_position.position_id).toBe(challenge.target_position);
    expect(input).not.toHaveProperty('all_positions');
    expect(input).not.toHaveProperty('peer_positions');
    expect(input).not.toHaveProperty('zeus_input');
    expect(input.opposing_excerpt.position_id).toBe(challenge.target_position);
  });

  test('executes meaningful defend/revise/concede/request-evidence/abstain actions as strict DTOs', () => {
    const base = {
      response_id: 'response-action' as ChallengeResponse['response_id'],
      case_id: 'case-action' as ChallengeResponse['case_id'],
      challenge_id: 'challenge-action' as ChallengeResponse['challenge_id'],
      responding_seat: 'ATHENA' as const,
      rationale: 'bounded rationale',
      evidence_ids: [],
      round: 1,
      source_position: 'position-athena-1' as ChallengeResponse['source_position'],
      revision_lineage: ['position-athena-1' as ChallengeResponse['source_position']],
    };
    for (const action of ['DEFEND', 'REVISE', 'CONCEDE', 'REQUEST_EVIDENCE', 'ABSTAIN'] as const) {
      const response = { ...base, action, revision_id: action === 'REVISE' || action === 'CONCEDE' ? 'revision-action' : null };
      expect(ChallengeResponseSchema.safeParse(response).success, action).toBe(true);
      expect(Phase5ChallengeResponseSchema.safeParse(response).success, action).toBe(true);
    }
  });

  test('preserves Round 1 immutability, revision lineage, evidence requests, and open disagreement', async () => {
    const result = await runOfflineAdversarialDeliberation(buildPhase5GoldenScenario());
    const round1 = result.events.filter((event): event is Extract<typeof event, { type: 'POSITION_PROPOSED' }> => event.type === 'POSITION_PROPOSED');
    expect(round1.every((event) => event.position.round === 1 && event.position.status === 'PROPOSED')).toBe(true);
    expect(result.blackboard.revisions.length).toBeGreaterThan(0);
    expect(result.blackboard.positions.some((position) => position.round === 2 && position.position_references.length > 0)).toBe(true);
    expect(result.blackboard.evidence_requests.length).toBeGreaterThan(0);
    expect(result.blackboard.disagreements.some((item) => item.status === 'OPEN')).toBe(true);
  });

  test('replays deterministically and records a truthful Zeus readiness gate', async () => {
    const first = await runOfflineAdversarialDeliberation(buildPhase5GoldenScenario());
    const second = await runOfflineAdversarialDeliberation(buildPhase5GoldenScenario());
    expect(stableStringify(first.events)).toBe(stableStringify(second.events));
    expect(stableStringify(replaySwarmEvents(first.events))).toBe(stableStringify(first.blackboard));
    const gate = first.events.find((event) => event.type === 'ZEUS_READINESS_EVALUATED');
    expect(gate?.type === 'ZEUS_READINESS_EVALUATED' ? gate.ready : false).toBe(true);
    expect(first.executor_invocations).toBe(8);
  });

  test('strict challenge-generation output has no credential or raw-response field', () => {
    const parsed = Phase5ChallengeGenerationOutputSchema.safeParse({ challenges: [], api_key: 'synthetic-secret', raw_response: 'model text' });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain('synthetic-secret');
  });
});
