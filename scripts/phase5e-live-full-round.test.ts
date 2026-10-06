import { describe, expect, test } from 'bun:test';
import { AgentPositionSchema, Phase5ChallengeResponseSchema, Phase5ChallengeSchema } from '../src/swarm/contracts';
import { allowedChallengeTypesForDisagreement, challengeDuplicateIdentity, challengeTypeCompatible, planPhase5Challenges } from '../src/swarm/debate/challenges';
import { buildChallengeInput } from '../src/swarm/debate/challenges';
import { buildRound1SeatInput, replaySwarmEvents } from '../src/swarm/engine/reducer';
import { parseFixtureResult, unavailableExecution } from '../src/swarm/engine/executor';
import { runOfflineAdversarialDeliberation } from '../src/swarm/engine/offline';
import { buildGoldenScenario, buildPhase5GoldenScenario } from '../src/swarm/evaluation/scenarios';
import { stableStringify } from '../src/swarm/evidence/package';
import { assertPositionValid } from '../src/swarm/governance/verifier';
import { SEAT_CHALLENGE_SCHEMA } from '../src/swarm/seats/validation';
import {
  PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET,
  PHASE5E_MAX_CHALLENGE_RESPONSE_REQUEST_BUDGET,
  PHASE5E_MAX_OUTPUT_TOKENS,
  PHASE5E_ROUND1_REQUEST_BUDGET,
  Phase5eBudgetLedger,
  phase5eArtifactContainsSensitiveMaterial,
  phase5eAuthorizationGate,
  phase5eFailureInjectionCoverage,
  phase5ePreflight,
  phase5eRound2PrivacyBoundary,
  preparePhase5eLiveRound,
  Phase5eExecutionState,
  runPhase5eCli,
  replayPhase5eArtifact,
  runPhase5eOfflineGoldenRound,
} from './phase5e-live-full-round';

const AUTHORIZED_OFFLINE_ENV = {
  SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096',
  SWARM_COUNCIL_PROVIDER: 'xai',
  SWARM_COUNCIL_MODEL: 'grok-4.7',
  XAI_API_KEY: 'offline-placeholder-not-a-credential',
  SWARM_LIVE_FULL_ADVERSARIAL_CONFIRM: 'YES',
};

describe('Phase 5E full bounded adversarial round preparation', () => {
  test('dedicated authorization is independent and blocks all calls without exact confirmation', () => {
    expect(phase5eAuthorizationGate({ ...AUTHORIZED_OFFLINE_ENV, SWARM_LIVE_FULL_ADVERSARIAL_CONFIRM: 'NO' }).status).toBe('BLOCKED');
    expect(phase5eAuthorizationGate(AUTHORIZED_OFFLINE_ENV).status).toBe('PASS');
    expect(preparePhase5eLiveRound({ ...AUTHORIZED_OFFLINE_ENV, SWARM_LIVE_FULL_ADVERSARIAL_CONFIRM: 'NO' })).toMatchObject({ full_round: 'NOT_RUN', live_network_calls: 0, live_provider_calls: 0, real_model_calls: 0, authorization_gate: 'BLOCKED' });
    const ledger = new Phase5eBudgetLedger(PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET);
    expect(ledger.stats()).toMatchObject({ attempted: 0, admitted: 0, blocked: 0 });
  });

  test('preflight exposes the bounded 4096-token budget and global ceiling', () => {
    const preflight = phase5ePreflight(AUTHORIZED_OFFLINE_ENV);
    expect(preflight.full_round_authorization_gate).toBe('PASS');
    expect(preflight.max_output_tokens).toBe(PHASE5E_MAX_OUTPUT_TOKENS);
    expect(preflight.round1_request_budget).toBe(4);
    expect(preflight.challenge_generation_request_budget).toBe(1);
    expect(preflight.max_challenge_response_request_budget).toBe(PHASE5E_MAX_CHALLENGE_RESPONSE_REQUEST_BUDGET);
    expect(preflight.global_provider_request_budget).toBe(PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET);
    expect(preflight.retry_disabled).toBe(true);
    expect(preflight.fallback_disabled).toBe(true);
    expect(preflight.zeus_enabled).toBe(false);
    expect(preflight.human_decision).toBe('PENDING');
  });

  test('round-one inputs are blind and the four-seat request ceiling is explicit', async () => {
    const scenario = buildPhase5GoldenScenario();
    const result = await runOfflineAdversarialDeliberation(scenario);
    const sealedIndex = result.events.findIndex((event) => event.type === 'EVIDENCE_SEALED');
    const sealedState = replaySwarmEvents(result.events.slice(0, sealedIndex + 1));
    for (const seat of ['ATHENA', 'ARES', 'HADES', 'APOLLO'] as const) {
      const input = buildRound1SeatInput(sealedState, seat);
      expect(input).not.toHaveProperty('positions');
      expect(input).not.toHaveProperty('disagreements');
      expect(input).not.toHaveProperty('challenges');
      expect(input.evidence_package.package_hash).toBe(sealedState.evidence_package!.package_hash);
    }
    expect(result.events.filter((event) => event.type === 'SEAT_STARTED')).toHaveLength(PHASE5E_ROUND1_REQUEST_BUDGET);
    expect(result.executor_invocations).toBe(8);
  });

  test('golden offline composition reaches the required stop boundary with immutable evidence', async () => {
    const report = await runPhase5eOfflineGoldenRound(AUTHORIZED_OFFLINE_ENV);
    expect(report.evidence_immutability).toBe(true);
    expect(report.round1_position_immutability).toBe(true);
    expect(report.zeus_readiness).toBe(true);
    expect(report.stopped_before_synthesis).toBe(true);
    expect(report.result.blackboard.state).toBe('AUDIT');
    expect(report.result.blackboard.human_decision).toBeNull();
    expect(report.result.events.some((event) => event.type === 'ZEUS_READINESS_EVALUATED')).toBe(true);
    expect(report.result.events.some((event) => event.type === 'ROUND_STOPPED')).toBe(true);
    expect(report.result.events.some((event) => event.actor === 'ZEUS')).toBe(false);
    expect(report.budget).toMatchObject({ maximum: 11, attempted: 9, admitted: 9, blocked: 0 });
  });

  test('ARES challenge selection is deterministic, compatible, bounded, and uniquely identified', async () => {
    const report = await runPhase5eOfflineGoldenRound(AUTHORIZED_OFFLINE_ENV);
    const first = report.result.blackboard.challenges;
    const round1 = report.result.events.filter((event): event is Extract<typeof event, { type: 'POSITION_PROPOSED' }> => event.type === 'POSITION_PROPOSED').map((event) => event.position);
    const disagreements = report.result.events.filter((event): event is Extract<typeof event, { type: 'DISAGREEMENT_IDENTIFIED' }> => event.type === 'DISAGREEMENT_IDENTIFIED').map((event) => event.disagreement);
    const second = planPhase5Challenges(round1, disagreements, report.result.blackboard.case!);
    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(first.every((challenge) => challenge.from_seat === 'ARES')).toBe(true);
    expect(first.every((challenge) => challengeTypeCompatible(report.result.blackboard.disagreements.find((item) => item.disagreement_id === challenge.disagreement_id)!.type, challenge.challenge_type))).toBe(true);
    expect(new Set(first.map(challengeDuplicateIdentity)).size).toBe(first.length);
    expect(first.length).toBeLessThanOrEqual(6);
    expect(first.every((challenge) => Phase5ChallengeSchema.safeParse(challenge).success)).toBe(true);
  });

  test('challenge responses are routed to the target seat with a narrow Round-2 privacy boundary', async () => {
    const report = await runPhase5eOfflineGoldenRound(AUTHORIZED_OFFLINE_ENV);
    for (const challenge of report.result.blackboard.challenges) {
      expect(['ATHENA', 'HADES', 'APOLLO']).toContain(challenge.to_seat);
      expect(challenge.from_seat).not.toBe(challenge.to_seat);
      const input = buildChallengeInput(report.result.blackboard, challenge);
      expect(input.prior_position.position_id).toBe(challenge.target_position);
      expect(input).not.toHaveProperty('all_positions');
      expect(input).not.toHaveProperty('peer_reasoning');
      expect(input).not.toHaveProperty('zeus_context');
      expect(input).not.toHaveProperty('human_decision_context');
      expect(phase5eRound2PrivacyBoundary(input)).toBe(true);
      expect(phase5eRound2PrivacyBoundary({ ...input, peer_reasoning: 'must be blocked' })).toBe(false);
    }
    expect(report.challenge_response_requests_attempted).toBe(report.result.blackboard.challenges.length);
    expect(report.challenge_response_requests_attempted).toBeLessThanOrEqual(PHASE5E_MAX_CHALLENGE_RESPONSE_REQUEST_BUDGET);
  });

  test('response, revision, reevaluation, false-consensus, and audit gates remain truthful', async () => {
    const report = await runPhase5eOfflineGoldenRound(AUTHORIZED_OFFLINE_ENV);
    const state = report.result.blackboard;
    expect(state.challenge_responses.every((response) => Phase5ChallengeResponseSchema.safeParse(response).success)).toBe(true);
    expect(state.revisions.length).toBeGreaterThan(0);
    expect(state.revisions.every((revision) => state.challenges.some((challenge) => challenge.challenge_id === revision.triggering_challenge_id))).toBe(true);
    expect(state.disagreements.some((item) => item.unresolved && item.status !== 'RESOLVED')).toBe(true);
    expect(state.audit_findings.some((finding) => finding.status === 'BLOCKED')).toBe(false);
    expect(state.audit_findings.some((finding) => finding.check_id === 'unresolved_disagreement_preservation')).toBe(true);
    expect(report.result.events.some((event) => event.type === 'REVISIONS_LOCKED')).toBe(true);
    expect(report.result.events.some((event) => event.type === 'DISAGREEMENTS_REEVALUATED')).toBe(true);
  });

  test('safe artifact capture contains replayable domain events but no secret or raw-provider material', async () => {
    const report = await runPhase5eOfflineGoldenRound(AUTHORIZED_OFFLINE_ENV);
    expect(phase5eArtifactContainsSensitiveMaterial(report.artifact)).toBe(false);
    expect(report.artifact.replay_event_log.length).toBe(report.result.events.length);
    expect(stableStringify(replayPhase5eArtifact(report.artifact))).toBe(stableStringify(report.result.blackboard));
    expect(report.artifact.zeus_called).toBe(false);
    expect(report.artifact.human_decision).toBe('PENDING');
  });

  test('global request ledger fails closed on overflow and does not retry or fallback', () => {
    const ledger = new Phase5eBudgetLedger(2);
    expect(ledger.attempt()).toBe(true);
    expect(ledger.attempt()).toBe(true);
    expect(ledger.attempt()).toBe(false);
    expect(ledger.stats()).toMatchObject({ maximum: 2, attempted: 2, admitted: 2, blocked: 1 });
  });

  test('failure-injection matrix is explicitly represented without recovery or fabrication', async () => {
    const coverage = phase5eFailureInjectionCoverage();
    expect(Object.keys(coverage)).toHaveLength(23);
    expect(Object.values(coverage).every(Boolean)).toBe(true);

    const unavailable = await runOfflineAdversarialDeliberation(buildGoldenScenario('ONE_SEAT_UNAVAILABLE'));
    expect(unavailable.blackboard.positions.length).toBeLessThan(4);
    expect(unavailable.events.some((event) => event.type === 'SEAT_UNAVAILABLE' || event.type === 'SEAT_FAILED' || event.type === 'SEAT_REJECTED')).toBe(true);
    expect(parseFixtureResult({ status: 'SUCCESS', execution: unavailableExecution(), position: '{invalid-json' })).toBeNull();
    expect(Phase5ChallengeResponseSchema.safeParse({ action: 'REVISE' }).success).toBe(false);
  });

  test('semantic and authority failures remain rejected', async () => {
    const report = await runPhase5eOfflineGoldenRound(AUTHORIZED_OFFLINE_ENV);
    const position = report.result.blackboard.positions.find((candidate) => candidate.round === 1)!;
    expect(AgentPositionSchema.safeParse({ ...position, position_id: undefined }).success).toBe(false);
    expect(() => assertPositionValid({ ...position, evidence_ids: ['unknown-evidence'] as never }, report.result.blackboard.case!, report.result.blackboard.evidence_package!)).toThrow();
    expect(SEAT_CHALLENGE_SCHEMA.validate({ action: 'REVISE', revision_id: 'spoofed', case_id: 'spoofed', challenge_id: 'spoofed', responding_seat: 'ATHENA' }).success).toBe(false);
  });

  test('no-material-disagreement and generation-failure paths do not fabricate challenges', async () => {
    const scenario = buildGoldenScenario('SUPPORTED_RISK');
    expect(planPhase5Challenges([], [], scenario.case)).toEqual([]);
    const failedGeneration = await runOfflineAdversarialDeliberation({
      ...buildPhase5GoldenScenario(),
      challenge_generator: { async generate() { throw new Error('INJECTED_CHALLENGE_GENERATION_FAILURE'); } },
    }).catch((error) => error);
    expect(failedGeneration).toBeInstanceOf(Error);
    expect((failedGeneration as Error).message).toContain('INJECTED_CHALLENGE_GENERATION_FAILURE');
  });

  test('configuration without 4096 is blocked for the future full round and makes no live claim', () => {
    const preflight = phase5ePreflight({ ...AUTHORIZED_OFFLINE_ENV, SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '1600' });
    expect(preflight.full_round_authorization_gate).toBe('BLOCKED');
    expect(preflight.errors).toContain('full round requires max output budget 4096');
  });

  test('CLI direct-entry behavior is visible, single-invocation guarded, and zero-call without authorization', async () => {
    const lines: string[] = [];
    const invocation_state = { count: 0 };
    const first = await runPhase5eCli({ env: { ...AUTHORIZED_OFFLINE_ENV, SWARM_LIVE_FULL_ADVERSARIAL_CONFIRM: 'NO' }, write: (line) => lines.push(line), invocation_state, install_signal_handler: false });
    const second = await runPhase5eCli({ env: { ...AUTHORIZED_OFFLINE_ENV, SWARM_LIVE_FULL_ADVERSARIAL_CONFIRM: 'NO' }, write: (line) => lines.push(line), invocation_state, install_signal_handler: false });
    expect(first.exit_code).toBe(0);
    expect(first.invocation_count).toBe(1);
    expect(second.exit_code).toBe(2);
    expect(lines).toContain('LIVE_FULL_ADVERSARIAL_ROUND=NOT_RUN');
    expect(lines).toContain('FULL_ROUND_AUTHORIZATION_GATE=FAIL');
    expect(lines).toContain('LIVE_PROVIDER_CALLS=0');
    expect(lines).toContain('CLI_INVOCATION_GUARD=FAIL');
  });

  test('authorized CLI emits complete preflight before an injected offline runner', async () => {
    const lines: string[] = [];
    let runnerSawPreflight = false;
    const offline = await runPhase5eOfflineGoldenRound(AUTHORIZED_OFFLINE_ENV);
    const result = await runPhase5eCli({
      env: AUTHORIZED_OFFLINE_ENV,
      write: (line) => lines.push(line),
      install_signal_handler: false,
      live_runner: async (_env, state) => {
        runnerSawPreflight = lines.includes('REQUEST_PRECHECK=PASS');
        return { result: offline.result, artifact: offline.artifact, budget: offline.budget, checkpoint: state.snapshot() };
      },
    });
    expect(result.exit_code).toBe(0);
    expect(runnerSawPreflight).toBe(true);
    expect(lines[0]).toBe('SWARM_2_PHASE_5E_LIVE_PREFLIGHT');
    expect(lines).toContain('REQUESTED_MAX_OUTPUT_TOKENS=4096');
    expect(lines).toContain('EFFECTIVE_MAX_OUTPUT_TOKENS=4096');
    expect(lines).toContain('REQUEST_PRECHECK=PASS');
  });

  test('preflight failures make zero calls and remain visible', async () => {
    const cases = [
      { name: 'missing credential', env: { ...AUTHORIZED_OFFLINE_ENV, XAI_API_KEY: undefined } },
      { name: 'token mismatch', env: { ...AUTHORIZED_OFFLINE_ENV, SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '1600' } },
      { name: 'provider mismatch', env: { ...AUTHORIZED_OFFLINE_ENV, SWARM_COUNCIL_PROVIDER: 'gemini' } },
      { name: 'model mismatch', env: { ...AUTHORIZED_OFFLINE_ENV, SWARM_COUNCIL_MODEL: 'wrong-model' } },
      { name: 'Zeus unexpectedly enabled', env: { ...AUTHORIZED_OFFLINE_ENV, SWARM_ENABLE_ZEUS: 'YES' } },
    ];
    for (const item of cases) {
      const lines: string[] = [];
      let calls = 0;
      const result = await runPhase5eCli({ env: item.env, write: (line) => lines.push(line), install_signal_handler: false, live_runner: async () => { calls += 1; throw new Error('MUST_NOT_RUN'); } });
      expect(result.exit_code, item.name).toBe(2);
      expect(calls, item.name).toBe(0);
      expect(lines.some((line) => line.startsWith('PREFLIGHT_FAILURE_REASON=')), item.name).toBe(true);
      expect(lines).toContain('LIVE_FULL_ADVERSARIAL_ROUND=NOT_RUN');
      expect(lines).toContain('LIVE_PROVIDER_CALLS=0');
    }
  });

  test('top-level failure is visible with a sanitized code and no secret leakage', async () => {
    const secret = 'synthetic-secret-must-not-print';
    const lines: string[] = [];
    const result = await runPhase5eCli({ env: AUTHORIZED_OFFLINE_ENV, write: (line) => lines.push(line), install_signal_handler: false, live_runner: async () => { throw new Error(`${secret}: transport failure`); } });
    expect(result.exit_code).toBe(1);
    expect(lines).toContain('FULL_BOUNDED_LIVE_ADVERSARIAL_ROUND=FAILED');
    expect(lines).toContain('SANITIZED_ERROR_CODE=TRANSPORT_FAILURE');
    expect(lines.join('\n')).not.toContain(secret);
  });

  test('interruption checkpoint distinguishes in-flight request from completed artifact validation', () => {
    const state = new Phase5eExecutionState();
    expect(state.snapshot()).toMatchObject({ request_status: 'NO_REQUEST_STARTED', requests_attempted: 0, artifact_validation_completed: false });
    state.requestStarted();
    state.markInterrupted();
    expect(state.snapshot()).toMatchObject({ request_status: 'REQUEST_IN_FLIGHT', requests_attempted: 1, interrupted: true, artifact_validation_completed: false });
    state.requestCompleted();
    state.markArtifactValidationCompleted();
    expect(state.snapshot()).toMatchObject({ request_status: 'REQUEST_COMPLETED', requests_completed: 1, artifact_validation_completed: true });
  });
});
