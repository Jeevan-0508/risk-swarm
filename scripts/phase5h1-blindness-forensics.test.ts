import { describe, expect, test } from 'bun:test';
import { evaluateRound1Blindness, type Round1BlindnessAttestation } from './phase5h1-blindness-forensics';
import { buildPhase5GoldenScenario } from '../src/swarm/evaluation/scenarios';
import { runOfflineAdversarialDeliberation } from '../src/swarm/engine/offline';

const blind = (overrides: Partial<Round1BlindnessAttestation> = {}): Round1BlindnessAttestation => ({
  seat_id: 'APOLLO',
  round: 1,
  peer_position_count: 0,
  peer_position_ids: [],
  peer_context_present: false,
  peer_reasoning_present: false,
  evidence_fingerprint: 'fnv1a:evidence',
  request_context_fingerprint: 'fnv1a:context',
  seat_contract_version: 'APOLLO_PROMPT_V1',
  ...overrides,
});

describe('Phase 5H.1 Round-1 blindness forensics', () => {
  test('A valid Apollo position with an explicit blind attestation passes blindness independently', () => {
    expect(evaluateRound1Blindness(blind(), 'fnv1a:evidence')).toBe('PASS');
  });

  test('B valid position with actual peer context fails blindness', () => {
    expect(evaluateRound1Blindness(blind({ peer_position_count: 1, peer_position_ids: ['position-athena-1'], peer_context_present: true }), 'fnv1a:evidence')).toBe('FAIL');
  });

  test('C invalid Apollo DTO does not by itself fail a separately attested blind context', () => {
    expect(evaluateRound1Blindness(blind(), 'fnv1a:evidence')).toBe('PASS');
  });

  test('D missing blindness evidence is unverifiable and remains certification-failing', () => {
    expect(evaluateRound1Blindness(undefined, 'fnv1a:evidence')).toBe('UNVERIFIABLE');
  });

  test('E later Apollo audit state does not retroactively change Round-1 blindness', () => {
    expect(evaluateRound1Blindness(blind(), 'fnv1a:evidence')).toBe('PASS');
  });

  test('F completion order does not matter when no peer context was supplied', () => {
    expect(evaluateRound1Blindness(blind({ request_context_fingerprint: 'fnv1a:context-after-peer-completion' }), 'fnv1a:evidence')).toBe('PASS');
  });

  test('G structured peer positions fail blindness even without hidden reasoning', () => {
    expect(evaluateRound1Blindness(blind({ peer_position_count: 1, peer_position_ids: ['position-athena-1'], peer_context_present: true, peer_reasoning_present: false }), 'fnv1a:evidence')).toBe('FAIL');
  });

  test('future offline/live request reservations persist four pre-request blind attestations without peer content', async () => {
    const observations: Array<{ readonly lifecycle: string; readonly operation: string; readonly round1_context_attestation?: Round1BlindnessAttestation }> = [];
    await runOfflineAdversarialDeliberation({ ...buildPhase5GoldenScenario(), request_observer: { observe: (observation) => observations.push(observation) } });
    const round1 = observations.filter((observation) => observation.lifecycle === 'RESERVED' && observation.operation === 'ROUND1_ANALYSIS');
    expect(round1).toHaveLength(4);
    expect(round1.every((observation) => evaluateRound1Blindness(observation.round1_context_attestation, observation.round1_context_attestation!.evidence_fingerprint) === 'PASS')).toBe(true);
    expect(round1.every((observation) => observation.round1_context_attestation?.peer_position_count === 0 && observation.round1_context_attestation?.peer_position_ids.length === 0)).toBe(true);
  });
});
