import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPhase5GoldenScenario } from '../src/swarm/evaluation/scenarios';
import { planPhase5Challenges } from '../src/swarm/debate/challenges';
import { runOfflineAdversarialDeliberation } from '../src/swarm/engine/offline';
import { sealEvidence } from '../src/swarm/evidence/package';
import {
  Phase5gArtifactSession,
  Phase5gCertificationArtifactSchema,
  certifyPhase5gArtifact,
  loadPhase5gArtifact,
  replayPhase5gArtifact,
  scanPhase5gSecrets,
} from './phase5g-durable-artifact';

function fixtureSession(directory: string) {
  const scenario = buildPhase5GoldenScenario();
  const packageValue = sealEvidence(scenario.case, scenario.evidence, { package_id: scenario.package_id, sealed_at: scenario.sealed_at });
  const session = new Phase5gArtifactSession({
    provider: 'mock',
    model: 'phase5g-offline-mock',
    case_value: scenario.case as unknown as Record<string, unknown>,
    evidence_package: packageValue as unknown as Record<string, unknown>,
    global_budget: 11,
    max_output_tokens: 4096,
  }, { directory, now: () => '2026-01-01T00:00:00.000Z', run_id: 'phase5g-test-run' });
  return { scenario, packageValue, session };
}

async function executePersistedGoldenRound(directory: string) {
  const { scenario, session } = fixtureSession(directory);
  const result = await runOfflineAdversarialDeliberation({
    ...scenario,
    request_observer: session,
    event_observer: (event) => session.observeEvent(event),
    challenge_generator: { generate: async (input) => planPhase5Challenges(input.positions, input.disagreements, input.case) },
  });
  session.finalize(result);
  return loadPhase5gArtifact(session.artifact_path);
}

describe('Phase 5G durable certification artifacts', () => {
  test('golden full round survives process-memory discard and replays from the saved artifact only', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-phase5g-golden-'));
    try {
      const artifact = await executePersistedGoldenRound(directory);
      const certification = certifyPhase5gArtifact(artifact);
      expect(artifact.execution_status).toBe('COMPLETED');
      expect(artifact.certification_candidate_status).toBe('YES');
      expect(artifact.budgets).toMatchObject({ round1_request_count: 4, challenge_generation_request_count: 1, zeus_request_count: 0 });
      expect(Number(artifact.budgets.challenge_response_request_count)).toBeGreaterThan(0);
      expect(artifact.request_ledger).toHaveLength(Number(artifact.budgets.total_request_count));
      const round1Attestations = artifact.request_ledger.filter((entry) => entry.operation === 'ROUND1_ANALYSIS').map((entry) => entry.round1_context_attestation);
      expect(round1Attestations).toHaveLength(4);
      expect(round1Attestations.every((attestation) => attestation?.peer_position_count === 0 && attestation.peer_position_ids.length === 0 && attestation.peer_context_present === false && attestation.peer_reasoning_present === false)).toBe(true);
      expect(artifact.round1.positions_locked).toBe(true);
      expect(artifact.round1.position_immutability).toBe('PASS');
      expect(artifact.evidence.fingerprint_before).toBe(artifact.evidence.fingerprint_after);
      expect(artifact.execution_events.every((event) => event.run_id === artifact.run_id)).toBe(true);
      expect(certification).toMatchObject({ ok: true, request_ledger_reconciliation: true, event_ordering: true, secret_scan: true, hidden_reasoning_scan: true, replayable: true });
      const replayed = replayPhase5gArtifact(artifact);
      expect(replayed.positions.filter((position) => position.round === 1).length).toBe(artifact.round1.seats.length);
      expect(replayed.human_decision).toBeNull();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('every reserved request is ledger-backed before completion and exact 4+1+1 accounting is reconstructable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-phase5g-ledger-'));
    try {
      const { session } = fixtureSession(directory);
      for (const [operation, seat] of [['ROUND1_ANALYSIS', 'ATHENA'], ['ROUND1_ANALYSIS', 'ARES'], ['ROUND1_ANALYSIS', 'HADES'], ['ROUND1_ANALYSIS', 'APOLLO'], ['CHALLENGE_GENERATION', 'ARES'], ['CHALLENGE_RESPONSE', 'ATHENA']] as const) {
        const request_id = `request-${operation}-${seat}`;
        session.observeRequest({ lifecycle: 'RESERVED', operation, request_id, seat_id: seat, invocation: session.current().request_ledger.length + 1 });
        expect(session.current().request_ledger.some((entry) => entry.request_id === request_id && entry.request_status === 'REQUEST_IN_FLIGHT')).toBe(true);
        session.observeRequest({ lifecycle: 'COMPLETED', operation, request_id, seat_id: seat, invocation: session.current().request_ledger.length, result: { status: 'SUCCESS' } });
      }
      expect(session.current().budgets).toMatchObject({ round1_request_count: 4, challenge_generation_request_count: 1, challenge_response_request_count: 1, zeus_request_count: 0, total_request_count: 6 });
      expect(session.current().request_ledger.every((entry) => entry.retry_index === 0 && entry.fallback_used === false)).toBe(true);

      const accountingPattern = (responseCount: number) => {
        const patternDirectory = mkdtempSync(join(tmpdir(), `swarm-phase5g-${responseCount}-`));
        try {
          const { session: patternSession } = fixtureSession(patternDirectory);
          const operations = [
            ...(['ATHENA', 'ARES', 'HADES', 'APOLLO'] as const).map((seat, index) => ['ROUND1_ANALYSIS' as const, seat, index + 1] as const),
            ['CHALLENGE_GENERATION' as const, 'ARES' as const, 5] as const,
            ...Array.from({ length: responseCount }, (_, index) => ['CHALLENGE_RESPONSE' as const, 'ATHENA' as const, index + 6] as const),
          ];
          for (const [operation, seat, invocation] of operations) {
            const request_id = `pattern-${operation}-${invocation}`;
            patternSession.observe({ lifecycle: 'RESERVED', operation, request_id, seat_id: seat, invocation });
            patternSession.observe({ lifecycle: 'COMPLETED', operation, request_id, seat_id: seat, invocation, result: { status: 'SUCCESS' } });
          }
          return patternSession.current().budgets;
        } finally { rmSync(patternDirectory, { recursive: true, force: true }); }
      };
      expect(accountingPattern(1)).toMatchObject({ round1_request_count: 4, challenge_generation_request_count: 1, challenge_response_request_count: 1, total_request_count: 6 });
      expect(accountingPattern(2)).toMatchObject({ round1_request_count: 4, challenge_generation_request_count: 1, challenge_response_request_count: 2, total_request_count: 7 });
      expect(accountingPattern(0)).toMatchObject({ round1_request_count: 4, challenge_generation_request_count: 1, challenge_response_request_count: 0, total_request_count: 5 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('failure checkpoints remain valid and never masquerade as completed artifacts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-phase5g-failure-'));
    try {
      const { session } = fixtureSession(directory);
      session.observeRequest({ lifecycle: 'RESERVED', operation: 'ROUND1_ANALYSIS', request_id: 'failed-round1', seat_id: 'ATHENA', invocation: 1 });
      session.observeRequest({ lifecycle: 'FAILED', operation: 'ROUND1_ANALYSIS', request_id: 'failed-round1', seat_id: 'ATHENA', invocation: 1, error_code: 'RESPONSE_PARSE_ERROR' });
      const persisted = loadPhase5gArtifact(session.artifact_path);
      expect(persisted.execution_status).toBe('IN_PROGRESS');
      expect(persisted.certification_candidate_status).toBe('NO');
      expect(persisted.request_ledger[0]).toMatchObject({ request_status: 'REQUEST_FAILED', failure_code: 'RESPONSE_PARSE_ERROR' });
      expect(Phase5gCertificationArtifactSchema.safeParse(JSON.parse(readFileSync(session.artifact_path, 'utf8'))).success).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('failure durability matrix preserves non-complete status for all required bounded failure classes', () => {
    const failureCodes = ['PROVIDER_REQUEST_FAILURE', 'MALFORMED_STRUCTURED_OUTPUT', 'CHALLENGE_GENERATION_FAILURE', 'CHALLENGE_RESPONSE_FAILURE', 'REVISION_REJECTED', 'PRIVACY_BOUNDARY_FAILURE', 'BUDGET_OVERFLOW', 'APOLLO_BLOCKER', 'ZEUS_READINESS_FAILURE'] as const;
    for (const [index, failureCode] of failureCodes.entries()) {
      const directory = mkdtempSync(join(tmpdir(), `swarm-phase5g-failure-matrix-${index}-`));
      try {
        const { session } = fixtureSession(directory);
        session.markFailed(new Error(failureCode));
        const persisted = loadPhase5gArtifact(session.artifact_path);
        expect(persisted.execution_status).toBe('FAILED');
        expect(persisted.certification_candidate_status).toBe('NO');
        expect(persisted.replay_metadata.failure_code).toBe(failureCode);
      } finally { rmSync(directory, { recursive: true, force: true }); }
    }
    const interruptedDirectory = mkdtempSync(join(tmpdir(), 'swarm-phase5g-interrupted-'));
    try {
      const { session } = fixtureSession(interruptedDirectory);
      session.markInterrupted();
      const persisted = loadPhase5gArtifact(session.artifact_path);
      expect(persisted.execution_status).toBe('INTERRUPTED');
      expect(persisted.certification_candidate_status).toBe('NO');
      expect(persisted.replay_metadata.interrupted).toBe(true);
    } finally { rmSync(interruptedDirectory, { recursive: true, force: true }); }
  });

  test('nested secret and hidden-reasoning scans fail closed', () => {
    expect(scanPhase5gSecrets({ safe: { nested: { authorization: 'Bearer abcdefghijk' } } })).toBe(true);
    expect(scanPhase5gSecrets({ safe: { nested: { reasoning_content: 'hidden' } } })).toBe(true);
    expect(scanPhase5gSecrets({ safe: { value: 'ordinary structured protocol metadata' } })).toBe(false);
  });

  test('Zeus cannot enter the Phase 5 ledger or replayed event sequence', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-phase5g-zeus-'));
    try {
      const artifact = await executePersistedGoldenRound(directory);
      expect(artifact.zeus_readiness).toMatchObject({ enabled: false, called: false, request_count: 0 });
      expect(artifact.execution_events.some((event) => event.event_type.startsWith('SYNTHESIS'))).toBe(false);
      expect(artifact.execution_events.some((event) => event.status_metadata.actor === 'ZEUS')).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
