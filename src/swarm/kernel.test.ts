import { describe, expect, test } from 'bun:test';
import {
  AgentPositionSchema,
  ChallengeSchema,
  DEFAULT_SWARM_POLICY,
  HumanDecisionSchema,
  ModelExecutionSchema,
  SEAT_CONTRACTS,
  SeatContractSchema,
  SWARM_PROTOCOL_VERSION,
  SwarmExecutionEventSchema,
  type AgentPosition,
  type AuditFindingId,
  type ChallengeId,
  type ChallengeResponseId,
  type ClaimId,
  type DisagreementId,
  type EvidenceItem,
  type EvidenceId,
  type EvidencePackageId,
  type ExecutionEventId,
  type HumanDecisionId,
  type ModelExecution,
  type PositionId,
  type RevisionId,
  type SwarmCaseId,
  type SynthesisId,
  type SwarmExecutionEvent,
} from './contracts';
import { createSwarmCase } from './contracts/factories';
import { sealEvidence } from './evidence/package';
import {
  buildRound1SeatInput,
  emptySwarmBlackboard,
  participation,
  reduceSwarmEvent,
  replaySwarmEvents,
} from './engine/reducer';
import { SwarmProtocolError } from './governance/verifier';

const id = <T extends string>(value: string) => value as T;
const caseId = id<SwarmCaseId>('case-1');
const evidenceId = id<EvidenceId>('evidence-1');

const evidence: EvidenceItem = {
  evidence_id: evidenceId,
  source_type: 'regulator',
  source_identity: 'example.gov',
  url: 'https://example.gov/item-1',
  title: 'Example evidence',
  observed_at: '2026-01-01T00:00:00.000Z',
  retrieved_at: '2026-01-02T00:00:00.000Z',
  claim: 'A bounded example claim.',
  excerpt: 'A bounded excerpt.',
  tier: 1,
  relevance: 0.9,
  reliability: 0.95,
  integrity_hash: 'sha256:example',
  incident_claim: true,
};

const swarmCase = createSwarmCase({
  case_id: caseId,
  question: 'Is the bounded example risk supported?',
  scope: { geo: ['DE'], mode: ['road'], from: '2026-01-01', to: '2026-01-31' },
  created_at: '2026-02-01T00:00:00.000Z',
  created_by: 'human:operator',
});
const packageValue = sealEvidence(swarmCase, [evidence], { package_id: id<EvidencePackageId>('package-1'), sealed_at: '2026-02-01T00:01:00.000Z' });

function execution(status: ModelExecution['status'] = 'SUCCESS'): ModelExecution {
  const success = status === 'SUCCESS';
  return {
    requested_provider: success ? 'test-provider' : null,
    requested_model: success ? 'test-model' : null,
    executed_provider: success ? 'test-provider' : null,
    executed_model: success ? 'test-model' : null,
    request_id: success ? 'request-1' : null,
    started_at: '2026-02-01T00:02:00.000Z',
    ended_at: '2026-02-01T00:02:01.000Z',
    duration_ms: 1000,
    status,
    model_called: success,
    independent: success,
    fallback_used: false,
    fallback_reason: null,
    failure_stage: success ? null : 'REQUEST',
    failure_reason_code: success ? null : `TEST_${status}`,
    diagnostics: { candidate_count: success ? 1 : 0 },
  };
}

function position(seat_id: 'ATHENA' | 'ARES' | 'HADES' | 'APOLLO', position_id: string, round = 1, status: AgentPosition['status'] = 'PROPOSED'): AgentPosition {
  const pid = id<PositionId>(position_id);
  return {
    position_id: pid,
    case_id: caseId,
    seat_id,
    round,
    status,
    conclusion: `${seat_id} conclusion`,
    risk_level: seat_id === 'ARES' ? 'HIGH' : 'MEDIUM',
    confidence: 0.7,
    claims: [{
      claim_id: id<ClaimId>(`${position_id}-claim`),
      position_id: pid,
      statement: `${seat_id} claim`,
      type: 'OBSERVATION',
      evidence_ids: [evidenceId],
      assumptions: [],
      uncertainty: 'The bounded fixture is limited.',
      status: 'SUPPORTED',
    }],
    evidence_ids: [evidenceId],
    assumptions: [],
    uncertainties: ['The fixture is intentionally bounded.'],
    risk_findings: [],
    control_gaps: [],
    counterarguments: [],
    position_references: [],
    evidence_requests: [],
    recommendation: 'Review the bounded risk.',
    abstained: false,
    abstention_reason: null,
    execution: execution(),
    created_at: '2026-02-01T00:03:00.000Z',
  };
}

function event<T extends SwarmExecutionEvent['type']>(type: T, sequence: number, payload: Record<string, unknown>, actor = 'SYSTEM'): SwarmExecutionEvent {
  return {
    event_id: id<ExecutionEventId>(`event-${sequence}`),
    case_id: caseId,
    protocol_version: SWARM_PROTOCOL_VERSION,
    sequence,
    timestamp: `2026-02-01T00:${String(sequence).padStart(2, '0')}:00.000Z`,
    actor,
    type,
    ...payload,
  } as SwarmExecutionEvent;
}

function initialEvents(): SwarmExecutionEvent[] {
  return [
    event('CASE_CREATED', 1, { case: swarmCase }),
    event('EVIDENCE_SEALED', 2, { evidence_package: packageValue }),
    event('INDEPENDENT_ANALYSIS_STARTED', 3, {}),
    event('SEAT_STARTED', 4, { seat_id: 'ATHENA' }, 'ATHENA'),
    event('SEAT_STARTED', 5, { seat_id: 'ARES' }, 'ARES'),
    event('SEAT_STARTED', 6, { seat_id: 'HADES' }, 'HADES'),
    event('SEAT_STARTED', 7, { seat_id: 'APOLLO' }, 'APOLLO'),
  ];
}

function round1Events(): SwarmExecutionEvent[] {
  const athena = position('ATHENA', 'position-athena');
  const ares = position('ARES', 'position-ares');
  const apollo = position('APOLLO', 'position-apollo');
  return [
    ...initialEvents(),
    event('POSITION_PROPOSED', 8, { position: athena }, 'ATHENA'),
    event('SEAT_COMPLETED', 9, { seat_id: 'ATHENA', position_id: athena.position_id, execution: athena.execution }, 'ATHENA'),
    event('POSITION_PROPOSED', 10, { position: ares }, 'ARES'),
    event('SEAT_COMPLETED', 11, { seat_id: 'ARES', position_id: ares.position_id, execution: ares.execution }, 'ARES'),
    event('SEAT_UNAVAILABLE', 12, { seat_id: 'HADES', reason: 'no configured execution', execution: execution('UNAVAILABLE') }, 'HADES'),
    event('POSITION_PROPOSED', 13, { position: apollo }, 'APOLLO'),
    event('SEAT_COMPLETED', 14, { seat_id: 'APOLLO', position_id: apollo.position_id, execution: apollo.execution }, 'APOLLO'),
  ];
}

function fullLog(): SwarmExecutionEvent[] {
  const partial = round1Events();
  const athena = position('ATHENA', 'position-athena');
  const ares = position('ARES', 'position-ares');
  const apollo = position('APOLLO', 'position-apollo');
  const challenge = {
    challenge_id: id<ChallengeId>('challenge-1'),
    case_id: caseId,
    round: 1,
    from_seat: 'ARES' as const,
    to_seat: 'ATHENA' as const,
    target_position: athena.position_id,
    target_claim: athena.claims[0]!.claim_id,
    challenge_type: 'EVIDENCE' as const,
    reasoning: 'Name the supplied evidence establishing the disputed inference.',
    evidence_ids: [evidenceId],
  };
  const response = {
    response_id: id<ChallengeResponseId>('response-1'),
    case_id: caseId,
    challenge_id: challenge.challenge_id,
    responding_seat: 'ATHENA' as const,
    action: 'DEFEND' as const,
    rationale: 'The cited evidence supports the bounded observation.',
    evidence_ids: [evidenceId],
    revision_id: null,
  };
  const disagreement = {
    disagreement_id: id<DisagreementId>('disagreement-1'),
    case_id: caseId,
    type: 'RISK_RATING' as const,
    subject_ids: [athena.position_id, ares.position_id],
    positions_by_seat: { ATHENA: athena.position_id, ARES: ares.position_id, APOLLO: apollo.position_id },
    materiality: 'MATERIAL' as const,
    basis: 'Athena and Ares assign different risk levels.',
    evidence_ids: [evidenceId],
    unresolved: true,
    status: 'OPEN' as const,
  };
  const finding = {
    finding_id: id<AuditFindingId>('finding-1'),
    case_id: caseId,
    check_id: 'citations_exist',
    source: 'DETERMINISTIC' as const,
    status: 'VERIFIED' as const,
    subject_ids: [athena.position_id],
    evidence_ids: [evidenceId],
    detail: 'Every citation resolves to the sealed package.',
    remediation: null,
  };
  const participationSummary = [
    { seat_id: 'ATHENA' as const, status: 'SUCCESS' as const, position_id: athena.position_id, participated: true, reason: 'completed an independent Round 1 position' },
    { seat_id: 'ARES' as const, status: 'SUCCESS' as const, position_id: ares.position_id, participated: true, reason: 'completed an independent Round 1 position' },
    { seat_id: 'HADES' as const, status: 'UNAVAILABLE' as const, position_id: null, participated: false, reason: 'no configured execution' },
    { seat_id: 'APOLLO' as const, status: 'SUCCESS' as const, position_id: apollo.position_id, participated: true, reason: 'completed an independent Round 1 position' },
  ];
  const synthesis = {
    synthesis_id: id<SynthesisId>('synthesis-1'),
    case_id: caseId,
    risk_summary: 'The bounded fixture supports a material risk requiring human review.',
    risk_level: 'HIGH' as const,
    majority_position: null,
    minority_positions: [ares.position_id],
    unresolved_disagreements: [disagreement.disagreement_id],
    strongest_evidence: [evidenceId],
    weakest_assumptions: ['The fixture is limited.'],
    evidence_gaps: ['Operational frequency remains unknown.'],
    control_gaps: [],
    recommended_controls: ['Add a human review control.'],
    uncertainty: 'The Council did not observe operational frequency.',
    participation_summary: participationSummary,
    audit_findings: [finding.finding_id],
    human_action_required: 'A human must decide whether to proceed.',
    human_decision_status: 'PENDING' as const,
  };
  return [
    ...partial,
    event('POSITIONS_LOCKED', 15, {}),
    event('DISAGREEMENT_IDENTIFIED', 16, { disagreement }),
    event('DISAGREEMENTS_FINALIZED', 17, {}),
    event('CHALLENGE_ROUND_STARTED', 18, { round: 1 }),
    event('CHALLENGE_EMITTED', 19, { challenge }, 'ARES'),
    event('CHALLENGE_RESPONSE_RECORDED', 20, { response }, 'ATHENA'),
    event('REVISIONS_LOCKED', 21, {}),
    event('AUDIT_STARTED', 22, {}, 'APOLLO'),
    event('AUDIT_FINDING_RECORDED', 23, { finding }, 'APOLLO'),
    event('AUDIT_COMPLETED', 24, {}, 'APOLLO'),
    event('SYNTHESIS_STARTED', 25, {}, 'ZEUS'),
    event('SYNTHESIS_READY', 26, { synthesis }, 'ZEUS'),
    event('HUMAN_REVIEW_STARTED', 27, {}),
    event('HUMAN_DECISION_RECORDED', 28, { decision: { decision_id: id<HumanDecisionId>('decision-1'), case_id: caseId, human_actor: 'human:operator', decision: 'HOLD', timestamp: '2026-02-01T01:00:00.000Z', note: 'Hold pending more evidence.', diverges_from_synthesis: false, divergence_reason: null } }, 'HUMAN'),
    event('CASE_CLOSED', 29, {}, 'HUMAN'),
  ];
}

function reduceAll(events: readonly SwarmExecutionEvent[]) {
  return events.reduce((state, current) => reduceSwarmEvent(state, current), emptySwarmBlackboard());
}

function expectProtocol(code: string, operation: () => unknown) {
  try {
    operation();
    throw new Error('expected protocol error');
  } catch (error) {
    expect(error).toBeInstanceOf(SwarmProtocolError);
    expect((error as SwarmProtocolError).code as string).toBe(code);
  }
}

describe('SWARM 2 Phase 1 protocol kernel', () => {
  test('progresses a valid bounded event log to CLOSED', () => {
    const state = reduceAll(fullLog());
    expect(state.state).toBe('CLOSED');
    expect(state.positions).toHaveLength(3);
    expect(state.human_decision?.human_actor).toBe('human:operator');
    expect(state.synthesis?.human_decision_status).toBe('PENDING');
  });

  test('replay produces the same deterministic projection as incremental reduction', () => {
    const log = fullLog();
    const incremental = reduceAll(log);
    const replayed = replaySwarmEvents(log);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(incremental));
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(replaySwarmEvents([...log])));
  });

  test('rejects state skips and keeps CLOSED terminal', () => {
    const empty = emptySwarmBlackboard();
    expectProtocol('INVALID_TRANSITION', () => reduceSwarmEvent(empty, event('INDEPENDENT_ANALYSIS_STARTED', 1, {})));
    const closed = reduceAll(fullLog());
    expectProtocol('INVALID_TRANSITION', () => reduceSwarmEvent(closed, event('CASE_CLOSED', 30, {}, 'HUMAN')));
  });

  test('rejects duplicate, gapped, and out-of-order event sequences', () => {
    const first = reduceSwarmEvent(emptySwarmBlackboard(), event('CASE_CREATED', 1, { case: swarmCase }));
    expectProtocol('EVENT_SEQUENCE_ERROR', () => reduceSwarmEvent(first, event('EVIDENCE_SEALED', 3, { evidence_package: packageValue })));
    expectProtocol('DUPLICATE_ID', () => reduceSwarmEvent(first, { ...event('EVIDENCE_SEALED', 2, { evidence_package: packageValue }), event_id: first.execution_events[0]!.event_id }));
  });

  test('invalid events do not mutate the previous blackboard', () => {
    const before = reduceAll(initialEvents());
    const snapshot = JSON.stringify(before);
    expectProtocol('POSITION_LOCK_VIOLATION', () => reduceSwarmEvent(before, event('POSITIONS_LOCKED', 8, {})));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  test('seals evidence with deterministic order, hash, and deep immutability', () => {
    const reverse = sealEvidence(swarmCase, [evidence], { package_id: id<EvidencePackageId>('package-1'), sealed_at: '2026-02-01T00:01:00.000Z' });
    expect(reverse.package_hash).toBe(packageValue.package_hash);
    expect(Object.isFrozen(reverse)).toBe(true);
    expect(Object.isFrozen(reverse.items)).toBe(true);
    expect(Object.isFrozen(reverse.items[0])).toBe(true);
    expect(() => ((reverse.items as unknown as EvidenceItem[]).push(evidence))).toThrow();
    expect(() => ((reverse.items[0] as unknown as EvidenceItem).claim = 'mutated')).toThrow();
  });

  test('rejects duplicate evidence and unknown citations', () => {
    expect(() => sealEvidence(swarmCase, [evidence, evidence], { sealed_at: '2026-02-01T00:01:00.000Z' })).toThrow();
    const bad = position('ATHENA', 'bad-position');
    bad.evidence_ids = [id<EvidenceId>('invented')];
    expectProtocol('UNKNOWN_EVIDENCE', () => reduceAll([...initialEvents(), event('POSITION_PROPOSED', 8, { position: bad }, 'ATHENA')]));
  });

  test('Round 1 input exposes only the sealed case and evidence package', () => {
    const state = reduceAll(round1Events().slice(0, 2));
    const input = buildRound1SeatInput(state, 'ATHENA');
    expect(Object.keys(input).sort()).toEqual(['case', 'evidence_package', 'seat_id']);
    expect(JSON.stringify(input)).not.toContain('position-ares');
    expect((input as unknown as Record<string, unknown>).positions).toBeUndefined();
    expect((input as unknown as Record<string, unknown>).disagreements).toBeUndefined();
    expect((input as unknown as Record<string, unknown>).challenges).toBeUndefined();
  });

  test('position lock waits for all four eligible seats and preserves unavailable truth', () => {
    const before = reduceAll(initialEvents());
    expectProtocol('POSITION_LOCK_VIOLATION', () => reduceSwarmEvent(before, event('POSITIONS_LOCKED', 8, {})));
    const locked = reduceAll(fullLog().slice(0, 15));
    expect(locked.state).toBe('POSITIONS_LOCKED');
    expect(locked.positions).toHaveLength(3);
    expect(participation(locked).find((entry) => entry.seat_id === 'HADES')).toEqual({ seat_id: 'HADES', status: 'UNAVAILABLE', position_id: null, participated: false, reason: 'no configured execution' });
  });

  test('FAILED and ABSTAINED seats are distinct and create no fake position', () => {
    const failedEvents = [...initialEvents(), event('SEAT_FAILED', 8, { seat_id: 'HADES', reason: 'provider failed', execution: execution('FAILED') }, 'HADES')];
    const failed = reduceAll(failedEvents);
    expect(failed.seat_execution_state.HADES.status).toBe('FAILED');
    expect(failed.positions).toHaveLength(0);
    const abstainedEvents = [...initialEvents(), event('SEAT_ABSTAINED', 8, { seat_id: 'HADES', reason: 'out of mandate', execution: execution('ABSTAINED') }, 'HADES')];
    const abstained = reduceAll(abstainedEvents);
    expect(abstained.seat_execution_state.HADES.status).toBe('ABSTAINED');
    expect(abstained.seat_execution_state.HADES.status).not.toBe('FAILED');
    expect(abstained.positions).toHaveLength(0);
  });

  test('deterministic fallback cannot masquerade as independent success', () => {
    expect(() => ModelExecutionSchema.parse({ ...execution(), model_called: false })).toThrow();
    const bad = { ...execution(), status: 'SUCCESS' as const, fallback_used: true, fallback_reason: 'deterministic fallback' };
    expect(() => ModelExecutionSchema.parse(bad)).toThrow();
  });

  test('challenge references, budget, and response ownership are enforced', () => {
    const locked = reduceAll(fullLog().slice(0, 17));
    const selfChallenge = { challenge_id: id<ChallengeId>('self'), case_id: caseId, round: 1, from_seat: 'ATHENA' as const, to_seat: 'ATHENA' as const, target_position: id<PositionId>('position-athena'), target_claim: null, challenge_type: 'EVIDENCE' as const, reasoning: 'self', evidence_ids: [evidenceId] };
    expect(() => ChallengeSchema.parse(selfChallenge)).toThrow();
    const challenge = { challenge_id: id<ChallengeId>('challenge-budget'), case_id: caseId, round: 1, from_seat: 'ARES' as const, to_seat: 'ATHENA' as const, target_position: id<PositionId>('position-athena'), target_claim: null, challenge_type: 'EVIDENCE' as const, reasoning: 'challenge', evidence_ids: [evidenceId] };
    const challenged = reduceSwarmEvent(reduceSwarmEvent(locked, event('CHALLENGE_ROUND_STARTED', 18, { round: 1 })), event('CHALLENGE_EMITTED', 19, { challenge }, 'ARES'));
    const wrongResponse = { response_id: id<ChallengeResponseId>('wrong'), case_id: caseId, challenge_id: challenge.challenge_id, responding_seat: 'ARES' as const, action: 'DEFEND' as const, rationale: 'wrong seat', evidence_ids: [], revision_id: null };
    expectProtocol('UNKNOWN_REFERENCE', () => reduceSwarmEvent(challenged, event('CHALLENGE_RESPONSE_RECORDED', 20, { response: wrongResponse }, 'ARES')));
  });

  test('challenge budget cannot be bypassed by event ordering', () => {
    const budgetCase = createSwarmCase({
      case_id: id<SwarmCaseId>('budget-case'),
      question: 'Budgeted case',
      scope: swarmCase.scope,
      created_at: swarmCase.created_at,
      created_by: swarmCase.created_by,
      policy: { max_challenges: 1 },
    });
    const budgetPackage = sealEvidence(budgetCase, [evidence], { package_id: id<EvidencePackageId>('budget-package'), sealed_at: '2026-02-01T00:01:00.000Z' });
    let state = emptySwarmBlackboard();
    const budgetPosition = { ...position('ATHENA', 'budget-position'), case_id: budgetCase.case_id };
    const budgetEvents = [
      { ...event('CASE_CREATED', 1, { case: budgetCase }), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>('budget-event-1') },
      { ...event('EVIDENCE_SEALED', 2, { evidence_package: budgetPackage }), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>('budget-event-2') },
      { ...event('INDEPENDENT_ANALYSIS_STARTED', 3, {}), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>('budget-event-3') },
      ...(['ATHENA', 'ARES', 'HADES', 'APOLLO'] as const).map((seat_id, index) => ({ ...event('SEAT_STARTED', 4 + index, { seat_id }, seat_id), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>(`budget-event-${4 + index}`) })),
      { ...event('POSITION_PROPOSED', 8, { position: budgetPosition }, 'ATHENA'), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>('budget-event-8') },
      { ...event('SEAT_COMPLETED', 9, { seat_id: 'ATHENA', position_id: budgetPosition.position_id, execution: budgetPosition.execution }, 'ATHENA'), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>('budget-event-9') },
      ...(['ARES', 'HADES', 'APOLLO'] as const).map((seat_id, index) => ({ ...event('SEAT_UNAVAILABLE', 10 + index, { seat_id, reason: 'not configured', execution: execution('UNAVAILABLE') }, seat_id), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>(`budget-event-${10 + index}`) })),
      { ...event('POSITIONS_LOCKED', 13, {}), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>('budget-event-13') },
      { ...event('DISAGREEMENTS_FINALIZED', 14, {}), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>('budget-event-14') },
      { ...event('CHALLENGE_ROUND_STARTED', 15, { round: 1 }), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>('budget-event-15') },
    ] as SwarmExecutionEvent[];
    for (const next of budgetEvents) state = reduceSwarmEvent(state, next);
    const firstChallenge = { challenge_id: id<ChallengeId>('budget-challenge-1'), case_id: budgetCase.case_id, round: 1, from_seat: 'ARES' as const, to_seat: 'ATHENA' as const, target_position: budgetPosition.position_id, target_claim: null, challenge_type: 'EVIDENCE' as const, reasoning: 'first', evidence_ids: [evidenceId] };
    state = reduceSwarmEvent(state, { ...event('CHALLENGE_EMITTED', 16, { challenge: firstChallenge }, 'ARES'), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>('budget-event-16') });
    const secondChallenge = { ...firstChallenge, challenge_id: id<ChallengeId>('budget-challenge-2') };
    expectProtocol('BUDGET_EXCEEDED', () => reduceSwarmEvent(state, { ...event('CHALLENGE_EMITTED', 17, { challenge: secondChallenge }, 'ARES'), case_id: budgetCase.case_id, event_id: id<ExecutionEventId>('budget-event-17') }));
  });

  test('revision preserves old position and records complete lineage', () => {
    const log = fullLog().slice(0, 19);
    const state = reduceAll(log);
    const old = state.positions.find((item) => item.seat_id === 'ATHENA')!;
    const revised = { ...position('ATHENA', 'position-athena-revised', 2, 'REVISED'), conclusion: 'ATHENA revised conclusion', position_references: [old.position_id] };
    const revision = { revision_id: id<RevisionId>('revision-1'), case_id: caseId, old_position_id: old.position_id, new_position_id: revised.position_id, triggering_challenge_id: id<ChallengeId>('challenge-1'), triggering_response_id: id<ChallengeResponseId>('response-1'), changed_claim_ids: [revised.claims[0]!.claim_id], retained_claim_ids: [], reason: 'The challenge changed the conclusion.' };
    const response = { response_id: id<ChallengeResponseId>('response-1'), case_id: caseId, challenge_id: id<ChallengeId>('challenge-1'), responding_seat: 'ATHENA' as const, action: 'DEFEND' as const, rationale: 'The cited evidence supports the bounded observation.', evidence_ids: [evidenceId], revision_id: null };
    const revisedResponse = { ...response, action: 'REVISE' as const, revision_id: revision.revision_id };
    const withRevisionResponse = reduceSwarmEvent(state, event('CHALLENGE_RESPONSE_RECORDED', 20, { response: revisedResponse }, 'ATHENA'));
    const withRevision = reduceSwarmEvent(withRevisionResponse, event('REVISION_RECORDED', 21, { revision, position: revised }, 'ATHENA'));
    expect(withRevision.positions.map((item) => item.position_id)).toEqual([old.position_id, id<PositionId>('position-ares'), id<PositionId>('position-apollo'), revised.position_id]);
    expect(withRevision.revisions[0]!.old_position_id).toBe(old.position_id);
  });

  test('human authority is separate from every seat', () => {
    expect(() => SeatContractSchema.parse({ seat_id: 'ZEUS', mandate: 'bad', authority: 'HUMAN_DECISION' })).toThrow();
    expect(() => HumanDecisionSchema.parse({ decision_id: id<HumanDecisionId>('bad'), case_id: caseId, human_actor: 'ZEUS', decision: 'APPROVE', timestamp: '2026-02-01', note: 'bad', diverges_from_synthesis: false, divergence_reason: null })).toThrow();
    expect(SEAT_CONTRACTS.ZEUS.authority).toBe('SYNTHESIS');
  });

  test('synthesis is pending human decision and cannot leak Zeus authority', () => {
    const valid = fullLog()[25]!;
    expect(SwarmExecutionEventSchema.safeParse(valid).success).toBe(true);
    const leaked = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
    (leaked.synthesis as Record<string, unknown>).risk_summary = 'APPROVED_BY_ZEUS';
    expect(SwarmExecutionEventSchema.safeParse(leaked).success).toBe(false);
  });

  test('diagnostics reject secret-shaped fields', () => {
    const bad = { ...execution(), diagnostics: { api_key: 'secret' } };
    expect(ModelExecutionSchema.safeParse(bad).success).toBe(false);
    const badPrompt = { ...execution(), diagnostics: { raw_prompt: 'secret-shaped' } };
    expect(ModelExecutionSchema.safeParse(badPrompt).success).toBe(false);
  });

  test('Zeus cannot be a Round 1 position and cross-seat leakage is rejected', () => {
    const zeus = { ...position('ATHENA', 'zeus-position'), seat_id: 'ZEUS' };
    expect(AgentPositionSchema.safeParse(zeus).success).toBe(false);
    const leaking = { ...position('ATHENA', 'leaking-position'), position_references: [id<PositionId>('position-ares')] };
    expect(JSON.stringify(buildRound1SeatInput(reduceAll(round1Events().slice(0, 2)), 'ATHENA'))).not.toContain('position-ares');
    expectProtocol('ROUND_LEAKAGE', () => reduceAll([...initialEvents(), event('POSITION_PROPOSED', 8, { position: leaking }, 'ATHENA')]));
  });

  test('deterministic invalid permutations never bypass the closed terminal state', () => {
    const closed = reduceAll(fullLog());
    const invalid: SwarmExecutionEvent[] = [
      event('CASE_CREATED', 30, { case: swarmCase }),
      event('EVIDENCE_SEALED', 30, { evidence_package: packageValue }),
      event('CASE_CLOSED', 30, {}, 'HUMAN'),
    ];
    for (const candidate of invalid) expectProtocol('INVALID_TRANSITION', () => reduceSwarmEvent(closed, candidate));
    expect(closed.state).toBe('CLOSED');
  });

  test('seeded invalid event permutations remain rejected and never mutate the source state', () => {
    const source = reduceAll(initialEvents());
    const candidates = [
      event('POSITIONS_LOCKED', 8, {}),
      event('AUDIT_STARTED', 8, {}),
      event('CASE_CLOSED', 8, {}, 'HUMAN'),
      event('SYNTHESIS_STARTED', 8, {}, 'ZEUS'),
    ];
    for (let seed = 0; seed < 32; seed += 1) {
      const ordered = [...candidates].sort((a, b) => ((a.type.length * (seed + 3)) % 17) - ((b.type.length * (seed + 3)) % 17));
      for (const candidate of ordered) {
        const snapshot = JSON.stringify(source);
        expect(() => reduceSwarmEvent(source, { ...candidate, sequence: 8 + seed, event_id: id<ExecutionEventId>(`permutation-${seed}-${candidate.type}`) })).toThrow();
        expect(JSON.stringify(source)).toBe(snapshot);
      }
    }
  });

  test('all identical fixture logs produce identical blackboards', () => {
    const first = reduceAll(fullLog());
    const second = reduceAll(fullLog());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(DEFAULT_SWARM_POLICY.allow_evidence_reseal).toBe(false);
  });
});
