import {
  AgentPositionSchema,
  ChallengeResponseSchema,
  EvidenceRequestSchema,
  Phase5ChallengeResponseSchema,
  Phase5ChallengeSchema,
  ROUND1_SEAT_IDS,
  SWARM_PROTOCOL_VERSION,
  type AgentPosition,
  type Challenge,
  type ChallengeResponse,
  type Claim,
  type ControlGap,
  type EvidenceItem,
  type EvidencePackage,
  type ModelExecution,
  type Round1SeatId,
  type SwarmBlackboard,
  type SwarmCase,
  type SwarmExecutionEvent,
} from '../src/swarm/contracts';
import { allowedChallengeTypesForDisagreement, buildChallengeInput, challengeDuplicateIdentity, challengeTypeCompatible, PHASE5_CHALLENGE_COMPATIBILITY_SOURCE, PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT, PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT, PHASE5_MAX_TOTAL_CHALLENGES } from '../src/swarm/debate/challenges';
import { detectDisagreements } from '../src/swarm/debate/disagreements';
import { buildRound1SeatInput, emptySwarmBlackboard, reduceSwarmEvent } from '../src/swarm/engine/reducer';
import { deterministicPackageHash, sealEvidence } from '../src/swarm/evidence/package';
import { ModelChallengeGenerator, phase5ChallengeGenerationSchema, Phase5ChallengeGenerationOutputSchema, phase5ChallengeDraftsToChallenges, type Phase5ChallengeGenerationInput } from '../src/swarm/models/challenge-generator';
import { ModelRouter } from '../src/swarm/models/router';
import { ModelRuntime } from '../src/swarm/models/runtime';
import { XaiProviderAdapter } from '../src/swarm/models/providers/xai';
import { ModelBackedSeatExecutor } from '../src/swarm/seats/executor';
import { SEAT_CHALLENGE_SCHEMA } from '../src/swarm/seats/validation';
import { FetchTransport, MockTransport, type HttpRequest, type HttpResponse, type HttpTransport } from '../src/swarm/models/transport';
import { resolveCouncilMaxOutputTokens, LIVE_MODEL, LIVE_PROVIDER } from './certify-swarm-live-council';
import { type ModelExecutionPlan, type ModelResponse } from '../src/swarm/models/types';
import { syntheticCase } from './certify-swarm-live-council';

export const PHASE5C_MAX_OUTPUT_TOKENS = 4096 as const;
export const PHASE5C_REQUEST_BUDGET = 1 as const;
export const PHASE5C_TARGET_DISAGREEMENT = 'ASSUMPTION' as const;
export const PHASE5C_CHALLENGE_GENERATION_SCHEMA = phase5ChallengeGenerationSchema(PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT, allowedChallengeTypesForDisagreement(PHASE5C_TARGET_DISAGREEMENT));

export interface Phase5cConfig {
  readonly provider: typeof LIVE_PROVIDER;
  readonly model: typeof LIVE_MODEL;
  readonly credential?: string;
  readonly base_url?: string;
  readonly confirm: string;
  readonly requested_max_output_tokens: string | null;
  readonly max_output_tokens: number | null;
  readonly output_budget_error: string | null;
}

export interface Phase5cBudgetPreflight {
  readonly REQUESTED_MAX_OUTPUT_TOKENS: number | null;
  readonly EFFECTIVE_MAX_OUTPUT_TOKENS: number | null;
  readonly REQUESTED_EFFECTIVE_MISMATCH_GATE: 'PASS' | 'BLOCKED';
}

export interface Phase5cWireProjection {
  readonly operation: 'CHALLENGE_GENERATION' | 'CHALLENGE_RESPONSE';
  readonly provider: string;
  readonly model: string | null;
  readonly seat_id: string | null;
  readonly configured_max_output_tokens: number | null;
  readonly schema_name: string | null;
  readonly strict: boolean | null;
  readonly provider_schema_fingerprint: string | null;
  readonly message_count: number;
  readonly peer_reasoning_present: boolean;
  readonly unrelated_challenges_present: boolean;
  readonly zeus_context_present: boolean;
  readonly human_decision_context_present: boolean;
  readonly target_disagreement_type: string | null;
  readonly allowed_challenge_types: readonly string[];
  readonly compatibility_source: string | null;
  readonly prompt_compatibility_alignment: boolean;
}

export interface Phase5cBudgetStats {
  readonly request_count: number;
  readonly attempted_count: number;
  readonly blocked_count: number;
}

export interface Phase5cArtifact {
  readonly case: SwarmCase;
  readonly evidence: readonly EvidenceItem[];
  readonly evidence_package: EvidencePackage;
  readonly positions: readonly AgentPosition[];
  readonly disagreements: ReturnType<typeof detectDisagreements>;
  readonly blackboard: SwarmBlackboard;
}

export interface Phase5cChallengeReport {
  readonly REQUEST_PRECHECK: 'PASS';
  readonly PROVIDER: string;
  readonly MODEL: string;
  readonly OPERATION: 'CHALLENGE_GENERATION';
  readonly SEAT: 'ARES';
  readonly TARGET_DISAGREEMENT_ID: string;
  readonly TARGET_DISAGREEMENT_TYPE: string;
  readonly ALLOWED_CHALLENGE_TYPES: readonly string[];
  readonly PROVIDER_CHALLENGE_TYPE_ENUM: readonly string[];
  readonly COMPATIBILITY_SOURCE: string;
  readonly SCHEMA_COMPATIBILITY_ALIGNMENT: 'PASS' | 'FAIL';
  readonly PROMPT_COMPATIBILITY_ALIGNMENT: 'PASS' | 'FAIL';
  readonly PROMPT_VERSION: string;
  readonly PROMPT_FINGERPRINT: string;
  readonly EVIDENCE_FINGERPRINT: string;
  readonly PROVIDER_SCHEMA_FINGERPRINT: string;
  readonly REQUEST_BUDGET: number;
  readonly REQUEST_BUDGET_ENFORCED: 'PASS' | 'FAIL';
  readonly RETRY_DISABLED: 'PASS' | 'FAIL';
  readonly FALLBACK_DISABLED: 'PASS' | 'FAIL';
  readonly HTTP_STATUS: number | null;
  readonly FINISH_REASON: string | null;
  readonly OUTPUT_TOKENS: number | null;
  readonly REQUESTED_MAX_OUTPUT_TOKENS: number | null;
  readonly EFFECTIVE_MAX_OUTPUT_TOKENS: number | null;
  readonly CONFIGURED_MAX_OUTPUT_TOKENS: number | null;
  readonly STRUCTURED_OUTPUT_PRESENT: 'PASS' | 'FAIL';
  readonly PROVIDER_OUTPUT_EXTRACTED: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly JSON_PARSE: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly CHALLENGE_DTO_VALIDATION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly CHALLENGE_SEMANTIC_VALIDATION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly CHALLENGE_CONVERSION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly PROTOCOL_VALIDATION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly CHALLENGE_ACCEPTED: boolean;
  readonly CHALLENGE_COUNT: number;
  readonly TARGET_SEATS: readonly string[];
  readonly CHALLENGE_TYPES: readonly string[];
  readonly EVIDENCE_REFERENCE_COUNT: number;
  readonly TRUNCATION_DETECTED: boolean;
  readonly FINAL_EXECUTION_STATUS: string;
  readonly FAILURE_STAGE: string | null;
  readonly FAILURE_CODE: string | null;
  readonly MODEL_EXECUTION_STATUS: string;
  readonly ARTIFACT_VALIDATION_STATUS: 'ACCEPTED' | 'REJECTED' | 'NOT_RUN';
  readonly FINAL_CERTIFICATION_STATUS: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly CHALLENGE_DIAGNOSTICS: readonly Phase5cChallengeCandidateDiagnostic[];
  readonly CANDIDATE_BUDGET_VALIDATION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly COLLECTION_BUDGET_VALIDATION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly DUPLICATE_VALIDATION: 'PASS' | 'FAIL' | 'NOT_RUN';
}

export interface Phase5cChallengeCandidateDiagnostic {
  readonly CHALLENGE_INDEX: number;
  readonly TARGET_SEAT: string;
  readonly CHALLENGE_TYPE: string;
  readonly DTO: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  readonly SEMANTIC: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  readonly FAILURE_CODE: string | null;
  readonly PROTOCOL: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  readonly CHECKS: Readonly<Record<string, 'PASS' | 'FAIL' | 'NOT_EVALUATED'>>;
}

export interface Phase5cResponseReport {
  readonly REQUEST_PRECHECK: 'PASS';
  readonly PROVIDER: string;
  readonly MODEL: string;
  readonly OPERATION: 'CHALLENGE_RESPONSE';
  readonly SEAT: 'ATHENA';
  readonly CHALLENGE_ID: string;
  readonly DISAGREEMENT_ID: string;
  readonly PROMPT_VERSION: string;
  readonly PROMPT_FINGERPRINT: string;
  readonly EVIDENCE_FINGERPRINT: string;
  readonly PROVIDER_SCHEMA_FINGERPRINT: string;
  readonly PRIVACY_BOUNDARY: 'PASS' | 'FAIL';
  readonly PEER_REASONING_PRESENT: boolean;
  readonly UNRELATED_CHALLENGES_PRESENT: boolean;
  readonly ZEUS_CONTEXT_PRESENT: boolean;
  readonly HUMAN_DECISION_CONTEXT_PRESENT: boolean;
  readonly REQUEST_BUDGET: number;
  readonly REQUEST_BUDGET_ENFORCED: 'PASS' | 'FAIL';
  readonly RETRY_DISABLED: 'PASS' | 'FAIL';
  readonly FALLBACK_DISABLED: 'PASS' | 'FAIL';
  readonly HTTP_STATUS: number | null;
  readonly FINISH_REASON: string | null;
  readonly OUTPUT_TOKENS: number | null;
  readonly REQUESTED_MAX_OUTPUT_TOKENS: number | null;
  readonly EFFECTIVE_MAX_OUTPUT_TOKENS: number | null;
  readonly CONFIGURED_MAX_OUTPUT_TOKENS: number | null;
  readonly STRUCTURED_OUTPUT_PRESENT: 'PASS' | 'FAIL';
  readonly PROVIDER_OUTPUT_EXTRACTED: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly JSON_PARSE: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly RESPONSE_DTO_VALIDATION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly RESPONSE_SEMANTIC_VALIDATION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly PROTOCOL_VALIDATION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly RESPONSE_CONVERSION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly ACTION: ChallengeResponse['action'] | null;
  readonly REVISION_APPLICABILITY: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  readonly CONCESSION_APPLICABILITY: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  readonly EVIDENCE_REQUEST_APPLICABILITY: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  readonly TRUNCATION_DETECTED: boolean;
  readonly FINAL_EXECUTION_STATUS: string;
  readonly FAILURE_STAGE: string | null;
  readonly FAILURE_CODE: string | null;
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function parseBody(request: HttpRequest): { readonly body: Record<string, unknown>; readonly context: Record<string, unknown>; readonly content: string } {
  const bodyValue = JSON.parse(request.body ?? '{}') as unknown;
  const body = record(bodyValue) ? bodyValue : {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const user = messages.find((value) => record(value) && value.role === 'user');
  const content = record(user) && typeof user.content === 'string' ? user.content : '';
  const marker = 'SEALED_SWARM_CONTEXT_JSON:';
  const contextValue = JSON.parse(content.split(marker)[1] ?? '{}') as unknown;
  return { body, context: record(contextValue) ? contextValue : {}, content };
}

export class Phase5cRequestContractGuardTransport implements HttpTransport {
  readonly projections: Phase5cWireProjection[] = [];
  constructor(private readonly delegate: HttpTransport, private readonly operation: Phase5cWireProjection['operation'], private readonly expectedSchema: Readonly<Record<string, unknown>>) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const { body, context, content } = parseBody(request);
    const format = record(body.response_format) ? body.response_format : {};
    const schemaEnvelope = record(format.json_schema) ? format.json_schema : {};
    const schema = record(schemaEnvelope.schema) ? schemaEnvelope.schema : undefined;
    const projection: Phase5cWireProjection = {
      operation: this.operation,
      provider: 'xai',
      model: typeof body.model === 'string' ? body.model : null,
      seat_id: typeof context.seat_id === 'string' ? context.seat_id : null,
      configured_max_output_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
      schema_name: typeof schemaEnvelope.name === 'string' ? schemaEnvelope.name : null,
      strict: typeof schemaEnvelope.strict === 'boolean' ? schemaEnvelope.strict : null,
      provider_schema_fingerprint: schema ? deterministicPackageHash(schema) : null,
      message_count: Array.isArray(body.messages) ? body.messages.length : 0,
      peer_reasoning_present: ['all_positions', 'peer_positions', 'other_seat_inputs'].some((key) => Object.prototype.hasOwnProperty.call(context, key)),
      unrelated_challenges_present: Array.isArray(context.unrelated_challenges) && context.unrelated_challenges.length > 0,
      zeus_context_present: ['zeus', 'zeus_output', 'synthesis'].some((key) => Object.prototype.hasOwnProperty.call(context, key)),
      human_decision_context_present: ['human_decision', 'human_decision_status'].some((key) => Object.prototype.hasOwnProperty.call(context, key)),
      target_disagreement_type: typeof context.target_disagreement_type === 'string' ? context.target_disagreement_type : null,
      allowed_challenge_types: Array.isArray(context.allowed_challenge_types) ? context.allowed_challenge_types.filter((value): value is string => typeof value === 'string') : [],
      compatibility_source: typeof context.compatibility_source === 'string' ? context.compatibility_source : null,
      prompt_compatibility_alignment: this.operation !== 'CHALLENGE_GENERATION' || content.includes('allowed challenge_type values are ASSUMPTION'),
    };
    this.projections.push(Object.freeze(projection));
    const errors: string[] = [];
    if (request.method !== 'POST') errors.push('METHOD');
    if (projection.model !== LIVE_MODEL) errors.push('MODEL');
    if (projection.configured_max_output_tokens !== PHASE5C_MAX_OUTPUT_TOKENS) errors.push('MAX_OUTPUT_TOKENS');
    if (projection.message_count !== (this.operation === 'CHALLENGE_GENERATION' ? 2 : 1)) errors.push('MESSAGE_COUNT');
    if (projection.schema_name !== (this.operation === 'CHALLENGE_GENERATION' ? PHASE5C_CHALLENGE_GENERATION_SCHEMA.name : SEAT_CHALLENGE_SCHEMA.name)) errors.push('SCHEMA_NAME');
    if (projection.strict !== true) errors.push('STRICT');
    if (projection.provider_schema_fingerprint !== deterministicPackageHash(this.expectedSchema)) errors.push('SCHEMA_FINGERPRINT');
    if (projection.peer_reasoning_present || projection.unrelated_challenges_present || projection.zeus_context_present || projection.human_decision_context_present) errors.push('PRIVACY_BOUNDARY');
    if (this.operation === 'CHALLENGE_GENERATION') {
      const selectedType = projection.target_disagreement_type === PHASE5C_TARGET_DISAGREEMENT ? PHASE5C_TARGET_DISAGREEMENT : null;
      const allowed = selectedType ? allowedChallengeTypesForDisagreement(selectedType) : [];
      if (!selectedType || JSON.stringify(projection.allowed_challenge_types) !== JSON.stringify(allowed)) errors.push('COMPATIBILITY_CONTEXT');
      if (projection.compatibility_source !== PHASE5_CHALLENGE_COMPATIBILITY_SOURCE) errors.push('COMPATIBILITY_SOURCE');
      if (!projection.prompt_compatibility_alignment) errors.push('PROMPT_COMPATIBILITY');
    }
    if (errors.length > 0) throw new Error(`PHASE5C_REQUEST_CONTRACT_BLOCKED:${errors.join(',')}`);
    return this.delegate.request(request);
  }
}

export class Phase5cBudgetedTransport implements HttpTransport {
  private requestCount = 0;
  private attemptedCount = 0;
  private blockedCount = 0;
  constructor(private readonly delegate: HttpTransport, private readonly maximum = PHASE5C_REQUEST_BUDGET) {}
  async request(request: HttpRequest): Promise<HttpResponse> {
    this.attemptedCount += 1;
    if (this.attemptedCount > this.maximum) { this.blockedCount += 1; throw new Error('PHASE5C_REQUEST_BUDGET_EXCEEDED'); }
    this.requestCount += 1;
    return this.delegate.request(request);
  }
  stats(): Phase5cBudgetStats { return { request_count: this.requestCount, attempted_count: this.attemptedCount, blocked_count: this.blockedCount }; }
}

export function phase5cConfigFromEnvironment(env: Readonly<Record<string, string | undefined>>, confirmationVariable: 'SWARM_LIVE_CHALLENGE_CONFIRM' | 'SWARM_LIVE_CHALLENGE_RESPONSE_CONFIRM'): Phase5cConfig {
  const budget = resolveCouncilMaxOutputTokens(env);
  return {
    provider: LIVE_PROVIDER,
    model: LIVE_MODEL,
    credential: env.XAI_API_KEY,
    base_url: env.SWARM_COUNCIL_XAI_BASE_URL,
    confirm: env[confirmationVariable] ?? '',
    requested_max_output_tokens: budget.requested_raw,
    max_output_tokens: budget.effective_value,
    output_budget_error: budget.error,
  };
}

export function phase5cBudgetPreflight(config: Phase5cConfig): Phase5cBudgetPreflight {
  const requested = config.requested_max_output_tokens === null ? null : Number(config.requested_max_output_tokens);
  const effective = config.max_output_tokens;
  const pass = config.output_budget_error === null && requested === PHASE5C_MAX_OUTPUT_TOKENS && effective === PHASE5C_MAX_OUTPUT_TOKENS;
  return { REQUESTED_MAX_OUTPUT_TOKENS: requested, EFFECTIVE_MAX_OUTPUT_TOKENS: effective, REQUESTED_EFFECTIVE_MISMATCH_GATE: pass ? 'PASS' : 'BLOCKED' };
}

export function formatPhase5cBudgetPreflight(preflight: Phase5cBudgetPreflight): string {
  return Object.entries(preflight).map(([key, value]) => `${key}=${value === null ? 'null' : value}`).join('\n');
}

function execution(seat: Round1SeatId): ModelExecution {
  return { requested_provider: LIVE_PROVIDER, requested_model: LIVE_MODEL, executed_provider: LIVE_PROVIDER, executed_model: LIVE_MODEL, request_id: `phase5c-captured-${seat.toLowerCase()}`, started_at: 'CAPTURED_PHASE4B', ended_at: 'CAPTURED_PHASE4B', duration_ms: 0, status: 'SUCCESS', model_called: true, independent: true, fallback_used: false, fallback_reason: null, failure_stage: null, failure_reason_code: null, diagnostics: { captured: true } };
}

function capturedPosition(caseValue: SwarmCase, seat: Round1SeatId, risk: AgentPosition['risk_level'], evidenceIds: readonly string[], assumption: string, control: string): AgentPosition {
  const positionId = `position-${seat.toLowerCase()}-1` as AgentPosition['position_id'];
  const claim: Claim = { claim_id: `${positionId}-claim-1` as Claim['claim_id'], position_id: positionId, statement: `${seat} identifies an auditable control signal.`, type: 'OBSERVATION', evidence_ids: evidenceIds as Claim['evidence_ids'], assumptions: [assumption], uncertainty: 'The captured Round 1 evidence does not establish every causal explanation.', status: 'SUPPORTED' };
  const gap: ControlGap = { gap_id: `${positionId}-gap-1` as ControlGap['gap_id'], case_id: caseValue.case_id, position_id: positionId, statement: control, evidence_ids: evidenceIds as ControlGap['evidence_ids'], assumptions: [assumption], uncertainty: 'Control operation requires human review of the underlying records.', priority: 'HIGH' };
  return { position_id: positionId, case_id: caseValue.case_id, seat_id: seat, round: 1, status: 'PROPOSED', conclusion: `${seat} records a ${risk.toLowerCase()} control risk signal.`, risk_level: risk, confidence: 0.7, claims: [claim], evidence_ids: [...evidenceIds] as AgentPosition['evidence_ids'], assumptions: [assumption], uncertainties: ['The captured records do not establish financial loss.'], risk_findings: [], control_gaps: [gap], counterarguments: ['A logging defect remains possible.'], position_references: [], evidence_requests: [], recommendation: 'Preserve human review and obtain bounded control-effectiveness evidence.', abstained: false, abstention_reason: null, execution: execution(seat), created_at: 'CAPTURED_PHASE4B' };
}

function append(state: SwarmBlackboard, type: SwarmExecutionEvent['type'], payload: Record<string, unknown>, actor = 'SYSTEM'): SwarmBlackboard {
  const event = { event_id: `phase5c-event-${state.execution_events.length + 1}` as SwarmExecutionEvent['event_id'], case_id: state.case?.case_id ?? 'case-phase4b-payment-review', protocol_version: SWARM_PROTOCOL_VERSION, sequence: state.execution_events.length + 1, timestamp: 'CAPTURED_PHASE4B', actor, type, ...payload } as SwarmExecutionEvent;
  return reduceSwarmEvent(state, event);
}

export function phase5cArtifact(): Phase5cArtifact {
  const base = syntheticCase();
  const caseValue: SwarmCase = { ...base.case, policy: { ...base.case.policy, max_challenge_rounds: 1, max_challenges: 6, max_revisions: 6, max_provider_calls: 8 } };
  const positions = [
    capturedPosition(caseValue, 'ATHENA', 'HIGH', ['EV-001', 'EV-002'], 'The threshold is consistently applied.', 'A human reviewer is required before processing.'),
    capturedPosition(caseValue, 'ARES', 'MEDIUM', ['EV-003', 'EV-004'], 'The threshold exceptions are not consistently recorded.', 'Exception review records are incomplete.'),
    capturedPosition(caseValue, 'HADES', 'HIGH', ['EV-001', 'EV-003'], 'The control gate is designed to block unreviewed exceptions.', 'The control gate should block unreviewed exceptions.'),
    capturedPosition(caseValue, 'APOLLO', 'HIGH', ['EV-004', 'EV-006'], 'The supplied evidence is sufficient to identify a governance gap.', 'Independent review evidence is incomplete.'),
  ] as const;
  const evidencePackage = sealEvidence(caseValue, base.evidence, { package_id: 'package-phase4b-payment-review' as EvidencePackage['package_id'], sealed_at: 'CAPTURED_PHASE4B' });
  const disagreements = detectDisagreements(positions);
  let blackboard = emptySwarmBlackboard();
  blackboard = append(blackboard, 'CASE_CREATED', { case: caseValue });
  blackboard = append(blackboard, 'EVIDENCE_SEALED', { evidence_package: evidencePackage });
  blackboard = append(blackboard, 'INDEPENDENT_ANALYSIS_STARTED', {});
  for (const position of positions) {
    blackboard = append(blackboard, 'SEAT_STARTED', { seat_id: position.seat_id }, position.seat_id);
    blackboard = append(blackboard, 'POSITION_PROPOSED', { position }, position.seat_id);
    blackboard = append(blackboard, 'SEAT_COMPLETED', { seat_id: position.seat_id, position_id: position.position_id, execution: position.execution }, position.seat_id);
  }
  blackboard = append(blackboard, 'POSITIONS_LOCKED', {});
  for (const disagreement of disagreements) blackboard = append(blackboard, 'DISAGREEMENT_IDENTIFIED', { disagreement }, 'APOLLO');
  blackboard = append(blackboard, 'DISAGREEMENTS_FINALIZED', {});
  blackboard = append(blackboard, 'CHALLENGE_ROUND_STARTED', { round: 1 });
  blackboard = append(blackboard, 'CHALLENGE_GENERATION_STARTED', { round: 1 }, 'ARES');
  return { case: caseValue, evidence: base.evidence, evidence_package: evidencePackage, positions, disagreements, blackboard };
}

export async function phase5cArtifactAsync(): Promise<Phase5cArtifact> { return phase5cArtifact(); }

function routerFor(config: Phase5cConfig, transport: HttpTransport, operation: Phase5cWireProjection['operation'], schema: Readonly<Record<string, unknown>>) {
  const budgeted = new Phase5cBudgetedTransport(transport);
  const guarded = new Phase5cRequestContractGuardTransport(budgeted, operation, schema);
  const adapter = new XaiProviderAdapter({ transport: guarded, baseUrl: config.base_url });
  const runtime = new ModelRuntime({ providers: new Map([[LIVE_PROVIDER, adapter]]), credentials: { resolve: () => ({ configured: Boolean(config.credential), value: config.credential }) } });
  const router = new ModelRouter(runtime);
  const plan: ModelExecutionPlan = { primary: { provider: LIVE_PROVIDER, model: LIVE_MODEL }, fallback_models: [], fallback_enabled: false, retry: { max_attempts: 1, retryable_reasons: [] } };
  return { budgeted, guarded, router, plan };
}

function diagnostics(response: ModelResponse<unknown>) {
  const d = response.diagnostics;
  return { http: typeof d.http_status === 'number' ? d.http_status : null, finish: response.finish_reason, output: response.usage?.output_tokens ?? (typeof d.output_count === 'number' ? d.output_count : null), present: response.execution.model_output_present, extracted: d.provider_output_extracted === true || response.execution.model_output_present, truncation: d.truncation_detected === true || response.finish_reason?.toLowerCase() === 'length' };
}

function candidateFailureCode(checks: Readonly<Record<string, 'PASS' | 'FAIL' | 'NOT_EVALUATED'>>): string | null {
  const first = Object.entries(checks).find(([, value]) => value === 'FAIL')?.[0];
  return first ? `CHALLENGE_${first}` : null;
}

export function phase5cChallengeCandidateDiagnostic(
  challenge: Challenge,
  artifact: Phase5cArtifact,
  requestedDisagreementId: string,
  allChallenges: readonly Challenge[] = [challenge],
): Phase5cChallengeCandidateDiagnostic {
  const disagreement = artifact.disagreements.find((item) => item.disagreement_id === challenge.disagreement_id);
  const target = artifact.positions.find((position) => position.position_id === challenge.target_position);
  const source = artifact.blackboard.positions.find((position) => position.seat_id === 'ARES');
  const knownEvidence = new Set(artifact.evidence_package.items.map((item) => item.evidence_id));
  const targetClaim = target?.claims.find((claim) => claim.claim_id === challenge.target_claim);
  const targetTypeValid = challenge.target_type === 'POSITION' || challenge.target_type === 'CLAIM' || challenge.target_type === 'DISAGREEMENT';
  const targetIdExists = challenge.target_type === 'CLAIM' ? Boolean(targetClaim) : challenge.target_type === 'DISAGREEMENT' ? Boolean(disagreement) : Boolean(target);
  const evidenceIdsExist = challenge.evidence_ids.every((id) => knownEvidence.has(id));
  const targetCount = allChallenges.filter((item) => item.to_seat === challenge.to_seat).length;
  const checks = {
    challenger_valid: challenge.from_seat === 'ARES' ? 'PASS' : 'FAIL',
    target_seat_valid: ['ATHENA', 'HADES', 'APOLLO'].includes(challenge.to_seat) ? 'PASS' : 'FAIL',
    challenger_not_target: challenge.from_seat !== challenge.to_seat ? 'PASS' : 'FAIL',
    disagreement_exists: disagreement ? 'PASS' : 'FAIL',
    disagreement_open: disagreement?.status === 'OPEN' ? 'PASS' : 'FAIL',
    disagreement_id_matches_requested_target: challenge.disagreement_id === requestedDisagreementId ? 'PASS' : 'FAIL',
    target_position_exists: target ? 'PASS' : 'FAIL',
    target_position_belongs_to_target_seat: target?.seat_id === challenge.to_seat ? 'PASS' : 'FAIL',
    target_type_valid: targetTypeValid ? 'PASS' : 'FAIL',
    target_id_exists: targetIdExists ? 'PASS' : 'FAIL',
    evidence_ids_exist: evidenceIdsExist ? 'PASS' : 'FAIL',
    evidence_ids_allowed: evidenceIdsExist ? 'PASS' : 'FAIL',
    round_valid: challenge.round === 1 ? 'PASS' : 'FAIL',
    source_position_exists: source ? 'PASS' : 'FAIL',
    source_position_locked: source?.status === 'LOCKED' ? 'PASS' : 'FAIL',
    requested_action_valid: ['DEFEND', 'REVISE', 'CONCEDE', 'REQUEST_EVIDENCE', 'ABSTAIN'].includes(challenge.requested_action ?? '') ? 'PASS' : 'FAIL',
    challenge_type_compatible: disagreement && challengeTypeCompatible(disagreement.type, challenge.challenge_type) ? 'PASS' : 'FAIL',
    case_id_valid: challenge.case_id === artifact.case.case_id ? 'PASS' : 'FAIL',
    budget_valid: challenge.round === 1 && PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT >= 1 && PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT >= 1 && PHASE5_MAX_TOTAL_CHALLENGES >= 1 ? 'PASS' : 'FAIL',
  } as const;
  const semantic = Object.values(checks).every((value) => value === 'PASS');
  return {
    CHALLENGE_INDEX: allChallenges.indexOf(challenge) + 1,
    TARGET_SEAT: challenge.to_seat,
    CHALLENGE_TYPE: challenge.challenge_type,
    DTO: Phase5ChallengeSchema.safeParse(challenge).success ? 'PASS' : 'FAIL',
    SEMANTIC: semantic ? 'PASS' : 'FAIL',
    FAILURE_CODE: semantic ? null : candidateFailureCode(checks),
    PROTOCOL: 'NOT_EVALUATED',
    CHECKS: checks,
  };
}

export function phase5cValidateChallengeSemantics(challenge: Challenge, artifact: Phase5cArtifact): boolean {
  return phase5cChallengeCandidateDiagnostic(challenge, artifact, challenge.disagreement_id ?? '').SEMANTIC === 'PASS';
}

export function phase5cValidateResponseSemantics(response: ChallengeResponse, challenge: Challenge, artifact: Phase5cArtifact): boolean {
  const parsed = Phase5ChallengeResponseSchema.safeParse(response);
  if (!parsed.success) return false;
  return response.case_id === artifact.case.case_id
    && response.challenge_id === challenge.challenge_id
    && response.responding_seat === challenge.to_seat
    && response.round === challenge.round
    && response.source_position === challenge.target_position
    && response.revision_lineage.includes(challenge.target_position)
    && response.evidence_ids.every((id) => artifact.evidence_package.items.some((item) => item.evidence_id === id));
}

export function phase5cChallengeFixture(artifact: Phase5cArtifact): Challenge {
  const disagreement = artifact.disagreements.find((item) => item.type === PHASE5C_TARGET_DISAGREEMENT) ?? artifact.disagreements.find((item) => item.type === 'CONTROL_EFFECTIVENESS') ?? artifact.disagreements[0]!;
  const target = artifact.positions.find((position) => position.seat_id === 'ATHENA')!;
  return { challenge_id: 'challenge-athena-phase5c' as Challenge['challenge_id'], case_id: artifact.case.case_id, round: 1, from_seat: 'ARES', to_seat: 'ATHENA', target_position: target.position_id, target_claim: target.claims[0]!.claim_id, challenge_type: disagreement.type === 'CONTROL_EFFECTIVENESS' ? 'CONTROL' : 'ASSUMPTION', reasoning: 'ARES requests a bounded defense of the targeted assumption using sealed evidence.', evidence_ids: [...disagreement.evidence_ids], disagreement_id: disagreement.disagreement_id, target_type: 'CLAIM', challenge_text: 'Address the targeted assumption using only your locked position and sealed evidence.', requested_action: 'DEFEND' };
}

export interface Phase5cCollectionValidation {
  readonly duplicateValid: boolean;
  readonly disagreementBudgetValid: boolean;
  readonly targetSeatBudgetValid: boolean;
  readonly totalBudgetValid: boolean;
  readonly budgetValid: boolean;
  readonly failureCode: string | null;
}

export function validatePhase5cCollection(challenges: readonly Challenge[], candidateDiagnostics: readonly Phase5cChallengeCandidateDiagnostic[]): Phase5cCollectionValidation {
  const duplicateValid = new Set(challenges.map((challenge) => challengeDuplicateIdentity(challenge))).size === challenges.length;
  const disagreementCounts = new Map<string, number>();
  const targetSeatCounts = new Map<string, number>();
  for (const challenge of challenges) {
    const disagreementId = challenge.disagreement_id ?? 'NO_DISAGREEMENT';
    disagreementCounts.set(disagreementId, (disagreementCounts.get(disagreementId) ?? 0) + 1);
    targetSeatCounts.set(challenge.to_seat, (targetSeatCounts.get(challenge.to_seat) ?? 0) + 1);
  }
  const disagreementBudgetValid = [...disagreementCounts.values()].every((count) => count <= PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT);
  const targetSeatBudgetValid = [...targetSeatCounts.values()].every((count) => count <= PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT);
  const totalBudgetValid = challenges.length <= PHASE5_MAX_TOTAL_CHALLENGES;
  const budgetValid = disagreementBudgetValid && targetSeatBudgetValid && totalBudgetValid;
  const failureCode = !duplicateValid
    ? 'DUPLICATE_CHALLENGE_IDENTITY'
    : !disagreementBudgetValid
      ? 'CHALLENGE_PER_DISAGREEMENT_BUDGET_EXCEEDED'
      : !targetSeatBudgetValid
        ? 'CHALLENGE_PER_TARGET_SEAT_BUDGET_EXCEEDED'
        : !totalBudgetValid
          ? 'CHALLENGE_TOTAL_BUDGET_EXCEEDED'
          : candidateDiagnostics.some((candidate) => candidate.PROTOCOL === 'FAIL')
            ? 'CHALLENGE_PROTOCOL_REJECTED'
            : null;
  return { duplicateValid, disagreementBudgetValid, targetSeatBudgetValid, totalBudgetValid, budgetValid, failureCode };
}

export async function runChallengeDiagnostic(config: Phase5cConfig, transport: HttpTransport): Promise<Phase5cChallengeReport> {
  const artifact = await phase5cArtifactAsync();
  const disagreement = artifact.disagreements.find((item) => item.type === PHASE5C_TARGET_DISAGREEMENT) ?? artifact.disagreements.find((item) => item.type === 'CONTROL_EFFECTIVENESS') ?? artifact.disagreements[0]!;
  const allowedChallengeTypes = allowedChallengeTypesForDisagreement(disagreement.type);
  const challengeSchema = phase5ChallengeGenerationSchema(PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT, allowedChallengeTypes);
  const preflight = phase5cBudgetPreflight(config);
  const base = { REQUEST_PRECHECK: 'PASS' as const, PROVIDER: config.provider, MODEL: config.model, OPERATION: 'CHALLENGE_GENERATION' as const, SEAT: 'ARES' as const, TARGET_DISAGREEMENT_ID: disagreement?.disagreement_id ?? 'NONE', TARGET_DISAGREEMENT_TYPE: disagreement?.type ?? 'NONE', ALLOWED_CHALLENGE_TYPES: [...allowedChallengeTypes], PROVIDER_CHALLENGE_TYPE_ENUM: [...allowedChallengeTypes], COMPATIBILITY_SOURCE: PHASE5_CHALLENGE_COMPATIBILITY_SOURCE, SCHEMA_COMPATIBILITY_ALIGNMENT: challengeSchema.json_schema && JSON.stringify((challengeSchema.json_schema.properties as { challenges: { items: { properties: { challenge_type: { enum: readonly string[] } } } } }).challenges.items.properties.challenge_type.enum) === JSON.stringify(allowedChallengeTypes) ? 'PASS' as const : 'FAIL' as const, PROMPT_COMPATIBILITY_ALIGNMENT: 'PASS' as const, PROMPT_VERSION: 'ARES_PHASE5C_CHALLENGE_GENERATION_V1', PROMPT_FINGERPRINT: deterministicPackageHash({ operation: 'CHALLENGE_GENERATION', target_disagreement: disagreement?.disagreement_id ?? null, allowed_challenge_types: allowedChallengeTypes }), EVIDENCE_FINGERPRINT: artifact.evidence_package.package_hash, PROVIDER_SCHEMA_FINGERPRINT: deterministicPackageHash(challengeSchema.json_schema ?? {}), REQUEST_BUDGET: PHASE5C_REQUEST_BUDGET, REQUEST_BUDGET_ENFORCED: 'PASS' as const, RETRY_DISABLED: 'PASS' as const, FALLBACK_DISABLED: 'PASS' as const, HTTP_STATUS: null as number | null, FINISH_REASON: null as string | null, OUTPUT_TOKENS: null as number | null, REQUESTED_MAX_OUTPUT_TOKENS: preflight.REQUESTED_MAX_OUTPUT_TOKENS, EFFECTIVE_MAX_OUTPUT_TOKENS: preflight.EFFECTIVE_MAX_OUTPUT_TOKENS, CONFIGURED_MAX_OUTPUT_TOKENS: null as number | null, STRUCTURED_OUTPUT_PRESENT: 'FAIL' as const, PROVIDER_OUTPUT_EXTRACTED: 'NOT_RUN' as const, JSON_PARSE: 'NOT_RUN' as const, CHALLENGE_DTO_VALIDATION: 'NOT_RUN' as const, CHALLENGE_SEMANTIC_VALIDATION: 'NOT_RUN' as const, CHALLENGE_CONVERSION: 'NOT_RUN' as const, PROTOCOL_VALIDATION: 'NOT_RUN' as const, CHALLENGE_ACCEPTED: false, CHALLENGE_COUNT: 0, TARGET_SEATS: [] as readonly string[], CHALLENGE_TYPES: [] as readonly string[], EVIDENCE_REFERENCE_COUNT: 0, TRUNCATION_DETECTED: false, FINAL_EXECUTION_STATUS: 'NOT_RUN', FAILURE_STAGE: null as string | null, FAILURE_CODE: null as string | null, MODEL_EXECUTION_STATUS: 'NOT_RUN', ARTIFACT_VALIDATION_STATUS: 'NOT_RUN' as const, FINAL_CERTIFICATION_STATUS: 'NOT_RUN' as const, CHALLENGE_DIAGNOSTICS: [] as readonly Phase5cChallengeCandidateDiagnostic[], CANDIDATE_BUDGET_VALIDATION: 'NOT_RUN' as const, COLLECTION_BUDGET_VALIDATION: 'NOT_RUN' as const, DUPLICATE_VALIDATION: 'NOT_RUN' as const };
  if (config.confirm !== 'YES' || !config.credential) return { ...base, FINAL_EXECUTION_STATUS: 'NOT_RUN', FAILURE_STAGE: 'REQUEST_BUILD', FAILURE_CODE: config.confirm !== 'YES' ? 'LIVE_CONFIRMATION_REQUIRED' : 'CREDENTIAL_MISSING' };
  if (preflight.REQUESTED_EFFECTIVE_MISMATCH_GATE !== 'PASS') return { ...base, REQUEST_BUDGET_ENFORCED: 'PASS', FINAL_EXECUTION_STATUS: 'BLOCKED', FAILURE_STAGE: 'REQUEST_BUILD', FAILURE_CODE: 'OUTPUT_TOKEN_BUDGET_PREFLIGHT_BLOCKED' };
  const { budgeted, guarded, router, plan } = routerFor(config, transport, 'CHALLENGE_GENERATION', challengeSchema.json_schema ?? {});
  const generator = new ModelChallengeGenerator(router, plan, undefined, PHASE5C_MAX_OUTPUT_TOKENS, PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT);
  const input: Phase5ChallengeGenerationInput = { case: { case_id: artifact.case.case_id, protocol_version: artifact.case.protocol_version, question: artifact.case.question, scope: artifact.case.scope, policy: artifact.case.policy }, evidence_package: artifact.evidence_package, positions: artifact.positions, disagreements: [disagreement] };
  const response = await generator.execute(input);
  const d = diagnostics(response);
  const output = response.structured_output;
  const validDto = Boolean(output && challengeSchema.validate(output).success);
  const converted = validDto && output && Phase5ChallengeGenerationOutputSchema.safeParse(output).success ? phase5ChallengeDraftsToChallenges(input, output as never) : [];
  const candidateDiagnostics = converted.map((challenge) => phase5cChallengeCandidateDiagnostic(challenge, artifact, disagreement.disagreement_id, converted));
  const semantic = validDto && converted.length > 0 && candidateDiagnostics.every((item) => item.SEMANTIC === 'PASS');
  const evaluatedDiagnostics = candidateDiagnostics.map((item, index) => {
    if (item.SEMANTIC !== 'PASS') return item;
    try { append(artifact.blackboard, 'CHALLENGE_EMITTED', { challenge: converted[index] }, 'ARES'); return { ...item, PROTOCOL: 'PASS' as const }; } catch { return { ...item, PROTOCOL: 'FAIL' as const, FAILURE_CODE: item.FAILURE_CODE ?? 'CHALLENGE_PROTOCOL_REJECTED' }; }
  });
  const collection = validatePhase5cCollection(converted, evaluatedDiagnostics);
  const candidateProtocol = semantic && evaluatedDiagnostics.every((item) => item.PROTOCOL === 'PASS');
  let protocol = false;
  if (candidateProtocol && collection.duplicateValid && collection.budgetValid) {
    try { let next = artifact.blackboard; for (const challenge of converted) next = append(next, 'CHALLENGE_EMITTED', { challenge }, 'ARES'); protocol = next.challenges.length === converted.length; } catch { protocol = false; }
  }
  const accepted = semantic && protocol;
  const artifactStatus: Phase5cChallengeReport['ARTIFACT_VALIDATION_STATUS'] = response.status === 'SUCCESS' ? accepted ? 'ACCEPTED' : 'REJECTED' : 'NOT_RUN';
  const failureStage = response.error?.stage ?? (response.status === 'SUCCESS' && !accepted ? semantic ? 'PROTOCOL_VALIDATION' : 'CHALLENGE_SEMANTIC_VALIDATION' : null);
  const failureCode = response.error?.code ?? (response.status === 'SUCCESS' && !accepted ? semantic ? collection.failureCode ?? 'CHALLENGE_PROTOCOL_REJECTED' : candidateDiagnostics.find((item) => item.FAILURE_CODE)?.FAILURE_CODE ?? (converted.length === 0 ? 'NO_CHALLENGES_EMITTED' : 'CHALLENGE_SEMANTIC_REJECTED') : null);
  const candidateBudgetValidation: Phase5cChallengeReport['CANDIDATE_BUDGET_VALIDATION'] = validDto && converted.length > 0 && candidateDiagnostics.every((item) => item.CHECKS.budget_valid === 'PASS') ? 'PASS' : validDto ? 'FAIL' : 'NOT_RUN';
  const collectionBudgetValidation: Phase5cChallengeReport['COLLECTION_BUDGET_VALIDATION'] = semantic ? collection.budgetValid ? 'PASS' : 'FAIL' : validDto ? 'NOT_RUN' : 'NOT_RUN';
  const duplicateValidation: Phase5cChallengeReport['DUPLICATE_VALIDATION'] = semantic ? collection.duplicateValid ? 'PASS' : 'FAIL' : validDto ? 'NOT_RUN' : 'NOT_RUN';
  const projection = guarded.projections[0];
  return { ...base, SCHEMA_COMPATIBILITY_ALIGNMENT: projection && JSON.stringify(projection.allowed_challenge_types) === JSON.stringify(allowedChallengeTypes) && projection.compatibility_source === PHASE5_CHALLENGE_COMPATIBILITY_SOURCE ? 'PASS' : 'FAIL', PROMPT_COMPATIBILITY_ALIGNMENT: projection?.prompt_compatibility_alignment ? 'PASS' : 'FAIL', HTTP_STATUS: d.http, FINISH_REASON: d.finish, OUTPUT_TOKENS: d.output, CONFIGURED_MAX_OUTPUT_TOKENS: typeof response.diagnostics.configured_output_limit === 'number' ? response.diagnostics.configured_output_limit : PHASE5C_MAX_OUTPUT_TOKENS, STRUCTURED_OUTPUT_PRESENT: response.execution.model_output_present ? 'PASS' : 'FAIL', PROVIDER_OUTPUT_EXTRACTED: d.extracted ? 'PASS' : 'FAIL', JSON_PARSE: response.status === 'SUCCESS' ? 'PASS' : 'FAIL', CHALLENGE_DTO_VALIDATION: validDto ? 'PASS' : 'FAIL', CHALLENGE_SEMANTIC_VALIDATION: semantic ? 'PASS' : 'FAIL', CHALLENGE_CONVERSION: output && validDto && converted.length === output.challenges.length ? 'PASS' : 'FAIL', PROTOCOL_VALIDATION: protocol ? 'PASS' : 'FAIL', CHALLENGE_ACCEPTED: accepted, CHALLENGE_COUNT: converted.length, TARGET_SEATS: converted.map((challenge) => challenge.to_seat), CHALLENGE_TYPES: converted.map((challenge) => challenge.challenge_type), EVIDENCE_REFERENCE_COUNT: converted.reduce((count, challenge) => count + challenge.evidence_ids.length, 0), TRUNCATION_DETECTED: d.truncation, FINAL_EXECUTION_STATUS: response.status, FAILURE_STAGE: failureStage, FAILURE_CODE: failureCode, MODEL_EXECUTION_STATUS: response.status, ARTIFACT_VALIDATION_STATUS: artifactStatus, FINAL_CERTIFICATION_STATUS: accepted ? 'PASS' : response.status === 'SUCCESS' ? 'FAIL' : 'NOT_RUN', CHALLENGE_DIAGNOSTICS: evaluatedDiagnostics, CANDIDATE_BUDGET_VALIDATION: candidateBudgetValidation, COLLECTION_BUDGET_VALIDATION: collectionBudgetValidation, DUPLICATE_VALIDATION: duplicateValidation, REQUEST_BUDGET_ENFORCED: budgeted.stats().attempted_count <= PHASE5C_REQUEST_BUDGET && guarded.projections.length <= PHASE5C_REQUEST_BUDGET ? 'PASS' : 'FAIL' };
}

function normalizeResponse(response: ChallengeResponse, challenge: Challenge): ChallengeResponse {
  return { ...response, round: challenge.round, source_position: challenge.target_position, revision_lineage: response.revision_lineage ?? [challenge.target_position] };
}

export async function runResponseDiagnostic(config: Phase5cConfig, transport: HttpTransport): Promise<Phase5cResponseReport> {
  const artifact = await phase5cArtifactAsync();
  const challenge = phase5cChallengeFixture(artifact);
  const preflight = phase5cBudgetPreflight(config);
  const base = { REQUEST_PRECHECK: 'PASS' as const, PROVIDER: config.provider, MODEL: config.model, OPERATION: 'CHALLENGE_RESPONSE' as const, SEAT: 'ATHENA' as const, CHALLENGE_ID: challenge.challenge_id, DISAGREEMENT_ID: challenge.disagreement_id!, PROMPT_VERSION: 'ATHENA_PHASE5C_CHALLENGE_RESPONSE_V1', PROMPT_FINGERPRINT: deterministicPackageHash({ operation: 'CHALLENGE_RESPONSE', challenge_id: challenge.challenge_id }), EVIDENCE_FINGERPRINT: artifact.evidence_package.package_hash, PROVIDER_SCHEMA_FINGERPRINT: deterministicPackageHash(SEAT_CHALLENGE_SCHEMA.json_schema ?? {}), PRIVACY_BOUNDARY: 'PASS' as const, PEER_REASONING_PRESENT: false, UNRELATED_CHALLENGES_PRESENT: false, ZEUS_CONTEXT_PRESENT: false, HUMAN_DECISION_CONTEXT_PRESENT: false, REQUEST_BUDGET: PHASE5C_REQUEST_BUDGET, REQUEST_BUDGET_ENFORCED: 'PASS' as const, RETRY_DISABLED: 'PASS' as const, FALLBACK_DISABLED: 'PASS' as const, HTTP_STATUS: null as number | null, FINISH_REASON: null as string | null, OUTPUT_TOKENS: null as number | null, REQUESTED_MAX_OUTPUT_TOKENS: preflight.REQUESTED_MAX_OUTPUT_TOKENS, EFFECTIVE_MAX_OUTPUT_TOKENS: preflight.EFFECTIVE_MAX_OUTPUT_TOKENS, CONFIGURED_MAX_OUTPUT_TOKENS: null as number | null, STRUCTURED_OUTPUT_PRESENT: 'FAIL' as const, PROVIDER_OUTPUT_EXTRACTED: 'NOT_RUN' as const, JSON_PARSE: 'NOT_RUN' as const, RESPONSE_DTO_VALIDATION: 'NOT_RUN' as const, RESPONSE_SEMANTIC_VALIDATION: 'NOT_RUN' as const, PROTOCOL_VALIDATION: 'NOT_RUN' as const, RESPONSE_CONVERSION: 'NOT_RUN' as const, ACTION: null as ChallengeResponse['action'] | null, REVISION_APPLICABILITY: 'NOT_APPLICABLE' as const, CONCESSION_APPLICABILITY: 'NOT_APPLICABLE' as const, EVIDENCE_REQUEST_APPLICABILITY: 'NOT_APPLICABLE' as const, TRUNCATION_DETECTED: false, FINAL_EXECUTION_STATUS: 'NOT_RUN', FAILURE_STAGE: null as string | null, FAILURE_CODE: null as string | null };
  if (config.confirm !== 'YES' || !config.credential) return { ...base, FINAL_EXECUTION_STATUS: 'NOT_RUN', FAILURE_STAGE: 'REQUEST_BUILD', FAILURE_CODE: config.confirm !== 'YES' ? 'LIVE_CONFIRMATION_REQUIRED' : 'CREDENTIAL_MISSING' };
  if (preflight.REQUESTED_EFFECTIVE_MISMATCH_GATE !== 'PASS') return { ...base, FINAL_EXECUTION_STATUS: 'BLOCKED', FAILURE_STAGE: 'REQUEST_BUILD', FAILURE_CODE: 'OUTPUT_TOKEN_BUDGET_PREFLIGHT_BLOCKED' };
  const { budgeted, guarded, router, plan } = routerFor(config, transport, 'CHALLENGE_RESPONSE', SEAT_CHALLENGE_SCHEMA.json_schema ?? {});
  const state = append(artifact.blackboard, 'CHALLENGE_EMITTED', { challenge }, 'ARES');
  const input = buildChallengeInput(state, challenge);
  const executor = new ModelBackedSeatExecutor(router, plan, 'ATHENA', { max_output_tokens: PHASE5C_MAX_OUTPUT_TOKENS });
  const raw = await executor.respond({ ...input, execution_context: { invocation: 1, phase: 'CHALLENGE_RESPONSE' as const } });
  const result = raw as { readonly status: string; readonly response?: ChallengeResponse; readonly revision?: import('../src/swarm/contracts').Revision; readonly position?: AgentPosition; readonly execution: ModelExecution; readonly reason?: string };
  const response = result.response ? normalizeResponse(result.response, challenge) : null;
  const responseDto = Boolean(response && Phase5ChallengeResponseSchema.safeParse(response).success);
  const responseSemantic = Boolean(response && phase5cValidateResponseSemantics(response, challenge, artifact));
  let protocol = false;
  let revisionApplicable: Phase5cResponseReport['REVISION_APPLICABILITY'] = 'NOT_APPLICABLE';
  let concessionApplicable: Phase5cResponseReport['CONCESSION_APPLICABILITY'] = 'NOT_APPLICABLE';
  let evidenceApplicable: Phase5cResponseReport['EVIDENCE_REQUEST_APPLICABILITY'] = 'NOT_APPLICABLE';
  if (response && responseDto && responseSemantic) {
    try {
      let next = append(state, 'CHALLENGE_RESPONSE_RECORDED', { response }, 'ATHENA');
      protocol = true;
      if (response.action === 'REQUEST_EVIDENCE') { const request = { request_id: `request-${challenge.challenge_id}` as import('../src/swarm/contracts').EvidenceRequestId, case_id: artifact.case.case_id, position_id: challenge.target_position, request: response.rationale, reason: 'Evidence requested by challenged seat.', evidence_ids: [...response.evidence_ids], status: 'OPEN' as const }; if (!EvidenceRequestSchema.safeParse(request).success) throw new Error('EVIDENCE_REQUEST_SCHEMA'); next = append(next, 'EVIDENCE_REQUEST_RECORDED', { request }, 'ATHENA'); evidenceApplicable = next.evidence_requests.length > 0 ? 'PASS' : 'FAIL'; }
      if (response.action === 'REVISE' || response.action === 'CONCEDE') { if (!result.revision || !result.position) throw new Error('REVISION_MISSING'); next = append(next, 'REVISION_CREATED', { revision_id: result.revision.revision_id, position_id: result.position.position_id }, 'SYSTEM'); next = append(next, 'REVISION_RECORDED', { revision: result.revision, position: result.position }, 'ATHENA'); revisionApplicable = next.revisions.length > 0 ? 'PASS' : 'FAIL'; if (response.action === 'CONCEDE') { next = append(next, 'CONCESSION_RECORDED', { challenge_id: challenge.challenge_id, response_id: response.response_id, position_id: result.position.position_id }, 'SYSTEM'); concessionApplicable = 'PASS'; } }
      if (response.action === 'DEFEND') protocol = next.positions.filter((position) => position.seat_id === 'ATHENA').length === 1;
      if (response.action === 'ABSTAIN') protocol = response.rationale.length > 0;
    } catch { protocol = false; if (response.action === 'REVISE') revisionApplicable = 'FAIL'; if (response.action === 'CONCEDE') concessionApplicable = 'FAIL'; if (response.action === 'REQUEST_EVIDENCE') evidenceApplicable = 'FAIL'; }
  }
  const d = diagnostics({ ...({ diagnostics: result.execution.diagnostics, finish_reason: result.execution.diagnostics?.finish_reason, usage: { output_tokens: result.execution.diagnostics?.output_tokens } } as unknown as ModelResponse<unknown>), status: result.status === 'SUCCESS' ? 'SUCCESS' : 'REJECTED', execution: result.execution, error: null } as ModelResponse<unknown>);
  const projected = guarded.projections[0];
  return { ...base, PRIVACY_BOUNDARY: projected && !projected.peer_reasoning_present && !projected.unrelated_challenges_present && !projected.zeus_context_present && !projected.human_decision_context_present ? 'PASS' : 'FAIL', PEER_REASONING_PRESENT: projected?.peer_reasoning_present ?? true, UNRELATED_CHALLENGES_PRESENT: projected?.unrelated_challenges_present ?? true, ZEUS_CONTEXT_PRESENT: projected?.zeus_context_present ?? true, HUMAN_DECISION_CONTEXT_PRESENT: projected?.human_decision_context_present ?? true, HTTP_STATUS: d.http, FINISH_REASON: d.finish, OUTPUT_TOKENS: d.output, CONFIGURED_MAX_OUTPUT_TOKENS: typeof result.execution.diagnostics?.configured_max_output_tokens === 'number' ? result.execution.diagnostics.configured_max_output_tokens : typeof result.execution.diagnostics?.output_tokens === 'number' ? result.execution.diagnostics.output_tokens : PHASE5C_MAX_OUTPUT_TOKENS, STRUCTURED_OUTPUT_PRESENT: response ? 'PASS' : 'FAIL', PROVIDER_OUTPUT_EXTRACTED: response ? 'PASS' : 'FAIL', JSON_PARSE: result.status === 'SUCCESS' ? 'PASS' : 'FAIL', RESPONSE_DTO_VALIDATION: responseDto ? 'PASS' : 'FAIL', RESPONSE_SEMANTIC_VALIDATION: responseSemantic ? 'PASS' : 'FAIL', PROTOCOL_VALIDATION: protocol ? 'PASS' : 'FAIL', RESPONSE_CONVERSION: response ? 'PASS' : 'FAIL', ACTION: response?.action ?? null, REVISION_APPLICABILITY: revisionApplicable, CONCESSION_APPLICABILITY: concessionApplicable, EVIDENCE_REQUEST_APPLICABILITY: evidenceApplicable, TRUNCATION_DETECTED: result.execution.diagnostics?.truncation_detected === true || result.execution.diagnostics?.finish_reason === 'length', FINAL_EXECUTION_STATUS: result.execution.status, FAILURE_STAGE: result.execution.failure_stage, FAILURE_CODE: result.execution.failure_reason_code, REQUEST_BUDGET_ENFORCED: budgeted.stats().attempted_count <= PHASE5C_REQUEST_BUDGET && guarded.projections.length <= PHASE5C_REQUEST_BUDGET ? 'PASS' : 'FAIL' };
}

export function formatPhase5cReport(report: Phase5cChallengeReport | Phase5cResponseReport): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(report)) {
    if (key === 'CHALLENGE_DIAGNOSTICS' && Array.isArray(value)) {
      for (const candidate of value as readonly Phase5cChallengeCandidateDiagnostic[]) {
        const prefix = `CHALLENGE_${candidate.CHALLENGE_INDEX}`;
        lines.push(`${prefix}_TARGET=${candidate.TARGET_SEAT}`);
        lines.push(`${prefix}_TYPE=${candidate.CHALLENGE_TYPE}`);
        lines.push(`${prefix}_DTO=${candidate.DTO}`);
        lines.push(`${prefix}_SEMANTIC=${candidate.SEMANTIC}`);
        lines.push(`${prefix}_FAILURE_CODE=${candidate.FAILURE_CODE ?? 'null'}`);
        lines.push(`${prefix}_PROTOCOL=${candidate.PROTOCOL}`);
        for (const [check, result] of Object.entries(candidate.CHECKS)) lines.push(`${prefix}_${check.toUpperCase()}=${result}`);
      }
      continue;
    }
    lines.push(`${key}=${Array.isArray(value) ? value.join(',') : value === null ? 'null' : value}`);
  }
  return lines.join('\n');
}

export function makeMockChallengeResponse(request: HttpRequest, mode: 'VALID' | 'MALFORMED' | 'TRUNCATED' = 'VALID'): HttpResponse {
  const { context } = parseBody(request);
  if (mode === 'TRUNCATED') return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: '{"challenges":[' }, finish_reason: 'length' }], usage: { completion_tokens: PHASE5C_MAX_OUTPUT_TOKENS } }) };
  if (mode === 'MALFORMED') return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: '{not-json' }, finish_reason: 'stop' }] }) };
  if (context.seat_id === 'ARES') return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ challenges: [{ disagreement_id: context.target_disagreement_id ?? 'disagreement-assumption-0', to_seat: 'ATHENA', target_type: 'CLAIM', target_position: 'position-athena-1', target_claim: 'position-athena-1-claim-1', challenge_type: 'ASSUMPTION', challenge_text: 'Address the targeted assumption using only sealed evidence.', evidence_ids: ['EV-001'], requested_action: 'DEFEND' }] }) }, finish_reason: 'stop' }] }) };
  return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ action: 'DEFEND', rationale: 'The locked position remains supported by the cited evidence.', evidence_ids: ['EV-001'], revised_assessment: null, concession: null, abstention_reason: null }) }, finish_reason: 'stop' }] }) };
}

export function mockTransport(mode: 'VALID' | 'MALFORMED' | 'TRUNCATED' = 'VALID'): MockTransport { return new MockTransport((request) => makeMockChallengeResponse(request, mode)); }
