import {
  EvidencePackageSchema,
  Phase5ChallengeResponseSchema,
  Phase5ChallengeSchema,
  ROUND1_SEAT_IDS,
  SynthesisBriefSchema,
  ZeusSynthesisBriefSchema,
  SwarmExecutionEventSchema,
  SWARM_PROTOCOL_VERSION,
  type AgentPosition,
  type Challenge,
  type ChallengeResponse,
  type Disagreement,
  type EvidenceRequest,
  type ModelExecution,
  type ProtocolState,
  type Round1SeatId,
  type SeatExecutionState,
  type SwarmBlackboard,
  type SwarmCase,
  type SwarmExecutionEvent,
  type SynthesisBrief,
} from '../contracts';
import { stableStringify, verifyEvidencePackageHash } from '../evidence/package';
import {
  challengeDuplicateIdentity,
  PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT,
  PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT,
  PHASE5_MAX_TOTAL_CHALLENGES,
} from '../debate/challenges';
import {
  assertExecutionTruth,
  assertHumanDecision,
  assertKnownEvidence,
  hasMeaningfulPositionChange,
  assertPositionValid,
  fail,
  SwarmProtocolError,
} from '../governance/verifier';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function initialSeatState(seat_id: Round1SeatId): SeatExecutionState {
  return { seat_id, status: 'NOT_STARTED', position_id: null, execution: null, reason: null };
}

export function emptySwarmBlackboard(): SwarmBlackboard {
  return deepFreeze({
    protocol_version: SWARM_PROTOCOL_VERSION,
    case: null,
    state: null,
    evidence_package: null,
    claims: [],
    positions: [],
    disagreements: [],
    challenges: [],
    challenge_responses: [],
    evidence_requests: [],
    revisions: [],
    audit_findings: [],
    synthesis: null,
    human_decision: null,
    seat_execution_state: {
      ATHENA: initialSeatState('ATHENA'),
      ARES: initialSeatState('ARES'),
      HADES: initialSeatState('HADES'),
      APOLLO: initialSeatState('APOLLO'),
    },
    execution_events: [],
    audit_completed: false,
    synthesis_started: false,
    zeus_readiness: null,
    zeus_input: null,
    zeus_synthesis: null,
  });
}

function copyState(state: SwarmBlackboard): {
  case: SwarmCase | null;
  state: ProtocolState | null;
  evidence_package: SwarmBlackboard['evidence_package'];
  claims: SwarmBlackboard['claims'][number][];
  positions: AgentPosition[];
  disagreements: Disagreement[];
  challenges: Challenge[];
  challenge_responses: ChallengeResponse[];
  evidence_requests: EvidenceRequest[];
  revisions: SwarmBlackboard['revisions'][number][];
  audit_findings: SwarmBlackboard['audit_findings'][number][];
  synthesis: SynthesisBrief | null;
  human_decision: SwarmBlackboard['human_decision'];
  seat_execution_state: Record<Round1SeatId, SeatExecutionState>;
  execution_events: SwarmExecutionEvent[];
  audit_completed: boolean;
  synthesis_started: boolean;
  zeus_readiness: SwarmBlackboard['zeus_readiness'];
  zeus_input: SwarmBlackboard['zeus_input'];
  zeus_synthesis: SwarmBlackboard['zeus_synthesis'];
} {
  return {
    case: state.case,
    state: state.state,
    evidence_package: state.evidence_package,
    claims: [...state.claims],
    positions: [...state.positions],
    disagreements: [...state.disagreements],
    challenges: [...state.challenges],
    challenge_responses: [...state.challenge_responses],
    evidence_requests: [...state.evidence_requests],
    revisions: [...state.revisions],
    audit_findings: [...state.audit_findings],
    synthesis: state.synthesis,
    human_decision: state.human_decision,
    seat_execution_state: { ...state.seat_execution_state },
    execution_events: [...state.execution_events],
    audit_completed: state.audit_completed,
    synthesis_started: state.synthesis_started,
    zeus_readiness: state.zeus_readiness,
    zeus_input: state.zeus_input,
    zeus_synthesis: state.zeus_synthesis,
  };
}

function finish(state: ReturnType<typeof copyState>, event: SwarmExecutionEvent): SwarmBlackboard {
  state.execution_events.push(event);
  return deepFreeze({ protocol_version: SWARM_PROTOCOL_VERSION, ...state });
}

function parseEvent(raw: unknown): SwarmExecutionEvent {
  const parsed = SwarmExecutionEventSchema.safeParse(raw);
  if (!parsed.success) fail('INVALID_EVENT');
  return parsed.data;
}

function requireCase(state: SwarmBlackboard): SwarmCase {
  if (!state.case) fail('INVALID_TRANSITION');
  return state.case;
}

function requirePackage(state: SwarmBlackboard) {
  if (!state.evidence_package) fail('INVALID_TRANSITION');
  return state.evidence_package;
}

function requireState(state: SwarmBlackboard, expected: ProtocolState | readonly ProtocolState[]): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!state.state || !allowed.includes(state.state)) fail('INVALID_TRANSITION');
}

function requireActor(event: SwarmExecutionEvent, actors: readonly string[]): void {
  if (!actors.includes(event.actor)) fail('AUTHORITY_VIOLATION');
}

function requireCaseId(state: SwarmBlackboard, event: SwarmExecutionEvent): void {
  if (state.case && event.case_id !== state.case.case_id) fail('UNKNOWN_REFERENCE');
}

function requireNewId(values: readonly { [key: string]: unknown }[], key: string, id: string): void {
  if (values.some((value) => value[key] === id)) fail('DUPLICATE_ID');
}

function positionById(state: SwarmBlackboard, positionId: string): AgentPosition {
  const position = state.positions.find((value) => value.position_id === positionId);
  if (!position) fail('UNKNOWN_REFERENCE');
  return position;
}

function claimById(state: SwarmBlackboard, claimId: string) {
  const claim = state.claims.find((value) => value.claim_id === claimId);
  if (!claim) fail('UNKNOWN_REFERENCE');
  return claim;
}

function validateSequence(state: SwarmBlackboard, event: SwarmExecutionEvent): void {
  const last = state.execution_events[state.execution_events.length - 1];
  const expected = last ? last.sequence + 1 : 1;
  if (event.sequence !== expected) fail('EVENT_SEQUENCE_ERROR');
  if (state.execution_events.some((value) => value.event_id === event.event_id)) fail('DUPLICATE_ID');
  if (event.protocol_version !== SWARM_PROTOCOL_VERSION) fail('SCHEMA_ERROR');
}

function updateSeat(state: ReturnType<typeof copyState>, seat: Round1SeatId, patch: Partial<SeatExecutionState>): void {
  state.seat_execution_state[seat] = { ...state.seat_execution_state[seat], ...patch };
}

function assertExecutionEvent(execution: ModelExecution, expected: 'SUCCESS' | 'ABSTAINED' | 'UNAVAILABLE' | 'FAILED' | 'REJECTED'): void {
  assertExecutionTruth(execution, expected);
  if (expected !== 'SUCCESS' && execution.status === 'SUCCESS') fail('AUTHORITY_VIOLATION');
}

function assertRound1Terminal(state: SwarmBlackboard): void {
  for (const seat of ROUND1_SEAT_IDS) {
    const status = state.seat_execution_state[seat].status;
    if (!['SUCCESS', 'ABSTAINED', 'UNAVAILABLE', 'FAILED', 'REJECTED'].includes(status)) fail('POSITION_LOCK_VIOLATION');
    if (status === 'SUCCESS' && !state.seat_execution_state[seat].position_id) fail('POSITION_LOCK_VIOLATION');
  }
}

function assertDisagreementReferences(state: SwarmBlackboard, disagreement: Disagreement): void {
  if (disagreement.case_id !== requireCase(state).case_id) fail('UNKNOWN_REFERENCE');
  assertKnownEvidence(disagreement.evidence_ids, requirePackage(state));
  for (const subject of disagreement.subject_ids) {
    if (!state.positions.some((position) => position.position_id === subject) && !state.claims.some((claim) => claim.claim_id === subject)) fail('UNKNOWN_REFERENCE');
  }
  for (const [seat, positionId] of Object.entries(disagreement.positions_by_seat)) {
    const position = positionById(state, positionId);
    if (position.seat_id !== seat) fail('UNKNOWN_REFERENCE');
  }
}

function assertChallengeReferences(state: SwarmBlackboard, challenge: Challenge): void {
  if (challenge.case_id !== requireCase(state).case_id) fail('UNKNOWN_REFERENCE');
  const target = positionById(state, challenge.target_position);
  if (target.seat_id !== challenge.to_seat) fail('UNKNOWN_REFERENCE');
  if (challenge.target_claim) {
    const claim = claimById(state, challenge.target_claim);
    if (claim.position_id !== target.position_id) fail('UNKNOWN_REFERENCE');
  }
  assertKnownEvidence(challenge.evidence_ids, requirePackage(state));
  if (challenge.from_seat === challenge.to_seat) fail('AUTHORITY_VIOLATION');
}

function assertPhase5ChallengeReferences(state: SwarmBlackboard, challenge: Challenge): void {
  const parsed = Phase5ChallengeSchema.safeParse(challenge);
  if (!parsed.success) fail('SCHEMA_ERROR');
  if (parsed.data.round !== 1 || parsed.data.from_seat !== 'ARES') fail('AUTHORITY_VIOLATION');
  if (!['ATHENA', 'HADES', 'APOLLO'].includes(parsed.data.to_seat)) fail('AUTHORITY_VIOLATION');
  const disagreement = state.disagreements.find((item) => item.disagreement_id === parsed.data.disagreement_id);
  if (!disagreement) fail('UNKNOWN_REFERENCE');
  const target = positionById(state, parsed.data.target_position);
  if (target.seat_id !== parsed.data.to_seat) fail('UNKNOWN_REFERENCE');
}

function assertSynthesisReferences(state: SwarmBlackboard, synthesis: SynthesisBrief): void {
  if (synthesis.case_id !== requireCase(state).case_id) fail('UNKNOWN_REFERENCE');
  const positionIds = new Set(state.positions.map((position) => position.position_id));
  if (synthesis.majority_position && !positionIds.has(synthesis.majority_position)) fail('UNKNOWN_REFERENCE');
  for (const positionId of synthesis.minority_positions) if (!positionIds.has(positionId)) fail('UNKNOWN_REFERENCE');
  for (const disagreementId of synthesis.unresolved_disagreements) if (!state.disagreements.some((item) => item.disagreement_id === disagreementId)) fail('UNKNOWN_REFERENCE');
  for (const findingId of synthesis.audit_findings) if (!state.audit_findings.some((item) => item.finding_id === findingId)) fail('UNKNOWN_REFERENCE');
  assertKnownEvidence(synthesis.strongest_evidence, requirePackage(state));
}

function assertZeusSynthesisReferences(state: SwarmBlackboard, synthesis: import('../contracts').ZeusSynthesisBrief): void {
  if (synthesis.case_id !== requireCase(state).case_id || synthesis.seat_id !== 'ZEUS') fail('UNKNOWN_REFERENCE');
  const positionIds = new Set(state.positions.map((position) => position.position_id));
  const disagreementIds = new Set(state.disagreements.map((item) => item.disagreement_id));
  const evidenceIds = new Set(requirePackage(state).items.map((item) => item.evidence_id));
  const findingIds = new Set(state.audit_findings.map((item) => item.finding_id));
  for (const id of synthesis.source_position_ids) if (!positionIds.has(id)) fail('UNKNOWN_REFERENCE');
  for (const id of synthesis.source_disagreement_ids) if (!disagreementIds.has(id)) fail('UNKNOWN_REFERENCE');
  for (const id of synthesis.source_evidence_ids) if (!evidenceIds.has(id)) fail('UNKNOWN_EVIDENCE');
  for (const id of synthesis.source_audit_finding_ids) if (!findingIds.has(id)) fail('UNKNOWN_REFERENCE');
  for (const item of synthesis.material_disagreements) if (!disagreementIds.has(item.disagreement_id)) fail('UNKNOWN_REFERENCE');
  for (const item of synthesis.minority_positions) {
    if (!positionIds.has(item.position_id) || !ROUND1_SEAT_IDS.includes(item.seat_id)) fail('UNKNOWN_REFERENCE');
  }
  if (!synthesis.human_decision_required || synthesis.human_decision_status !== 'PENDING') fail('AUTHORITY_VIOLATION');
}

export function reduceSwarmEvent(current: SwarmBlackboard, rawEvent: unknown): SwarmBlackboard {
  const event = parseEvent(rawEvent);
  validateSequence(current, event);
  requireCaseId(current, event);
  const state = copyState(current);

  if (event.type === 'CASE_CREATED') {
    if (current.state !== null || current.execution_events.length !== 0 || event.sequence !== 1) fail('INVALID_TRANSITION');
    requireActor(event, ['SYSTEM', 'HUMAN']);
    if (event.case_id !== event.case.case_id) fail('UNKNOWN_REFERENCE');
    return finish({ ...state, case: event.case, state: 'CASE_CREATED' }, event);
  }

  if (!current.case) fail('INVALID_TRANSITION');

  switch (event.type) {
    case 'EVIDENCE_SEALED': {
      requireState(current, 'CASE_CREATED');
      requireActor(event, ['SYSTEM', 'HUMAN']);
      const packageValue = EvidencePackageSchema.safeParse(event.evidence_package);
      if (!packageValue.success || packageValue.data.case_id !== current.case.case_id || !verifyEvidencePackageHash(packageValue.data)) fail('EVIDENCE_MUTATION');
      if (packageValue.data.items.length > current.case.policy.max_evidence_items) fail('BUDGET_EXCEEDED');
      return finish({ ...state, evidence_package: packageValue.data, state: 'EVIDENCE_READY' }, event);
    }
    case 'INDEPENDENT_ANALYSIS_STARTED':
      requireState(current, 'EVIDENCE_READY');
      requireActor(event, ['SYSTEM']);
      return finish({ ...state, state: 'INDEPENDENT_ANALYSIS' }, event);
    case 'SEAT_STARTED':
      requireState(current, 'INDEPENDENT_ANALYSIS');
      requireActor(event, [event.seat_id, 'SYSTEM']);
      if (current.seat_execution_state[event.seat_id].status !== 'NOT_STARTED') fail('INVALID_TRANSITION');
      updateSeat(state, event.seat_id, { status: 'RUNNING', reason: null, execution: null, position_id: null });
      return finish(state, event);
    case 'POSITION_PROPOSED': {
      requireState(current, 'INDEPENDENT_ANALYSIS');
      requireActor(event, [event.position.seat_id]);
      if (event.position.round !== 1 || event.position.status !== 'PROPOSED') fail('ROUND_LEAKAGE');
      const seatState = current.seat_execution_state[event.position.seat_id];
      if (seatState.status !== 'RUNNING' || seatState.position_id !== null) fail('INVALID_TRANSITION');
      assertPositionValid(event.position, current.case, requirePackage(current));
      requireNewId(current.positions, 'position_id', event.position.position_id);
      const claims = [...state.claims, ...event.position.claims];
      state.positions.push(event.position);
      state.claims = claims;
      updateSeat(state, event.position.seat_id, { position_id: event.position.position_id });
      return finish(state, event);
    }
    case 'SEAT_COMPLETED': {
      requireState(current, 'INDEPENDENT_ANALYSIS');
      requireActor(event, [event.seat_id]);
      const seatState = current.seat_execution_state[event.seat_id];
      if (seatState.status !== 'RUNNING' || seatState.position_id !== event.position_id) fail('INVALID_TRANSITION');
      const position = positionById(current, event.position_id);
      if (position.seat_id !== event.seat_id) fail('UNKNOWN_REFERENCE');
      if (stableStringify(position.execution) !== stableStringify(event.execution)) fail('UNKNOWN_REFERENCE');
      assertExecutionEvent(event.execution, 'SUCCESS');
      updateSeat(state, event.seat_id, { status: 'SUCCESS', execution: event.execution, reason: null });
      return finish(state, event);
    }
    case 'SEAT_ABSTAINED':
    case 'SEAT_UNAVAILABLE':
    case 'SEAT_FAILED':
    case 'SEAT_REJECTED': {
      requireState(current, 'INDEPENDENT_ANALYSIS');
      requireActor(event, [event.seat_id]);
      const expected = event.type === 'SEAT_ABSTAINED' ? 'ABSTAINED' : event.type === 'SEAT_UNAVAILABLE' ? 'UNAVAILABLE' : event.type === 'SEAT_FAILED' ? 'FAILED' : 'REJECTED';
      const seatState = current.seat_execution_state[event.seat_id];
      if (seatState.status !== 'RUNNING' || seatState.position_id !== null) fail('INVALID_TRANSITION');
      assertExecutionEvent(event.execution, expected);
      updateSeat(state, event.seat_id, { status: expected, execution: event.execution, reason: event.reason });
      return finish(state, event);
    }
    case 'POSITIONS_LOCKED': {
      requireState(current, 'INDEPENDENT_ANALYSIS');
      requireActor(event, ['SYSTEM']);
      assertRound1Terminal(current);
      state.positions = state.positions.map((position) => ({ ...position, status: 'LOCKED' }));
      return finish({ ...state, state: 'POSITIONS_LOCKED' }, event);
    }
    case 'DISAGREEMENT_IDENTIFIED':
      requireState(current, 'POSITIONS_LOCKED');
      requireActor(event, ['SYSTEM', 'APOLLO']);
      requireNewId(current.disagreements, 'disagreement_id', event.disagreement.disagreement_id);
      assertDisagreementReferences(current, event.disagreement);
      state.disagreements.push(event.disagreement);
      return finish(state, event);
    case 'DISAGREEMENTS_FINALIZED':
      requireState(current, 'POSITIONS_LOCKED');
      requireActor(event, ['SYSTEM']);
      return finish({ ...state, state: 'DISAGREEMENTS_IDENTIFIED' }, event);
    case 'CHALLENGE_ROUND_STARTED':
      requireState(current, 'DISAGREEMENTS_IDENTIFIED');
      requireActor(event, ['SYSTEM']);
      if (event.round > current.case.policy.max_challenge_rounds || current.case.policy.max_challenge_rounds === 0) fail('BUDGET_EXCEEDED');
      return finish({ ...state, state: 'CHALLENGE_ROUND' }, event);
    case 'CHALLENGE_GENERATION_STARTED':
      requireState(current, 'CHALLENGE_ROUND');
      requireActor(event, ['ARES', 'SYSTEM']);
      if (event.round !== 1) fail('INVALID_TRANSITION');
      return finish(state, event);
    case 'CHALLENGES_GENERATED':
      requireState(current, 'CHALLENGE_ROUND');
      requireActor(event, ['ARES', 'SYSTEM']);
      return finish(state, event);
    case 'CHALLENGE_EMITTED':
      requireState(current, 'CHALLENGE_ROUND');
      requireActor(event, [event.challenge.from_seat, 'SYSTEM']);
      if (current.challenges.length >= current.case.policy.max_challenges) fail('BUDGET_EXCEEDED');
      requireNewId(current.challenges, 'challenge_id', event.challenge.challenge_id);
      assertChallengeReferences(current, event.challenge);
      if (event.challenge.disagreement_id) {
        assertPhase5ChallengeReferences(current, event.challenge);
        if (current.challenges.some((item) => item.disagreement_id && challengeDuplicateIdentity(item) === challengeDuplicateIdentity(event.challenge))) fail('DUPLICATE_ID');
        if (current.challenges.filter((item) => item.disagreement_id === event.challenge.disagreement_id).length >= PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT) fail('BUDGET_EXCEEDED');
        if (current.challenges.filter((item) => item.disagreement_id && item.to_seat === event.challenge.to_seat).length >= PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT) fail('BUDGET_EXCEEDED');
        if (current.challenges.filter((item) => item.disagreement_id).length >= PHASE5_MAX_TOTAL_CHALLENGES) fail('BUDGET_EXCEEDED');
      }
      state.challenges.push(event.challenge);
      return finish(state, event);
    case 'CHALLENGE_RESPONSE_STARTED':
      requireState(current, 'CHALLENGE_ROUND');
      requireActor(event, ['SYSTEM', event.responding_seat]);
      if (!current.challenges.some((item) => item.challenge_id === event.challenge_id && item.to_seat === event.responding_seat)) fail('UNKNOWN_REFERENCE');
      return finish(state, event);
    case 'CHALLENGE_RESPONSE_FAILED':
      requireState(current, 'CHALLENGE_ROUND');
      requireActor(event, ['SYSTEM', event.responding_seat]);
      if (!current.challenges.some((item) => item.challenge_id === event.challenge_id && item.to_seat === event.responding_seat)) fail('UNKNOWN_REFERENCE');
      return finish(state, event);
    case 'CHALLENGE_RESPONSE_RECORDED': {
      requireState(current, 'CHALLENGE_ROUND');
      requireActor(event, [event.response.responding_seat]);
      requireNewId(current.challenge_responses, 'response_id', event.response.response_id);
      const challenge = current.challenges.find((item) => item.challenge_id === event.response.challenge_id);
      if (!challenge || challenge.to_seat !== event.response.responding_seat) fail('UNKNOWN_REFERENCE');
      if (current.challenge_responses.some((response) => response.challenge_id === event.response.challenge_id)) fail('DUPLICATE_ID');
      assertKnownEvidence(event.response.evidence_ids, requirePackage(current));
      if (challenge.disagreement_id) {
        const parsed = Phase5ChallengeResponseSchema.safeParse(event.response);
        if (!parsed.success || parsed.data.round !== challenge.round || parsed.data.source_position !== challenge.target_position) fail('SCHEMA_ERROR');
        for (const positionId of parsed.data.revision_lineage) positionById(current, positionId);
      }
      state.challenge_responses.push(event.response);
      return finish(state, event);
    }
    case 'EVIDENCE_REQUEST_RECORDED': {
      requireState(current, 'CHALLENGE_ROUND');
      requireActor(event, ['ATHENA', 'ARES', 'HADES', 'APOLLO', 'SYSTEM']);
      requireNewId(current.evidence_requests, 'request_id', event.request.request_id);
      if (event.request.case_id !== current.case.case_id) fail('UNKNOWN_REFERENCE');
      positionById(current, event.request.position_id);
      assertKnownEvidence(event.request.evidence_ids, requirePackage(current));
      state.evidence_requests.push(event.request);
      return finish(state, event);
    }
    case 'REVISION_CREATED':
      requireState(current, 'CHALLENGE_ROUND');
      requireActor(event, ['SYSTEM', 'ATHENA', 'HADES', 'APOLLO']);
      if (!current.challenge_responses.some((item) => item.revision_id === event.revision_id)) fail('UNKNOWN_REFERENCE');
      return finish(state, event);
    case 'CONCESSION_RECORDED':
      requireState(current, 'CHALLENGE_ROUND');
      requireActor(event, ['SYSTEM', 'ATHENA', 'HADES', 'APOLLO']);
      if (!current.challenges.some((item) => item.challenge_id === event.challenge_id)) fail('UNKNOWN_REFERENCE');
      if (!current.challenge_responses.some((item) => item.response_id === event.response_id && item.challenge_id === event.challenge_id && item.action === 'CONCEDE')) fail('UNKNOWN_REFERENCE');
      positionById(current, event.position_id);
      return finish(state, event);
    case 'REVISION_RECORDED': {
      requireState(current, 'CHALLENGE_ROUND');
      requireActor(event, [event.position.seat_id]);
      if (event.position.status !== 'REVISED' || event.position.round <= 1) fail('INVALID_TRANSITION');
      const revision = event.revision;
      if (revision.case_id !== current.case.case_id || revision.new_position_id !== event.position.position_id) fail('UNKNOWN_REFERENCE');
      const oldPosition = positionById(current, revision.old_position_id);
      const challenge = current.challenges.find((item) => item.challenge_id === revision.triggering_challenge_id);
      const response = current.challenge_responses.find((item) => item.response_id === revision.triggering_response_id);
      if (!challenge || !response || (response.action !== 'REVISE' && response.action !== 'CONCEDE') || response.revision_id !== revision.revision_id) fail('UNKNOWN_REFERENCE');
      if (challenge.to_seat !== event.position.seat_id || oldPosition.seat_id !== event.position.seat_id || response.challenge_id !== challenge.challenge_id) fail('AUTHORITY_VIOLATION');
      if (current.revisions.some((item) => item.revision_id === revision.revision_id) || current.positions.some((item) => item.position_id === event.position.position_id)) fail('DUPLICATE_ID');
      for (const referencedPosition of event.position.position_references) positionById(current, referencedPosition);
      assertPositionValid(event.position, current.case, requirePackage(current));
      if (!hasMeaningfulPositionChange(oldPosition, event.position)) fail('INVALID_TRANSITION');
      state.positions.push(event.position);
      state.claims.push(...event.position.claims);
      state.revisions.push(revision);
      return finish(state, event);
    }
    case 'REVISIONS_LOCKED': {
      requireState(current, ['DISAGREEMENTS_IDENTIFIED', 'CHALLENGE_ROUND']);
      requireActor(event, ['SYSTEM']);
      if (current.state === 'CHALLENGE_ROUND') {
        for (const challenge of current.challenges) {
          const response = current.challenge_responses.find((item) => item.challenge_id === challenge.challenge_id);
          if (!response) fail('INVALID_TRANSITION');
          if ((response.action === 'REVISE' || response.action === 'CONCEDE') && !current.revisions.some((item) => item.revision_id === response.revision_id)) fail('INVALID_TRANSITION');
        }
      }
      return finish({ ...state, state: 'REVISIONS_LOCKED' }, event);
    }
    case 'DISAGREEMENTS_REEVALUATED': {
      requireState(current, 'REVISIONS_LOCKED');
      requireActor(event, ['SYSTEM', 'APOLLO']);
      if (event.disagreements.some((item) => item.case_id !== requireCase(current).case_id)) fail('UNKNOWN_REFERENCE');
      for (const disagreement of event.disagreements) assertDisagreementReferences(current, disagreement);
      return finish({ ...state, disagreements: [...event.disagreements] }, event);
    }
    case 'AUDIT_STARTED':
      requireState(current, 'REVISIONS_LOCKED');
      requireActor(event, ['SYSTEM', 'APOLLO']);
      return finish({ ...state, state: 'AUDIT' }, event);
    case 'AUDIT_FINDING_RECORDED': {
      requireState(current, 'AUDIT');
      requireActor(event, ['APOLLO', 'SYSTEM']);
      requireNewId(current.audit_findings, 'finding_id', event.finding.finding_id);
      if (event.finding.case_id !== current.case.case_id) fail('UNKNOWN_REFERENCE');
      assertKnownEvidence(event.finding.evidence_ids, requirePackage(current));
      for (const subject of event.finding.subject_ids) {
        if (!current.positions.some((position) => position.position_id === subject) && !current.claims.some((claim) => claim.claim_id === subject) && !current.challenges.some((challenge) => challenge.challenge_id === subject) && !current.disagreements.some((disagreement) => disagreement.disagreement_id === subject)) fail('UNKNOWN_REFERENCE');
      }
      state.audit_findings.push(event.finding);
      return finish(state, event);
    }
    case 'AUDIT_COMPLETED':
      requireState(current, 'AUDIT');
      requireActor(event, ['APOLLO', 'SYSTEM']);
      return finish({ ...state, audit_completed: true }, event);
    case 'POST_CHALLENGE_AUDIT_COMPLETED':
      requireState(current, 'AUDIT');
      requireActor(event, ['APOLLO', 'SYSTEM']);
      if (!current.audit_completed) fail('INVALID_TRANSITION');
      return finish(state, event);
    case 'ZEUS_READINESS_EVALUATED':
      requireState(current, 'AUDIT');
      requireActor(event, ['SYSTEM']);
      if (!current.audit_completed) fail('INVALID_TRANSITION');
      return finish({ ...state, zeus_readiness: { ready: event.ready, blockers: event.ready ? [] : [event.reason], warnings: [], required_inputs_present: {}, human_authority_intact: true } }, event);
    case 'ROUND_STOPPED':
      requireState(current, 'AUDIT');
      requireActor(event, ['SYSTEM']);
      if (!current.audit_completed || !current.execution_events.some((item) => item.type === 'ZEUS_READINESS_EVALUATED')) fail('INVALID_TRANSITION');
      return finish(state, event);
    case 'ZEUS_SYNTHESIS_REQUESTED':
      requireState(current, 'AUDIT');
      requireActor(event, ['SYSTEM', 'HUMAN']);
      if (!current.audit_completed || !current.zeus_readiness?.ready || current.zeus_input || event.request_budget !== 1) fail('INVALID_TRANSITION');
      if (event.input.input_fingerprint !== event.input_fingerprint) fail('UNKNOWN_REFERENCE');
      return finish({ ...state, state: 'SYNTHESIS', synthesis_started: false, zeus_input: event.input, zeus_readiness: event.input.readiness }, event);
    case 'ZEUS_SYNTHESIS_STARTED':
      requireState(current, 'SYNTHESIS');
      requireActor(event, ['ZEUS', 'SYSTEM']);
      if (!current.zeus_readiness?.ready || current.synthesis_started) fail('INVALID_TRANSITION');
      return finish({ ...state, synthesis_started: true }, event);
    case 'ZEUS_SYNTHESIS_COMPLETED':
      requireState(current, 'SYNTHESIS');
      requireActor(event, ['ZEUS']);
      if (!current.synthesis_started || current.zeus_synthesis) fail('INVALID_TRANSITION');
      if (!ZeusSynthesisBriefSchema.safeParse(event.synthesis).success) fail('SCHEMA_ERROR');
      assertZeusSynthesisReferences(current, event.synthesis);
      return finish({ ...state, zeus_synthesis: event.synthesis }, event);
    case 'ZEUS_SYNTHESIS_FAILED':
      requireState(current, 'SYNTHESIS');
      requireActor(event, ['ZEUS', 'SYSTEM']);
      if (!current.synthesis_started || current.zeus_synthesis) fail('INVALID_TRANSITION');
      return finish(state, event);
    case 'HUMAN_REVIEW_REQUIRED':
      requireState(current, 'SYNTHESIS');
      requireActor(event, ['SYSTEM', 'HUMAN']);
      if (!current.zeus_synthesis || !event.human_decision_required || event.decision_status !== 'PENDING') fail('INVALID_TRANSITION');
      return finish({ ...state, state: 'HUMAN_REVIEW' }, event);
    case 'SYNTHESIS_STARTED':
      requireState(current, 'AUDIT');
      requireActor(event, ['ZEUS', 'SYSTEM']);
      if (!current.audit_completed) fail('INVALID_TRANSITION');
      return finish({ ...state, state: 'SYNTHESIS', synthesis_started: true }, event);
    case 'SYNTHESIS_READY':
      requireState(current, 'SYNTHESIS');
      requireActor(event, ['ZEUS']);
      if (!current.synthesis_started || current.synthesis) fail('INVALID_TRANSITION');
      if (!SynthesisBriefSchema.safeParse(event.synthesis).success) fail('SCHEMA_ERROR');
      assertSynthesisReferences(current, event.synthesis);
      state.synthesis = event.synthesis;
      return finish(state, event);
    case 'HUMAN_REVIEW_STARTED':
      requireState(current, 'SYNTHESIS');
      requireActor(event, ['SYSTEM', 'HUMAN']);
      if (!current.synthesis) fail('INVALID_TRANSITION');
      return finish({ ...state, state: 'HUMAN_REVIEW' }, event);
    case 'HUMAN_DECISION_RECORDED':
      requireState(current, 'HUMAN_REVIEW');
      requireActor(event, ['HUMAN']);
      if (current.human_decision) fail('DUPLICATE_ID');
      assertHumanDecision(event.decision, current.case);
      return finish({ ...state, human_decision: event.decision }, event);
    case 'CASE_CLOSED':
      requireState(current, 'HUMAN_REVIEW');
      requireActor(event, ['HUMAN']);
      if (!current.human_decision) fail('INVALID_TRANSITION');
      return finish({ ...state, state: 'CLOSED' }, event);
    default:
      return event satisfies never;
  }
}

export function replaySwarmEvents(events: readonly SwarmExecutionEvent[]): SwarmBlackboard {
  let state = emptySwarmBlackboard();
  for (const event of events) state = reduceSwarmEvent(state, event);
  return state;
}

export function buildRound1SeatInput(state: SwarmBlackboard, seat_id: Round1SeatId) {
  requireState(state, ['EVIDENCE_READY', 'INDEPENDENT_ANALYSIS']);
  if (!state.case || !state.evidence_package) fail('INVALID_TRANSITION');
  return deepFreeze({
    seat_id,
    case: {
      case_id: state.case.case_id,
      protocol_version: state.case.protocol_version,
      question: state.case.question,
      scope: state.case.scope,
      policy: state.case.policy,
    },
    evidence_package: state.evidence_package,
  });
}

export function participation(state: SwarmBlackboard) {
  return ROUND1_SEAT_IDS.map((seat_id) => {
    const seat = state.seat_execution_state[seat_id];
    return {
      seat_id,
      status: seat.status,
      position_id: seat.position_id,
      participated: seat.status === 'SUCCESS',
      reason: seat.status === 'SUCCESS' ? 'completed an independent Round 1 position' : seat.reason ?? `seat is ${seat.status.toLowerCase()}`,
    } as const;
  });
}

export { SwarmProtocolError };
