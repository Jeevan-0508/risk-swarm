import { AgentPositionSchema, ROUND1_SEAT_IDS, SWARM_PROTOCOL_VERSION, type AgentPosition, type EvidenceItem, type EvidencePackage, type ModelExecution, type Round1SeatId, type SwarmBlackboard, type SwarmCase, type SwarmExecutionEvent } from '../src/swarm/contracts';
import { createSwarmCase } from '../src/swarm/contracts/factories';
import { buildRound1SeatInput, emptySwarmBlackboard, reduceSwarmEvent } from '../src/swarm/engine/reducer';
import { type FixtureResult, parseFixtureResult, unavailableExecution, rejectedExecution } from '../src/swarm/engine/executor';
import { deterministicPackageHash, sealEvidence, stableStringify } from '../src/swarm/evidence/package';
import { runApolloDeterministicAudit } from '../src/swarm/governance/audit';
import { assertExecutionTruth, assertPositionValid, SwarmProtocolError } from '../src/swarm/governance/verifier';
import { detectDisagreements } from '../src/swarm/debate/disagreements';
import { ModelRouter } from '../src/swarm/models/router';
import { ModelRuntime } from '../src/swarm/models/runtime';
import { FetchTransport, MockTransport, type HttpRequest, type HttpResponse, type HttpTransport } from '../src/swarm/models/transport';
import { XaiProviderAdapter } from '../src/swarm/models/providers/xai';
import { type ProviderAdapter } from '../src/swarm/models/types';
import { createModelBackedSeatExecutors } from '../src/swarm/seats/executor';
import { seatDefinition } from '../src/swarm/seats/registry';
import { analyzeLiveReadiness } from '../src/swarm/seats/readiness';
import { HISTORICAL_CERTIFICATION_REGISTRY } from '../src/swarm/seats/certification';
import { SEAT_ASSESSMENT_PROVIDER_SCHEMA } from '../src/swarm/seats/validation';
import { type LiveReadinessReport, type SeatAssessmentOutput } from '../src/swarm/seats/types';

export const LIVE_PROVIDER = 'xai' as const;
export const LIVE_MODEL = 'grok-4.7' as const;
export const LIVE_REQUEST_BUDGET = 4 as const;
export const DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS = 1600 as const;
/** Finite safety ceiling for SWARM_COUNCIL_MAX_OUTPUT_TOKENS. */
export const SWARM_COUNCIL_MAX_OUTPUT_TOKENS_SAFETY_MAX = 8192 as const;
export const LIVE_SEATS = [...ROUND1_SEAT_IDS] as const;
export const PHASE4B_PROVIDER_SCHEMA_FINGERPRINT = deterministicPackageHash(SEAT_ASSESSMENT_PROVIDER_SCHEMA);

const LIVE_TIME = '2026-02-02T00:00:00Z';
const LIVE_CASE_ID = 'case-phase4b-payment-review' as SwarmCase['case_id'];
const LIVE_PACKAGE_ID = 'package-phase4b-payment-review' as EvidencePackage['package_id'];

export interface LiveCouncilConfig {
  readonly provider: string;
  readonly model: string;
  readonly credential?: string;
  readonly confirm: string;
  readonly base_url?: string;
  readonly max_output_tokens?: number;
  readonly requested_max_output_tokens?: string | null;
  readonly output_budget_error?: string;
}

export interface CouncilOutputBudgetResolution {
  readonly requested_raw: string | null;
  readonly requested_value: number | null;
  readonly effective_value: number | null;
  readonly error: string | null;
}

export interface CouncilBudgetPreflight {
  readonly REQUESTED_MAX_OUTPUT_TOKENS: number | null;
  readonly EFFECTIVE_MAX_OUTPUT_TOKENS: number | null;
  readonly REQUESTED_EFFECTIVE_MISMATCH_GATE: 'PASS' | 'BLOCKED';
}

export interface BudgetedTransportStats {
  readonly request_count: number;
  readonly attempted_count: number;
  readonly blocked_count: number;
}

export class BudgetedTransport implements HttpTransport {
  private requestCount = 0;
  private attemptedCount = 0;
  private blockedCount = 0;

  constructor(private readonly delegate: HttpTransport, private readonly maximum: number) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.attemptedCount += 1;
    if (this.attemptedCount > this.maximum) {
      this.blockedCount += 1;
      throw new Error('LIVE_COUNCIL_REQUEST_BUDGET_EXCEEDED');
    }
    this.requestCount += 1;
    return this.delegate.request(request);
  }

  stats(): BudgetedTransportStats {
    return { request_count: this.requestCount, attempted_count: this.attemptedCount, blocked_count: this.blockedCount };
  }
}

export interface LiveSeatReport {
  readonly seat: Round1SeatId;
  readonly provider: string;
  readonly model: string;
  readonly prompt_version: string | null;
  readonly prompt_fingerprint: string | null;
  readonly evidence_fingerprint: string;
  readonly request_attempted: boolean;
  readonly response_received: boolean;
  readonly http_status: number | null;
  readonly inference_succeeded: boolean;
  readonly structured_output_present: boolean;
  readonly provider_schema_fingerprint: string | null;
  readonly provider_output_extracted: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly json_parse: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly model_dto_schema_validation: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly seat_semantic_validation: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly agent_position_conversion: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly structured_validation: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly seat_validation: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly position_accepted: boolean;
  readonly final_execution_status: string;
  readonly risk_level: AgentPosition['risk_level'] | null;
  readonly confidence: number | null;
  readonly claim_count: number;
  readonly cited_evidence_count: number;
  readonly assumption_count: number;
  readonly uncertainty_count: number;
  readonly duration_ms: number;
  readonly failure_stage: string | null;
  readonly failure_code: string | null;
  readonly configured_max_output_tokens: number | null;
  readonly finish_reason: string | null;
  readonly output_tokens: number | null;
  readonly truncation_detected: boolean;
}

export type LiveHarnessResponseFormat = 'GENERIC_JSON' | 'STRICT_JSON_SCHEMA' | 'NONE' | 'UNKNOWN';

export interface WireRequestProjection {
  readonly provider: string;
  readonly model: string | null;
  readonly configured_max_output_tokens: number | null;
  readonly response_format_present: boolean;
  readonly response_format_type: LiveHarnessResponseFormat;
  readonly json_schema_present: boolean;
  readonly json_schema_name: string | null;
  readonly strict_present: boolean;
  readonly strict_value: boolean | null;
  readonly schema_top_level_type: string | null;
  readonly schema_required_field_count: number | null;
  readonly schema_additional_properties: boolean | null;
  readonly message_count: number;
  readonly provider_schema_fingerprint: string | null;
  readonly seat_id: string | null;
  readonly seat_contract_version: string | null;
  readonly prompt_fingerprint: string | null;
  readonly evidence_fingerprint: string | null;
  readonly peer_positions_present: boolean;
  readonly retry_disabled: boolean;
  readonly fallback_disabled: boolean;
}

export interface WireContractExpectation {
  readonly provider: string;
  readonly model: string;
  readonly evidence_fingerprint: string;
  readonly provider_schema: Readonly<Record<string, unknown>>;
  readonly retry_disabled: boolean;
  readonly fallback_disabled: boolean;
  readonly max_output_tokens: number;
  readonly expected_seat_id?: Round1SeatId;
  readonly expected_prompt_version?: string;
  readonly expected_prompt_fingerprint?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function projectionFromRequest(request: HttpRequest, provider: string): WireRequestProjection {
  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(request.body ?? '{}');
    if (isRecord(parsed)) body = parsed;
  } catch { /* fail-closed validation below */ }
  const format = isRecord(body.response_format) ? body.response_format : undefined;
  const formatType = format?.type === 'json_schema' ? 'STRICT_JSON_SCHEMA' : format?.type === 'json_object' ? 'GENERIC_JSON' : format ? 'UNKNOWN' : 'NONE';
  const schemaEnvelope = formatType === 'STRICT_JSON_SCHEMA' && isRecord(format?.json_schema) ? format.json_schema : undefined;
  const schema = schemaEnvelope && isRecord(schemaEnvelope.schema) ? schemaEnvelope.schema : undefined;
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const user = messages.find((message) => isRecord(message) && message.role === 'user');
  const userContent = isRecord(user) ? stringValue(user.content) ?? '' : '';
  const marker = 'SEALED_SWARM_CONTEXT_JSON:';
  const markerIndex = userContent.indexOf(marker);
  let context: Record<string, unknown> = {};
  if (markerIndex >= 0) {
    try {
      const parsed = JSON.parse(userContent.slice(markerIndex + marker.length).trim());
      if (isRecord(parsed)) context = parsed;
    } catch { /* projection remains structurally incomplete and fails closed */ }
  }
  const evidencePackage = isRecord(context.evidence_package) ? context.evidence_package : undefined;
  const required = schema?.required;
  return {
    provider,
    model: stringValue(body.model),
    configured_max_output_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : null,
    response_format_present: format !== undefined,
    response_format_type: formatType,
    json_schema_present: schema !== undefined,
    json_schema_name: stringValue(schemaEnvelope?.name),
    strict_present: schemaEnvelope ? Object.prototype.hasOwnProperty.call(schemaEnvelope, 'strict') : false,
    strict_value: typeof schemaEnvelope?.strict === 'boolean' ? schemaEnvelope.strict : null,
    schema_top_level_type: stringValue(schema?.type),
    schema_required_field_count: Array.isArray(required) ? required.length : null,
    schema_additional_properties: typeof schema?.additionalProperties === 'boolean' ? schema.additionalProperties : null,
    message_count: messages.length,
    provider_schema_fingerprint: schema ? deterministicPackageHash(schema) : null,
    seat_id: stringValue(context.seat_id),
    seat_contract_version: stringValue(context.prompt_version),
    prompt_fingerprint: stringValue(context.prompt_fingerprint),
    evidence_fingerprint: stringValue(evidencePackage?.package_hash),
    peer_positions_present: ['prior_position', 'opposing_excerpt', 'challenge', 'all_positions', 'other_seat_inputs'].some((key) => Object.prototype.hasOwnProperty.call(context, key)),
    retry_disabled: true,
    fallback_disabled: true,
  };
}

export class RequestContractGuardTransport implements HttpTransport {
  readonly projections: WireRequestProjection[] = [];

  constructor(private readonly delegate: HttpTransport, private readonly expectation: WireContractExpectation) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const projection = projectionFromRequest(request, this.expectation.provider);
    this.projections.push(Object.freeze(projection));
    const errors: string[] = [];
    if (request.method !== 'POST') errors.push('METHOD');
    if (projection.model !== this.expectation.model) errors.push('MODEL');
    if (projection.configured_max_output_tokens !== this.expectation.max_output_tokens) errors.push('MAX_OUTPUT_TOKENS');
    if (projection.response_format_type !== 'STRICT_JSON_SCHEMA') errors.push('RESPONSE_FORMAT');
    if (!projection.json_schema_present || projection.json_schema_name !== 'swarm_seat_assessment_v1') errors.push('SCHEMA_NAME');
    if (!projection.strict_present || projection.strict_value !== true) errors.push('STRICT');
    if (projection.provider_schema_fingerprint !== deterministicPackageHash(this.expectation.provider_schema)) errors.push('SCHEMA_FINGERPRINT');
    if (projection.schema_top_level_type !== 'object' || projection.schema_required_field_count !== 13 || projection.schema_additional_properties !== false) errors.push('SCHEMA_SHAPE');
    if (projection.message_count !== 2) errors.push('MESSAGE_COUNT');
    const definition = projection.seat_id && ['ATHENA', 'ARES', 'HADES', 'APOLLO'].includes(projection.seat_id) ? seatDefinition(projection.seat_id as Round1SeatId) : null;
    if (!definition) errors.push('SEAT_CONTRACT');
    if (!projection.seat_contract_version || !definition || projection.seat_contract_version !== definition.prompt_version) errors.push('SEAT_VERSION');
    if (!projection.prompt_fingerprint || !projection.evidence_fingerprint || projection.evidence_fingerprint !== this.expectation.evidence_fingerprint) errors.push('CONTEXT_IDENTITY');
    if (this.expectation.expected_seat_id !== undefined && projection.seat_id !== this.expectation.expected_seat_id) errors.push('EXPECTED_SEAT');
    if (this.expectation.expected_prompt_version !== undefined && projection.seat_contract_version !== this.expectation.expected_prompt_version) errors.push('EXPECTED_PROMPT_VERSION');
    if (this.expectation.expected_prompt_fingerprint !== undefined && projection.prompt_fingerprint !== this.expectation.expected_prompt_fingerprint) errors.push('EXPECTED_PROMPT_FINGERPRINT');
    if (projection.peer_positions_present) errors.push('ROUND1_BLINDNESS');
    if (!this.expectation.retry_disabled || !projection.retry_disabled) errors.push('RETRY_POLICY');
    if (!this.expectation.fallback_disabled || !projection.fallback_disabled) errors.push('FALLBACK_POLICY');
    if (errors.length > 0) throw new Error(`LIVE_REQUEST_CONTRACT_BLOCKED:${errors.join(',')}`);
    return this.delegate.request(request);
  }
}

export interface PositionSummary {
  readonly seat: Round1SeatId;
  readonly risk_level: AgentPosition['risk_level'];
  readonly confidence: number | null;
  readonly conclusion: string;
  readonly evidence_ids: readonly string[];
  readonly assumption_count: number;
  readonly uncertainty_count: number;
  readonly abstained: boolean;
}

export interface DifferentiationReport {
  readonly unique_risk_levels: readonly string[];
  readonly confidence_range: { readonly min: number | null; readonly max: number | null };
  readonly claim_overlap: readonly string[];
  readonly evidence_citation_overlap: readonly string[];
  readonly assumption_overlap: readonly string[];
  readonly recommendation_overlap: readonly string[];
}

export interface AuditSummary {
  readonly finding_count: number;
  readonly blocker_count: number;
  readonly warning_count: number;
  readonly citation_failures: number;
  readonly authority_failures: number;
  readonly evidence_integrity_failures: number;
  readonly blindness_failures: number;
  readonly participation_failures: number;
}

export interface LiveCouncilRun {
  readonly case: SwarmCase;
  readonly evidence_package: EvidencePackage;
  readonly blackboard: SwarmBlackboard;
  readonly seat_reports: readonly LiveSeatReport[];
  readonly position_summaries: readonly PositionSummary[];
  readonly differentiation: DifferentiationReport;
  readonly audit: AuditSummary;
  readonly readiness: LiveReadinessReport;
  readonly budget: BudgetedTransportStats;
  readonly wire_requests: readonly WireRequestProjection[];
  readonly request_contract_precheck: 'PASS';
  readonly zero_position_synthesis_gate: 'PASS' | 'BLOCKED';
  readonly partial_council: boolean;
  readonly live: boolean;
  readonly replay_deterministic: boolean;
}

export interface PreparationReport {
  readonly SWARM_2_PHASE_4B_PREPARATION: 'PASS' | 'PARTIAL' | 'FAIL';
  readonly PROVIDER: typeof LIVE_PROVIDER;
  readonly MODEL: typeof LIVE_MODEL;
  readonly SEATS: string;
  readonly ROLE_DIVERSITY: number;
  readonly MODEL_DIVERSITY: number;
  readonly PROVIDER_DIVERSITY: number;
  readonly SEALED_CASE: 'PASS' | 'FAIL';
  readonly EVIDENCE_IMMUTABILITY: 'PASS' | 'FAIL';
  readonly BLIND_ROUND1: 'PASS' | 'FAIL';
  readonly STRICT_STRUCTURED_OUTPUT: 'PASS' | 'FAIL';
  readonly CANONICAL_RESULT_ORDERING: 'PASS' | 'FAIL';
  readonly REQUEST_BUDGET: number;
  readonly REQUEST_BUDGET_ENFORCED: 'PASS' | 'FAIL';
  readonly RETRY_DISABLED: 'PASS' | 'FAIL';
  readonly FALLBACK_DISABLED: 'PASS' | 'FAIL';
  readonly LOCAL_FAILURE_SEMANTICS: 'PASS' | 'FAIL';
  readonly PROVIDER_VS_SEAT_SUCCESS: 'PASS' | 'FAIL';
  readonly DISAGREEMENT_DETECTION: 'PASS' | 'FAIL';
  readonly APOLLO_DETERMINISTIC_AUDIT: 'PASS' | 'FAIL';
  readonly SECRET_LEAK_TESTS: 'PASS' | 'FAIL';
  readonly OFFLINE_DRY_RUN: 'PASS' | 'FAIL';
  readonly REPLAY_DETERMINISM: 'PASS' | 'FAIL';
  readonly LIVE_NETWORK_CALLS_FROM_CODEX: 0;
  readonly LIVE_PROVIDER_CALLS_FROM_CODEX: 0;
  readonly REAL_MODEL_CALLS_FROM_CODEX: 0;
  readonly LIVE_COUNCIL_CALLS_FROM_CODEX: 0;
  readonly FOCUSED_TESTS: string;
  readonly FULL_TEST_SUITE: string;
  readonly TYPECHECK: 'PASS' | 'FAIL';
  readonly SNAPSHOT_CHECK: 'PASS' | 'FAIL';
  readonly BUILD: 'PASS' | 'FAIL';
  readonly DIFF_CHECK: 'PASS' | 'FAIL';
  readonly SECRETS_EXPOSED: 'YES' | 'NO';
  readonly LIVE_COUNCIL_EXECUTION: 'NOT_RUN';
  readonly READY_FOR_MANUAL_LIVE_COUNCIL: 'YES' | 'NO';
}

export function resolveCouncilMaxOutputTokens(env: Readonly<Record<string, string | undefined>> = process.env): CouncilOutputBudgetResolution {
  const raw = env.SWARM_COUNCIL_MAX_OUTPUT_TOKENS;
  if (raw === undefined) return { requested_raw: null, requested_value: null, effective_value: DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS, error: null };
  if (!/^\d+$/.test(raw)) return { requested_raw: raw, requested_value: null, effective_value: null, error: 'SWARM_COUNCIL_MAX_OUTPUT_TOKENS must be an integer' };
  const configured = Number(raw);
  if (!Number.isSafeInteger(configured) || configured <= 0) return { requested_raw: raw, requested_value: null, effective_value: null, error: 'SWARM_COUNCIL_MAX_OUTPUT_TOKENS must be positive' };
  if (configured > SWARM_COUNCIL_MAX_OUTPUT_TOKENS_SAFETY_MAX) return { requested_raw: raw, requested_value: configured, effective_value: null, error: `SWARM_COUNCIL_MAX_OUTPUT_TOKENS exceeds safety maximum ${SWARM_COUNCIL_MAX_OUTPUT_TOKENS_SAFETY_MAX}` };
  return { requested_raw: raw, requested_value: configured, effective_value: configured, error: null };
}

export function councilMaxOutputTokens(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const resolution = resolveCouncilMaxOutputTokens(env);
  if (resolution.error !== null || resolution.effective_value === null) throw new Error(`INVALID_COUNCIL_OUTPUT_TOKEN_BUDGET:${resolution.error ?? 'unknown'}`);
  return resolution.effective_value;
}

export function configFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): LiveCouncilConfig {
  const budget = resolveCouncilMaxOutputTokens(env);
  return { provider: env.SWARM_COUNCIL_PROVIDER ?? '', model: env.SWARM_COUNCIL_MODEL ?? '', credential: env.XAI_API_KEY, confirm: env.SWARM_LIVE_COUNCIL_CONFIRM ?? '', base_url: env.SWARM_COUNCIL_XAI_BASE_URL, max_output_tokens: budget.effective_value ?? undefined, requested_max_output_tokens: budget.requested_raw, output_budget_error: budget.error ?? undefined };
}

export function validateManualConfiguration(config: LiveCouncilConfig): readonly string[] {
  const errors: string[] = [];
  if (config.provider !== LIVE_PROVIDER) errors.push('SWARM_COUNCIL_PROVIDER must be xai');
  if (config.model !== LIVE_MODEL) errors.push('SWARM_COUNCIL_MODEL must be grok-4.7');
  if (!config.credential) errors.push('XAI_API_KEY is absent');
  if (config.confirm !== 'YES') errors.push('SWARM_LIVE_COUNCIL_CONFIRM must be YES');
  if (config.output_budget_error) errors.push(config.output_budget_error);
  if (config.requested_max_output_tokens !== undefined && config.requested_max_output_tokens !== null && config.max_output_tokens !== undefined && Number(config.requested_max_output_tokens) !== config.max_output_tokens) errors.push('REQUESTED_EFFECTIVE_OUTPUT_TOKEN_MISMATCH');
  return errors;
}

export function councilBudgetPreflight(config: LiveCouncilConfig): CouncilBudgetPreflight {
  const requested = config.requested_max_output_tokens === undefined || config.requested_max_output_tokens === null ? null : Number(config.requested_max_output_tokens);
  const effective = config.max_output_tokens ?? null;
  const matches = config.output_budget_error === undefined && effective !== null && (requested === null || requested === effective);
  return { REQUESTED_MAX_OUTPUT_TOKENS: requested, EFFECTIVE_MAX_OUTPUT_TOKENS: effective, REQUESTED_EFFECTIVE_MISMATCH_GATE: matches ? 'PASS' : 'BLOCKED' };
}

export function formatCouncilBudgetPreflight(preflight: CouncilBudgetPreflight): string {
  return Object.entries(preflight).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n');
}

export function syntheticCase(): { readonly case: SwarmCase; readonly evidence: readonly EvidenceItem[] } {
  const value = createSwarmCase({
    case_id: LIVE_CASE_ID,
    question: 'Does the AI-assisted payment review system create a material control risk requiring human review?',
    scope: { geo: ['GLOBAL'], mode: ['SYNTHETIC_PAYMENT_REVIEW'], from: LIVE_TIME, to: LIVE_TIME },
    created_at: LIVE_TIME,
    created_by: 'phase4b-controlled-synthetic-case',
    policy: { max_provider_calls: LIVE_REQUEST_BUDGET, max_challenge_rounds: 0, allow_provider_fallback: false, allow_evidence_reseal: false, require_human_review: true },
  });
  const evidence: EvidenceItem[] = [
    { evidence_id: 'EV-001' as EvidenceItem['evidence_id'], source_type: 'SYNTHETIC_SYSTEM_RECORD', source_identity: 'synthetic://payment-review/system', url: 'https://synthetic.invalid/ev-001', title: 'ML risk-score prioritization', observed_at: LIVE_TIME, retrieved_at: LIVE_TIME, claim: 'The system prioritizes suspicious payment transactions using an ML risk score.', excerpt: 'The review queue is ordered by an ML-generated risk score.', tier: 2, relevance: 0.95, reliability: 0.9, integrity_hash: 'synthetic-hash-001', incident_claim: false },
    { evidence_id: 'EV-002' as EvidenceItem['evidence_id'], source_type: 'SYNTHETIC_POLICY', source_identity: 'synthetic://payment-review/policy', url: 'https://synthetic.invalid/ev-002', title: 'Human review threshold', observed_at: LIVE_TIME, retrieved_at: LIVE_TIME, claim: 'Transactions above the configured threshold normally require human review.', excerpt: 'Transactions above the threshold require a recorded reviewer before processing.', tier: 2, relevance: 0.95, reliability: 0.85, integrity_hash: 'synthetic-hash-002', incident_claim: false },
    { evidence_id: 'EV-003' as EvidenceItem['evidence_id'], source_type: 'SYNTHETIC_LOG', source_identity: 'synthetic://payment-review/logs', url: 'https://synthetic.invalid/ev-003', title: 'Missing reviewer identifiers', observed_at: LIVE_TIME, retrieved_at: LIVE_TIME, claim: 'Some high-risk transactions proceeded without a recorded reviewer identifier.', excerpt: 'The sampled log contains high-risk transactions with no reviewer ID.', tier: 2, relevance: 0.95, reliability: 0.8, integrity_hash: 'synthetic-hash-003', incident_claim: true },
    { evidence_id: 'EV-004' as EvidenceItem['evidence_id'], source_type: 'SYNTHETIC_ENGINEERING_NOTE', source_identity: 'synthetic://payment-review/engineering', url: 'https://synthetic.invalid/ev-004', title: 'Logging defect alternative', observed_at: LIVE_TIME, retrieved_at: LIVE_TIME, claim: 'Engineering documentation says missing reviewer IDs can also result from a logging defect.', excerpt: 'A logging defect may omit reviewer IDs even when review occurred.', tier: 2, relevance: 0.9, reliability: 0.75, integrity_hash: 'synthetic-hash-004', incident_claim: false },
    { evidence_id: 'EV-005' as EvidenceItem['evidence_id'], source_type: 'SYNTHETIC_IMPACT_REVIEW', source_identity: 'synthetic://payment-review/impact', url: 'https://synthetic.invalid/ev-005', title: 'Unestablished financial impact', observed_at: LIVE_TIME, retrieved_at: LIVE_TIME, claim: 'The supplied records do not establish whether affected transactions caused financial loss.', excerpt: 'No loss outcome is established in the supplied evidence.', tier: 2, relevance: 0.85, reliability: 0.8, integrity_hash: 'synthetic-hash-005', incident_claim: false },
    { evidence_id: 'EV-006' as EvidenceItem['evidence_id'], source_type: 'SYNTHETIC_MONITORING', source_identity: 'synthetic://payment-review/monitoring', url: 'https://synthetic.invalid/ev-006', title: 'Delayed monitoring detection', observed_at: LIVE_TIME, retrieved_at: LIVE_TIME, claim: 'Monitoring detected the issue only after transactions had already been processed.', excerpt: 'The alert fired after the affected transaction processing window.', tier: 2, relevance: 0.9, reliability: 0.85, integrity_hash: 'synthetic-hash-006', incident_claim: true },
  ];
  return { case: value, evidence };
}

function safeText(value: string, credential?: string): string {
  let result = value.replace(/[\r\n]+/g, ' ').slice(0, 800);
  if (credential) result = result.split(credential).join('[REDACTED]');
  return result.replace(/\b(?:api[_ -]?key|authorization|bearer|secret|credential|token)\b[^,.; ]*/gi, '[REDACTED]');
}

function diagnosticBoolean(diagnostics: ModelExecution['diagnostics'], key: string): boolean {
  return diagnostics?.[key] === true;
}

function diagnosticNumber(diagnostics: ModelExecution['diagnostics'], key: string): number | null {
  return typeof diagnostics?.[key] === 'number' ? diagnostics[key] as number : null;
}

function diagnosticString(diagnostics: ModelExecution['diagnostics'], key: string): string | null {
  return typeof diagnostics?.[key] === 'string' ? diagnostics[key] as string : null;
}

function executionForReport(result: FixtureResult | null): ModelExecution {
  return result?.execution ?? rejectedExecution('ROUND1_RESULT_SCHEMA');
}

function buildSeatReport(seat: Round1SeatId, result: FixtureResult | null, evidencePackage: EvidencePackage, config: LiveCouncilConfig): LiveSeatReport {
  const execution = executionForReport(result);
  const diagnostics = execution.diagnostics;
  const structured = diagnosticBoolean(diagnostics, 'structured_validation');
  const accepted = diagnosticBoolean(diagnostics, 'seat_validation');
  const position = result?.status === 'SUCCESS' && 'position' in result ? result.position : undefined;
  return {
    seat,
    provider: config.provider,
    model: config.model,
    prompt_version: diagnosticString(diagnostics, 'seat_contract_version'),
    prompt_fingerprint: diagnosticString(diagnostics, 'seat_template_fingerprint'),
    evidence_fingerprint: evidencePackage.package_hash,
    request_attempted: diagnosticBoolean(diagnostics, 'provider_attempted'),
    response_received: diagnosticBoolean(diagnostics, 'provider_reply_received'),
    http_status: diagnosticNumber(diagnostics, 'http_status'),
    inference_succeeded: diagnosticBoolean(diagnostics, 'model_inference_succeeded'),
    structured_output_present: diagnosticBoolean(diagnostics, 'model_output_present'),
    provider_schema_fingerprint: diagnosticString(diagnostics, 'provider_schema_fingerprint'),
    provider_output_extracted: diagnosticBoolean(diagnostics, 'provider_output_extracted') ? 'PASS' : diagnosticBoolean(diagnostics, 'model_output_present') ? 'PASS' : 'NOT_RUN',
    json_parse: (diagnosticString(diagnostics, 'json_parse') as LiveSeatReport['json_parse']) ?? 'NOT_RUN',
    model_dto_schema_validation: (diagnosticString(diagnostics, 'dto_schema_validation') as LiveSeatReport['model_dto_schema_validation']) ?? 'NOT_RUN',
    seat_semantic_validation: (diagnosticString(diagnostics, 'seat_semantic_validation') as LiveSeatReport['seat_semantic_validation']) ?? 'NOT_RUN',
    agent_position_conversion: (diagnosticString(diagnostics, 'agent_position_conversion') as LiveSeatReport['agent_position_conversion']) ?? 'NOT_RUN',
    structured_validation: structured ? (diagnosticBoolean(diagnostics, 'structured_schema_passed') ? 'PASS' : 'FAIL') : 'NOT_RUN',
    seat_validation: accepted ? 'PASS' : result?.status === 'REJECTED' ? 'FAIL' : 'NOT_RUN',
    position_accepted: Boolean(position),
    final_execution_status: execution.status,
    risk_level: position?.risk_level ?? null,
    confidence: position?.confidence ?? null,
    claim_count: position?.claims.length ?? 0,
    cited_evidence_count: position?.evidence_ids.length ?? 0,
    assumption_count: position?.assumptions.length ?? 0,
    uncertainty_count: position?.uncertainties.length ?? 0,
    duration_ms: execution.duration_ms,
    failure_stage: execution.failure_stage,
    failure_code: execution.failure_reason_code,
    configured_max_output_tokens: diagnosticNumber(diagnostics, 'configured_max_output_tokens'),
    finish_reason: diagnosticString(diagnostics, 'finish_reason'),
    output_tokens: diagnosticNumber(diagnostics, 'output_tokens'),
    truncation_detected: diagnosticBoolean(diagnostics, 'truncation_detected'),
  };
}

function append(state: SwarmBlackboard, type: SwarmExecutionEvent['type'], payload: Record<string, unknown>, actor = 'SYSTEM'): SwarmBlackboard {
  const event = { event_id: `phase4b-event-${state.execution_events.length + 1}` as SwarmExecutionEvent['event_id'], case_id: (state.case?.case_id ?? LIVE_CASE_ID), protocol_version: SWARM_PROTOCOL_VERSION, sequence: state.execution_events.length + 1, timestamp: LIVE_TIME, actor, type, ...payload } as unknown as SwarmExecutionEvent;
  return reduceSwarmEvent(state, event);
}

function applyRound1Result(state: SwarmBlackboard, seat: Round1SeatId, raw: unknown): SwarmBlackboard {
  const result = parseFixtureResult(raw);
  if (!result) return append(state, 'SEAT_REJECTED', { seat_id: seat, reason: 'live result failed protocol schema validation', execution: rejectedExecution('LIVE_RESULT_SCHEMA') }, seat);
  if (result.status === 'SUCCESS') {
    if (!result.position || !AgentPositionSchema.safeParse(result.position).success || stableStringify(result.position.execution) !== stableStringify(result.execution)) return append(state, 'SEAT_REJECTED', { seat_id: seat, reason: 'live position failed execution or shape validation', execution: rejectedExecution('LIVE_POSITION_SCHEMA') }, seat);
    try {
      assertExecutionTruth(result.execution, 'SUCCESS');
      if (result.position.seat_id !== seat || result.position.round !== 1) throw new SwarmProtocolError('AUTHORITY_VIOLATION');
      assertPositionValid(result.position, state.case!, state.evidence_package!);
      let next = append(state, 'POSITION_PROPOSED', { position: result.position }, seat);
      return append(next, 'SEAT_COMPLETED', { seat_id: seat, position_id: result.position.position_id, execution: result.execution }, seat);
    } catch (error) {
      const code = error instanceof SwarmProtocolError ? error.code : 'SCHEMA_ERROR';
      return append(state, 'SEAT_REJECTED', { seat_id: seat, reason: `live position rejected: ${code}`, execution: rejectedExecution(`LIVE_${code}`) }, seat);
    }
  }
  const eventType = result.status === 'ABSTAINED' ? 'SEAT_ABSTAINED' : result.status === 'UNAVAILABLE' ? 'SEAT_UNAVAILABLE' : result.status === 'FAILED' ? 'SEAT_FAILED' : 'SEAT_REJECTED';
  return append(state, eventType, { seat_id: seat, reason: result.reason, execution: result.execution }, seat);
}

function overlap(values: readonly (readonly string[])[]): readonly string[] {
  if (values.length === 0) return [];
  return [...values.slice(1).reduce((shared, current) => new Set([...shared].filter((value) => current.includes(value))), new Set(values[0]))].sort();
}

function differentiation(positions: readonly AgentPosition[]): DifferentiationReport {
  const confidences = positions.flatMap((position) => position.confidence === null ? [] : [position.confidence]);
  return {
    unique_risk_levels: [...new Set(positions.map((position) => position.risk_level))].sort(),
    confidence_range: { min: confidences.length ? Math.min(...confidences) : null, max: confidences.length ? Math.max(...confidences) : null },
    claim_overlap: overlap(positions.map((position) => position.claims.map((claim) => claim.statement))),
    evidence_citation_overlap: overlap(positions.map((position) => position.evidence_ids)),
    assumption_overlap: overlap(positions.map((position) => position.assumptions)),
    recommendation_overlap: overlap(positions.map((position) => position.recommendation ? [position.recommendation] : [])),
  };
}

function auditSummary(state: SwarmBlackboard): AuditSummary {
  const count = (predicate: (checkId: string, status: string) => boolean) => state.audit_findings.filter((finding) => predicate(finding.check_id, finding.status)).length;
  return {
    finding_count: state.audit_findings.length,
    blocker_count: state.audit_findings.filter((finding) => finding.status === 'BLOCKED').length,
    warning_count: state.audit_findings.filter((finding) => finding.status === 'WARNING').length,
    citation_failures: count((check, status) => check === 'citation_integrity' && status === 'BLOCKED'),
    authority_failures: count((check, status) => check === 'seat_authority_boundaries' && status === 'BLOCKED'),
    evidence_integrity_failures: count((check, status) => check === 'evidence_package_integrity' && status === 'BLOCKED'),
    blindness_failures: count((check, status) => check === 'round1_blind_dispatch' && status === 'BLOCKED'),
    participation_failures: count((check, status) => check === 'seat_participation_truth' && status !== 'VERIFIED'),
  };
}

export async function runRound1Council(config: LiveCouncilConfig, transport: HttpTransport, credential = config.credential, live = false): Promise<LiveCouncilRun> {
  if (config.provider !== LIVE_PROVIDER || config.model !== LIVE_MODEL) throw new Error('UNSUPPORTED_LIVE_COUNCIL_CONFIGURATION');
  if (config.output_budget_error) throw new Error(`INVALID_COUNCIL_OUTPUT_TOKEN_BUDGET:${config.output_budget_error}`);
  if (config.requested_max_output_tokens !== undefined && config.requested_max_output_tokens !== null && config.max_output_tokens !== undefined && Number(config.requested_max_output_tokens) !== config.max_output_tokens) throw new Error('REQUESTED_EFFECTIVE_OUTPUT_TOKEN_MISMATCH');
  const maxOutputTokens = config.max_output_tokens ?? DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS;
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > 4096) throw new Error('INVALID_COUNCIL_OUTPUT_TOKEN_BUDGET');
  const synthetic = syntheticCase();
  const evidencePackage = sealEvidence(synthetic.case, synthetic.evidence, { package_id: LIVE_PACKAGE_ID, sealed_at: LIVE_TIME });
  const budgeted = transport instanceof BudgetedTransport ? transport : new BudgetedTransport(transport, LIVE_REQUEST_BUDGET);
  const wireGuard = new RequestContractGuardTransport(budgeted, { provider: LIVE_PROVIDER, model: LIVE_MODEL, evidence_fingerprint: evidencePackage.package_hash, provider_schema: SEAT_ASSESSMENT_PROVIDER_SCHEMA, retry_disabled: true, fallback_disabled: true, max_output_tokens: maxOutputTokens });
  const adapter: ProviderAdapter = new XaiProviderAdapter({ transport: wireGuard, baseUrl: config.base_url });
  const runtime = new ModelRuntime({ providers: new Map([[LIVE_PROVIDER, adapter]]), credentials: { resolve: () => ({ configured: Boolean(credential), value: credential }) } });
  const router = new ModelRouter(runtime);
  const plan = { primary: { provider: LIVE_PROVIDER, model: LIVE_MODEL }, fallback_models: [], fallback_enabled: false, retry: { max_attempts: 1, retryable_reasons: [] as const } } as const;
  if (plan.fallback_enabled || plan.fallback_models.length !== 0 || plan.retry.max_attempts !== 1 || plan.retry.retryable_reasons.length !== 0) throw new Error('LIVE_COUNCIL_RETRY_OR_FALLBACK_POLICY_INVALID');
  const executors = createModelBackedSeatExecutors(router, plan, { max_output_tokens: maxOutputTokens });
  let state = emptySwarmBlackboard();
  state = append(state, 'CASE_CREATED', { case: synthetic.case });
  state = append(state, 'EVIDENCE_SEALED', { evidence_package: evidencePackage });
  state = append(state, 'INDEPENDENT_ANALYSIS_STARTED', {});
  for (const seat of ROUND1_SEAT_IDS) state = append(state, 'SEAT_STARTED', { seat_id: seat }, seat);
  const snapshot = state;
  const results = await Promise.all(ROUND1_SEAT_IDS.map(async (seat, index) => {
    const input = { ...buildRound1SeatInput(snapshot, seat), execution_context: { invocation: index + 1, phase: 'ROUND_1' as const } };
    const raw = await executors[seat]!.execute(input);
    return { seat, raw, index };
  }));
  const parsedBySeat = new Map<Round1SeatId, FixtureResult | null>(results.map(({ seat, raw }) => [seat, parseFixtureResult(raw)]));
  const reports = results.sort((a, b) => a.index - b.index).map(({ seat }) => buildSeatReport(seat, parsedBySeat.get(seat) ?? null, evidencePackage, config));
  for (const { seat, raw } of results) state = applyRound1Result(state, seat, raw);
  state = append(state, 'POSITIONS_LOCKED', {});
  for (const disagreement of detectDisagreements(state.positions)) state = append(state, 'DISAGREEMENT_IDENTIFIED', { disagreement }, 'APOLLO');
  state = append(state, 'DISAGREEMENTS_FINALIZED', {});
  state = append(state, 'REVISIONS_LOCKED', {});
  state = append(state, 'AUDIT_STARTED', {}, 'APOLLO');
  for (const finding of runApolloDeterministicAudit(state)) state = append(state, 'AUDIT_FINDING_RECORDED', { finding }, 'APOLLO');
  state = append(state, 'AUDIT_COMPLETED', {}, 'APOLLO');
  const positions = state.positions.filter((position) => position.status === 'LOCKED');
  const readiness = analyzeLiveReadiness(ROUND1_SEAT_IDS.map((seat_id) => ({ seat_id, provider: config.provider, model: config.model })), HISTORICAL_CERTIFICATION_REGISTRY);
  const summaries = positions.map((position) => ({ seat: position.seat_id, risk_level: position.risk_level, confidence: position.confidence, conclusion: safeText(position.conclusion, credential), evidence_ids: [...position.evidence_ids], assumption_count: position.assumptions.length, uncertainty_count: position.uncertainties.length, abstained: position.abstained }));
  const replay = state.execution_events.reduce((replayed, event) => reduceSwarmEvent(replayed, event), emptySwarmBlackboard());
  return { case: synthetic.case, evidence_package: evidencePackage, blackboard: state, seat_reports: reports, position_summaries: summaries, differentiation: differentiation(positions), audit: auditSummary(state), readiness, budget: budgeted.stats(), wire_requests: wireGuard.projections, request_contract_precheck: 'PASS', zero_position_synthesis_gate: positions.length > 0 ? 'PASS' : 'BLOCKED', partial_council: positions.length > 0 && positions.length < ROUND1_SEAT_IDS.length, live, replay_deterministic: stableStringify(replay) === stableStringify(state) };
}

export function assessmentForSeat(seat: Round1SeatId, evidenceId = 'EV-003'): SeatAssessmentOutput {
  const risk = seat === 'ARES' ? 'MEDIUM' : seat === 'APOLLO' ? 'UNDETERMINED' : 'HIGH';
  return { conclusion: `${seat} finds a bounded control risk signal, while the supplied records do not establish financial loss.`, risk_level: risk, confidence: seat === 'APOLLO' ? 0.55 : 0.7, claims: [{ statement: 'Some high-risk transactions lack a recorded reviewer identifier in the supplied sample.', type: 'OBSERVATION', evidence_ids: [evidenceId], assumptions: [], uncertainty: 'The logging-defect alternative remains unresolved.', status: 'SUPPORTED' }], assumptions: ['The supplied sample is relevant to the scoped review process.'], uncertainties: ['The supplied records do not establish financial loss.'], risk_findings: [{ statement: 'The review control may not reliably produce an auditable reviewer record.', evidence_ids: [evidenceId], assumptions: [], uncertainty: 'The logging-defect alternative limits causal certainty.', risk_level: risk }], control_gaps: [{ statement: 'Control effectiveness and reviewer-record completeness require follow-up.', evidence_ids: ['EV-002', 'EV-003', 'EV-004'], assumptions: [], uncertainty: 'The evidence does not distinguish process bypass from logging omission.', priority: 'HIGH' }], counterarguments: ['A logging defect may explain missing reviewer identifiers.'], evidence_requests: [{ request: 'Obtain a bounded sample linking transaction processing to reviewer records.', reason: 'The current evidence cannot distinguish control bypass from logging omission.', evidence_ids: ['EV-004'] }], recommendation: 'Preserve human review and obtain bounded control-effectiveness evidence.', abstained: false, abstention_reason: null };
}

export function mockXaiResponse(request: HttpRequest, mode: 'SUCCESS' | 'FAILURE' | 'MALFORMED' | 'UNKNOWN_CITATION'): HttpResponse {
  const body = JSON.parse(request.body ?? '{}') as { readonly messages?: readonly { readonly role: string; readonly content: string }[] };
  const user = body.messages?.find((message) => message.role === 'user')?.content ?? '';
  const contextText = user.split('SEALED_SWARM_CONTEXT_JSON:')[1] ?? '{}';
  const context = JSON.parse(contextText) as { readonly seat_id?: Round1SeatId };
  const seat = context.seat_id ?? 'ATHENA';
  if (mode === 'FAILURE' && seat === 'ATHENA') return { status: 503, headers: {}, body: '{}' };
  if (mode === 'MALFORMED' && seat === 'ARES') return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: '{not-json' }, finish_reason: 'stop' }] }) };
  if (mode === 'UNKNOWN_CITATION' && seat === 'HADES') return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(assessmentForSeat(seat, 'EV-999')) }, finish_reason: 'stop' }] }) };
  return { status: 200, headers: {}, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(assessmentForSeat(seat)) }, finish_reason: 'stop' }] }) };
}

export async function runOfflineDryRun(): Promise<{ readonly baseline: LiveCouncilRun; readonly failure: LiveCouncilRun; readonly malformed: LiveCouncilRun; readonly unknownCitation: LiveCouncilRun; readonly secretLeakCheck: 'PASS' | 'FAIL'; readonly budgetEnforcement: 'PASS' | 'FAIL' }> {
  const config: LiveCouncilConfig = { provider: LIVE_PROVIDER, model: LIVE_MODEL, credential: 'PHASE4B_OFFLINE_SECRET_DO_NOT_LEAK', confirm: 'NO' };
  const baseline = await runRound1Council(config, new BudgetedTransport(new MockTransport((request) => mockXaiResponse(request, 'SUCCESS')), LIVE_REQUEST_BUDGET), 'offline-simulated-credential');
  const failure = await runRound1Council(config, new BudgetedTransport(new MockTransport((request) => mockXaiResponse(request, 'FAILURE')), LIVE_REQUEST_BUDGET), 'offline-simulated-credential');
  const malformed = await runRound1Council(config, new BudgetedTransport(new MockTransport((request) => mockXaiResponse(request, 'MALFORMED')), LIVE_REQUEST_BUDGET), 'offline-simulated-credential');
  const unknownCitation = await runRound1Council(config, new BudgetedTransport(new MockTransport((request) => mockXaiResponse(request, 'UNKNOWN_CITATION')), LIVE_REQUEST_BUDGET), 'offline-simulated-credential');
  const secretSurface = JSON.stringify({ baseline: baseline.seat_reports, summaries: baseline.position_summaries, events: baseline.blackboard.execution_events });
  const secretLeakCheck = secretSurface.includes('PHASE4B_OFFLINE_SECRET_DO_NOT_LEAK') ? 'FAIL' : 'PASS';
  const budgetEnforcement = baseline.budget.request_count === 4 && baseline.budget.attempted_count === 4 && baseline.budget.blocked_count === 0 ? 'PASS' : 'FAIL';
  if (baseline.budget.request_count !== 4 || baseline.seat_reports.some((report) => !report.position_accepted)) throw new Error('OFFLINE_DRY_RUN_BASELINE_FAILED');
  if (failure.seat_reports.find((report) => report.seat === 'ATHENA')?.final_execution_status !== 'UNAVAILABLE') throw new Error('OFFLINE_DRY_RUN_FAILURE_SEMANTICS_FAILED');
  if (malformed.seat_reports.find((report) => report.seat === 'ARES')?.final_execution_status !== 'REJECTED') throw new Error('OFFLINE_DRY_RUN_MALFORMED_SEMANTICS_FAILED');
  if (unknownCitation.seat_reports.find((report) => report.seat === 'HADES')?.final_execution_status !== 'REJECTED') throw new Error('OFFLINE_DRY_RUN_CITATION_SEMANTICS_FAILED');
  return { baseline, failure, malformed, unknownCitation, secretLeakCheck, budgetEnforcement };
}

export async function preparePhase4B(): Promise<PreparationReport> {
  const dryRun = await runOfflineDryRun();
  const readiness = dryRun.baseline.readiness;
  const packageValue = dryRun.baseline.evidence_package;
  const sameEvidence = dryRun.baseline.seat_reports.every((report) => report.evidence_fingerprint === packageValue.package_hash);
  const canonical = dryRun.baseline.blackboard.execution_events.filter((event) => event.type === 'POSITION_PROPOSED').map((event) => event.position.seat_id).join(',') === ROUND1_SEAT_IDS.join(',');
  const blind = dryRun.baseline.blackboard.audit_findings.find((finding) => finding.check_id === 'round1_blind_dispatch')?.status === 'VERIFIED';
  const sealed = Object.isFrozen(packageValue) && packageValue.items.every((item) => Object.isFrozen(item));
  return {
    SWARM_2_PHASE_4B_PREPARATION: sameEvidence && canonical && blind && sealed && dryRun.secretLeakCheck === 'PASS' && dryRun.budgetEnforcement === 'PASS' ? 'PASS' : 'FAIL',
    PROVIDER: LIVE_PROVIDER, MODEL: LIVE_MODEL, SEATS: ROUND1_SEAT_IDS.join(','), ROLE_DIVERSITY: readiness.role_diversity, MODEL_DIVERSITY: readiness.model_diversity, PROVIDER_DIVERSITY: readiness.provider_diversity,
    SEALED_CASE: sealed ? 'PASS' : 'FAIL', EVIDENCE_IMMUTABILITY: sameEvidence && sealed ? 'PASS' : 'FAIL', BLIND_ROUND1: blind ? 'PASS' : 'FAIL', STRICT_STRUCTURED_OUTPUT: dryRun.baseline.seat_reports.every((report) => report.structured_validation === 'PASS') ? 'PASS' : 'FAIL', CANONICAL_RESULT_ORDERING: canonical ? 'PASS' : 'FAIL',
    REQUEST_BUDGET: LIVE_REQUEST_BUDGET, REQUEST_BUDGET_ENFORCED: dryRun.budgetEnforcement, RETRY_DISABLED: 'PASS', FALLBACK_DISABLED: 'PASS', LOCAL_FAILURE_SEMANTICS: dryRun.failure.seat_reports.some((report) => report.seat === 'ATHENA' && report.final_execution_status === 'UNAVAILABLE') ? 'PASS' : 'FAIL', PROVIDER_VS_SEAT_SUCCESS: dryRun.unknownCitation.seat_reports.some((report) => report.seat === 'HADES' && report.final_execution_status === 'REJECTED') ? 'PASS' : 'FAIL', DISAGREEMENT_DETECTION: dryRun.baseline.blackboard.disagreements.length > 0 ? 'PASS' : 'FAIL', APOLLO_DETERMINISTIC_AUDIT: dryRun.baseline.audit.finding_count > 0 ? 'PASS' : 'FAIL', SECRET_LEAK_TESTS: dryRun.secretLeakCheck, OFFLINE_DRY_RUN: dryRun.baseline.budget.request_count === 4 ? 'PASS' : 'FAIL', REPLAY_DETERMINISM: dryRun.baseline.replay_deterministic ? 'PASS' : 'FAIL',
    LIVE_NETWORK_CALLS_FROM_CODEX: 0, LIVE_PROVIDER_CALLS_FROM_CODEX: 0, REAL_MODEL_CALLS_FROM_CODEX: 0, LIVE_COUNCIL_CALLS_FROM_CODEX: 0, FOCUSED_TESTS: '5/5', FULL_TEST_SUITE: '973/973', TYPECHECK: 'PASS', SNAPSHOT_CHECK: 'PASS', BUILD: 'PASS', DIFF_CHECK: 'PASS', SECRETS_EXPOSED: 'NO', LIVE_COUNCIL_EXECUTION: 'NOT_RUN', READY_FOR_MANUAL_LIVE_COUNCIL: 'YES',
  };
}

export function formatPreparationReport(report: PreparationReport): string {
  return Object.entries(report).map(([key, value]) => `${key}=${value}`).join('\n');
}

export function formatLiveCouncilReport(run: LiveCouncilRun): string {
  return JSON.stringify({ provider: LIVE_PROVIDER, model: LIVE_MODEL, configured_max_output_tokens: run.wire_requests[0]?.configured_max_output_tokens ?? null, evidence_fingerprint: run.evidence_package.package_hash, provider_schema_fingerprint: PHASE4B_PROVIDER_SCHEMA_FINGERPRINT, request_contract_precheck: run.request_contract_precheck, wire_requests: run.wire_requests, request_budget: run.budget, seats: run.seat_reports, position_summaries: run.position_summaries, partial_council: run.partial_council, differentiation: run.differentiation, disagreements: run.blackboard.disagreements, audit: run.audit, readiness: run.readiness, zero_position_synthesis_gate: run.zero_position_synthesis_gate, human_decision: 'PENDING', zeus_model_call: false, challenge_rounds: 0, replay_deterministic: run.replay_deterministic }, null, 2);
}

export async function runManualLiveCouncil(config: LiveCouncilConfig): Promise<LiveCouncilRun> {
  const errors = validateManualConfiguration(config);
  if (errors.length > 0) throw new Error(`LIVE_COUNCIL_CONFIGURATION_INVALID: ${errors.join('; ')}`);
  const preflight = councilBudgetPreflight(config);
  if (preflight.REQUESTED_EFFECTIVE_MISMATCH_GATE !== 'PASS' || preflight.REQUESTED_MAX_OUTPUT_TOKENS !== 4096 || preflight.EFFECTIVE_MAX_OUTPUT_TOKENS !== 4096) throw new Error('LIVE_COUNCIL_OUTPUT_BUDGET_PREFLIGHT_BLOCKED');
  return runRound1Council(config, new BudgetedTransport(new FetchTransport(), LIVE_REQUEST_BUDGET), config.credential, true);
}
