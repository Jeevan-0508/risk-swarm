import { describe, expect, test } from 'bun:test';
import { buildCertifiedPhase6Scenario } from '../evaluation/scenarios';
import { runOfflineAdversarialDeliberation } from '../engine/offline';
import { runOfflineZeusSynthesis } from '../engine/zeus';
import { buildCouncilViewModel, SWARM_SEAT_LAYOUT } from './view-model';

describe('SWARM Council Chamber view-model', () => {
  test('uses stable five-seat geometry and renders protocol state from canonical events', async () => {
    const phase5 = await runOfflineAdversarialDeliberation(buildCertifiedPhase6Scenario());
    const phase6 = await runOfflineZeusSynthesis(phase5);
    const model = buildCouncilViewModel(phase6.blackboard, phase6.events, 'REPLAY');
    expect(model.seats.map((seat) => seat.seat_id)).toEqual(['ATHENA', 'ARES', 'HADES', 'APOLLO', 'ZEUS']);
    expect(model.seats.map((seat) => seat.layout)).toEqual(Object.values(SWARM_SEAT_LAYOUT));
    expect(model.seats.find((seat) => seat.seat_id === 'ZEUS')?.state).toBe('HUMAN REVIEW REQUIRED');
    expect(model.evidence_core.open_disagreement_count).toBe(4);
    expect(model.challenges.map((challenge) => challenge.response)).toEqual(['DEFEND', 'REVISE']);
    expect(model.revisions).toHaveLength(1);
    expect(model.timeline.at(-1)?.type).toBe('HUMAN_REVIEW_REQUIRED');
  });

  test('does not invent activity for an empty blackboard', async () => {
    const { emptySwarmBlackboard } = await import('../engine/reducer');
    const model = buildCouncilViewModel(emptySwarmBlackboard(), [], 'REPLAY');
    expect(model.phase).toBe('IDLE');
    expect(model.evidence_core.evidence_count).toBe(0);
    expect(model.timeline).toHaveLength(0);
    expect(model.seats.every((seat) => seat.state === 'DORMANT')).toBe(true);
  });
});
