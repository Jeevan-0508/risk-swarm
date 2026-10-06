export const MODEL_CAPABILITIES = ['TEXT_GENERATION', 'STRUCTURED_OUTPUT', 'JSON_MODE', 'TOOL_CALLING', 'STREAMING'] as const;
export type ModelCapability = (typeof MODEL_CAPABILITIES)[number];

export const CAPABILITY_SOURCES = ['CONFIGURED', 'DISCOVERED', 'VERIFIED'] as const;
export type CapabilitySource = (typeof CAPABILITY_SOURCES)[number];

export type ProviderId = string;
export type ModelId = string;

export interface ModelRef {
  readonly provider: ProviderId;
  readonly model: ModelId;
}

export interface ModelCapabilities {
  readonly capabilities: readonly ModelCapability[];
  readonly source: CapabilitySource;
  readonly max_input_tokens?: number;
  readonly max_output_tokens?: number;
  readonly supports_system_instruction?: boolean;
  readonly supports_temperature?: boolean;
  readonly supports_seed?: boolean;
}

export interface StructuredValidationDiagnostics {
  /** JSONPath-like location of the first safe validation failure. */
  readonly path: string;
  readonly code: string;
  readonly expected: string;
  readonly actual_type: string;
}

export interface OutputSchemaDescriptor<T = unknown> {
  readonly name: string;
  readonly strict?: boolean;
  readonly describe?: string;
  /** Provider-facing JSON Schema, when the adapter supports native structured output. */
  readonly json_schema?: Readonly<Record<string, unknown>>;
  readonly validate: (value: unknown) => { readonly success: true; readonly value: T } | { readonly success: false; readonly error: string; readonly diagnostics?: StructuredValidationDiagnostics };
}

export interface ModelRequest<T = unknown> {
  readonly request_id: string;
  readonly case_id: string;
  readonly seat_id?: string;
  readonly purpose: string;
  readonly model_requirements: readonly ModelCapability[];
  readonly system_instruction?: string;
  readonly task_instruction: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly output_schema?: OutputSchemaDescriptor<T>;
  readonly temperature?: number;
  readonly max_output_tokens?: number;
  readonly timeout_ms: number;
  readonly signal?: AbortSignal;
}

export const MODEL_RESPONSE_STATUSES = ['SUCCESS', 'UNAVAILABLE', 'FAILED', 'REJECTED'] as const;
export type ModelResponseStatus = (typeof MODEL_RESPONSE_STATUSES)[number];

export const MODEL_ERROR_CODES = [
  'AUTHENTICATION',
  'AUTHORIZATION',
  'MODEL_NOT_FOUND',
  'CAPABILITY_MISMATCH',
  'RATE_LIMITED',
  'TIMEOUT',
  'NETWORK',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_HTTP_ERROR',
  'OUTPUT_TOKEN_LIMIT',
  'RESPONSE_PARSE_ERROR',
  'EMPTY_RESPONSE',
  'STRUCTURED_OUTPUT_INVALID',
  'CANCELLED',
  'UNKNOWN_PROVIDER_ERROR',
] as const;
export type ModelErrorCode = (typeof MODEL_ERROR_CODES)[number];

export const FAILURE_STAGES = [
  'ROUTING',
  'CAPABILITY_CHECK',
  'REQUEST_BUILD',
  'REQUEST',
  'HTTP',
  'RESPONSE_TRUNCATED',
  'RESPONSE_PARSE',
  'RESPONSE_NORMALIZATION',
  'STRUCTURED_VALIDATION',
  'COMPLETE',
] as const;
export type FailureStage = (typeof FAILURE_STAGES)[number];

export type SafeDiagnosticValue = string | number | boolean | null;
export type SafeDiagnostics = Readonly<Record<string, SafeDiagnosticValue>>;

export interface ModelError {
  readonly code: ModelErrorCode;
  readonly stage: FailureStage;
  readonly message: string;
  readonly diagnostics: SafeDiagnostics;
}

export interface UsageMetadata {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
  readonly cost?: number;
  readonly cost_currency?: string;
}

export interface RuntimeExecutionMetadata {
  readonly requested_provider: ProviderId;
  readonly requested_model: ModelId;
  readonly executed_provider: ProviderId | null;
  readonly executed_model: ModelId | null;
  readonly fallback_used: boolean;
  readonly fallback_reason: ModelErrorCode | null;
  readonly real_model_called: boolean;
  /** A provider request was handed to the transport boundary. */
  readonly provider_request_attempted: boolean;
  /** The transport returned an HTTP/provider response, including error status. */
  readonly provider_response_received: boolean;
  /** The provider returned model content before local parsing/validation. */
  readonly model_inference_succeeded: boolean;
  /** The provider returned text or structured content, whether or not it validated. */
  readonly model_output_present: boolean;
  /** Local structured-output validation accepted the result. */
  readonly model_output_accepted: boolean;
  /** Local structured-output normalization/validation was reached. */
  readonly structured_validation_performed: boolean;
  readonly output_validated: boolean;
  readonly independent: boolean;
}

export interface ModelAttempt {
  readonly attempt_number: number;
  readonly provider: ProviderId;
  readonly model: ModelId;
  readonly started_at: string;
  readonly ended_at: string;
  readonly duration_ms: number;
  readonly status: ModelResponseStatus;
  readonly failure_stage: FailureStage | null;
  readonly failure_reason_code: ModelErrorCode | null;
  readonly capability_snapshot: ModelCapabilities;
  readonly diagnostics: SafeDiagnostics;
  readonly provider_request_attempted: boolean;
  readonly provider_response_received: boolean;
  readonly model_inference_succeeded: boolean;
  readonly model_output_present: boolean;
  readonly model_output_accepted: boolean;
  readonly structured_validation_performed: boolean;
}

export interface ModelResponse<T = unknown> {
  readonly request_id: string;
  readonly requested_model: ModelRef;
  readonly executed_model: ModelRef | null;
  readonly status: ModelResponseStatus;
  readonly text: string | null;
  readonly structured_output: T | null;
  readonly finish_reason: string | null;
  readonly usage: UsageMetadata | null;
  readonly execution: RuntimeExecutionMetadata;
  readonly error: ModelError | null;
  readonly diagnostics: SafeDiagnostics;
  readonly attempts: readonly ModelAttempt[];
}

export interface ModelPolicy {
  readonly primary: ModelRef;
  readonly fallback_models?: readonly ModelRef[];
  readonly required_capabilities?: readonly ModelCapability[];
  readonly fallback_enabled?: boolean;
  readonly allowed_fallback_reasons?: readonly ModelErrorCode[];
  readonly retry?: RetryPolicy;
  readonly minimum_health?: HealthStatus;
}

export type ModelExecutionPlan = ModelPolicy;

export interface RetryPolicy {
  readonly max_attempts: number;
  readonly retryable_reasons: readonly ModelErrorCode[];
  readonly backoff_ms?: readonly number[];
}

export interface CredentialResult {
  readonly configured: boolean;
  /** Internal-only value. It must never be copied into a response, attempt, event, or error. */
  readonly value?: string;
  readonly reason?: string;
}

export interface CredentialResolver {
  resolve(provider: ProviderId): Promise<CredentialResult> | CredentialResult;
}

export interface ProviderExecution {
  readonly status: ModelResponseStatus;
  readonly text?: string | null;
  readonly structured_output?: unknown;
  readonly finish_reason?: string | null;
  readonly usage?: UsageMetadata | null;
  readonly error?: ModelError;
  readonly diagnostics?: SafeDiagnostics;
  /** Real adapters may assert this; the mock adapter intentionally leaves it false. */
  readonly real_model_called?: boolean;
  readonly provider_request_attempted?: boolean;
  readonly provider_response_received?: boolean;
  readonly model_inference_succeeded?: boolean;
  readonly model_output_present?: boolean;
}

export interface ProviderContext {
  readonly credential?: string;
  readonly signal?: AbortSignal;
}

export interface ProviderAdapter {
  readonly providerId: ProviderId;
  getConfiguredCapabilities(model: ModelId): ModelCapabilities;
  execute(request: ModelRequest, model: ModelId, context: ProviderContext): Promise<ProviderExecution>;
  discoverModels?: () => Promise<DiscoveryResult>;
  healthCheck?: (model?: ModelId) => Promise<HealthObservation>;
}

export const DISCOVERY_STATUSES = ['LISTED', 'EXECUTION_VERIFIED'] as const;
export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number];

export interface DiscoveredModel {
  readonly model: ModelId;
  readonly status: DiscoveryStatus;
  readonly capabilities?: ModelCapabilities;
}

export interface DiscoveryResult {
  readonly provider: ProviderId;
  readonly observed_at: string;
  readonly models: readonly DiscoveredModel[];
  readonly status: 'SUCCESS' | 'DISCOVERY_UNSUPPORTED' | 'FAILED';
  readonly diagnostics: SafeDiagnostics;
}

export const HEALTH_STATUSES = ['UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface HealthObservation {
  readonly provider: ProviderId;
  readonly model: ModelId | null;
  readonly observed_at: string;
  readonly source: string;
  readonly status: HealthStatus;
  readonly reason_code: ModelErrorCode | null;
}

export interface Clock {
  now(): number;
  iso(): string;
}

export type RetryScheduler = (delay_ms: number) => Promise<void>;

export type RuntimeEvent =
  | { readonly type: 'ROUTING_STARTED'; readonly request_id: string; readonly model: ModelRef }
  | { readonly type: 'ATTEMPT_STARTED'; readonly request_id: string; readonly attempt_number: number; readonly model: ModelRef }
  | { readonly type: 'ATTEMPT_FAILED'; readonly request_id: string; readonly attempt_number: number; readonly model: ModelRef; readonly code: ModelErrorCode; readonly stage: FailureStage }
  | { readonly type: 'RETRY_SCHEDULED'; readonly request_id: string; readonly attempt_number: number; readonly delay_ms: number; readonly reason: ModelErrorCode }
  | { readonly type: 'FALLBACK_SELECTED'; readonly request_id: string; readonly from: ModelRef; readonly to: ModelRef; readonly reason: ModelErrorCode }
  | { readonly type: 'ATTEMPT_SUCCEEDED'; readonly request_id: string; readonly attempt_number: number; readonly model: ModelRef }
  | { readonly type: 'EXECUTION_COMPLETED'; readonly request_id: string; readonly status: ModelResponseStatus; readonly executed_model: ModelRef | null };

export interface ModelRuntimeOptions {
  readonly providers: ReadonlyMap<ProviderId, ProviderAdapter> | Readonly<Record<ProviderId, ProviderAdapter>>;
  readonly credentials?: CredentialResolver;
  readonly clock?: Clock;
  readonly onEvent?: (event: RuntimeEvent) => void;
}

export interface ModelRouterOptions extends ModelRuntimeOptions {
  readonly retryScheduler?: RetryScheduler;
  readonly circuitBreaker?: import('./circuit').CircuitBreaker;
}
