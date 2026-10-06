import {
  AgentPositionSchema,
  ChallengeResponseSchema,
  EvidenceRequestSchema,
  ROUND1_SEAT_IDS,
  SWARM_PROTOCOL_VERSION,
  type EvidenceItem,
  type Challenge,
  type EvidenceRequest,
  type ModelExecution,
  type Round1SeatId,
  type SwarmBlackboard,
  type SwarmCase,
  type SwarmExecutionEvent,
} from '../contracts';
import type { Phase5ChallengeGenerationInput } from '../models/challenge-generator';
import { sealEvidence, stableStringify } from '../evidence/package';
import { deterministicPackageHash } from '../evidence/package';
import { runApolloDeterministicAudit } from '../governance/audit';
import { assessSynthesisReadiness, validateFixtureSynthesis, type SynthesisExecutor, type SynthesisInput } from '../governance/synthesis';
import { assertExecutionTruth, assertPositionValid, fail, SwarmProtocolError } from '../governance/verifier';
import { currentPositions, detectDisagreements, reevaluateDisagreements } from '../debate/disagreements';
import { buildChallengeInput, planChallenges, planPhase5Challenges, selectAndAdmitPhase5Challenges, type Phase5ChallengeAdmissionResult } from '../debate/challenges';
import { buildRound1SeatInput, emptySwarmBlackboard, participation, reduceSwarmEvent } from './reducer';
import { abstainedExecution, rejectedExecution, unavailableExecution, type FixtureResult, parseFixtureResponse, parseFixtureResult, type SeatExecutor } from './executor';
import { SEAT_PROMPT_VERSIONS } from '../seats/types';

export interface OfflineSwarmRunInput {
  readonly case: SwarmCase;
  readonly evidence: readonly EvidenceItem[];
  readonly sealed_at: string;
  readonly package_id?: import('../contracts').EvidencePackageId;
  readonly seat_executors: Readonly<Partial<Record<Round1SeatId, SeatExecutor>>>;
  readonly synthesis_executor?: SynthesisExecutor;
  /** Phase 5 runs stop after audit and never invoke the synthesis executor. */
  readonly run_synthesis?: boolean;
  readonly phase5?: boolean;
  readonly challenge_generator?: {
    generate(input: Phase5ChallengeGenerationInput, invocation?: number): Promise<readonly Challenge[]>;
  };
  /** Fixed event timestamp; defaults to the case creation timestamp. */
  readonly event_timestamp?: string;
  /** Narrow observability seam used by the durable Phase 5G artifact writer.
   * It observes logical provider operations before and after the existing
   * executor/router path; it does not alter protocol decisions. */
  readonly request_observer?: OfflineRequestObserver;
  /** Receives the already validated domain event after reduction. */
  readonly event_observer?: (event: SwarmExecutionEvent) => void;
  /** Receives sanitized candidate dispositions before any challenge event is reduced. */
  readonly challenge_admission_observer?: (report: Phase5ChallengeAdmissionResult) => void;
}

export interface Round1ContextAttestation {
  readonly seat_id: Round1SeatId;
  readonly round: 1;
  readonly peer_position_count: 0;
  readonly peer_position_ids: readonly string[];
  readonly peer_context_present: false;
  readonly peer_reasoning_present: false;
  readonly evidence_fingerprint: string;
  readonly request_context_fingerprint: string;
  readonly seat_contract_version: string;
}

export type OfflineRequestOperation = 'ROUND1_ANALYSIS' | 'CHALLENGE_GENERATION' | 'CHALLENGE_RESPONSE' | 'ZEUS_SYNTHESIS';

export interface OfflineRequestObservation {
  readonly lifecycle: 'RESERVED' | 'COMPLETED' | 'FAILED';
  readonly operation: OfflineRequestOperation;
  readonly request_id: string;
  readonly seat_id: Round1SeatId | null;
  readonly invocation: number;
  readonly result?: unknown;
  readonly error_code?: string;
  readonly round1_context_attestation?: Round1ContextAttestation;
}

export interface OfflineRequestObserver {
  observe(observation: OfflineRequestObservation): void;
}

export interface OfflineSwarmRunResult {
  readonly blackboard: SwarmBlackboard;
  readonly events: readonly SwarmExecutionEvent[];
  readonly executor_invocations: number;
}

function asErrorCode(error: unknown): string {
  return error instanceof SwarmProtocolError ? error.code : 'SCHEMA_ERROR';
}

function terminalExecution(result: FixtureResult): ModelExecution {
  return result.execution;
}

export async function runOfflineSwarmCase(input: OfflineSwarmRunInput): Promise<OfflineSwarmRunResult> {
  let state = emptySwarmBlackboard();
  let invocations = 0;
  const eventTimestamp = input.event_timestamp ?? input.case.created_at;
  const packageValue = sealEvidence(input.case, input.evidence, { package_id: input.package_id, sealed_at: input.sealed_at });

  const append = (type: SwarmExecutionEvent['type'], payload: Record<string, unknown>, actor = 'SYSTEM'): void => {
    const sequence = state.execution_events.length + 1;
    const event = {
      event_id: `offline-event-${sequence}` as import('../contracts').ExecutionEventId,
      case_id: input.case.case_id,
      protocol_version: SWARM_PROTOCOL_VERSION,
      sequence,
      timestamp: eventTimestamp,
      actor,
      type,
      ...payload,
    } as SwarmExecutionEvent;
    state = reduceSwarmEvent(state, event);
    input.event_observer?.(event);
  };

  const invoke = async <T>(operation: OfflineRequestOperation, seat_id: Round1SeatId | null, fn: () => Promise<T>, round1_context_attestation?: Round1ContextAttestation): Promise<T> => {
    if (invocations >= input.case.policy.max_provider_calls) throw new SwarmProtocolError('BUDGET_EXCEEDED');
    invocations += 1;
    const invocation = invocations;
    const request_id = operation === 'ROUND1_ANALYSIS'
      ? `model-request-${input.case.case_id}-${seat_id}-${invocation}-round1`
      : operation === 'CHALLENGE_RESPONSE'
        ? `model-request-${input.case.case_id}-${seat_id}-${invocation}-challenge`
        : operation === 'CHALLENGE_GENERATION'
          ? `model-request-${input.case.case_id}-ARES-phase5-challenges-${invocation}`
          : `model-request-${input.case.case_id}-ZEUS-synthesis-${invocation}`;
    input.request_observer?.observe({ lifecycle: 'RESERVED', operation, request_id, seat_id, invocation, round1_context_attestation });
    try {
      const result = await fn();
      input.request_observer?.observe({ lifecycle: 'COMPLETED', operation, request_id, seat_id, invocation, result });
      return result;
    } catch (error) {
      input.request_observer?.observe({ lifecycle: 'FAILED', operation, request_id, seat_id, invocation, error_code: error instanceof SwarmProtocolError ? error.code : 'UNEXPECTED_ERROR' });
      throw error;
    }
  };

  append('CASE_CREATED', { case: input.case });
  append('EVIDENCE_SEALED', { evidence_package: packageValue });
  append('INDEPENDENT_ANALYSIS_STARTED', {});
  for (const seat_id of ROUND1_SEAT_IDS) append('SEAT_STARTED', { seat_id }, seat_id);

  // Every executor sees this one snapshot. Promise completion order is intentionally discarded.
  const round1Snapshot = state;
  const results = await Promise.all(ROUND1_SEAT_IDS.map(async (seat_id, index) => {
    const executor = input.seat_executors[seat_id];
    if (!executor) return { seat_id, raw: { status: 'UNAVAILABLE', reason: 'no fixture executor configured', execution: unavailableExecution() }, index };
    const seatInput = { ...buildRound1SeatInput(round1Snapshot, seat_id), execution_context: { invocation: invocations + index + 1, phase: 'ROUND_1' as const } };
    const evidence_fingerprint = round1Snapshot.evidence_package!.package_hash;
    const round1_context_attestation: Round1ContextAttestation = Object.freeze({
      seat_id,
      round: 1,
      peer_position_count: 0,
      peer_position_ids: [],
      peer_context_present: false,
      peer_reasoning_present: false,
      evidence_fingerprint,
      request_context_fingerprint: deterministicPackageHash({ seat_id, case_id: seatInput.case.case_id, evidence_fingerprint, peer_position_ids: [] }),
      seat_contract_version: SEAT_PROMPT_VERSIONS[seat_id],
    });
    if (round1_context_attestation.peer_position_count !== 0 || round1_context_attestation.peer_context_present) throw new SwarmProtocolError('AUTHORITY_VIOLATION');
    return { seat_id, raw: await invoke('ROUND1_ANALYSIS', seat_id, () => executor.execute(seatInput), round1_context_attestation), index };
  }));

  for (const { seat_id, raw } of results.sort((a, b) => a.index - b.index)) {
    const result = parseFixtureResult(raw);
    if (!result) {
      append('SEAT_REJECTED', { seat_id, reason: 'fixture result failed protocol schema validation', execution: rejectedExecution('FIXTURE_RESULT_SCHEMA') }, seat_id);
      continue;
    }
    if (result.status === 'SUCCESS') {
      if (!result.position || !AgentPositionSchema.safeParse(result.position).success || stableStringify(result.position.execution) !== stableStringify(result.execution)) {
        append('SEAT_REJECTED', { seat_id, reason: 'fixture position failed execution or shape validation', execution: rejectedExecution('FIXTURE_POSITION_SCHEMA') }, seat_id);
        continue;
      }
      try {
        assertExecutionTruth(result.execution, 'SUCCESS');
        assertPositionValid(result.position, input.case, packageValue);
        if (result.position.seat_id !== seat_id || result.position.round !== 1) throw new SwarmProtocolError('AUTHORITY_VIOLATION');
        append('POSITION_PROPOSED', { position: result.position }, seat_id);
        append('SEAT_COMPLETED', { seat_id, position_id: result.position.position_id, execution: result.execution }, seat_id);
      } catch (error) {
        append('SEAT_REJECTED', { seat_id, reason: `fixture position rejected: ${asErrorCode(error)}`, execution: rejectedExecution(`FIXTURE_${asErrorCode(error)}`) }, seat_id);
      }
      continue;
    }
    try {
      assertExecutionTruth(terminalExecution(result), result.status);
      const eventType = result.status === 'ABSTAINED' ? 'SEAT_ABSTAINED' : result.status === 'UNAVAILABLE' ? 'SEAT_UNAVAILABLE' : result.status === 'FAILED' ? 'SEAT_FAILED' : 'SEAT_REJECTED';
      append(eventType, { seat_id, reason: result.reason, execution: result.execution }, seat_id);
    } catch (error) {
      append('SEAT_REJECTED', { seat_id, reason: `fixture terminal result rejected: ${asErrorCode(error)}`, execution: rejectedExecution(`FIXTURE_${asErrorCode(error)}`) }, seat_id);
    }
  }

  append('POSITIONS_LOCKED', {});
  const disagreements = detectDisagreements(state.positions);
  for (const disagreement of disagreements) append('DISAGREEMENT_IDENTIFIED', { disagreement }, 'APOLLO');
  append('DISAGREEMENTS_FINALIZED', {});

  let challenges = input.phase5
    ? planPhase5Challenges(state.positions, disagreements, input.case)
    : input.case.policy.max_challenge_rounds > 0 ? planChallenges(state.positions, disagreements, input.case) : [];
  if (input.phase5 && input.challenge_generator && state.case && state.evidence_package) {
    const generationInput: Phase5ChallengeGenerationInput = {
      case: { case_id: state.case.case_id, protocol_version: state.case.protocol_version, question: state.case.question, scope: state.case.scope, policy: state.case.policy },
      evidence_package: state.evidence_package,
      positions: state.positions,
      disagreements,
    };
    challenges = [...await invoke('CHALLENGE_GENERATION', 'ARES', () => input.challenge_generator!.generate(generationInput, invocations + 1))];
  }
  if (input.phase5) {
    const admission = selectAndAdmitPhase5Challenges(challenges, disagreements, state.positions, input.case);
    input.challenge_admission_observer?.(admission);
    challenges = [...admission.admitted];
  }
  if (challenges.length > 0) {
    append('CHALLENGE_ROUND_STARTED', { round: 1 });
    if (input.phase5) append('CHALLENGE_GENERATION_STARTED', { round: 1 }, 'ARES');
    for (const challenge of challenges) append('CHALLENGE_EMITTED', { challenge }, challenge.from_seat);
    if (input.phase5) append('CHALLENGES_GENERATED', { challenge_ids: challenges.map((challenge) => challenge.challenge_id) }, 'ARES');
    const challengeSnapshot = state;
    const responses = await Promise.all(challenges.map(async (challenge, index) => {
      const executor = input.seat_executors[challenge.to_seat];
      append('CHALLENGE_RESPONSE_STARTED', { challenge_id: challenge.challenge_id, responding_seat: challenge.to_seat }, 'SYSTEM');
      if (!executor) return { challenge, raw: { status: 'ABSTAINED', reason: 'no fixture executor configured', execution: abstainedExecution() }, index };
      const challengeInput = { ...buildChallengeInput(challengeSnapshot, challenge), execution_context: { invocation: invocations + index + 1, phase: 'CHALLENGE_RESPONSE' as const } };
      return { challenge, raw: await invoke('CHALLENGE_RESPONSE', challenge.to_seat, () => executor.respond(challengeInput)), index };
    }));
    for (const { challenge, raw } of responses.sort((a, b) => a.index - b.index)) {
      const result = parseFixtureResponse(raw);
      let response;
      if (!result || result.status === 'SUCCESS' && !result.response) {
        if (input.phase5) {
          append('CHALLENGE_RESPONSE_FAILED', { challenge_id: challenge.challenge_id, responding_seat: challenge.to_seat, reason: 'response failed protocol schema validation' }, 'SYSTEM');
          response = {
            response_id: `response-${challenge.challenge_id}` as import('../contracts').ChallengeResponseId,
            case_id: input.case.case_id,
            challenge_id: challenge.challenge_id,
            responding_seat: challenge.to_seat,
            action: 'ABSTAIN' as const,
            rationale: 'No valid structured challenge response was available; no revision or fallback was applied.',
            evidence_ids: [],
            revision_id: null,
            round: challenge.round,
            source_position: challenge.target_position,
            revision_lineage: [challenge.target_position],
          };
        } else throw new SwarmProtocolError('SCHEMA_ERROR');
      }
      if (result?.status === 'SUCCESS') {
        response = {
          ...result.response!,
          ...(input.phase5 ? { round: challenge.round, source_position: challenge.target_position, revision_lineage: result.response!.revision_lineage ?? [challenge.target_position] } : {}),
        };
        if (!response || !ChallengeResponseSchema.safeParse(response).success || response.challenge_id !== challenge.challenge_id || response.responding_seat !== challenge.to_seat) {
          if (input.phase5) {
            append('CHALLENGE_RESPONSE_FAILED', { challenge_id: challenge.challenge_id, responding_seat: challenge.to_seat, reason: 'response failed challenge authority validation' }, 'SYSTEM');
            response = {
              response_id: `response-${challenge.challenge_id}` as import('../contracts').ChallengeResponseId,
              case_id: input.case.case_id,
              challenge_id: challenge.challenge_id,
              responding_seat: challenge.to_seat,
              action: 'ABSTAIN' as const,
              rationale: 'Challenge response failed authority validation; no revision or fallback was applied.',
              evidence_ids: [],
              revision_id: null,
              round: challenge.round,
              source_position: challenge.target_position,
              revision_lineage: [challenge.target_position],
            };
          } else throw new SwarmProtocolError('AUTHORITY_VIOLATION');
        }
      } else {
        response = {
          response_id: `response-${challenge.challenge_id}` as import('../contracts').ChallengeResponseId,
          case_id: input.case.case_id,
          challenge_id: challenge.challenge_id,
          responding_seat: challenge.to_seat,
          action: 'ABSTAIN' as const,
          rationale: `Seat response unavailable: ${result?.reason ?? 'no valid response result'}`,
          evidence_ids: [],
          revision_id: null,
          ...(input.phase5 ? { round: challenge.round, source_position: challenge.target_position, revision_lineage: [challenge.target_position] } : {}),
        };
      }
      append('CHALLENGE_RESPONSE_RECORDED', { response }, challenge.to_seat);
      if (response.action === 'REQUEST_EVIDENCE') {
        const request: EvidenceRequest = {
          request_id: `request-${challenge.challenge_id}` as import('../contracts').EvidenceRequestId,
          case_id: input.case.case_id,
          position_id: challenge.target_position,
          request: response.rationale,
          reason: 'The challenged seat requested additional evidence.',
          evidence_ids: [...response.evidence_ids],
          status: 'OPEN',
        };
        if (!EvidenceRequestSchema.safeParse(request).success) throw new SwarmProtocolError('SCHEMA_ERROR');
        append('EVIDENCE_REQUEST_RECORDED', { request }, challenge.to_seat);
      }
      if (response.action === 'REVISE' || response.action === 'CONCEDE') {
        if (!result || result.status !== 'SUCCESS' || !result.revision || !result.position || result.revision.revision_id !== response.revision_id) throw new SwarmProtocolError('SCHEMA_ERROR');
        if (state.revisions.length >= input.case.policy.max_revisions) throw new SwarmProtocolError('BUDGET_EXCEEDED');
        if (input.phase5) append('REVISION_CREATED', { revision_id: result.revision.revision_id, position_id: result.position.position_id }, 'SYSTEM');
        append('REVISION_RECORDED', { revision: result.revision, position: result.position }, challenge.to_seat);
        if (input.phase5 && response.action === 'CONCEDE') append('CONCESSION_RECORDED', { challenge_id: challenge.challenge_id, response_id: response.response_id, position_id: result.position.position_id }, 'SYSTEM');
      }
    }
  }
  append('REVISIONS_LOCKED', {});
  if (input.phase5) append('DISAGREEMENTS_REEVALUATED', { disagreements: reevaluateDisagreements(state.disagreements, currentPositions(state)) }, 'APOLLO');
  append('AUDIT_STARTED', {}, 'APOLLO');
  for (const finding of runApolloDeterministicAudit(state)) append('AUDIT_FINDING_RECORDED', { finding }, 'APOLLO');
  append('AUDIT_COMPLETED', {}, 'APOLLO');
  if (input.phase5) {
    append('POST_CHALLENGE_AUDIT_COMPLETED', {}, 'APOLLO');
    append('ZEUS_READINESS_EVALUATED', { ready: true, reason: 'Protocol audit passed; Zeus synthesis is ready for a separate controlled phase and human decision remains pending.' }, 'SYSTEM');
    append('ROUND_STOPPED', { reason: 'Phase 5 adversarial round stops before Zeus synthesis; human decision remains pending.' }, 'SYSTEM');
  }
  if (input.run_synthesis === false || input.phase5) return { blackboard: state, events: state.execution_events, executor_invocations: invocations };
  append('SYNTHESIS_STARTED', {}, 'ZEUS');

  const synthesisInput: SynthesisInput = {
    case: state.case ?? input.case,
    evidence_package: state.evidence_package,
    final_positions: currentPositions(state),
    participation_summary: participation(state),
    disagreements: state.disagreements,
    challenges: state.challenges,
    challenge_responses: state.challenge_responses,
    revisions: state.revisions,
    audit_findings: state.audit_findings,
    evidence_requests: state.evidence_requests,
  };
  if (!assessSynthesisReadiness(synthesisInput).ready) fail('INVALID_TRANSITION');
  const synthesisExecutor = input.synthesis_executor;
  if (!synthesisExecutor) throw new SwarmProtocolError('INVALID_TRANSITION');
  const synthesis = await invoke('ZEUS_SYNTHESIS', 'APOLLO', () => synthesisExecutor.synthesize(synthesisInput));
  const validatedSynthesis = validateFixtureSynthesis(synthesis, synthesisInput);
  append('SYNTHESIS_READY', { synthesis: validatedSynthesis }, 'ZEUS');
  append('HUMAN_REVIEW_STARTED', {});
  return { blackboard: state, events: state.execution_events, executor_invocations: invocations };
}

export type Phase5OfflineRunInput = Omit<OfflineSwarmRunInput, 'phase5' | 'run_synthesis' | 'synthesis_executor'> & {
  /** Accepted only for structural compatibility with the shared golden
   * fixture type; Phase 5 never invokes it. */
  readonly synthesis_executor?: SynthesisExecutor;
};

/** Offline-only Phase 5 entry point. It deliberately terminates at AUDIT and
 * emits a Zeus readiness gate without invoking Zeus or producing synthesis. */
export async function runOfflineAdversarialDeliberation(input: Phase5OfflineRunInput): Promise<OfflineSwarmRunResult> {
  return runOfflineSwarmCase({ ...input, phase5: true, run_synthesis: false });
}
