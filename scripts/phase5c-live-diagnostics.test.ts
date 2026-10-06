import { describe, expect, test } from 'bun:test';
import {
  PHASE5C_MAX_OUTPUT_TOKENS,
  phase5cArtifact,
  phase5cChallengeFixture,
  phase5cChallengeCandidateDiagnostic,
  phase5cConfigFromEnvironment,
  phase5cValidateChallengeSemantics,
  phase5cValidateResponseSemantics,
  validatePhase5cCollection,
  runChallengeDiagnostic,
  runResponseDiagnostic,
  mockTransport,
  type Phase5cConfig,
} from './phase5c-live-diagnostics';
import { Phase5ChallengeResponseSchema, type ChallengeResponse } from '../src/swarm/contracts';
import { ChallengeTypeSchema, DisagreementTypeSchema } from '../src/swarm/contracts';
import { PHASE5_CHALLENGE_GENERATION_PROVIDER_SCHEMA, phase5ChallengeDraftsToChallenges, phase5ChallengeGenerationSchema } from '../src/swarm/models/challenge-generator';
import { type HttpRequest, type HttpResponse, type HttpTransport } from '../src/swarm/models/transport';
import { allowedChallengeTypesForDisagreement, challengeDuplicateIdentity, challengeTypeCompatible, PHASE5_CHALLENGE_COMPATIBILITY_SOURCE, PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT, PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT, PHASE5_MAX_TOTAL_CHALLENGES } from '../src/swarm/debate/challenges';
import { reduceSwarmEvent } from '../src/swarm/engine/reducer';
import type { SwarmExecutionEvent } from '../src/swarm/contracts';

class RecordingTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly response: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>) {}
  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return this.response(request);
  }
}

function config(gate: 'SWARM_LIVE_CHALLENGE_CONFIRM' | 'SWARM_LIVE_CHALLENGE_RESPONSE_CONFIRM', overrides: Record<string, string | undefined> = {}): Phase5cConfig {
  return phase5cConfigFromEnvironment({
    SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096',
    XAI_API_KEY: 'PHASE5C_TEST_SECRET_DO_NOT_PRINT',
    [gate]: 'YES',
    ...overrides,
  }, gate);
}

function responseForChallenge(challenge = phase5cChallengeFixture(phase5cArtifact())): ChallengeResponse {
  const artifact = phase5cArtifact();
  const target = artifact.positions.find((position) => position.position_id === challenge.target_position)!;
  return {
    response_id: 'response-phase5c-test' as ChallengeResponse['response_id'],
    case_id: artifact.case.case_id,
    challenge_id: challenge.challenge_id,
    responding_seat: challenge.to_seat,
    action: 'DEFEND',
    rationale: 'The locked position remains supported by the cited evidence.',
    evidence_ids: ['EV-001'],
    revision_id: null,
    round: challenge.round,
    source_position: target.position_id,
    revision_lineage: [target.position_id],
  };
}

function challengeForSeat(base: ReturnType<typeof phase5cChallengeFixture>, artifact: ReturnType<typeof phase5cArtifact>, seat: 'ATHENA' | 'HADES' | 'APOLLO', challengeId: string, disagreementId = base.disagreement_id!, challengeType: 'ASSUMPTION' | 'CONFIDENCE' | 'CONTROL' = 'ASSUMPTION') {
  const target = artifact.positions.find((position) => position.seat_id === seat)!;
  return { ...base, challenge_id: challengeId as typeof base.challenge_id, to_seat: seat, target_position: target.position_id, target_claim: target.claims[0]!.claim_id, disagreement_id: disagreementId, challenge_type: challengeType };
}

function emitChallenge(state: ReturnType<typeof phase5cArtifact>['blackboard'], challenge: ReturnType<typeof phase5cChallengeFixture>) {
  const sequence = state.execution_events.length + 1;
  return reduceSwarmEvent(state, { event_id: `phase5c2-event-${sequence}` as SwarmExecutionEvent['event_id'], case_id: state.case!.case_id, protocol_version: state.case!.protocol_version, sequence, timestamp: 'PHASE5C2_OFFLINE', actor: 'ARES', type: 'CHALLENGE_EMITTED', challenge } as SwarmExecutionEvent);
}

describe('Phase 5C live adversarial certification preparation', () => {
  test('uses exactly one bounded ARES request and reaches the serialized 4096-token xAI contract', async () => {
    const transport = new RecordingTransport((request) => mockTransport().request(request));
    const report = await runChallengeDiagnostic(config('SWARM_LIVE_CHALLENGE_CONFIRM'), transport);
    const body = JSON.parse(transport.requests[0]!.body!) as { model: string; max_tokens: number; response_format: { json_schema: { name: string; strict: boolean; schema: { properties: { challenges: { maxItems: number } } } } }; messages: Array<{ content: string }> };
    expect(report.CHALLENGE_ACCEPTED).toBe(true);
    expect(report.TARGET_DISAGREEMENT_ID).toBe('disagreement-assumption-1');
    expect(report.TARGET_SEATS).toEqual(['ATHENA']);
    expect(report.CHALLENGE_TYPES).toEqual(['ASSUMPTION']);
    expect(report.REQUEST_BUDGET_ENFORCED).toBe('PASS');
    expect(transport.requests).toHaveLength(1);
    expect(body.model).toBe('grok-4.7');
    expect(body.max_tokens).toBe(PHASE5C_MAX_OUTPUT_TOKENS);
    expect(body.response_format.json_schema.name).toBe('swarm_phase5_challenge_generation');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties.challenges.maxItems).toBe(2);
    expect(body.response_format.json_schema.schema.properties.challenges.items.properties.challenge_type.enum).toEqual(['ASSUMPTION']);
    expect(body.messages.some((message) => message.content.includes('at most two high-value targeted challenges'))).toBe(true);
    expect(body.messages.some((message) => message.content.includes('allowed challenge_type values are ASSUMPTION'))).toBe(true);
    expect(report.TARGET_DISAGREEMENT_TYPE).toBe('ASSUMPTION');
    expect(report.ALLOWED_CHALLENGE_TYPES).toEqual(['ASSUMPTION']);
    expect(report.PROVIDER_CHALLENGE_TYPE_ENUM).toEqual(['ASSUMPTION']);
    expect(report.COMPATIBILITY_SOURCE).toBe(PHASE5_CHALLENGE_COMPATIBILITY_SOURCE);
    expect(report.SCHEMA_COMPATIBILITY_ALIGNMENT).toBe('PASS');
    expect(report.PROMPT_COMPATIBILITY_ALIGNMENT).toBe('PASS');
  });

  test('uses exactly one private ATHENA response request with no peer, Zeus, or human context', async () => {
    const transport = new RecordingTransport((request) => mockTransport().request(request));
    const report = await runResponseDiagnostic(config('SWARM_LIVE_CHALLENGE_RESPONSE_CONFIRM'), transport);
    const body = JSON.parse(transport.requests[0]!.body!) as { max_tokens: number; response_format: { json_schema: { name: string; strict: boolean } }; messages: Array<{ content: string }> };
    const userContent = body.messages.find((message) => message.content.includes('SEALED_SWARM_CONTEXT_JSON:'))!.content;
    const context = JSON.parse(userContent.split('SEALED_SWARM_CONTEXT_JSON:')[1]!) as Record<string, unknown>;
    expect(report.FINAL_EXECUTION_STATUS).toBe('SUCCESS');
    expect(report.RESPONSE_DTO_VALIDATION).toBe('PASS');
    expect(report.RESPONSE_SEMANTIC_VALIDATION).toBe('PASS');
    expect(report.PROTOCOL_VALIDATION).toBe('PASS');
    expect(report.ACTION).toBe('DEFEND');
    expect(report.PRIVACY_BOUNDARY).toBe('PASS');
    expect(transport.requests).toHaveLength(1);
    expect(body.max_tokens).toBe(4096);
    expect(body.response_format.json_schema.name).toBe('swarm_seat_challenge_v1');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(context).not.toHaveProperty('all_positions');
    expect(context).not.toHaveProperty('peer_positions');
    expect(context).not.toHaveProperty('zeus');
    expect(context).not.toHaveProperty('human_decision');
  });

  test('confirmation gates prevent both diagnostics from making any request', async () => {
    const challengeTransport = new RecordingTransport((request) => mockTransport().request(request));
    const responseTransport = new RecordingTransport((request) => mockTransport().request(request));
    const challenge = await runChallengeDiagnostic(phase5cConfigFromEnvironment({ SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096', XAI_API_KEY: 'secret' }, 'SWARM_LIVE_CHALLENGE_CONFIRM'), challengeTransport);
    const response = await runResponseDiagnostic(phase5cConfigFromEnvironment({ SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '4096', XAI_API_KEY: 'secret' }, 'SWARM_LIVE_CHALLENGE_RESPONSE_CONFIRM'), responseTransport);
    expect(challenge.FINAL_EXECUTION_STATUS).toBe('NOT_RUN');
    expect(response.FINAL_EXECUTION_STATUS).toBe('NOT_RUN');
    expect(challengeTransport.requests).toHaveLength(0);
    expect(responseTransport.requests).toHaveLength(0);
  });

  test('output-budget mismatch blocks before transport', async () => {
    const transport = new RecordingTransport((request) => mockTransport().request(request));
    const mismatched = { ...config('SWARM_LIVE_CHALLENGE_CONFIRM'), max_output_tokens: 1600 };
    const report = await runChallengeDiagnostic(mismatched, transport);
    expect(report.FINAL_EXECUTION_STATUS).toBe('BLOCKED');
    expect(report.FAILURE_CODE).toBe('OUTPUT_TOKEN_BUDGET_PREFLIGHT_BLOCKED');
    expect(transport.requests).toHaveLength(0);
  });

  test('malformed structured output is rejected with one request and no fallback', async () => {
    const transport = new RecordingTransport((request) => mockTransport('MALFORMED').request(request));
    const report = await runChallengeDiagnostic(config('SWARM_LIVE_CHALLENGE_CONFIRM'), transport);
    expect(report.CHALLENGE_ACCEPTED).toBe(false);
    expect(report.FINAL_EXECUTION_STATUS).toBe('REJECTED');
    expect(report.JSON_PARSE).toBe('FAIL');
    expect(report.RETRY_DISABLED).toBe('PASS');
    expect(report.FALLBACK_DISABLED).toBe('PASS');
    expect(transport.requests).toHaveLength(1);
  });

  test('truncated structured output remains rejected and classified as output-token truncation', async () => {
    const transport = new RecordingTransport((request) => mockTransport('TRUNCATED').request(request));
    const report = await runResponseDiagnostic(config('SWARM_LIVE_CHALLENGE_RESPONSE_CONFIRM'), transport);
    expect(report.FINAL_EXECUTION_STATUS).toBe('REJECTED');
    expect(report.TRUNCATION_DETECTED).toBe(true);
    expect(report.FAILURE_STAGE).toBe('RESPONSE_TRUNCATED');
    expect(report.FAILURE_CODE).toBe('OUTPUT_TOKEN_LIMIT');
    expect(report.RETRY_DISABLED).toBe('PASS');
    expect(report.FALLBACK_DISABLED).toBe('PASS');
    expect(transport.requests).toHaveLength(1);
  });

  test('strict response contract accepts every permitted action while semantic checks reject wrong target and unknown evidence', () => {
    const artifact = phase5cArtifact();
    const challenge = phase5cChallengeFixture(artifact);
    const valid = responseForChallenge(challenge);
    for (const action of ['DEFEND', 'REVISE', 'CONCEDE', 'REQUEST_EVIDENCE', 'ABSTAIN'] as const) {
      const candidate = { ...valid, action, revision_id: action === 'REVISE' || action === 'CONCEDE' ? 'revision-phase5c-test' : null };
      expect(Phase5ChallengeResponseSchema.safeParse(candidate).success, action).toBe(true);
    }
    expect(phase5cValidateResponseSemantics(valid, challenge, artifact)).toBe(true);
    expect(phase5cValidateResponseSemantics({ ...valid, responding_seat: 'ARES' } as ChallengeResponse, challenge, artifact)).toBe(false);
    expect(phase5cValidateResponseSemantics({ ...valid, evidence_ids: ['EV-UNKNOWN'] } as ChallengeResponse, challenge, artifact)).toBe(false);
    expect(phase5cValidateResponseSemantics({ ...valid, source_position: 'position-hades-1' } as ChallengeResponse, challenge, artifact)).toBe(false);
  });

  test('ARES semantic validation preserves authority, target, disagreement, and sealed-evidence boundaries', () => {
    const artifact = phase5cArtifact();
    const challenge = phase5cChallengeFixture(artifact);
    expect(phase5cValidateChallengeSemantics(challenge, artifact)).toBe(true);
    expect(phase5cValidateChallengeSemantics({ ...challenge, from_seat: 'ATHENA' } as typeof challenge, artifact)).toBe(false);
    expect(phase5cValidateChallengeSemantics({ ...challenge, evidence_ids: ['EV-UNKNOWN'] } as typeof challenge, artifact)).toBe(false);
    expect(phase5cValidateChallengeSemantics({ ...challenge, to_seat: 'ARES' } as typeof challenge, artifact)).toBe(false);
    expect(phase5cValidateChallengeSemantics({ ...challenge, target_position: 'position-unknown' } as typeof challenge, artifact)).toBe(false);
    expect(phase5cValidateChallengeSemantics({ ...challenge, disagreement_id: 'disagreement-unknown' } as typeof challenge, artifact)).toBe(false);
    const incompatible = phase5cChallengeCandidateDiagnostic({ ...challenge, challenge_type: 'CONFIDENCE' } as typeof challenge, artifact, challenge.disagreement_id);
    expect(incompatible.SEMANTIC).toBe('FAIL');
    expect(incompatible.CHECKS.challenge_type_compatible).toBe('FAIL');
  });

  test('canonical disagreement compatibility drives semantic validation, schema projection, and prompt-visible values', () => {
    const artifact = phase5cArtifact();
    const assumption = artifact.disagreements.find((item) => item.type === 'ASSUMPTION')!;
    const allowed = allowedChallengeTypesForDisagreement(assumption.type);
    expect(allowed).toEqual(['ASSUMPTION']);
    expect(challengeTypeCompatible('ASSUMPTION', 'ASSUMPTION')).toBe(true);
    expect(challengeTypeCompatible('ASSUMPTION', 'SEVERITY')).toBe(false);
    const contextSchema = phase5ChallengeGenerationSchema(2, allowed);
    const provider = contextSchema.json_schema!.properties as { challenges: { items: { properties: { challenge_type: { enum: readonly string[] } } } } };
    expect(provider.challenges.items.properties.challenge_type.enum).toEqual([...allowed]);
    const draft = { challenges: [{ disagreement_id: assumption.disagreement_id, to_seat: 'ATHENA' as const, target_type: 'CLAIM' as const, target_position: 'position-athena-1' as const, target_claim: 'position-athena-1-claim-1', challenge_type: 'SEVERITY' as const, challenge_text: 'Challenge the selected assumption.', evidence_ids: ['EV-001'], requested_action: 'DEFEND' as const }] };
    expect(contextSchema.validate(draft).success).toBe(false);
    expect(phase5cChallengeCandidateDiagnostic({ ...phase5cChallengeFixture(artifact), challenge_type: 'SEVERITY' } as ReturnType<typeof phase5cChallengeFixture>, artifact, assumption.disagreement_id).CHECKS.challenge_type_compatible).toBe('FAIL');
    expect(allowedChallengeTypesForDisagreement('RISK_RATING')).toEqual(['SEVERITY']);
    expect(allowedChallengeTypesForDisagreement('EVIDENCE_INTERPRETATION')).toEqual(['EVIDENCE']);
    expect(allowedChallengeTypesForDisagreement('CONTROL_EFFECTIVENESS')).toEqual(['CONTROL']);
    expect(allowedChallengeTypesForDisagreement('CONFIDENCE')).toEqual(['CONFIDENCE']);
  });

  test('three schema-valid drafts are diagnosed per candidate and rejected at the declared per-disagreement budget boundary', async () => {
    const artifact = phase5cArtifact();
    const disagreementId = 'disagreement-assumption-1';
    const multi = new RecordingTransport(() => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ challenges: [
        { disagreement_id: disagreementId, to_seat: 'ATHENA', target_type: 'CLAIM', target_position: 'position-athena-1', target_claim: 'position-athena-1-claim-1', challenge_type: 'ASSUMPTION', challenge_text: 'Address the targeted assumption using sealed evidence.', evidence_ids: ['EV-001'], requested_action: 'DEFEND' },
        { disagreement_id: disagreementId, to_seat: 'HADES', target_type: 'CLAIM', target_position: 'position-hades-1', target_claim: 'position-hades-1-claim-1', challenge_type: 'ASSUMPTION', challenge_text: 'Address the targeted assumption using sealed evidence.', evidence_ids: ['EV-001'], requested_action: 'DEFEND' },
        { disagreement_id: disagreementId, to_seat: 'APOLLO', target_type: 'CLAIM', target_position: 'position-apollo-1', target_claim: 'position-apollo-1-claim-1', challenge_type: 'ASSUMPTION', challenge_text: 'Address the targeted assumption using sealed evidence.', evidence_ids: ['EV-001'], requested_action: 'DEFEND' },
      ] }) }, finish_reason: 'stop' }] }),
    }));
    const report = await runChallengeDiagnostic(config('SWARM_LIVE_CHALLENGE_CONFIRM'), multi);
    expect(report.MODEL_EXECUTION_STATUS).toBe('SUCCESS');
    expect(report.ARTIFACT_VALIDATION_STATUS).toBe('REJECTED');
    expect(report.FINAL_CERTIFICATION_STATUS).toBe('FAIL');
    expect(report.CHALLENGE_COUNT).toBe(3);
    expect(report.CHALLENGE_DTO_VALIDATION).toBe('PASS');
    expect(report.CHALLENGE_CONVERSION).toBe('PASS');
    expect(report.CHALLENGE_SEMANTIC_VALIDATION).toBe('PASS');
    expect(report.PROTOCOL_VALIDATION).toBe('FAIL');
    expect(report.FAILURE_STAGE).toBe('PROTOCOL_VALIDATION');
    expect(report.FAILURE_CODE).toBe('CHALLENGE_PER_DISAGREEMENT_BUDGET_EXCEEDED');
    expect(report.CANDIDATE_BUDGET_VALIDATION).toBe('PASS');
    expect(report.COLLECTION_BUDGET_VALIDATION).toBe('FAIL');
    expect(report.DUPLICATE_VALIDATION).toBe('PASS');
    expect(report.CHALLENGE_DIAGNOSTICS).toHaveLength(3);
    expect(report.CHALLENGE_DIAGNOSTICS.every((candidate) => candidate.DTO === 'PASS' && candidate.SEMANTIC === 'PASS' && candidate.PROTOCOL === 'PASS')).toBe(true);
    expect(report.CHALLENGE_DIAGNOSTICS.map((candidate) => candidate.TARGET_SEAT)).toEqual(['ATHENA', 'HADES', 'APOLLO']);
    expect(report.CHALLENGE_DIAGNOSTICS.map((candidate) => candidate.CHALLENGE_TYPE)).toEqual(['ASSUMPTION', 'ASSUMPTION', 'ASSUMPTION']);
    expect(multi.requests).toHaveLength(1);
  });

  test('duplicate identity is distinct from disagreement identity and the declared two-per-disagreement budget is enforced', () => {
    const artifact = phase5cArtifact();
    const first = phase5cChallengeFixture(artifact);
    const second = challengeForSeat(first, artifact, 'HADES', 'challenge-hades-phase5c');
    const third = challengeForSeat(first, artifact, 'APOLLO', 'challenge-apollo-phase5c');
    expect(challengeDuplicateIdentity(first)).not.toBe(challengeDuplicateIdentity(second));
    expect(challengeDuplicateIdentity(first)).toBe(challengeDuplicateIdentity({ ...first, challenge_id: 'challenge-duplicate' as typeof first.challenge_id }));
    const two = validatePhase5cCollection([first, second], []);
    expect(two.duplicateValid).toBe(true);
    expect(two.disagreementBudgetValid).toBe(true);
    expect(two.budgetValid).toBe(true);
    const three = validatePhase5cCollection([first, second, third], []);
    expect(three.duplicateValid).toBe(true);
    expect(three.disagreementBudgetValid).toBe(false);
    expect(three.budgetValid).toBe(false);
    expect(three.failureCode).toBe('CHALLENGE_PER_DISAGREEMENT_BUDGET_EXCEEDED');
    expect(PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT).toBe(2);
  });

  test('the production reducer accepts two distinct targets for one disagreement, rejects semantic duplicates, and rejects the third by budget', () => {
    const artifact = phase5cArtifact();
    const first = phase5cChallengeFixture(artifact);
    const second = challengeForSeat(first, artifact, 'HADES', 'challenge-hades-phase5c');
    const third = challengeForSeat(first, artifact, 'APOLLO', 'challenge-apollo-phase5c');
    const duplicate = { ...first, challenge_id: 'challenge-duplicate' as typeof first.challenge_id };
    const once = emitChallenge(artifact.blackboard, first);
    const twice = emitChallenge(once, second);
    expect(twice.challenges).toHaveLength(2);
    expect(() => emitChallenge(once, duplicate)).toThrow(/DUPLICATE_ID/);
    expect(() => emitChallenge(twice, third)).toThrow(/BUDGET_EXCEEDED/);
  });

  test('candidate and collection budget telemetry are separate, and total/seat bounds remain fail-closed', () => {
    const artifact = phase5cArtifact();
    const first = phase5cChallengeFixture(artifact);
    const candidates = [
      first,
      challengeForSeat(first, artifact, 'HADES', 'challenge-hades-phase5c'),
      challengeForSeat(first, artifact, 'APOLLO', 'challenge-apollo-phase5c'),
    ];
    const candidateDiagnostics = candidates.map((challenge) => phase5cChallengeCandidateDiagnostic(challenge, artifact, first.disagreement_id!, candidates));
    expect(candidateDiagnostics.every((candidate) => candidate.CHECKS.budget_valid === 'PASS')).toBe(true);
    expect(validatePhase5cCollection(candidates, candidateDiagnostics).budgetValid).toBe(false);
    expect(validatePhase5cCollection(candidates.map((challenge, index) => ({ ...challenge, disagreement_id: `disagreement-${index}` })), []).budgetValid).toBe(true);
    const seatOverflow = Array.from({ length: 4 }, (_, index) => ({ ...first, challenge_id: `challenge-seat-${index}` as typeof first.challenge_id, disagreement_id: `disagreement-seat-${index}` as typeof first.disagreement_id }));
    expect(validatePhase5cCollection(seatOverflow, []).targetSeatBudgetValid).toBe(false);
    const totalOverflow = Array.from({ length: 7 }, (_, index) => ({ ...first, challenge_id: `challenge-total-${index}` as typeof first.challenge_id, disagreement_id: `disagreement-total-${index}` as typeof first.disagreement_id, to_seat: (['ATHENA', 'HADES', 'APOLLO'] as const)[index % 3] }));
    expect(validatePhase5cCollection(totalOverflow, []).totalBudgetValid).toBe(false);
    expect(PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT).toBe(3);
    expect(PHASE5_MAX_TOTAL_CHALLENGES).toBe(6);
  });

  test('reports are sanitized and do not retain credentials or raw model text', async () => {
    const secret = 'PHASE5C_SECRET_SHOULD_NEVER_APPEAR';
    const report = await runChallengeDiagnostic(config('SWARM_LIVE_CHALLENGE_CONFIRM', { XAI_API_KEY: secret }), mockTransport());
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('SEALED_SWARM_CONTEXT_JSON');
    expect(serialized).not.toContain('raw_response');
  });

  test('provider and DTO challenge vocabularies remain aligned, while runtime owns canonical identity fields', () => {
    const providerProperties = PHASE5_CHALLENGE_GENERATION_PROVIDER_SCHEMA.properties as { challenges: { items: { properties: { challenge_type: { enum: readonly string[] } } } } };
    expect(providerProperties.challenges.items.properties.challenge_type.enum).toEqual([...ChallengeTypeSchema.options]);
    expect(DisagreementTypeSchema.options).toContain('ASSUMPTION');
    expect(DisagreementTypeSchema.options).toContain('CONFIDENCE');
    const artifact = phase5cArtifact();
    const input = { case: { case_id: artifact.case.case_id, protocol_version: artifact.case.protocol_version, question: artifact.case.question, scope: artifact.case.scope, policy: artifact.case.policy }, evidence_package: artifact.evidence_package, positions: artifact.positions, disagreements: [artifact.disagreements[0]!] };
    const challenge = phase5ChallengeDraftsToChallenges(input, { challenges: [{ disagreement_id: artifact.disagreements[0]!.disagreement_id, to_seat: 'ATHENA', target_type: 'CLAIM', target_position: 'position-athena-1', target_claim: 'position-athena-1-claim-1', challenge_type: 'ASSUMPTION', challenge_text: 'Address the targeted assumption using sealed evidence.', evidence_ids: ['EV-001'], requested_action: 'DEFEND' }] });
    expect(challenge[0]!.challenge_id).toBe('challenge-1');
    expect(challenge[0]!.case_id).toBe(artifact.case.case_id);
    expect(challenge[0]!.round).toBe(1);
    expect(challenge[0]!.from_seat).toBe('ARES');
  });
});
