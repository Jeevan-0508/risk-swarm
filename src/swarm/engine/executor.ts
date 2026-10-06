import {
  AgentPositionSchema,
  ModelExecutionSchema,
  Round1SeatIdSchema,
  type AgentPosition,
  type Challenge,
  type ChallengeResponse,
  type EvidencePackage,
  type ModelExecution,
  type Round1SeatId,
  type Round1SeatInput,
  type SwarmCase,
} from '../contracts';

export interface SeatExecutionContext {
  readonly invocation: number;
  readonly phase: 'ROUND_1' | 'CHALLENGE_RESPONSE';
}

export interface SeatInput extends Round1SeatInput {
  readonly execution_context: SeatExecutionContext;
}

export interface ChallengeInput {
  readonly seat_id: Round1SeatId;
  readonly case: Pick<SwarmCase, 'case_id' | 'protocol_version' | 'question' | 'scope' | 'policy'>;
  readonly evidence_package: EvidencePackage;
  readonly prior_position: AgentPosition;
  readonly challenge: Challenge;
  readonly opposing_excerpt: Readonly<{
    position_id: string;
    seat_id: Round1SeatId;
    conclusion: string;
    risk_level: AgentPosition['risk_level'];
    confidence: number | null;
    target_claim: string | null;
  }>;
  readonly execution_context: SeatExecutionContext;
}

export interface FixtureSuccess {
  readonly status: 'SUCCESS';
  readonly execution: ModelExecution;
  readonly position?: AgentPosition;
  readonly response?: ChallengeResponse;
  readonly revision?: import('../contracts').Revision;
  readonly delay_ms?: number;
}

export interface FixtureTerminal {
  readonly status: 'ABSTAINED' | 'UNAVAILABLE' | 'FAILED' | 'REJECTED';
  readonly execution: ModelExecution;
  readonly reason: string;
  readonly delay_ms?: number;
}

export type FixtureResult = FixtureSuccess | FixtureTerminal;

export interface SeatExecutor {
  execute(input: SeatInput): Promise<unknown>;
  respond(input: ChallengeInput): Promise<unknown>;
}

export interface FixtureSeatPlan {
  readonly seat_id: Round1SeatId;
  readonly round1: unknown;
  readonly responses?: Readonly<Record<string, unknown>>;
}

function wait(delay_ms: number | undefined): Promise<void> {
  if (!delay_ms || delay_ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delay_ms));
}

/** Deterministic fixture executor. It has no clock, network, filesystem, provider, or global state. */
export class FixtureSeatExecutor implements SeatExecutor {
  private readonly plans: Readonly<Record<Round1SeatId, FixtureSeatPlan>>;

  constructor(plans: readonly FixtureSeatPlan[]) {
    const next = {} as Record<Round1SeatId, FixtureSeatPlan>;
    for (const plan of plans) {
      if (!Round1SeatIdSchema.safeParse(plan.seat_id).success) throw new Error('INVALID_FIXTURE_SEAT');
      if (next[plan.seat_id]) throw new Error('DUPLICATE_FIXTURE_SEAT');
      next[plan.seat_id] = plan;
    }
    this.plans = Object.freeze(next);
  }

  async execute(input: SeatInput): Promise<unknown> {
    const plan = this.plans[input.seat_id];
    if (!plan) return { status: 'UNAVAILABLE', reason: 'no fixture configured', execution: unavailableExecution() } satisfies FixtureTerminal;
    const result = plan.round1 as FixtureResult & { delay_ms?: number };
    await wait(result && typeof result === 'object' ? result.delay_ms : undefined);
    return result;
  }

  async respond(input: ChallengeInput): Promise<unknown> {
    const plan = this.plans[input.seat_id];
    const result = plan?.responses?.[input.challenge.challenge_id] as (FixtureResult & { delay_ms?: number }) | undefined;
    if (!result) return { status: 'ABSTAINED', reason: 'fixture did not answer the challenge', execution: abstainedExecution() } satisfies FixtureTerminal;
    await wait(result.delay_ms);
    return result;
  }
}

export function unavailableExecution(): ModelExecution {
  return {
    requested_provider: null, requested_model: null, executed_provider: null, executed_model: null, request_id: null,
    started_at: 'FIXTURE', ended_at: 'FIXTURE', duration_ms: 0, status: 'UNAVAILABLE', model_called: false, independent: false,
    fallback_used: false, fallback_reason: null, failure_stage: 'FIXTURE', failure_reason_code: 'FIXTURE_UNAVAILABLE', diagnostics: { fixture: true },
  };
}

export function abstainedExecution(): ModelExecution {
  return {
    requested_provider: null, requested_model: null, executed_provider: null, executed_model: null, request_id: null,
    started_at: 'FIXTURE', ended_at: 'FIXTURE', duration_ms: 0, status: 'ABSTAINED', model_called: false, independent: false,
    fallback_used: false, fallback_reason: null, failure_stage: 'FIXTURE', failure_reason_code: 'FIXTURE_ABSTAINED', diagnostics: { fixture: true },
  };
}

export function rejectedExecution(code = 'FIXTURE_REJECTED'): ModelExecution {
  return {
    requested_provider: null, requested_model: null, executed_provider: null, executed_model: null, request_id: null,
    started_at: 'FIXTURE', ended_at: 'FIXTURE', duration_ms: 0, status: 'REJECTED', model_called: false, independent: false,
    fallback_used: false, fallback_reason: null, failure_stage: 'VALIDATION', failure_reason_code: code, diagnostics: { fixture: true },
  };
}

export function parseFixtureResult(value: unknown): FixtureResult | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (!['SUCCESS', 'ABSTAINED', 'UNAVAILABLE', 'FAILED', 'REJECTED'].includes(String(candidate.status))) return null;
  if (!ModelExecutionSchema.safeParse(candidate.execution).success) return null;
  if (candidate.status === 'SUCCESS') {
    if (candidate.position !== undefined && !AgentPositionSchema.safeParse(candidate.position).success) return null;
    return candidate as unknown as FixtureSuccess;
  }
  if (typeof candidate.reason !== 'string' || candidate.reason.trim().length === 0) return null;
  return candidate as unknown as FixtureTerminal;
}

export function parseFixtureResponse(value: unknown): FixtureResult | null {
  return parseFixtureResult(value);
}
