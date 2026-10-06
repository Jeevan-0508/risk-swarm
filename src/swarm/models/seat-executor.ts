import { type ChallengeInput, type SeatExecutor, type SeatInput } from '../engine/executor';
import { ModelRouter } from './router';
import { jsonSchema } from './structured-output';
import { type ModelExecutionPlan, type ModelResponse, type ModelRef, type OutputSchemaDescriptor } from './types';

export interface GenericModelTaskOutput {
  readonly summary: string;
  readonly confidence: number;
  readonly abstained?: boolean;
  readonly abstention_reason?: string;
}

export const GENERIC_MODEL_TASK_SCHEMA = jsonSchema<GenericModelTaskOutput>('generic_model_task', (value) => {
  if (!value || typeof value !== 'object') return { success: false, error: 'object required' };
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== 'string' || record.summary.trim().length === 0) return { success: false, error: 'summary required' };
  if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) return { success: false, error: 'confidence must be bounded' };
  if (record.abstained !== undefined && typeof record.abstained !== 'boolean') return { success: false, error: 'abstained must be boolean' };
  if (record.abstained === true && (typeof record.abstention_reason !== 'string' || record.abstention_reason.trim().length === 0)) return { success: false, error: 'abstention reason required' };
  const abstentionReason = typeof record.abstention_reason === 'string' ? record.abstention_reason : undefined;
  return { success: true, value: { summary: record.summary, confidence: record.confidence, ...(typeof record.abstained === 'boolean' ? { abstained: record.abstained } : {}), ...(abstentionReason === undefined ? {} : { abstention_reason: abstentionReason }) } };
}, { strict: true, describe: 'Generic summary and bounded confidence; not a risk-seat schema.' });

export interface ModelSeatExecutionResult<T = GenericModelTaskOutput> {
  readonly status: 'SUCCESS' | 'ABSTAINED' | 'UNAVAILABLE' | 'FAILED' | 'REJECTED';
  readonly output: T | null;
  readonly response: ModelResponse<T>;
  readonly reason: string | null;
}

/** Generic runtime default; Council certification supplies its own bounded budget explicitly. */
export const DEFAULT_GENERIC_MODEL_MAX_OUTPUT_TOKENS = 256 as const;

export interface ModelSeatExecutorOptions<T = GenericModelTaskOutput> {
  readonly purpose?: string;
  readonly system_instruction?: string;
  readonly task_instruction?: string;
  readonly output_schema?: OutputSchemaDescriptor<T>;
  readonly context?: (input: SeatInput | ChallengeInput, phase: 'ROUND_1' | 'CHALLENGE_RESPONSE') => Readonly<Record<string, unknown>>;
  readonly timeout_ms?: number;
  readonly max_output_tokens?: number;
}

function mapResponse<T>(response: ModelResponse<T>): ModelSeatExecutionResult<T> {
  const candidate = response.structured_output as (T & { readonly abstained?: boolean; readonly abstention_reason?: string }) | null;
  if (response.status === 'SUCCESS' && candidate?.abstained) return { status: 'ABSTAINED', output: candidate, response, reason: candidate.abstention_reason ?? 'generic task abstained' };
  return { status: response.status, output: response.structured_output, response, reason: response.error?.message ?? null };
}

export class ModelSeatExecutor<T = GenericModelTaskOutput> implements SeatExecutor {
  constructor(private readonly router: ModelRouter, private readonly plan: ModelExecutionPlan, private readonly requestId = (caseId: string, seatId: string, invocation: number, purpose: string) => `model-request-${caseId}-${seatId}-${purpose}-${invocation}`, private readonly options: ModelSeatExecutorOptions<T> = {}) {}

  async execute(input: SeatInput): Promise<ModelSeatExecutionResult<T>> {
    const request = {
      request_id: this.requestId(input.case.case_id, input.seat_id, input.execution_context.invocation, 'round1'),
      case_id: input.case.case_id,
      seat_id: input.seat_id,
      purpose: this.options.purpose ?? 'GENERIC_MODEL_RUNTIME_CERTIFICATION',
      model_requirements: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'] as const,
      system_instruction: this.options.system_instruction ?? 'Return only the generic structured task result. This is a runtime test, not a risk assessment.',
      task_instruction: this.options.task_instruction ?? 'Provide a concise generic summary and confidence between 0 and 1.',
      context: this.options.context?.(input, 'ROUND_1') ?? { scope: input.case.scope, evidence_package_id: input.evidence_package.package_id },
      output_schema: this.options.output_schema ?? GENERIC_MODEL_TASK_SCHEMA as unknown as OutputSchemaDescriptor<T>,
      max_output_tokens: this.options.max_output_tokens ?? DEFAULT_GENERIC_MODEL_MAX_OUTPUT_TOKENS,
      timeout_ms: this.options.timeout_ms ?? 10_000,
    };
    return mapResponse(await this.router.execute(request, this.plan));
  }

  async respond(input: ChallengeInput): Promise<ModelSeatExecutionResult<T>> {
    const request = {
      request_id: this.requestId(input.case.case_id, input.seat_id, input.execution_context.invocation, 'challenge'),
      case_id: input.case.case_id,
      seat_id: input.seat_id,
      purpose: this.options.purpose ?? 'GENERIC_MODEL_RUNTIME_CERTIFICATION_RESPONSE',
      model_requirements: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'] as const,
      task_instruction: this.options.task_instruction ?? 'Provide a generic structured response to the supplied test challenge.',
      context: this.options.context?.(input, 'CHALLENGE_RESPONSE') ?? { challenge_id: input.challenge.challenge_id, prior_position_id: input.prior_position.position_id },
      output_schema: this.options.output_schema ?? GENERIC_MODEL_TASK_SCHEMA as unknown as OutputSchemaDescriptor<T>,
      max_output_tokens: this.options.max_output_tokens ?? DEFAULT_GENERIC_MODEL_MAX_OUTPUT_TOKENS,
      timeout_ms: this.options.timeout_ms ?? 10_000,
    };
    return mapResponse(await this.router.execute(request, this.plan));
  }
}

export function modelRef(provider: string, model: string): ModelRef {
  return { provider, model };
}
