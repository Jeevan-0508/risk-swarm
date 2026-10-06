import { deterministicPackageHash, sealEvidence } from '../src/swarm/evidence/package';
import { MockTransport, FetchTransport, type HttpResponse, type HttpTransport } from '../src/swarm/models/transport';
import { XaiProviderAdapter } from '../src/swarm/models/providers/xai';
import { ModelRuntime } from '../src/swarm/models/runtime';
import { ModelRouter } from '../src/swarm/models/router';
import { parseJson } from '../src/swarm/models/structured-output';
import { type ModelExecution } from '../src/swarm/contracts';
import { ModelBackedSeatExecutor } from '../src/swarm/seats/executor';
import { buildSeatPrompt } from '../src/swarm/seats/prompt';
import { seatDefinition } from '../src/swarm/seats/registry';
import { type SeatInput } from '../src/swarm/engine/executor';
import { type Round1SeatId } from '../src/swarm/contracts';
import { DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS, LIVE_MODEL, LIVE_PROVIDER, LIVE_REQUEST_BUDGET, PHASE4B_PROVIDER_SCHEMA_FINGERPRINT, RequestContractGuardTransport, BudgetedTransport, resolveCouncilMaxOutputTokens, SWARM_COUNCIL_MAX_OUTPUT_TOKENS_SAFETY_MAX, syntheticCase, type WireRequestProjection } from './certify-swarm-live-council';
import { SEAT_ASSESSMENT_PROVIDER_SCHEMA, SEAT_ASSESSMENT_SCHEMA } from '../src/swarm/seats/validation';

export const DIAGNOSTIC_SEAT = 'ATHENA' as const;
export const DIAGNOSTIC_PROVIDER = LIVE_PROVIDER;
export const DIAGNOSTIC_MODEL = LIVE_MODEL;
export const DIAGNOSTIC_CONFIRMATION = 'YES' as const;
export const DIAGNOSTIC_REQUEST_BUDGET = 1 as const;
export const DIAGNOSTIC_PROMPT_VERSION = 'ATHENA_PROMPT_V1' as const;
export const DIAGNOSTIC_PROMPT_FINGERPRINT = 'fnv1a-8c2a6636' as const;
export const DIAGNOSTIC_EVIDENCE_FINGERPRINT = 'fnv1a:cd48b0a4' as const;
export const DIAGNOSTIC_MAX_OUTPUT_TOKENS = DEFAULT_SWARM_COUNCIL_MAX_OUTPUT_TOKENS;

type StageStatus = 'PASS' | 'FAIL' | 'NOT_RUN';
type ContentType = 'string' | 'object' | 'array' | 'null' | 'missing' | 'scalar';

export interface DiagnosticConfig {
  readonly provider: typeof LIVE_PROVIDER;
  readonly model: typeof LIVE_MODEL;
  readonly credential?: string;
  readonly confirm: string;
  readonly requested_max_output_tokens: string | null;
  readonly max_output_tokens: number | null;
  readonly output_budget_error: string | null;
}

export interface DiagnosticReport {
  readonly REQUEST_PRECHECK: 'PASS';
  readonly PROVIDER: typeof LIVE_PROVIDER;
  readonly MODEL: typeof LIVE_MODEL;
  readonly SEAT: typeof DIAGNOSTIC_SEAT;
  readonly PROMPT_VERSION: typeof DIAGNOSTIC_PROMPT_VERSION;
  readonly PROMPT_FINGERPRINT: typeof DIAGNOSTIC_PROMPT_FINGERPRINT;
  readonly PROVIDER_SCHEMA_FINGERPRINT: typeof PHASE4B_PROVIDER_SCHEMA_FINGERPRINT;
  readonly EVIDENCE_FINGERPRINT: typeof DIAGNOSTIC_EVIDENCE_FINGERPRINT;
  readonly STRICT_JSON_SCHEMA: 'PASS';
  readonly REQUEST_BUDGET: 1;
  readonly REQUEST_BUDGET_ENFORCED: 'PASS';
  readonly RETRY_DISABLED: 'PASS';
  readonly FALLBACK_DISABLED: 'PASS';
  readonly HTTP_METHOD: 'POST';
  readonly API_FAMILY: 'CHAT_COMPLETIONS';
  readonly HTTP_STATUS: number | null;
  readonly HTTP_BODY_IS_JSON: boolean;
  readonly RESPONSE_KEYS: readonly string[];
  readonly CHOICE_COUNT: number;
  readonly FINISH_REASON: string | null;
  readonly MESSAGE_PRESENT: boolean;
  readonly MESSAGE_KEYS: readonly string[];
  readonly MESSAGE_ROLE: string | null;
  readonly CONTENT_PRESENT: boolean;
  readonly CONTENT_TYPE: ContentType;
  readonly CONTENT_LENGTH: number | null;
  readonly CONTENT_FINGERPRINT: string | null;
  readonly STARTS_WITH_OBJECT_MARKER: boolean;
  readonly STARTS_WITH_ARRAY_MARKER: boolean;
  readonly STARTS_WITH_CODE_FENCE: boolean;
  readonly CONTAINS_CODE_FENCE: boolean;
  readonly LEADING_CHARACTER_CLASS: string;
  readonly TRAILING_CHARACTER_CLASS: string;
  readonly TOOL_CALLS_PRESENT: boolean;
  readonly TOOL_CALL_COUNT: number;
  readonly REFUSAL_PRESENT: boolean;
  readonly INPUT_TOKENS: number | null;
  readonly OUTPUT_TOKENS: number | null;
  readonly TOTAL_TOKENS: number | null;
  readonly CONFIGURED_MAX_OUTPUT_TOKENS: number | null;
  readonly REQUESTED_MAX_OUTPUT_TOKENS: number | null;
  readonly EFFECTIVE_MAX_OUTPUT_TOKENS: number | null;
  readonly REQUESTED_EFFECTIVE_MISMATCH_GATE: 'PASS' | 'BLOCKED';
  readonly JSON_PARSE_DIRECT: StageStatus;
  readonly JSON_PARSE_DIRECT_REASON: string;
  readonly JSON_PARSE_FENCED: StageStatus;
  readonly JSON_PARSE_FENCED_REASON: string;
  readonly JSON_PARSE_BOUNDED_OBJECT: StageStatus;
  readonly JSON_PARSE_BOUNDED_OBJECT_REASON: string;
  readonly JSON_CANDIDATE_COUNT: number;
  readonly DTO_VALIDATION_ATTEMPTED: StageStatus;
  readonly DTO_VALIDATION_RESULT: StageStatus;
  readonly FINAL_EXECUTION_STATUS: string;
  readonly FAILURE_STAGE: string | null;
  readonly FAILURE_CODE: string | null;
  readonly TRUNCATION_DETECTED: boolean;
  readonly PROVIDER_SCHEMA_PROJECTION: WireRequestProjection;
}

interface SafeResponseObservation {
  readonly http_status: number;
  readonly body_is_json: boolean;
  readonly response_keys: readonly string[];
  readonly choice_count: number;
  readonly finish_reason: string | null;
  readonly message_present: boolean;
  readonly message_keys: readonly string[];
  readonly message_role: string | null;
  readonly content_present: boolean;
  readonly content_type: ContentType;
  readonly content_length: number | null;
  readonly content_fingerprint: string | null;
  readonly starts_with_object_marker: boolean;
  readonly starts_with_array_marker: boolean;
  readonly starts_with_code_fence: boolean;
  readonly contains_code_fence: boolean;
  readonly leading_character_class: string;
  readonly trailing_character_class: string;
  readonly tool_calls_present: boolean;
  readonly tool_call_count: number;
  readonly refusal_present: boolean;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly total_tokens: number | null;
  readonly parse_stages: ReturnType<typeof parseStages>;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedKeys(value: Record<string, unknown> | undefined): readonly string[] {
  return Object.keys(value ?? {}).filter((key) => /^[A-Za-z0-9_.-]{1,80}$/.test(key)).slice(0, 32);
}

function contentType(value: unknown): ContentType {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'object') return 'object';
  return 'scalar';
}

function characterClass(value: string, trailing = false): string {
  const trimmed = value.trim();
  if (!trimmed) return 'EMPTY';
  const character = trailing ? trimmed.at(-1)! : trimmed[0]!;
  if (character === '{' || character === '}') return 'JSON_OBJECT_MARKER';
  if (character === '[' || character === ']') return 'JSON_ARRAY_MARKER';
  if (character === '`') return 'CODE_FENCE_MARKER';
  if (/\p{L}/u.test(character)) return 'LETTER';
  if (/\d/u.test(character)) return 'DIGIT';
  return 'OTHER';
}

function boundedString(value: unknown, allowed: RegExp): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80 || !allowed.test(value)) return null;
  return value;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function observeResponse(response: HttpResponse): SafeResponseObservation {
  let parsed: unknown;
  let bodyIsJson = false;
  try { parsed = JSON.parse(response.body); bodyIsJson = true; } catch { parsed = null; }
  const top = record(parsed) ? parsed : undefined;
  const choices = top && Array.isArray(top.choices) ? top.choices : [];
  const firstChoice = record(choices[0]) ? choices[0] : undefined;
  const message = firstChoice && record(firstChoice.message) ? firstChoice.message : undefined;
  const hasContent = Boolean(message && Object.prototype.hasOwnProperty.call(message, 'content'));
  const content = hasContent ? message!.content : undefined;
  const text = typeof content === 'string' ? content : '';
  const usage = top && record(top.usage) ? top.usage : undefined;
  const toolCalls = message && Object.prototype.hasOwnProperty.call(message, 'tool_calls') ? message.tool_calls : undefined;
  const parseStagesValue = parseStages(content);
  const finish = boundedString(firstChoice?.finish_reason, /^[A-Za-z0-9_.:-]+$/);
  const role = boundedString(message?.role, /^(?:assistant|user|system|tool)$/);
  return {
    http_status: response.status,
    body_is_json: bodyIsJson,
    response_keys: boundedKeys(top),
    choice_count: choices.length,
    finish_reason: finish ?? (firstChoice?.finish_reason === undefined ? null : 'UNAVAILABLE'),
    message_present: message !== undefined,
    message_keys: boundedKeys(message),
    message_role: role ?? (message?.role === undefined ? null : 'OTHER'),
    content_present: hasContent,
    content_type: contentType(content),
    content_length: typeof content === 'string' ? content.length : null,
    content_fingerprint: hasContent ? deterministicPackageHash(content) : null,
    starts_with_object_marker: text.trim().startsWith('{'),
    starts_with_array_marker: text.trim().startsWith('['),
    starts_with_code_fence: /^```/.test(text.trim()),
    contains_code_fence: text.includes('```'),
    leading_character_class: characterClass(text),
    trailing_character_class: characterClass(text, true),
    tool_calls_present: toolCalls !== undefined && toolCalls !== null,
    tool_call_count: Array.isArray(toolCalls) ? toolCalls.length : 0,
    refusal_present: message?.refusal !== undefined && message?.refusal !== null,
    input_tokens: finiteNumber(usage?.prompt_tokens),
    output_tokens: finiteNumber(usage?.completion_tokens),
    total_tokens: finiteNumber(usage?.total_tokens),
    parse_stages: parseStagesValue,
  };
}

class DiagnosticResponseCaptureTransport implements HttpTransport {
  observation: SafeResponseObservation | null = null;

  constructor(private readonly delegate: HttpTransport) {}

  async request(request: Parameters<HttpTransport['request']>[0]): Promise<HttpResponse> {
    const response = await this.delegate.request(request);
    this.observation = observeResponse(response);
    return response;
  }
}

function normalizedReason(text: string, mode: string, candidateCount: number): string {
  if (!text.trim()) return 'EMPTY';
  if (candidateCount > 1) return 'MULTIPLE_CANDIDATES';
  if ((text.trim().startsWith('{') || text.trim().startsWith('[')) && !/[}\]]\s*$/.test(text.trim())) return 'UNTERMINATED_JSON';
  if (candidateCount === 0) return 'NO_JSON_CANDIDATE';
  if (mode === 'INVALID_JSON') return 'UNEXPECTED_TOKEN';
  return 'WRONG_TOP_LEVEL_TYPE';
}

function parseStages(content: unknown): { readonly direct: StageStatus; readonly directReason: string; readonly fenced: StageStatus; readonly fencedReason: string; readonly bounded: StageStatus; readonly boundedReason: string; readonly candidateCount: number; readonly parsedPresent: boolean; readonly dtoResult: StageStatus } {
  if (typeof content !== 'string' || !content.trim()) return { direct: 'NOT_RUN', directReason: content === '' ? 'EMPTY' : 'NOT_RUN', fenced: 'NOT_RUN', fencedReason: 'NOT_RUN', bounded: 'NOT_RUN', boundedReason: 'NOT_RUN', candidateCount: 0, parsedPresent: false, dtoResult: 'NOT_RUN' };
  const direct = parseJson(content, { allow_code_fence: false, allow_balanced_object_extraction: false });
  if (direct.error === undefined) return { direct: 'PASS', directReason: 'PASS', fenced: 'NOT_RUN', fencedReason: 'NOT_RUN', bounded: 'NOT_RUN', boundedReason: 'NOT_RUN', candidateCount: 0, parsedPresent: true, dtoResult: SEAT_ASSESSMENT_SCHEMA.validate(direct.value).success ? 'PASS' : 'FAIL' };
  const fenced = parseJson(content, { allow_code_fence: true, allow_balanced_object_extraction: false });
  if (fenced.error === undefined) return { direct: 'FAIL', directReason: normalizedReason(content, direct.mode, direct.candidate_count), fenced: 'PASS', fencedReason: 'PASS', bounded: 'NOT_RUN', boundedReason: 'NOT_RUN', candidateCount: 0, parsedPresent: true, dtoResult: SEAT_ASSESSMENT_SCHEMA.validate(fenced.value).success ? 'PASS' : 'FAIL' };
  const bounded = parseJson(content, { allow_code_fence: false, allow_balanced_object_extraction: true });
  if (bounded.error === undefined) return { direct: 'FAIL', directReason: normalizedReason(content, direct.mode, direct.candidate_count), fenced: 'FAIL', fencedReason: normalizedReason(content, fenced.mode, fenced.candidate_count), bounded: 'PASS', boundedReason: 'PASS', candidateCount: bounded.candidate_count, parsedPresent: true, dtoResult: SEAT_ASSESSMENT_SCHEMA.validate(bounded.value).success ? 'PASS' : 'FAIL' };
  return { direct: 'FAIL', directReason: normalizedReason(content, direct.mode, direct.candidate_count), fenced: 'FAIL', fencedReason: normalizedReason(content, fenced.mode, fenced.candidate_count), bounded: 'FAIL', boundedReason: normalizedReason(content, bounded.mode, bounded.candidate_count), candidateCount: bounded.candidate_count, parsedPresent: false, dtoResult: 'NOT_RUN' };
}

function diagnosticInput(): { readonly input: SeatInput; readonly evidenceFingerprint: string; readonly promptFingerprint: string } {
  const synthetic = syntheticCase();
  const evidencePackage = sealEvidence(synthetic.case, synthetic.evidence, { package_id: 'package-phase4b-payment-review' as never, sealed_at: '2026-02-02T00:00:00Z' });
  const input: SeatInput = {
    seat_id: DIAGNOSTIC_SEAT,
    case: { case_id: synthetic.case.case_id, protocol_version: synthetic.case.protocol_version, question: synthetic.case.question, scope: synthetic.case.scope, policy: synthetic.case.policy },
    evidence_package: evidencePackage,
    execution_context: { invocation: 1, phase: 'ROUND_1' },
  };
  return { input, evidenceFingerprint: evidencePackage.package_hash, promptFingerprint: buildSeatPrompt(seatDefinition(DIAGNOSTIC_SEAT), input, 'ROUND_1').fingerprint };
}

interface DiagnosticBudget {
  readonly requested: number | null;
  readonly effective: number;
}

function reportFrom(observation: SafeResponseObservation, response: ModelExecution, projection: WireRequestProjection, metadata: { readonly promptFingerprint: string; readonly evidenceFingerprint: string }, budget: DiagnosticBudget): DiagnosticReport {
  const stages = observation.parse_stages;
  const dtoAttempted = stages.parsedPresent ? 'PASS' : 'NOT_RUN';
  return {
    REQUEST_PRECHECK: 'PASS', PROVIDER: LIVE_PROVIDER, MODEL: LIVE_MODEL, SEAT: DIAGNOSTIC_SEAT, PROMPT_VERSION: DIAGNOSTIC_PROMPT_VERSION, PROMPT_FINGERPRINT: metadata.promptFingerprint as typeof DIAGNOSTIC_PROMPT_FINGERPRINT,
    PROVIDER_SCHEMA_FINGERPRINT: PHASE4B_PROVIDER_SCHEMA_FINGERPRINT, EVIDENCE_FINGERPRINT: metadata.evidenceFingerprint as typeof DIAGNOSTIC_EVIDENCE_FINGERPRINT, STRICT_JSON_SCHEMA: 'PASS', REQUEST_BUDGET: 1, REQUEST_BUDGET_ENFORCED: 'PASS', RETRY_DISABLED: 'PASS', FALLBACK_DISABLED: 'PASS',
    HTTP_METHOD: 'POST', API_FAMILY: 'CHAT_COMPLETIONS', HTTP_STATUS: observation.http_status, HTTP_BODY_IS_JSON: observation.body_is_json, RESPONSE_KEYS: observation.response_keys, CHOICE_COUNT: observation.choice_count, FINISH_REASON: observation.finish_reason, MESSAGE_PRESENT: observation.message_present, MESSAGE_KEYS: observation.message_keys, MESSAGE_ROLE: observation.message_role, CONTENT_PRESENT: observation.content_present, CONTENT_TYPE: observation.content_type, CONTENT_LENGTH: observation.content_length, CONTENT_FINGERPRINT: observation.content_fingerprint,
    STARTS_WITH_OBJECT_MARKER: observation.starts_with_object_marker, STARTS_WITH_ARRAY_MARKER: observation.starts_with_array_marker, STARTS_WITH_CODE_FENCE: observation.starts_with_code_fence, CONTAINS_CODE_FENCE: observation.contains_code_fence, LEADING_CHARACTER_CLASS: observation.leading_character_class, TRAILING_CHARACTER_CLASS: observation.trailing_character_class, TOOL_CALLS_PRESENT: observation.tool_calls_present, TOOL_CALL_COUNT: observation.tool_call_count, REFUSAL_PRESENT: observation.refusal_present, INPUT_TOKENS: observation.input_tokens, OUTPUT_TOKENS: observation.output_tokens, TOTAL_TOKENS: observation.total_tokens, CONFIGURED_MAX_OUTPUT_TOKENS: budget.effective, REQUESTED_MAX_OUTPUT_TOKENS: budget.requested, EFFECTIVE_MAX_OUTPUT_TOKENS: budget.effective, REQUESTED_EFFECTIVE_MISMATCH_GATE: budget.requested === null || budget.requested === budget.effective ? 'PASS' : 'BLOCKED',
    JSON_PARSE_DIRECT: stages.direct, JSON_PARSE_DIRECT_REASON: stages.directReason, JSON_PARSE_FENCED: stages.fenced, JSON_PARSE_FENCED_REASON: stages.fencedReason, JSON_PARSE_BOUNDED_OBJECT: stages.bounded, JSON_PARSE_BOUNDED_OBJECT_REASON: stages.boundedReason, JSON_CANDIDATE_COUNT: stages.candidateCount, DTO_VALIDATION_ATTEMPTED: dtoAttempted, DTO_VALIDATION_RESULT: stages.dtoResult, FINAL_EXECUTION_STATUS: response.status, FAILURE_STAGE: response.failure_stage, FAILURE_CODE: response.failure_reason_code, TRUNCATION_DETECTED: response.diagnostics.truncation_detected === true, PROVIDER_SCHEMA_PROJECTION: projection,
  };
}

export async function runDiagnosticWithTransport(transport: HttpTransport, credential: string, effectiveMaxOutputTokens = DIAGNOSTIC_MAX_OUTPUT_TOKENS, requestedMaxOutputTokens: number | null = null): Promise<DiagnosticReport> {
  if (!Number.isSafeInteger(effectiveMaxOutputTokens) || effectiveMaxOutputTokens <= 0 || effectiveMaxOutputTokens > SWARM_COUNCIL_MAX_OUTPUT_TOKENS_SAFETY_MAX) throw new Error('INVALID_DIAGNOSTIC_OUTPUT_TOKEN_BUDGET');
  if (requestedMaxOutputTokens !== null && requestedMaxOutputTokens !== effectiveMaxOutputTokens) throw new Error('REQUESTED_EFFECTIVE_OUTPUT_TOKEN_MISMATCH');
  const prepared = diagnosticInput();
  if (prepared.promptFingerprint !== DIAGNOSTIC_PROMPT_FINGERPRINT) throw new Error('DIAGNOSTIC_PROMPT_CONTRACT_MISMATCH');
  if (prepared.evidenceFingerprint !== DIAGNOSTIC_EVIDENCE_FINGERPRINT) throw new Error('DIAGNOSTIC_EVIDENCE_CONTRACT_MISMATCH');
  if (PHASE4B_PROVIDER_SCHEMA_FINGERPRINT !== 'fnv1a:835100c1') throw new Error('DIAGNOSTIC_SCHEMA_CONTRACT_MISMATCH');
  const capture = new DiagnosticResponseCaptureTransport(transport);
  const budget = new BudgetedTransport(capture, DIAGNOSTIC_REQUEST_BUDGET);
  const guard = new RequestContractGuardTransport(budget, { provider: LIVE_PROVIDER, model: LIVE_MODEL, evidence_fingerprint: prepared.evidenceFingerprint, provider_schema: SEAT_ASSESSMENT_PROVIDER_SCHEMA, retry_disabled: true, fallback_disabled: true, max_output_tokens: effectiveMaxOutputTokens, expected_seat_id: DIAGNOSTIC_SEAT, expected_prompt_version: DIAGNOSTIC_PROMPT_VERSION, expected_prompt_fingerprint: prepared.promptFingerprint });
  const adapter = new XaiProviderAdapter({ transport: guard });
  const runtime = new ModelRuntime({ providers: new Map([[LIVE_PROVIDER, adapter]]), credentials: { resolve: () => ({ configured: true, value: credential }) } });
  const router = new ModelRouter(runtime);
  const executor = new ModelBackedSeatExecutor(router, { primary: { provider: LIVE_PROVIDER, model: LIVE_MODEL }, fallback_models: [], fallback_enabled: false, retry: { max_attempts: 1, retryable_reasons: [] } }, DIAGNOSTIC_SEAT, { max_output_tokens: effectiveMaxOutputTokens });
  const result = await executor.execute(prepared.input);
  const observation = capture.observation;
  if (!observation) throw new Error('DIAGNOSTIC_RESPONSE_NOT_CAPTURED');
  const projection = guard.projections[0];
  if (!projection) throw new Error('DIAGNOSTIC_REQUEST_NOT_CAPTURED');
  const stats = budget.stats();
  if (stats.request_count !== 1 || stats.attempted_count !== 1 || stats.blocked_count !== 0) throw new Error('DIAGNOSTIC_REQUEST_BUDGET_INVALID');
  return reportFrom(observation, result.execution, projection, prepared, { requested: requestedMaxOutputTokens, effective: effectiveMaxOutputTokens });
}

export async function runOfflineDiagnosticFixtures(): Promise<{ readonly reports: readonly DiagnosticReport[]; readonly secretLeakCheck: 'PASS' | 'FAIL' }> {
  const secret = 'PHASE4B3_OFFLINE_SECRET_DO_NOT_LEAK';
  const fixtures: readonly string[] = [
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }] }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: '```json\n{"ok":true}\n```' }, finish_reason: 'stop' }] }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: `prose {"ok":true}` }, finish_reason: 'stop' }] }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"ok":' }, finish_reason: 'length' }] }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'plain refusal prose' }, finish_reason: 'stop' }] }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: [{ type: 'text', text: '{"ok":true}' }] }, finish_reason: 'stop' }] }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: { ok: true } }, finish_reason: 'stop' }] }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }] }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'tool-1', type: 'function' }] }, finish_reason: 'tool_calls' }] }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, refusal: 'refused' }, finish_reason: 'stop' }] }),
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"a":1} {"b":2}' }, finish_reason: 'stop' }] }),
  ];
  const reports: DiagnosticReport[] = [];
  for (const body of fixtures) reports.push(await runDiagnosticWithTransport(new MockTransport(() => ({ status: 200, headers: {}, body })), secret));
  const serialized = JSON.stringify(reports);
  const secretLeakCheck = serialized.includes(secret) || serialized.includes('plain refusal prose') || serialized.includes('refused') || serialized.includes('tool-1') ? 'FAIL' : 'PASS';
  return { reports, secretLeakCheck };
}

export function diagnosticConfigFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): DiagnosticConfig {
  const budget = resolveCouncilMaxOutputTokens(env);
  return { provider: LIVE_PROVIDER, model: LIVE_MODEL, credential: env.XAI_API_KEY, confirm: env.SWARM_XAI_DIAGNOSTIC_CONFIRM ?? '', requested_max_output_tokens: budget.requested_raw, max_output_tokens: budget.effective_value, output_budget_error: budget.error };
}

export function validateDiagnosticConfiguration(config: DiagnosticConfig): readonly string[] {
  const errors: string[] = [];
  if (config.provider !== LIVE_PROVIDER) errors.push('provider');
  if (config.model !== LIVE_MODEL) errors.push('model');
  if (!config.credential) errors.push('credential');
  if (config.confirm !== DIAGNOSTIC_CONFIRMATION) errors.push('confirmation');
  if (config.output_budget_error) errors.push('output_budget');
  if (config.max_output_tokens === null) errors.push('output_budget');
  if (config.requested_max_output_tokens !== null && config.max_output_tokens !== null && Number(config.requested_max_output_tokens) !== config.max_output_tokens) errors.push('output_budget_mismatch');
  return errors;
}

export interface DiagnosticPreflight {
  readonly REQUESTED_MAX_OUTPUT_TOKENS: number | null;
  readonly EFFECTIVE_MAX_OUTPUT_TOKENS: number | null;
  readonly REQUESTED_EFFECTIVE_MISMATCH_GATE: 'PASS' | 'BLOCKED';
}

export function diagnosticPreflight(config: DiagnosticConfig): DiagnosticPreflight {
  const requested = config.requested_max_output_tokens === null ? null : Number(config.requested_max_output_tokens);
  const effective = config.max_output_tokens;
  const matches = config.output_budget_error === null && effective !== null && (requested === null || requested === effective);
  return { REQUESTED_MAX_OUTPUT_TOKENS: requested, EFFECTIVE_MAX_OUTPUT_TOKENS: effective, REQUESTED_EFFECTIVE_MISMATCH_GATE: matches ? 'PASS' : 'BLOCKED' };
}

export function formatDiagnosticPreflight(preflight: DiagnosticPreflight): string {
  return Object.entries(preflight).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n');
}

export async function runManualDiagnostic(config: DiagnosticConfig): Promise<DiagnosticReport> {
  const errors = validateDiagnosticConfiguration(config);
  if (errors.length > 0) throw new Error(`XAI_DIAGNOSTIC_CONFIGURATION_INVALID:${errors.join(',')}`);
  const preflight = diagnosticPreflight(config);
  if (preflight.REQUESTED_EFFECTIVE_MISMATCH_GATE !== 'PASS' || preflight.EFFECTIVE_MAX_OUTPUT_TOKENS === null) throw new Error('XAI_DIAGNOSTIC_OUTPUT_BUDGET_PREFLIGHT_BLOCKED');
  return runDiagnosticWithTransport(new FetchTransport(), config.credential!, preflight.EFFECTIVE_MAX_OUTPUT_TOKENS, preflight.REQUESTED_MAX_OUTPUT_TOKENS);
}

export function formatDiagnosticReport(report: DiagnosticReport): string {
  return Object.entries(report).map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n');
}
