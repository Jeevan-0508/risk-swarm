import { GeminiProviderAdapter } from '../src/swarm/models/providers/gemini';
import { XaiProviderAdapter } from '../src/swarm/models/providers/xai';
import { ModelRouter } from '../src/swarm/models/router';
import { ModelRuntime } from '../src/swarm/models/runtime';
import { ModelSeatExecutor, type GenericModelTaskOutput, type ModelSeatExecutionResult, type ModelSeatExecutorOptions } from '../src/swarm/models/seat-executor';
import { jsonSchema } from '../src/swarm/models/structured-output';
import { type HttpTransport, type HttpRequest, type HttpResponse } from '../src/swarm/models/transport';
import { type ModelResponse, type SafeDiagnostics } from '../src/swarm/models/types';

const CERTIFICATION_SECRET = 'SWARM_PHASE3B_TEST_SECRET_DO_NOT_LEAK';

export interface CertificationConfig {
  readonly provider: string;
  readonly model: string;
  readonly credential?: string;
  readonly timeout_ms?: number;
  readonly base_url?: string;
}

export interface CertificationReport {
  readonly CERT_PROVIDER: string;
  readonly CERT_MODEL: string;
  readonly CREDENTIAL_PRESENT: 'PRESENT' | 'ABSENT';
  readonly REQUEST_COUNT: number;
  readonly REQUESTED_PROVIDER: string;
  readonly REQUESTED_MODEL: string;
  readonly ATTEMPTED_PROVIDER: string | null;
  readonly ATTEMPTED_MODEL: string | null;
  readonly EXECUTED_PROVIDER: string | null;
  readonly EXECUTED_MODEL: string | null;
  readonly FALLBACK_USED: boolean;
  readonly PROVIDER_REQUEST_ATTEMPTED: boolean;
  readonly PROVIDER_RESPONSE_RECEIVED: boolean;
  readonly MODEL_INFERENCE_SUCCEEDED: boolean;
  readonly MODEL_OUTPUT_PRESENT: boolean;
  readonly MODEL_OUTPUT_ACCEPTED: boolean;
  readonly FINAL_STATUS: string;
  readonly FAILURE_STAGE: string | null;
  readonly FAILURE_REASON_CODE: string | null;
  readonly HTTP_STATUS: number | null;
  readonly STRUCTURED_OUTPUT_PRESENT: boolean;
  readonly STRUCTURED_VALIDATION: 'PASS' | 'FAIL' | 'NOT_RUN';
  readonly SUMMARY_MATCH: boolean;
  readonly CONFIDENCE_MATCH: boolean;
  readonly ATTEMPT_COUNT: number;
  readonly DURATION_MS: number;
  readonly REAL_MODEL_CALLED: boolean;
  readonly SECRET_LEAK_CHECK: 'PASS' | 'FAIL';
  readonly CERTIFICATION_RESULT: 'PASS' | 'FAIL';
}

export interface CertificationRun {
  readonly report: CertificationReport;
  readonly response: ModelResponse<GenericModelTaskOutput> | null;
}

class CountingTransport implements HttpTransport {
  request_count = 0;

  constructor(private readonly delegate: HttpTransport) {}

  request(request: HttpRequest): Promise<HttpResponse> {
    this.request_count += 1;
    return this.delegate.request(request);
  }
}

function strictCertificationSchema() {
  return jsonSchema<GenericModelTaskOutput>('phase3b_certification_output', (value) => {
    if (!value || typeof value !== 'object') return { success: false, error: 'object required' };
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== 'confidence' || keys[1] !== 'summary') return { success: false, error: 'exactly summary and confidence are required' };
    if (record.summary !== 'OK') return { success: false, error: 'summary must equal OK' };
    if (record.confidence !== 1) return { success: false, error: 'confidence must equal 1' };
    return { success: true, value: { summary: 'OK', confidence: 1 } };
  }, { strict: true, describe: 'Phase 3B infrastructure-only result; exactly summary and confidence.' });
}

function safeHttpStatus(diagnostics: SafeDiagnostics): number | null {
  return typeof diagnostics.http_status === 'number' ? diagnostics.http_status : null;
}

function containsSecret(value: unknown, credential?: string): boolean {
  const serialized = JSON.stringify(value);
  return serialized.includes(CERTIFICATION_SECRET) || Boolean(credential && credential.length > 0 && serialized.includes(credential));
}

function emptyReport(config: CertificationConfig, requestCount: number, started: number, reason: string | null): CertificationReport {
  return {
    CERT_PROVIDER: config.provider,
    CERT_MODEL: config.model,
    CREDENTIAL_PRESENT: config.credential ? 'PRESENT' : 'ABSENT',
    REQUEST_COUNT: requestCount,
    REQUESTED_PROVIDER: config.provider,
    REQUESTED_MODEL: config.model,
    ATTEMPTED_PROVIDER: null,
    ATTEMPTED_MODEL: null,
    EXECUTED_PROVIDER: null,
    EXECUTED_MODEL: null,
    FALLBACK_USED: false,
    PROVIDER_REQUEST_ATTEMPTED: false,
    PROVIDER_RESPONSE_RECEIVED: false,
    MODEL_INFERENCE_SUCCEEDED: false,
    MODEL_OUTPUT_PRESENT: false,
    MODEL_OUTPUT_ACCEPTED: false,
    FINAL_STATUS: 'UNAVAILABLE',
    FAILURE_STAGE: 'REQUEST_BUILD',
    FAILURE_REASON_CODE: reason,
    HTTP_STATUS: null,
    STRUCTURED_OUTPUT_PRESENT: false,
    STRUCTURED_VALIDATION: 'NOT_RUN',
    SUMMARY_MATCH: false,
    CONFIDENCE_MATCH: false,
    ATTEMPT_COUNT: 0,
    DURATION_MS: Math.max(0, Date.now() - started),
    REAL_MODEL_CALLED: false,
    SECRET_LEAK_CHECK: 'PASS',
    CERTIFICATION_RESULT: 'FAIL',
  };
}

function buildReport(config: CertificationConfig, requestCount: number, result: ModelSeatExecutionResult, started: number): CertificationReport {
  const response = result.response;
  const output = response.structured_output;
  const attempt = response.attempts[0] ?? null;
  const summaryMatch = output?.summary === 'OK';
  const confidenceMatch = output?.confidence === 1;
  const safeSurface = { execution: response.execution, attempts: response.attempts, diagnostics: response.diagnostics, error: response.error };
  const secretLeakCheck = containsSecret(safeSurface, config.credential) ? 'FAIL' : 'PASS';
  const certificationPass = requestCount === 1
    && response.requested_model.provider === config.provider
    && response.requested_model.model === config.model
    && attempt?.provider === config.provider
    && attempt?.model === config.model
    && response.execution.executed_provider === config.provider
    && response.execution.executed_model === config.model
    && response.execution.fallback_used === false
    && response.attempts.length === 1
    && response.status === 'SUCCESS'
    && response.structured_output !== null
    && response.execution.output_validated
    && response.execution.model_output_accepted
    && summaryMatch
    && confidenceMatch
    && response.execution.real_model_called
    && secretLeakCheck === 'PASS';

  return {
    CERT_PROVIDER: config.provider,
    CERT_MODEL: config.model,
    CREDENTIAL_PRESENT: config.credential ? 'PRESENT' : 'ABSENT',
    REQUEST_COUNT: requestCount,
    REQUESTED_PROVIDER: response.requested_model.provider,
    REQUESTED_MODEL: response.requested_model.model,
    ATTEMPTED_PROVIDER: attempt?.provider ?? null,
    ATTEMPTED_MODEL: attempt?.model ?? null,
    EXECUTED_PROVIDER: response.execution.executed_provider,
    EXECUTED_MODEL: response.execution.executed_model,
    FALLBACK_USED: response.execution.fallback_used,
    PROVIDER_REQUEST_ATTEMPTED: response.execution.provider_request_attempted,
    PROVIDER_RESPONSE_RECEIVED: response.execution.provider_response_received,
    MODEL_INFERENCE_SUCCEEDED: response.execution.model_inference_succeeded,
    MODEL_OUTPUT_PRESENT: response.execution.model_output_present,
    MODEL_OUTPUT_ACCEPTED: response.execution.model_output_accepted,
    FINAL_STATUS: response.status,
    FAILURE_STAGE: response.error?.stage ?? null,
    FAILURE_REASON_CODE: response.error?.code ?? null,
    HTTP_STATUS: safeHttpStatus(response.diagnostics),
    STRUCTURED_OUTPUT_PRESENT: response.structured_output !== null,
    STRUCTURED_VALIDATION: response.execution.structured_validation_performed ? (response.execution.output_validated ? 'PASS' : 'FAIL') : 'NOT_RUN',
    SUMMARY_MATCH: summaryMatch,
    CONFIDENCE_MATCH: confidenceMatch,
    ATTEMPT_COUNT: response.attempts.length,
    DURATION_MS: Math.max(0, Date.now() - started),
    REAL_MODEL_CALLED: response.execution.real_model_called,
    SECRET_LEAK_CHECK: secretLeakCheck,
    CERTIFICATION_RESULT: certificationPass ? 'PASS' : 'FAIL',
  };
}

export async function runCertification(config: CertificationConfig, transport: HttpTransport): Promise<CertificationRun> {
  const started = Date.now();
  const counted = new CountingTransport(transport);
  if (config.provider !== 'gemini' && config.provider !== 'xai') return { report: emptyReport(config, 0, started, 'UNSUPPORTED_PROVIDER'), response: null };
  if (!config.model) return { report: emptyReport(config, 0, started, 'MODEL_NOT_CONFIGURED'), response: null };

  const adapter = config.provider === 'gemini'
    ? new GeminiProviderAdapter({ transport: counted, baseUrl: config.base_url })
    : new XaiProviderAdapter({ transport: counted, baseUrl: config.base_url });
  const runtime = new ModelRuntime({
    providers: new Map([[adapter.providerId, adapter]]),
    credentials: { resolve: () => ({ configured: Boolean(config.credential), value: config.credential }) },
  });
  const router = new ModelRouter(runtime);
  const seatOptions: ModelSeatExecutorOptions = {
    purpose: 'PHASE3B_MODEL_RUNTIME_CERTIFICATION',
    system_instruction: 'This is infrastructure certification. Return only the requested JSON object.',
    task_instruction: 'Return exactly {"summary":"OK","confidence":1}. Do not include any additional fields or prose.',
    output_schema: strictCertificationSchema(),
    timeout_ms: config.timeout_ms ?? 10_000,
  };
  const executor = new ModelSeatExecutor(router, { primary: { provider: config.provider, model: config.model }, required_capabilities: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'], fallback_enabled: false, retry: { max_attempts: 1, retryable_reasons: [] } }, undefined, seatOptions);
  const result = await executor.execute({
    seat_id: 'CERTIFICATION' as never,
    case: { case_id: 'PHASE3B_CERTIFICATION', protocol_version: '2.0.0-alpha.1', question: 'Infrastructure certification only', scope: { geo: [], mode: ['INFRASTRUCTURE_ONLY'], from: 'CERTIFICATION', to: 'CERTIFICATION' }, policy: {} },
    evidence_package: { package_id: 'PHASE3B_NO_EVIDENCE', case_id: 'PHASE3B_CERTIFICATION', protocol_version: '2.0.0-alpha.1', items: [], known_gaps: [], known_conflicts: [], package_hash: 'CERTIFICATION', sealed_at: 'CERTIFICATION' },
    execution_context: { invocation: 1, phase: 'ROUND_1' },
  } as never);
  const report = buildReport(config, counted.request_count, result, started);
  return { report, response: result.response };
}

export function credentialEnvName(provider: string): string | null {
  if (provider === 'gemini') return 'GEMINI_API_KEY';
  if (provider === 'xai') return 'XAI_API_KEY';
  return null;
}

export function configFromEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): CertificationConfig {
  const provider = env.SWARM_CERT_PROVIDER ?? '';
  const keyName = credentialEnvName(provider);
  const base_url = provider === 'xai' ? env.SWARM_CERT_XAI_BASE_URL : env.SWARM_CERT_GEMINI_BASE_URL;
  return { provider, model: env.SWARM_CERT_MODEL ?? '', credential: keyName ? env[keyName] : undefined, base_url };
}

export function formatCertificationReport(report: CertificationReport): string {
  return Object.entries(report).map(([key, value]) => `${key}=${value === null ? 'null' : value}`).join('\n');
}

export const certificationTestSecret = CERTIFICATION_SECRET;
