import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildCertifiedPhase6Scenario } from '../src/swarm/evaluation/scenarios';
import { runOfflineAdversarialDeliberation } from '../src/swarm/engine/offline';
import { runOfflineZeusSynthesis } from '../src/swarm/engine/zeus';
import { type ZeusArtifact, buildZeusArtifact, replayZeusArtifact, verifyZeusArtifact } from '../src/swarm/governance/zeus-artifact';
import { buildZeusAllowedReferenceSets, buildZeusInput, canonicalizeZeusSynthesis, defaultZeusSynthesis, zeusPrompt, ZEUS_PROMPT_VERSION } from '../src/swarm/governance/zeus';
import { ROUND1_SEAT_IDS, ZEUS_CONTROL_EFFECTIVENESS_VALUES, ZEUS_DISAGREEMENT_REFERENCE_MATERIALITY_VALUES, ZEUS_DISAGREEMENT_REFERENCE_STATUS_VALUES, ZEUS_EVIDENCE_QUALITY_VALUES, ZEUS_RISK_LEVEL_VALUES, ZEUS_SYNTHESIS_OUTPUT_LIMITS, ZeusSynthesisBodySchema, type ZeusSynthesisBrief, type ZeusSynthesisBody, type ZeusSynthesisInput } from '../src/swarm/contracts';
import { deterministicPackageHash, stableStringify } from '../src/swarm/evidence/package';
import { ModelRouter } from '../src/swarm/models/router';
import { ModelRuntime } from '../src/swarm/models/runtime';
import { jsonSchema } from '../src/swarm/models/structured-output';
import { FetchTransport, type HttpRequest, type HttpResponse, type HttpTransport } from '../src/swarm/models/transport';
import { XaiProviderAdapter } from '../src/swarm/models/providers/xai';
import { type ModelRequest, type ModelResponse, type OutputSchemaDescriptor, type SafeDiagnostics, type StructuredValidationDiagnostics } from '../src/swarm/models/types';
import { SwarmProtocolError } from '../src/swarm/governance/verifier';
import {
  PHASE6B_CONFIRMATION_VARIABLE,
  PHASE6B_EXPECTED_INPUT_FINGERPRINT,
  PHASE6B_MODEL,
  PHASE6B_PROVIDER,
  PHASE6B_REQUEST_BUDGET,
  phase6bPreflight,
  Phase6bRequestBudget,
  type Phase6bPreflight,
} from './phase6b1-pretransport';

export const PHASE6B_ARTIFACT_SCHEMA_VERSION = 'SWARM_PHASE6B_LIVE_ZEUS_ARTIFACT_V1' as const;
export const PHASE6B_REQUEST_ID = 'phase6b-zeus-synthesis-1' as const;
export const PHASE6B_PROMPT_FINGERPRINT = deterministicPackageHash(ZEUS_PROMPT_VERSION);

type ResultStatus = 'WOULD_EXECUTE_ONE_ZEUS_REQUEST' | 'EXECUTED_ONE_ZEUS_REQUEST' | 'BLOCKED' | 'FAILED';

export interface Phase6bWireProjection {
  readonly method: string;
  readonly url: string;
  readonly budget_category: string | null;
  readonly model: string | null;
  readonly max_output_tokens: number | null;
  readonly token_field: 'max_tokens';
  readonly schema_name: string | null;
  readonly strict_schema: boolean;
  readonly prompt_version: string;
  readonly input_fingerprint: string;
}

export interface Phase6bContractMeasurements {
  readonly zeus_schema_size_bytes: number;
  readonly zeus_input_size_bytes: number;
  readonly zeus_prompt_size_bytes: number;
  readonly zeus_context_size_bytes: number;
  readonly zeus_provider_user_message_size_bytes: number;
  readonly zeus_fixture_output_size_bytes: number;
  readonly zeus_input_estimated_tokens: number;
  readonly zeus_prompt_estimated_tokens: number;
  readonly zeus_context_estimated_tokens: number;
  readonly zeus_schema_estimated_tokens: number;
  readonly zeus_fixture_output_estimated_tokens: number;
}

export interface Phase6bTerminationTelemetry {
  readonly http_status: number | null;
  readonly provider_finish_reason: string | null;
  readonly termination_reason: string | null;
  readonly response_completion_status: string | null;
  readonly output_limit: number | null;
  readonly input_usage_count: number | null;
  readonly output_usage_count: number | null;
  readonly total_usage_count: number | null;
  readonly request_id: string;
  readonly provider: string;
  readonly model: string;
  readonly parser_stage: string | null;
}

export interface Phase6bRequestLedger {
  readonly request_budget: 1;
  readonly admissible_requests: number;
  readonly transport_requests: number;
  readonly retry_requests: 0;
  readonly fallback_requests: 0;
  readonly second_request_blocked: 'PASS' | 'FAIL' | 'NOT_RUN';
}

export interface Phase6bHarnessResult {
  readonly status: ResultStatus;
  readonly dry_run: boolean;
  readonly preflight: Phase6bPreflight;
  readonly transport_boundary: 'NOT_CROSSED' | 'CROSSED_ONCE' | 'BLOCKED';
  readonly wire_request: Phase6bWireProjection | null;
  readonly request_ledger: Phase6bRequestLedger;
  readonly artifact: ZeusArtifact | null;
  readonly artifact_only_replay: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly secret_scan: 'PASS' | 'FAIL';
  readonly hidden_reasoning_scan: 'PASS' | 'FAIL';
  readonly human_decision: 'PENDING';
  readonly real_provider_calls: 0 | 1;
  readonly failure_code: string | null;
  readonly termination_telemetry: Phase6bTerminationTelemetry | null;
  readonly validation_failure_path: string | null;
  readonly validation_failure_code: string | null;
  readonly validation_expected: string | null;
  readonly validation_actual_type: string | null;
  readonly unknown_reference_path: string | null;
  readonly unknown_reference_value: string | null;
  readonly reference_class: string | null;
  readonly allowed_reference_count: number | null;
}

function phase6bValidationDiagnostics(diagnostics: SafeDiagnostics | undefined): Pick<Phase6bHarnessResult, 'validation_failure_path' | 'validation_failure_code' | 'validation_expected' | 'validation_actual_type' | 'unknown_reference_path' | 'unknown_reference_value' | 'reference_class' | 'allowed_reference_count'> {
  const text = (key: string): string | null => typeof diagnostics?.[key] === 'string' ? diagnostics[key] as string : null;
  const number = (key: string): number | null => typeof diagnostics?.[key] === 'number' ? diagnostics[key] as number : null;
  return {
    validation_failure_path: text('VALIDATION_FAILURE_PATH'),
    validation_failure_code: text('VALIDATION_FAILURE_CODE'),
    validation_expected: text('VALIDATION_EXPECTED'),
    validation_actual_type: text('VALIDATION_ACTUAL_TYPE'),
    unknown_reference_path: text('UNKNOWN_REFERENCE_PATH'),
    unknown_reference_value: text('UNKNOWN_REFERENCE_VALUE'),
    reference_class: text('REFERENCE_CLASS'),
    allowed_reference_count: number('ALLOWED_REFERENCE_COUNT'),
  };
}

const boundedString = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength } as const);
const stringList = (maxItems: number, maxLength = ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text) => ({ type: 'array', maxItems, items: boundedString(maxLength) } as const);
const idString = boundedString(160);
const idList = (maxItems: number, allowed?: readonly string[]) => allowed === undefined ? stringList(maxItems, 160) : ({ type: 'array', maxItems, items: { type: 'string', enum: [...allowed] } } as const);
const riskLevel = { type: 'string', enum: [...ZEUS_RISK_LEVEL_VALUES] } as const;
const objectSchema = (properties: Readonly<Record<string, unknown>>, required: readonly string[]) => ({ type: 'object', additionalProperties: false, properties, required });

const disagreementSchema = objectSchema({
  disagreement_id: idString,
  status: { type: 'string', enum: [...ZEUS_DISAGREEMENT_REFERENCE_STATUS_VALUES] },
  materiality: { type: 'string', enum: [...ZEUS_DISAGREEMENT_REFERENCE_MATERIALITY_VALUES] },
}, ['disagreement_id', 'status', 'materiality']);

const minoritySchema = objectSchema({ position_id: idString, seat_id: { type: 'string', enum: [...ROUND1_SEAT_IDS] } }, ['position_id', 'seat_id']);
/** Reject unknown provider fields instead of allowing the DTO parser to strip
 * them. This keeps the runtime validator as strict as the advertised wire
 * schema while leaving domain semantics to the canonical Zeus validator. */
function actualType(value: unknown): string {
  if (value === undefined) return 'missing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function valueAtPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') current = current[segment];
    else if (isRecord(current) && typeof segment === 'string') current = current[segment];
    else return undefined;
  }
  return current;
}

function strictSchemaFailure(value: unknown, schema: unknown, path = '$'): StructuredValidationDiagnostics | null {
  if (!isRecord(schema)) return { path, code: 'SCHEMA', expected: 'schema object', actual_type: actualType(value) };
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    if (anyOf.some((candidate) => strictSchemaFailure(value, candidate, path) === null)) return null;
    return { path, code: 'ANY_OF', expected: 'one permitted schema alternative', actual_type: actualType(value) };
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => stableStringify(candidate) === stableStringify(value))) return { path, code: 'ENUM', expected: schema.enum.map((candidate) => String(candidate)).join('|'), actual_type: actualType(value) };
  if (schema.type === 'object') {
    if (!isRecord(value) || Array.isArray(value)) return { path, code: 'TYPE', expected: 'object', actual_type: actualType(value) };
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === 'string') : [];
    const missing = required.find((key) => !(key in value));
    if (missing) return { path: `${path}.${missing}`, code: 'REQUIRED', expected: 'present', actual_type: 'missing' };
    const unexpected = schema.additionalProperties === false ? Object.keys(value).find((key) => !(key in properties)) : undefined;
    if (unexpected) return { path: `${path}.${unexpected}`, code: 'ADDITIONAL_PROPERTY', expected: 'not present', actual_type: actualType(value[unexpected]) };
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (childSchema !== undefined) {
        const error = strictSchemaFailure(child, childSchema, `${path}.${key}`);
        if (error) return error;
      }
    }
    return null;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return { path, code: 'TYPE', expected: 'array', actual_type: actualType(value) };
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return { path, code: 'MIN_ITEMS', expected: `>=${schema.minItems}`, actual_type: 'array' };
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) return { path, code: 'MAX_ITEMS', expected: `<=${schema.maxItems}`, actual_type: 'array' };
    if (schema.items !== undefined) {
      for (const [index, child] of value.entries()) {
        const error = strictSchemaFailure(child, schema.items, `${path}[${index}]`);
        if (error) return error;
      }
    }
    return null;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return { path, code: 'TYPE', expected: 'string', actual_type: actualType(value) };
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return { path, code: 'MIN_LENGTH', expected: `>=${schema.minLength}`, actual_type: 'string' };
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return { path, code: 'MAX_LENGTH', expected: `<=${schema.maxLength}`, actual_type: 'string' };
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) return { path, code: 'TYPE', expected: 'integer', actual_type: actualType(value) };
    if (typeof schema.minimum === 'number' && (value as number) < schema.minimum) return { path, code: 'MINIMUM', expected: `>=${schema.minimum}`, actual_type: 'number' };
    if (typeof schema.maximum === 'number' && (value as number) > schema.maximum) return { path, code: 'MAXIMUM', expected: `<=${schema.maximum}`, actual_type: 'number' };
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { path, code: 'TYPE', expected: 'number', actual_type: actualType(value) };
    if (typeof schema.minimum === 'number' && value < schema.minimum) return { path, code: 'MINIMUM', expected: `>=${schema.minimum}`, actual_type: 'number' };
    if (typeof schema.maximum === 'number' && value > schema.maximum) return { path, code: 'MAXIMUM', expected: `<=${schema.maximum}`, actual_type: 'number' };
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') return { path, code: 'TYPE', expected: 'boolean', actual_type: actualType(value) };
  if (schema.const !== undefined && stableStringify(schema.const) !== stableStringify(value)) return { path, code: 'CONST', expected: String(schema.const), actual_type: actualType(value) };
  if (schema.type === 'null' && value !== null) return { path, code: 'TYPE', expected: 'null', actual_type: actualType(value) };
  return null;
}

/** Provider-facing schema: strict at every object boundary and free of prompt/reasoning fields. */
export const ZEUS_SYNTHESIS_PROVIDER_SCHEMA: Readonly<Record<string, unknown>> = objectSchema({
  executive_summary: boundedString(ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text),
  decision_context: boundedString(ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text),
  material_risks: { type: 'array', maxItems: ZEUS_SYNTHESIS_OUTPUT_LIMITS.risk_items, items: objectSchema({ statement: boundedString(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text), risk_level: riskLevel, uncertainty: boundedString(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text), source_position_ids: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item), source_evidence_ids: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item) }, ['statement', 'risk_level', 'uncertainty', 'source_position_ids', 'source_evidence_ids']) },
  control_assessment: { type: 'array', maxItems: ZEUS_SYNTHESIS_OUTPUT_LIMITS.control_items, items: objectSchema({ statement: boundedString(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text), effectiveness: { type: 'string', enum: [...ZEUS_CONTROL_EFFECTIVENESS_VALUES] }, gaps: stringList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item), source_position_ids: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item), source_evidence_ids: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item) }, ['statement', 'effectiveness', 'gaps', 'source_position_ids', 'source_evidence_ids']) },
  evidence_assessment: objectSchema({ summary: boundedString(ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text), quality: { type: 'string', enum: [...ZEUS_EVIDENCE_QUALITY_VALUES] }, evidence_ids: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_evidence_items), gaps: stringList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.evidence_gap_items) }, ['summary', 'quality', 'evidence_ids', 'gaps']),
  areas_of_agreement: stringList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.agreement_items),
  material_disagreements: { type: 'array', maxItems: ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_disagreement_items, items: disagreementSchema },
  minority_positions: { type: 'array', maxItems: ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_position_items, items: minoritySchema },
  uncertainties: stringList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.uncertainty_items),
  assumptions: stringList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.assumption_items),
  evidence_gaps: stringList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.evidence_gap_items),
  decision_options: stringList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.decision_option_items),
  recommended_next_actions: stringList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.next_action_items),
  escalations: stringList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.escalation_items),
  audit_summary: objectSchema({ finding_ids: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items), blocker_count: { type: 'integer', minimum: 0, maximum: 200 }, warning_count: { type: 'integer', minimum: 0, maximum: 200 }, citation_failures: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items), evidence_integrity_findings: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items), authority_findings: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items), summary: boundedString(ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text) }, ['finding_ids', 'blocker_count', 'warning_count', 'citation_failures', 'evidence_integrity_findings', 'authority_findings', 'summary']),
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  source_position_ids: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_position_items),
  source_disagreement_ids: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_disagreement_items),
  source_evidence_ids: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_evidence_items),
  source_audit_finding_ids: idList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items),
}, ['executive_summary', 'decision_context', 'material_risks', 'control_assessment', 'evidence_assessment', 'areas_of_agreement', 'material_disagreements', 'minority_positions', 'uncertainties', 'assumptions', 'evidence_gaps', 'decision_options', 'recommended_next_actions', 'escalations', 'audit_summary', 'confidence', 'source_position_ids', 'source_disagreement_ids', 'source_evidence_ids', 'source_audit_finding_ids']);

/** Adds exact canonical enum domains to the wire schema for this one sealed
 * input. The base schema remains exported for contract tests and DTO shape
 * checks; this per-input schema is what the provider request receives. */
export function buildZeusProviderSchema(input: ZeusSynthesisInput): Readonly<Record<string, unknown>> {
  const schema = JSON.parse(JSON.stringify(ZEUS_SYNTHESIS_PROVIDER_SCHEMA)) as Record<string, any>;
  const allowed = buildZeusAllowedReferenceSets(input);
  const sourceList = (maxItems: number, ids: readonly string[]) => idList(maxItems, [...ids]);
  const properties = schema.properties as Record<string, any>;
  properties.source_position_ids = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_position_items, [...allowed.position_ids]);
  properties.source_disagreement_ids = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_disagreement_items, [...allowed.disagreement_ids]);
  properties.source_evidence_ids = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_evidence_items, [...allowed.evidence_ids]);
  properties.source_audit_finding_ids = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items, [...allowed.audit_finding_ids]);
  properties.material_risks.items.properties.source_position_ids = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item, [...allowed.position_ids]);
  properties.material_risks.items.properties.source_evidence_ids = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item, [...allowed.evidence_ids]);
  properties.control_assessment.items.properties.source_position_ids = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item, [...allowed.position_ids]);
  properties.control_assessment.items.properties.source_evidence_ids = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item, [...allowed.evidence_ids]);
  properties.evidence_assessment.properties.evidence_ids = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_evidence_items, [...allowed.evidence_ids]);
  properties.material_disagreements.items.properties.disagreement_id = { type: 'string', enum: [...allowed.disagreement_ids] };
  properties.minority_positions.items.properties.position_id = { type: 'string', enum: [...allowed.position_ids] };
  properties.audit_summary.properties.finding_ids = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items, [...allowed.audit_finding_ids]);
  properties.audit_summary.properties.citation_failures = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items, [...allowed.audit_finding_ids]);
  properties.audit_summary.properties.evidence_integrity_findings = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items, [...allowed.audit_finding_ids]);
  properties.audit_summary.properties.authority_findings = sourceList(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items, [...allowed.audit_finding_ids]);
  return Object.freeze(schema);
}

function outputSchema(input: ZeusSynthesisInput): OutputSchemaDescriptor<ZeusSynthesisBody> {
  const providerSchema = buildZeusProviderSchema(input);
  return jsonSchema('zeus_synthesis_v2', (value) => {
    const strictFailure = strictSchemaFailure(value, ZEUS_SYNTHESIS_PROVIDER_SCHEMA);
    if (strictFailure) return { success: false, error: `ZEUS_PROVIDER_SCHEMA_INVALID:${strictFailure.path}:${strictFailure.code}`, diagnostics: strictFailure };
    const parsed = ZeusSynthesisBodySchema.safeParse(value);
    if (parsed.success) return { success: true, value: parsed.data };
    const issue = parsed.error.issues[0];
    const issuePath = issue?.path ?? [];
    const path = issuePath.reduce((result, segment) => `${result}${typeof segment === 'number' ? `[${segment}]` : `.${segment}`}`, '$');
    const detail = issue as unknown as Record<string, unknown> | undefined;
    const expected = typeof detail?.expected === 'string' ? detail.expected
      : Array.isArray(detail?.options) ? detail.options.map((item) => String(item)).join('|')
      : typeof detail?.maximum === 'number' ? `<=${detail.maximum}`
      : typeof detail?.minimum === 'number' ? `>=${detail.minimum}`
      : typeof issue?.message === 'string' ? issue.message.slice(0, 240)
      : 'canonical Zeus DTO constraint';
    const diagnostics: StructuredValidationDiagnostics = { path, code: issue?.code.toUpperCase() ?? 'DTO', expected, actual_type: actualType(valueAtPath(value, issuePath as (string | number)[])) };
    return { success: false, error: `ZEUS_SYNTHESIS_DTO_INVALID:${path}:${diagnostics.code}`, diagnostics };
  }, { strict: true, describe: 'Bounded Zeus executive decision-support DTO. Use only canonical source IDs from the sealed input; preserve all material disagreements, minority positions, Apollo findings, and pending human authority without source-text reproduction or hidden reasoning.', json_schema: providerSchema });
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function assertProviderMetadata(output: ZeusSynthesisBrief, input: ZeusSynthesisInput, response: ModelResponse<ZeusSynthesisBody>): void {
  const execution = output.execution;
  if (execution.seat_id !== 'ZEUS' || execution.provider_requested !== PHASE6B_PROVIDER || execution.model_requested !== PHASE6B_MODEL || execution.provider_executed !== PHASE6B_PROVIDER || execution.model_executed !== PHASE6B_MODEL || execution.request_id !== PHASE6B_REQUEST_ID || execution.prompt_version !== ZEUS_PROMPT_VERSION || execution.prompt_fingerprint !== PHASE6B_PROMPT_FINGERPRINT || execution.input_fingerprint !== input.input_fingerprint || execution.output_validation !== 'PASS' || execution.fallback_used || execution.retry_index !== 0) throw new Error('ZEUS_EXECUTION_METADATA_MISMATCH');
  if (execution.finish_reason !== (response.finish_reason ?? null) || execution.output_tokens !== (response.usage?.output_tokens ?? null)) throw new Error('ZEUS_EXECUTION_USAGE_MISMATCH');
}

function assertPreservation(output: ZeusSynthesisBrief, input: ZeusSynthesisInput): void {
  const outputDisagreements = new Set(output.material_disagreements.map((item) => item.disagreement_id));
  const materialOpen = input.post_challenge_disagreements.filter((item) => (item.status === 'OPEN' || item.status === 'NARROWED') && item.materiality !== 'MINOR');
  if (materialOpen.some((item) => !outputDisagreements.has(item.disagreement_id))) throw new Error('ZEUS_DISAGREEMENT_PRESERVATION_FAILED');
  const expectedMinorities = input.minority_positions.map((expected) => {
    const seatId = expected.seat_ids[0];
    const position = input.final_positions.find((item) => item.seat_id === seatId && item.conclusion === expected.position_summary)
      ?? input.final_positions.find((item) => item.seat_id === seatId);
    return position ? { position_id: position.position_id, seat_id: position.seat_id } : null;
  });
  if (expectedMinorities.some((expected) => expected === null || !output.minority_positions.some((actual) => stableStringify(actual) === stableStringify(expected)))) throw new Error('ZEUS_MINORITY_PRESERVATION_FAILED');
  const auditIds = new Set(output.audit_summary.finding_ids);
  if (input.audit_findings.some((finding) => !auditIds.has(finding.finding_id))) throw new Error('ZEUS_APOLLO_AUDIT_PRESERVATION_FAILED');
  if (!output.human_decision_required || output.human_decision_status !== 'PENDING') throw new Error('ZEUS_HUMAN_AUTHORITY_BOUNDARY_FAILED');
}

class NeverCrossedTransport implements HttpTransport {
  requests = 0;
  async request(_request: HttpRequest): Promise<HttpResponse> {
    this.requests += 1;
    throw new Error('PHASE6B_DRY_RUN_TRANSPORT_MUST_NOT_BE_CROSSED');
  }
}

class Phase6bTransportGuard implements HttpTransport {
  private readonly budget = new Phase6bRequestBudget();
  private readonly projections: Phase6bWireProjection[] = [];

  constructor(private readonly delegate: HttpTransport, private readonly expected: { readonly max_output_tokens: number; readonly input_fingerprint: string; readonly base_url?: string; readonly provider_schema: Readonly<Record<string, unknown>> }) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    if (!this.budget.reserve()) throw new Error('PHASE6B_SECOND_REQUEST_BLOCKED');
    const body = request.body === undefined ? null : JSON.parse(request.body) as Record<string, unknown>;
    const format = isRecord(body?.response_format) ? body.response_format : null;
    const schema = isRecord(format?.json_schema) ? format.json_schema : null;
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const messageText = messages.map((item) => isRecord(item) ? safeString(item.content) ?? '' : '').join('\n');
    if (request.method !== 'POST' || request.budget_category !== 'ZEUS_SYNTHESIS' || body?.model !== PHASE6B_MODEL || body?.max_tokens !== this.expected.max_output_tokens || format?.type !== 'json_schema' || schema?.name !== 'zeus_synthesis_v2' || schema?.strict !== true || stableStringify(schema.schema) !== stableStringify(this.expected.provider_schema) || !messageText.includes(ZEUS_PROMPT_VERSION) || !messageText.includes(this.expected.input_fingerprint)) throw new Error('PHASE6B_WIRE_CONTRACT_INVALID');
    this.projections.push({ method: request.method, url: request.url, budget_category: request.budget_category ?? null, model: typeof body.model === 'string' ? body.model : null, max_output_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : null, token_field: 'max_tokens', schema_name: typeof schema.name === 'string' ? schema.name : null, strict_schema: schema.strict === true, prompt_version: ZEUS_PROMPT_VERSION, input_fingerprint: this.expected.input_fingerprint });
    return this.delegate.request(request);
  }

  stats(): { readonly transport_requests: number; readonly second_request_blocked: 'PASS' | 'FAIL' } {
    const second = this.budget.reserve();
    return { transport_requests: this.projections.length, second_request_blocked: second ? 'FAIL' : 'PASS' };
  }

  firstProjection(): Phase6bWireProjection | null { return this.projections[0] ?? null; }
}

function buildRequest(input: ZeusSynthesisInput, maxOutputTokens: number): ModelRequest<ZeusSynthesisBody> {
  return {
    request_id: PHASE6B_REQUEST_ID,
    case_id: input.case.case_id,
    seat_id: 'ZEUS',
    purpose: 'ZEUS_SYNTHESIS',
    model_requirements: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT', 'JSON_MODE'],
    system_instruction: zeusPrompt(),
    task_instruction: `${ZEUS_PROMPT_VERSION}: return only the bounded schema from the canonical input, using IDs for source references and preserving the pending human boundary.`,
    context: { zeus_input: input, prompt_version: ZEUS_PROMPT_VERSION, input_fingerprint: input.input_fingerprint },
    output_schema: outputSchema(input),
    temperature: 0,
    max_output_tokens: maxOutputTokens,
    timeout_ms: 30_000,
  };
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

/** Offline-only contract accounting. These are byte measurements, not provider usage claims. */
export function measurePhase6bContract(input: ZeusSynthesisInput): Phase6bContractMeasurements {
  const request = buildRequest(input, 4096);
  const system = request.system_instruction ?? '';
  const task = request.task_instruction;
  const context = JSON.stringify(request.context);
  const userMessage = `${task}\n\nSEALED_SWARM_CONTEXT_JSON:\n${context}`;
  const schema = stableStringify(ZEUS_SYNTHESIS_PROVIDER_SCHEMA);
  const inputBytes = utf8Bytes(stableStringify(input));
  const promptBytes = utf8Bytes(system) + utf8Bytes(task);
  const contextBytes = utf8Bytes(context);
  const userMessageBytes = utf8Bytes(userMessage);
  const fixture = JSON.stringify(defaultZeusSynthesis(input));
  const fixtureBytes = utf8Bytes(fixture);
  return {
    zeus_schema_size_bytes: utf8Bytes(schema),
    zeus_input_size_bytes: inputBytes,
    zeus_prompt_size_bytes: promptBytes,
    zeus_context_size_bytes: contextBytes,
    zeus_provider_user_message_size_bytes: userMessageBytes,
    zeus_fixture_output_size_bytes: fixtureBytes,
    zeus_input_estimated_tokens: estimateTokens(inputBytes),
    zeus_prompt_estimated_tokens: estimateTokens(promptBytes),
    zeus_context_estimated_tokens: estimateTokens(contextBytes),
    zeus_schema_estimated_tokens: estimateTokens(utf8Bytes(schema)),
    zeus_fixture_output_estimated_tokens: estimateTokens(fixtureBytes),
  };
}

function buildRuntime(transport: HttpTransport, env: Readonly<Record<string, string | undefined>>, baseUrl?: string): ModelRouter {
  const adapter = new XaiProviderAdapter({ transport, baseUrl });
  const runtime = new ModelRuntime({ providers: new Map([[PHASE6B_PROVIDER, adapter]]), credentials: { resolve: () => ({ configured: typeof env.XAI_API_KEY === 'string' && env.XAI_API_KEY.length > 0, value: env.XAI_API_KEY }) } });
  return new ModelRouter(runtime);
}

async function canonicalPhase5(): Promise<Awaited<ReturnType<typeof runOfflineAdversarialDeliberation>>> {
  return runOfflineAdversarialDeliberation(buildCertifiedPhase6Scenario());
}

function securityScan(value: unknown, secret: string | undefined): { readonly secret: 'PASS' | 'FAIL'; readonly hidden: 'PASS' | 'FAIL' } {
  const serialized = JSON.stringify(value) ?? '';
  const secretPass = !(secret && secret.length > 0 && serialized.includes(secret))
    && !/Bearer\s+[A-Za-z0-9._-]+/i.test(serialized)
    && !/authorization\s*:\s*bearer/i.test(serialized)
    && !/\b(?:xai[_-]?api[_-]?key|authorization)\s*[:=]/i.test(serialized)
    && !/["'](?:xai[_-]?api[_-]?key|authorization)["']\s*:/i.test(serialized);
  const hiddenPattern = /reasoning_content|chain.?of.?thought|hidden.?reasoning|raw_provider|raw_response|provider_response|internal_reasoning/i;
  const hasHidden = (candidate: unknown, key = ''): boolean => {
    if (key !== 'hidden_reasoning_scan' && hiddenPattern.test(key)) return true;
    if (typeof candidate === 'string') return hiddenPattern.test(candidate);
    if (Array.isArray(candidate)) return candidate.some((item) => hasHidden(item));
    if (isRecord(candidate)) return Object.entries(candidate).some(([childKey, child]) => hasHidden(child, childKey));
    return false;
  };
  const hiddenPass = !hasHidden(value);
  return { secret: secretPass ? 'PASS' : 'FAIL', hidden: hiddenPass ? 'PASS' : 'FAIL' };
}

function terminationTelemetry(response: ModelResponse<unknown>): Phase6bTerminationTelemetry {
  const d = response.diagnostics;
  const number = (key: string): number | null => typeof d[key] === 'number' ? d[key] : null;
  const string = (key: string): string | null => typeof d[key] === 'string' ? d[key] : null;
  return {
    http_status: number('http_status'),
    provider_finish_reason: response.finish_reason,
    termination_reason: string('termination_reason'),
    response_completion_status: string('response_completion_status'),
    output_limit: number('configured_output_limit'),
    input_usage_count: response.usage?.input_tokens ?? number('input_usage_count'),
    output_usage_count: response.usage?.output_tokens ?? number('output_count'),
    total_usage_count: response.usage?.total_tokens ?? number('total_usage_count'),
    request_id: response.request_id,
    provider: response.requested_model.provider,
    model: response.requested_model.model,
    parser_stage: string('parser_stage') ?? response.error?.stage ?? null,
  };
}

function baseResult(preflight: Phase6bPreflight, dryRun: boolean, status: ResultStatus, failure_code: string | null, wire_request: Phase6bWireProjection | null, request_ledger: Phase6bRequestLedger, artifact: ZeusArtifact | null, replay: 'PASS' | 'FAIL' | 'NOT_RUN', secret: 'PASS' | 'FAIL', hidden: 'PASS' | 'FAIL', real_provider_calls: 0 | 1, transport_boundary: Phase6bHarnessResult['transport_boundary'], telemetry: Phase6bTerminationTelemetry | null = null, validation: Pick<Phase6bHarnessResult, 'validation_failure_path' | 'validation_failure_code' | 'validation_expected' | 'validation_actual_type' | 'unknown_reference_path' | 'unknown_reference_value' | 'reference_class' | 'allowed_reference_count'> = { validation_failure_path: null, validation_failure_code: null, validation_expected: null, validation_actual_type: null, unknown_reference_path: null, unknown_reference_value: null, reference_class: null, allowed_reference_count: null }): Phase6bHarnessResult {
  return { status, dry_run: dryRun, preflight, transport_boundary: transport_boundary, wire_request, request_ledger, artifact, artifact_only_replay: replay, secret_scan: secret, hidden_reasoning_scan: hidden, human_decision: 'PENDING', real_provider_calls, failure_code, termination_telemetry: telemetry, ...validation };
}

function protocolValidationDiagnostics(error: unknown): Pick<Phase6bHarnessResult, 'validation_failure_path' | 'validation_failure_code' | 'validation_expected' | 'validation_actual_type' | 'unknown_reference_path' | 'unknown_reference_value' | 'reference_class' | 'allowed_reference_count'> {
  if (!(error instanceof SwarmProtocolError)) return { validation_failure_path: null, validation_failure_code: null, validation_expected: null, validation_actual_type: null, unknown_reference_path: null, unknown_reference_value: null, reference_class: null, allowed_reference_count: null };
  return { validation_failure_path: typeof error.diagnostics.UNKNOWN_REFERENCE_PATH === 'string' ? error.diagnostics.UNKNOWN_REFERENCE_PATH : null, validation_failure_code: error.code, validation_expected: null, validation_actual_type: null, unknown_reference_path: typeof error.diagnostics.UNKNOWN_REFERENCE_PATH === 'string' ? error.diagnostics.UNKNOWN_REFERENCE_PATH : null, unknown_reference_value: typeof error.diagnostics.UNKNOWN_REFERENCE_VALUE === 'string' ? error.diagnostics.UNKNOWN_REFERENCE_VALUE : null, reference_class: typeof error.diagnostics.REFERENCE_CLASS === 'string' ? error.diagnostics.REFERENCE_CLASS : null, allowed_reference_count: typeof error.diagnostics.ALLOWED_REFERENCE_COUNT === 'number' ? error.diagnostics.ALLOWED_REFERENCE_COUNT : null };
}

export async function runPhase6bDryRun(env: Readonly<Record<string, string | undefined>> = process.env): Promise<Phase6bHarnessResult> {
  return runPhase6bHarness({ env, dry_run: true });
}

export async function runPhase6bLiveZeus(env: Readonly<Record<string, string | undefined>> = process.env, transport?: HttpTransport): Promise<Phase6bHarnessResult> {
  return runPhase6bHarness({ env, dry_run: false, transport });
}

export async function runPhase6bHarness(options: { readonly env?: Readonly<Record<string, string | undefined>>; readonly dry_run: boolean; readonly transport?: HttpTransport }): Promise<Phase6bHarnessResult> {
  const env = options.env ?? process.env;
  const preflight = await phase6bPreflight(env);
  const emptyLedger: Phase6bRequestLedger = { request_budget: 1, admissible_requests: 0, transport_requests: 0, retry_requests: 0, fallback_requests: 0, second_request_blocked: 'NOT_RUN' };
  if (preflight.request_precheck === 'BLOCKED') {
    const result = baseResult(preflight, options.dry_run, 'BLOCKED', preflight.blocking_gate, null, { ...emptyLedger, second_request_blocked: 'PASS' }, null, 'NOT_RUN', 'PASS', 'PASS', 0, 'BLOCKED');
    const scans = securityScan(result, env.XAI_API_KEY);
    return { ...result, secret_scan: scans.secret, hidden_reasoning_scan: scans.hidden };
  }

  const phase5 = await canonicalPhase5();
  const input = buildZeusInput(phase5.blackboard);
  if (input.input_fingerprint !== PHASE6B_EXPECTED_INPUT_FINGERPRINT) throw new Error('ZEUS_INPUT_FINGERPRINT_MISMATCH');
  const budget = new Phase6bRequestBudget();
  if (!budget.reserve()) throw new Error('PHASE6B_FIRST_REQUEST_BLOCKED');
  const maxOutputTokens = preflight.effective_max_output_tokens!;
  const request = buildRequest(input, maxOutputTokens);
  const neverCrossed = new NeverCrossedTransport();
  buildRuntime(neverCrossed, env, env.SWARM_COUNCIL_XAI_BASE_URL);
  if (request.output_schema?.strict !== true || request.output_schema.json_schema === undefined) throw new Error('ZEUS_STRICT_SCHEMA_MISSING');

  if (options.dry_run) {
    const second = budget.reserve();
    const ledger: Phase6bRequestLedger = { request_budget: 1, admissible_requests: 1, transport_requests: neverCrossed.requests, retry_requests: 0, fallback_requests: 0, second_request_blocked: second ? 'FAIL' : 'PASS' };
    const result = baseResult(preflight, true, 'WOULD_EXECUTE_ONE_ZEUS_REQUEST', null, { method: 'POST', url: `${env.SWARM_COUNCIL_XAI_BASE_URL ?? 'https://api.x.ai/v1'}/chat/completions`, budget_category: 'ZEUS_SYNTHESIS', model: PHASE6B_MODEL, max_output_tokens: maxOutputTokens, token_field: 'max_tokens', schema_name: request.output_schema?.name ?? null, strict_schema: request.output_schema?.strict === true, prompt_version: ZEUS_PROMPT_VERSION, input_fingerprint: input.input_fingerprint }, ledger, null, 'NOT_RUN', 'PASS', 'PASS', 0, 'NOT_CROSSED');
    const scans = securityScan(result, env.XAI_API_KEY);
    return { ...result, secret_scan: scans.secret, hidden_reasoning_scan: scans.hidden };
  }

  const guarded = new Phase6bTransportGuard(options.transport ?? new FetchTransport(), { max_output_tokens: maxOutputTokens, input_fingerprint: input.input_fingerprint, base_url: env.SWARM_COUNCIL_XAI_BASE_URL, provider_schema: buildZeusProviderSchema(input) });
  const router = buildRuntime(guarded, env, env.SWARM_COUNCIL_XAI_BASE_URL);
  const plan = { primary: { provider: PHASE6B_PROVIDER, model: PHASE6B_MODEL }, fallback_models: [], fallback_enabled: false, retry: { max_attempts: 1, retryable_reasons: [] as const } } as const;
  const response = await router.execute(request, plan);
  const guardStats = guarded.stats();
  if (response.status !== 'SUCCESS' || !response.structured_output) {
    const result = baseResult(preflight, false, 'FAILED', response.error?.code ?? 'ZEUS_EXECUTION_FAILED', guarded.firstProjection(), { request_budget: 1, admissible_requests: 1, transport_requests: guardStats.transport_requests, retry_requests: 0, fallback_requests: 0, second_request_blocked: guardStats.second_request_blocked }, null, 'NOT_RUN', 'PASS', 'PASS', options.transport ? 0 : response.execution.real_model_called ? 1 : 0, guardStats.transport_requests === 1 ? 'CROSSED_ONCE' : 'BLOCKED', terminationTelemetry(response), phase6bValidationDiagnostics(response.diagnostics));
    const scans = securityScan(result, env.XAI_API_KEY);
    return { ...result, secret_scan: scans.secret, hidden_reasoning_scan: scans.hidden };
  }

  const outputScans = securityScan(response.structured_output, env.XAI_API_KEY);
  if (outputScans.secret === 'FAIL' || outputScans.hidden === 'FAIL') {
    const result = baseResult(preflight, false, 'FAILED', 'UNSAFE_ZEUS_OUTPUT', guarded.firstProjection(), { request_budget: 1, admissible_requests: 1, transport_requests: guardStats.transport_requests, retry_requests: 0, fallback_requests: 0, second_request_blocked: guardStats.second_request_blocked }, null, 'NOT_RUN', outputScans.secret, outputScans.hidden, options.transport ? 0 : response.execution.real_model_called ? 1 : 0, 'CROSSED_ONCE', terminationTelemetry(response));
    const scans = securityScan(result, env.XAI_API_KEY);
    return { ...result, secret_scan: scans.secret, hidden_reasoning_scan: scans.hidden };
  }

  try {
    const output = canonicalizeZeusSynthesis(response.structured_output, input, {
      provider_requested: response.execution.requested_provider,
      model_requested: response.execution.requested_model,
      provider_executed: response.execution.executed_provider,
      model_executed: response.execution.executed_model,
      request_id: response.request_id,
      finish_reason: response.finish_reason,
      output_tokens: response.usage?.output_tokens ?? null,
    });
    assertPreservation(output, input);
    assertProviderMetadata(output, input, response);
    const zeus = await runOfflineZeusSynthesis(phase5, { synthesize: async () => output });
    const artifact = buildZeusArtifact(zeus.blackboard, { artifact_schema_version: PHASE6B_ARTIFACT_SCHEMA_VERSION, provider_requests: 1 });
    const replay = replayZeusArtifact(JSON.parse(JSON.stringify(artifact)));
    const replayStatus = replay.artifact_only_replay === 'PASS' && replay.human_decision === null ? 'PASS' : 'FAIL';
    const result = baseResult(preflight, false, 'EXECUTED_ONE_ZEUS_REQUEST', null, guarded.firstProjection(), { request_budget: 1, admissible_requests: 1, transport_requests: guardStats.transport_requests, retry_requests: 0, fallback_requests: 0, second_request_blocked: guardStats.second_request_blocked }, artifact, replayStatus, 'PASS', 'PASS', options.transport ? 0 : response.execution.real_model_called ? 1 : 0, 'CROSSED_ONCE', terminationTelemetry(response));
    const scans = securityScan(result, env.XAI_API_KEY);
    return { ...result, secret_scan: scans.secret, hidden_reasoning_scan: scans.hidden };
  } catch (error) {
    const result = baseResult(preflight, false, 'FAILED', error instanceof SwarmProtocolError ? error.code : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'ZEUS_EXECUTION_VALIDATION_FAILED', guarded.firstProjection(), { request_budget: 1, admissible_requests: 1, transport_requests: guardStats.transport_requests, retry_requests: 0, fallback_requests: 0, second_request_blocked: guardStats.second_request_blocked }, null, 'NOT_RUN', 'PASS', 'PASS', options.transport ? 0 : response.execution.real_model_called ? 1 : 0, 'CROSSED_ONCE', terminationTelemetry(response), protocolValidationDiagnostics(error));
    const scans = securityScan(result, env.XAI_API_KEY);
    return { ...result, secret_scan: scans.secret, hidden_reasoning_scan: scans.hidden };
  }
}

export function writePhase6bArtifact(artifact: ZeusArtifact, path = 'artifacts/swarm/phase6b-live-zeus/zeus-artifact.json', secret?: string): string {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const inputScan = securityScan(artifact, secret);
  if (inputScan.secret === 'FAIL' || inputScan.hidden === 'FAIL') throw new Error('UNSAFE_ZEUS_ARTIFACT');
  const verified = verifyZeusArtifact(artifact);
  const serialized = JSON.stringify(verified, null, 2);
  const persistedScan = securityScan(verified, secret);
  if (persistedScan.secret === 'FAIL' || persistedScan.hidden === 'FAIL') throw new Error('UNSAFE_ZEUS_ARTIFACT');
  writeFileSync(target, `${serialized}\n`, 'utf8');
  return target;
}

export function loadPhase6bArtifact(path: string): ZeusArtifact {
  const serialized = readFileSync(resolve(path), 'utf8');
  const scan = securityScan(serialized, undefined);
  if (scan.secret === 'FAIL' || scan.hidden === 'FAIL') throw new Error('UNSAFE_ZEUS_ARTIFACT');
  return verifyZeusArtifact(JSON.parse(serialized) as unknown);
}

export function formatPhase6bReport(result: Phase6bHarnessResult): readonly string[] {
  const ready = result.status === 'WOULD_EXECUTE_ONE_ZEUS_REQUEST' && result.dry_run && result.preflight.request_precheck === 'PASS';
  return [
    'SWARM_2_PHASE_6B_LIVE_ZEUS_HARNESS',
    `LIVE_PHASE6B_HARNESS_IMPLEMENTED=YES`,
    `STATUS=${result.status}`,
    `DRY_RUN_TRANSPORT_BOUNDARY=${result.dry_run && result.transport_boundary === 'NOT_CROSSED' ? 'PASS' : result.dry_run ? 'FAIL' : 'NOT_RUN'}`,
    `XAI_CREDENTIAL_AVAILABLE=${result.preflight.credential_available}`,
    `AUTHORIZATION_AVAILABLE=${result.preflight.authorization_gate === 'PASS' ? 'YES' : 'NO'}`,
    `PROVIDER_MODEL_GATE=${result.preflight.gates.find((gate) => gate.name === 'PROVIDER_MODEL')?.status === 'PASS' ? 'PASS' : 'FAIL'}`,
    `ZEUS_INPUT_FINGERPRINT=${result.preflight.input_fingerprint ?? 'null'}`,
    'ZEUS_REQUEST_BUDGET=1',
    'RETRY_DISABLED=PASS',
    'FALLBACK_DISABLED=PASS',
    `SECOND_REQUEST_BLOCKED=${result.request_ledger.second_request_blocked === 'PASS' ? 'PASS' : 'FAIL'}`,
    `SECRET_SCAN=${result.secret_scan}`,
    `HIDDEN_REASONING_SCAN=${result.hidden_reasoning_scan}`,
    `HUMAN_DECISION=${result.human_decision}`,
    `REAL_PROVIDER_CALLS=${result.real_provider_calls === 1 ? 1 : 0}`,
    `REQUESTS_ADMISSIBLE=${result.request_ledger.admissible_requests}`,
    `TRANSPORT_REQUESTS=${result.request_ledger.transport_requests}`,
    `ARTIFACT_ONLY_REPLAY=${result.artifact_only_replay}`,
    `FAILURE_CODE=${result.failure_code ?? 'NONE'}`,
    `VALIDATION_FAILURE_PATH=${result.validation_failure_path ?? 'NONE'}`,
    `VALIDATION_FAILURE_CODE=${result.validation_failure_code ?? 'NONE'}`,
    `VALIDATION_EXPECTED=${result.validation_expected ?? 'NONE'}`,
    `VALIDATION_ACTUAL_TYPE=${result.validation_actual_type ?? 'NONE'}`,
    `UNKNOWN_REFERENCE_PATH=${result.unknown_reference_path ?? 'NONE'}`,
    `UNKNOWN_REFERENCE_VALUE=${result.unknown_reference_value ?? 'NONE'}`,
    `REFERENCE_CLASS=${result.reference_class ?? 'NONE'}`,
    `ALLOWED_REFERENCE_COUNT=${result.allowed_reference_count ?? 'NONE'}`,
    `TERMINATION_HTTP_STATUS=${result.termination_telemetry?.http_status ?? 'null'}`,
    `PROVIDER_FINISH_REASON=${result.termination_telemetry?.provider_finish_reason ?? 'null'}`,
    `TERMINATION_REASON=${result.termination_telemetry?.termination_reason ?? 'null'}`,
    `RESPONSE_COMPLETION_STATUS=${result.termination_telemetry?.response_completion_status ?? 'null'}`,
    `REQUESTED_OUTPUT_LIMIT=${result.termination_telemetry?.output_limit ?? 'null'}`,
    `INPUT_USAGE_COUNT=${result.termination_telemetry?.input_usage_count ?? 'null'}`,
    `OUTPUT_USAGE_COUNT=${result.termination_telemetry?.output_usage_count ?? 'null'}`,
    `TOTAL_USAGE_COUNT=${result.termination_telemetry?.total_usage_count ?? 'null'}`,
    `TERMINATION_REQUEST_ID=${result.termination_telemetry?.request_id ?? 'null'}`,
    `TERMINATION_PROVIDER=${result.termination_telemetry?.provider ?? 'null'}`,
    `TERMINATION_MODEL=${result.termination_telemetry?.model ?? 'null'}`,
    `PARSER_STAGE=${result.termination_telemetry?.parser_stage ?? 'null'}`,
    `READY_FOR_ONE_LIVE_ZEUS_CALL=${ready ? 'YES' : 'NO'}`,
  ];
}

if (import.meta.main) {
  const live = process.argv.includes('--live');
  if (live) {
    const result = await runPhase6bLiveZeus(process.env);
    for (const line of formatPhase6bReport(result)) console.log(line);
    if (result.artifact) console.log(`ARTIFACT_WRITTEN=${writePhase6bArtifact(result.artifact)}`);
  } else {
    const result = await runPhase6bDryRun(process.env);
    for (const line of formatPhase6bReport(result)) console.log(line);
  }
}
