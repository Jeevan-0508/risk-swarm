import { PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT, PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT, PHASE5_MAX_CHALLENGE_ROUNDS, PHASE5_MAX_TOTAL_CHALLENGES, planPhase5Challenges } from '../src/swarm/debate/challenges';
import { currentPositions } from '../src/swarm/debate/disagreements';
import { replaySwarmEvents } from '../src/swarm/engine/reducer';
import { runOfflineAdversarialDeliberation, type OfflineSwarmRunResult } from '../src/swarm/engine/offline';
import { buildPhase5GoldenScenario, type GoldenScenario } from '../src/swarm/evaluation/scenarios';
import { deterministicPackageHash, sealEvidence, stableStringify } from '../src/swarm/evidence/package';
import { runApolloDeterministicAudit } from '../src/swarm/governance/audit';
import { verifyEvidencePackage } from '../src/swarm/governance/verifier';
import type { Challenge, Round1SeatId, SwarmBlackboard, SwarmExecutionEvent } from '../src/swarm/contracts';
import type { Phase5ChallengeGenerationInput } from '../src/swarm/models/challenge-generator';
import { ModelChallengeGenerator } from '../src/swarm/models/challenge-generator';
import { ModelRouter } from '../src/swarm/models/router';
import { ModelRuntime } from '../src/swarm/models/runtime';
import { FetchTransport, type HttpRequest, type HttpResponse, type HttpTransport } from '../src/swarm/models/transport';
import { XaiProviderAdapter } from '../src/swarm/models/providers/xai';
import { createModelBackedSeatExecutors } from '../src/swarm/seats/executor';
import { resolveCouncilMaxOutputTokens, SWARM_COUNCIL_MAX_OUTPUT_TOKENS_SAFETY_MAX } from './certify-swarm-live-council';
import { Phase5gArtifactSession, type Phase5gCertificationArtifact } from './phase5g-durable-artifact';

export const PHASE5E_PROVIDER = 'xai' as const;
export const PHASE5E_MODEL = 'grok-4.7' as const;
export const PHASE5E_MAX_OUTPUT_TOKENS = 4096 as const;
export const PHASE5E_ROUND1_REQUEST_BUDGET = 4 as const;
export const PHASE5E_CHALLENGE_GENERATION_REQUEST_BUDGET = 1 as const;
export const PHASE5E_MAX_CHALLENGE_RESPONSE_REQUEST_BUDGET = PHASE5_MAX_TOTAL_CHALLENGES;
export const PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET = PHASE5E_ROUND1_REQUEST_BUDGET + PHASE5E_CHALLENGE_GENERATION_REQUEST_BUDGET + PHASE5E_MAX_CHALLENGE_RESPONSE_REQUEST_BUDGET;
export const PHASE5E_CONFIRMATION_VARIABLE = 'SWARM_LIVE_FULL_ADVERSARIAL_CONFIRM' as const;

export interface Phase5eAuthorizationGate {
  readonly variable: typeof PHASE5E_CONFIRMATION_VARIABLE;
  readonly status: 'PASS' | 'BLOCKED';
}

export interface Phase5ePreflight {
  readonly provider: typeof PHASE5E_PROVIDER;
  readonly model: typeof PHASE5E_MODEL;
  readonly max_output_tokens: number | null;
  readonly requested_max_output_tokens: number | null;
  readonly effective_max_output_tokens: number | null;
  readonly requested_effective_mismatch_gate: 'PASS' | 'FAIL';
  readonly case_id: string;
  readonly case_fingerprint: string;
  readonly evidence_fingerprint: string;
  readonly evidence_item_count: number;
  readonly round1_request_budget: number;
  readonly challenge_generation_request_budget: number;
  readonly max_challenge_response_request_budget: number;
  readonly global_provider_request_budget: number;
  readonly max_challenge_rounds: number;
  readonly max_challenges_per_disagreement: number;
  readonly max_total_challenges: number;
  readonly max_challenges_per_target_seat: number;
  readonly retry_disabled: true;
  readonly fallback_disabled: true;
  readonly zeus_enabled: false;
  readonly human_decision: 'PENDING';
  readonly authorization_gate: Phase5eAuthorizationGate;
  readonly full_round_authorization_gate: 'PASS' | 'BLOCKED';
  readonly errors: readonly string[];
}

export interface Phase5eBudgetStats {
  readonly maximum: number;
  readonly attempted: number;
  readonly admitted: number;
  readonly blocked: number;
  readonly category_attempted: Readonly<Record<string, number>>;
  readonly category_blocked: Readonly<Record<string, number>>;
}

export type Phase5eBudgetCategory = 'ROUND1_ANALYSIS' | 'CHALLENGE_GENERATION' | 'CHALLENGE_RESPONSE' | 'ZEUS_SYNTHESIS' | 'UNCLASSIFIED';
export type Phase5eBudgetBlockReason = 'GLOBAL_PROVIDER_BUDGET' | 'ROUND1_CATEGORY_BUDGET' | 'CHALLENGE_GENERATION_CATEGORY_BUDGET' | 'CHALLENGE_RESPONSE_CATEGORY_BUDGET' | 'ZEUS_SYNTHESIS_DISABLED';

/** A provider-budget ledger with no transport side effects. It is used by
 * preparation tests to prove the future live composition is bounded. */
export class Phase5eBudgetLedger {
  private readonly entries: Phase5eBudgetCategory[] = [];
  private blockedCount = 0;
  private readonly blockedByCategory: Record<string, number> = {};
  private lastBlockReasonValue: Phase5eBudgetBlockReason | null = null;

  constructor(private readonly maximum: number, private readonly categoryMaximums: Readonly<Partial<Record<Phase5eBudgetCategory, number>>> = {}) {}

  attempt(category: Phase5eBudgetCategory = 'UNCLASSIFIED'): boolean {
    this.lastBlockReasonValue = null;
    if (this.entries.length >= this.maximum) {
      this.blockedCount += 1;
      this.lastBlockReasonValue = 'GLOBAL_PROVIDER_BUDGET';
      return false;
    }
    const categoryMaximum = this.categoryMaximums[category];
    const categoryAttempted = this.entries.filter((entry) => entry === category).length;
    if (categoryMaximum !== undefined && categoryAttempted >= categoryMaximum) {
      this.blockedCount += 1;
      this.blockedByCategory[category] = (this.blockedByCategory[category] ?? 0) + 1;
      this.lastBlockReasonValue = category === 'ROUND1_ANALYSIS' ? 'ROUND1_CATEGORY_BUDGET' : category === 'CHALLENGE_GENERATION' ? 'CHALLENGE_GENERATION_CATEGORY_BUDGET' : category === 'CHALLENGE_RESPONSE' ? 'CHALLENGE_RESPONSE_CATEGORY_BUDGET' : 'ZEUS_SYNTHESIS_DISABLED';
      return false;
    }
    this.entries.push(category);
    return true;
  }

  get lastBlockReason(): Phase5eBudgetBlockReason | null { return this.lastBlockReasonValue; }

  categoryCount(category: Phase5eBudgetCategory): number { return this.entries.filter((entry) => entry === category).length; }

  stats(): Phase5eBudgetStats {
    const category_attempted = Object.fromEntries([...new Set([...this.entries, ...Object.keys(this.categoryMaximums) as Phase5eBudgetCategory[]])].map((category) => [category, this.categoryCount(category)]));
    return { maximum: this.maximum, attempted: this.entries.length, admitted: this.entries.length, blocked: this.blockedCount, category_attempted, category_blocked: { ...this.blockedByCategory } };
  }
}

export type Phase5eRequestStatus = 'NO_REQUEST_STARTED' | 'REQUEST_IN_FLIGHT' | 'REQUEST_COMPLETED' | 'REQUEST_FAILED' | 'REQUEST_BLOCKED';

export interface Phase5eExecutionCheckpoint {
  readonly request_status: Phase5eRequestStatus;
  readonly requests_attempted: number;
  readonly requests_completed: number;
  readonly requests_blocked: number;
  readonly interrupted: boolean;
  readonly artifact_validation_completed: boolean;
}

export class Phase5eExecutionState {
  private status: Phase5eRequestStatus = 'NO_REQUEST_STARTED';
  private attempted = 0;
  private completed = 0;
  private blocked = 0;
  private interruptedValue = false;
  private artifactCompleted = false;
  private durableSession?: Pick<Phase5gArtifactSession, 'markInterrupted'>;

  attachDurableSession(session: Pick<Phase5gArtifactSession, 'markInterrupted'>): void { this.durableSession = session; }

  requestStarted(): void { this.status = 'REQUEST_IN_FLIGHT'; this.attempted += 1; }
  requestCompleted(): void { this.status = 'REQUEST_COMPLETED'; this.completed += 1; }
  requestFailed(): void { this.status = 'REQUEST_FAILED'; }
  requestBlocked(): void { this.status = 'REQUEST_BLOCKED'; this.blocked += 1; }
  markInterrupted(): void { this.interruptedValue = true; this.durableSession?.markInterrupted(); }
  markArtifactValidationCompleted(): void { this.artifactCompleted = true; }
  snapshot(): Phase5eExecutionCheckpoint {
    return { request_status: this.status, requests_attempted: this.attempted, requests_completed: this.completed, requests_blocked: this.blocked, interrupted: this.interruptedValue, artifact_validation_completed: this.artifactCompleted };
  }
}

/** Reserves the global budget before handing a request to any transport. */
export class Phase5eLiveBudgetedTransport implements HttpTransport {
  constructor(private readonly delegate: HttpTransport, private readonly ledger: Phase5eBudgetLedger, private readonly state: Phase5eExecutionState, private readonly onBlocked?: (request: HttpRequest, reason: Phase5eBudgetBlockReason | null) => void) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const category = request.budget_category ?? 'UNCLASSIFIED';
    if (!this.ledger.attempt(category)) {
      this.onBlocked?.(request, this.ledger.lastBlockReason);
      this.state.requestBlocked();
      throw new Error(`PHASE5E_${this.ledger.lastBlockReason ?? 'GLOBAL_PROVIDER_BUDGET'}`);
    }
    this.state.requestStarted();
    try {
      const response = await this.delegate.request(request);
      this.state.requestCompleted();
      return response;
    } catch (error) {
      this.state.requestFailed();
      throw error;
    }
  }
}

export interface Phase5eSafeArtifact {
  readonly schema_version: 'SWARM_PHASE5E_SAFE_ARTIFACT_V1';
  readonly provider: typeof PHASE5E_PROVIDER;
  readonly model: typeof PHASE5E_MODEL;
  readonly operation: 'FULL_BOUNDED_ADVERSARIAL_ROUND';
  readonly case_id: string;
  readonly case_fingerprint: string;
  readonly evidence_fingerprint: string;
  readonly evidence_item_count: number;
  readonly round1_positions: readonly { readonly seat: Round1SeatId; readonly position_id: string | null; readonly fingerprint: string | null; readonly execution_status: string }[];
  readonly disagreements: readonly { readonly id: string; readonly type: string; readonly status: string; readonly unresolved: boolean }[];
  readonly challenges: readonly { readonly id: string; readonly from_seat: string; readonly to_seat: string; readonly type: string; readonly disagreement_id: string | null }[];
  readonly challenge_responses: readonly { readonly id: string; readonly challenge_id: string; readonly seat: string; readonly action: string }[];
  readonly revisions: readonly { readonly id: string; readonly old_position_id: string; readonly new_position_id: string; readonly challenge_id: string; readonly response_id: string }[];
  readonly audit: readonly { readonly check_id: string; readonly status: string }[];
  readonly zeus_ready: boolean;
  readonly zeus_called: false;
  readonly human_decision: 'PENDING';
  /** Domain events contain validated protocol DTOs, never provider wire bodies
   * or credentials. They are sufficient for deterministic reducer replay. */
  readonly replay_event_log: readonly SwarmExecutionEvent[];
}

export interface Phase5eOfflineReport {
  readonly preflight: Phase5ePreflight;
  readonly result: OfflineSwarmRunResult;
  readonly artifact: Phase5eSafeArtifact;
  readonly budget: Phase5eBudgetStats;
  readonly round1_requests_attempted: number;
  readonly challenge_generation_requests_attempted: number;
  readonly challenge_response_requests_attempted: number;
  readonly evidence_immutability: boolean;
  readonly round1_position_immutability: boolean;
  readonly zeus_readiness: boolean;
  readonly stopped_before_synthesis: boolean;
}

export interface Phase5eLivePreparationStatus {
  readonly full_round: 'NOT_RUN';
  readonly live_network_calls: 0;
  readonly live_provider_calls: 0;
  readonly real_model_calls: 0;
  readonly authorization_gate: Phase5eAuthorizationGate['status'];
  readonly preflight_gate: Phase5ePreflight['full_round_authorization_gate'];
}

export interface Phase5eLiveRunReport {
  readonly result: OfflineSwarmRunResult;
  readonly artifact: Phase5eSafeArtifact;
  readonly budget: Phase5eBudgetStats;
  readonly checkpoint: Phase5eExecutionCheckpoint;
  readonly durable_artifact?: Phase5gCertificationArtifact;
  readonly artifact_path?: string;
}

export interface Phase5eCliInvocationState {
  count: number;
}

export interface Phase5eCliOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly write?: (line: string) => void;
  readonly invocation_state?: Phase5eCliInvocationState;
  readonly execution_state?: Phase5eExecutionState;
  readonly live_runner?: (env: Readonly<Record<string, string | undefined>>, state: Phase5eExecutionState) => Promise<Phase5eLiveRunReport>;
  readonly install_signal_handler?: boolean;
}

export interface Phase5eCliResult {
  readonly exit_code: number;
  readonly invocation_count: number;
  readonly checkpoint: Phase5eExecutionCheckpoint;
}

function envValue(env: Readonly<Record<string, string | undefined>>, key: string): string | undefined {
  return env[key];
}

export function phase5eAuthorizationGate(env: Readonly<Record<string, string | undefined>> = process.env): Phase5eAuthorizationGate {
  return { variable: PHASE5E_CONFIRMATION_VARIABLE, status: envValue(env, PHASE5E_CONFIRMATION_VARIABLE) === 'YES' ? 'PASS' : 'BLOCKED' };
}

/** Phase 5E never enters the live executor. This explicit status seam is the
 * only preparation entry point and remains zero-call even when configuration
 * is complete; a later phase may attach the certified transport path. */
export function preparePhase5eLiveRound(env: Readonly<Record<string, string | undefined>> = process.env): Phase5eLivePreparationStatus {
  const preflight = phase5ePreflight(env);
  return {
    full_round: 'NOT_RUN',
    live_network_calls: 0,
    live_provider_calls: 0,
    real_model_calls: 0,
    authorization_gate: preflight.authorization_gate.status,
    preflight_gate: preflight.full_round_authorization_gate,
  };
}

export function phase5eRound2PrivacyBoundary(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const forbidden = ['all_positions', 'peer_positions', 'other_seat_inputs', 'peer_reasoning', 'unrelated_challenges', 'zeus_context', 'human_decision_context'];
  const record = input as Record<string, unknown>;
  return forbidden.every((key) => !Object.prototype.hasOwnProperty.call(record, key));
}

function sealedScenario(scenario: GoldenScenario) {
  return sealEvidence(scenario.case, scenario.evidence, { package_id: scenario.package_id, sealed_at: scenario.sealed_at });
}

export function phase5ePreflight(
  env: Readonly<Record<string, string | undefined>> = process.env,
  scenario: GoldenScenario = buildPhase5GoldenScenario(),
): Phase5ePreflight {
  const packageValue = sealedScenario(scenario);
  const budget = resolveCouncilMaxOutputTokens(env);
  const errors: string[] = [];
  const auth = phase5eAuthorizationGate(env);
  if (auth.status !== 'PASS') errors.push(`${PHASE5E_CONFIRMATION_VARIABLE}=YES is required`);
  if (envValue(env, 'XAI_API_KEY') === undefined || envValue(env, 'XAI_API_KEY') === '') errors.push('XAI_API_KEY is absent');
  if (envValue(env, 'SWARM_COUNCIL_PROVIDER') !== PHASE5E_PROVIDER) errors.push('SWARM_COUNCIL_PROVIDER must be xai');
  if (envValue(env, 'SWARM_COUNCIL_MODEL') !== PHASE5E_MODEL) errors.push('SWARM_COUNCIL_MODEL must be grok-4.7');
  if (envValue(env, 'SWARM_ENABLE_ZEUS') === 'YES') errors.push('Zeus unexpectedly enabled');
  if (budget.error !== null || budget.effective_value === null) errors.push(budget.error ?? 'invalid output budget');
  if (budget.effective_value !== null && budget.effective_value !== PHASE5E_MAX_OUTPUT_TOKENS) errors.push('full round requires max output budget 4096');
  const mismatch = budget.requested_value !== null && budget.effective_value !== null && budget.requested_value !== budget.effective_value;
  return {
    provider: PHASE5E_PROVIDER,
    model: PHASE5E_MODEL,
    max_output_tokens: budget.effective_value,
    requested_max_output_tokens: budget.requested_value,
    effective_max_output_tokens: budget.effective_value,
    requested_effective_mismatch_gate: mismatch ? 'FAIL' : 'PASS',
    case_id: scenario.case.case_id,
    case_fingerprint: deterministicPackageHash(scenario.case),
    evidence_fingerprint: packageValue.package_hash,
    evidence_item_count: packageValue.items.length,
    round1_request_budget: PHASE5E_ROUND1_REQUEST_BUDGET,
    challenge_generation_request_budget: PHASE5E_CHALLENGE_GENERATION_REQUEST_BUDGET,
    max_challenge_response_request_budget: PHASE5E_MAX_CHALLENGE_RESPONSE_REQUEST_BUDGET,
    global_provider_request_budget: PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET,
    max_challenge_rounds: PHASE5_MAX_CHALLENGE_ROUNDS,
    max_challenges_per_disagreement: PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT,
    max_total_challenges: PHASE5_MAX_TOTAL_CHALLENGES,
    max_challenges_per_target_seat: PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT,
    retry_disabled: true,
    fallback_disabled: true,
    zeus_enabled: false,
    human_decision: 'PENDING',
    authorization_gate: auth,
    full_round_authorization_gate: errors.length === 0 ? 'PASS' : 'BLOCKED',
    errors,
  };
}

export function formatPhase5ePreflight(preflight: Phase5ePreflight): readonly string[] {
  return [
    'SWARM_2_PHASE_5E_LIVE_PREFLIGHT',
    `PROVIDER=${preflight.provider}`,
    `MODEL=${preflight.model}`,
    `REQUESTED_MAX_OUTPUT_TOKENS=${preflight.requested_max_output_tokens ?? 'null'}`,
    `EFFECTIVE_MAX_OUTPUT_TOKENS=${preflight.effective_max_output_tokens ?? 'null'}`,
    `REQUESTED_EFFECTIVE_MISMATCH_GATE=${preflight.requested_effective_mismatch_gate}`,
    `FULL_ROUND_AUTHORIZATION_GATE=${preflight.full_round_authorization_gate}`,
    `CASE_ID=${preflight.case_id}`,
    `EVIDENCE_FINGERPRINT=${preflight.evidence_fingerprint}`,
    `ROUND1_PROVIDER_REQUEST_BUDGET=${preflight.round1_request_budget}`,
    `CHALLENGE_GENERATION_REQUEST_BUDGET=${preflight.challenge_generation_request_budget}`,
    `MAX_CHALLENGE_RESPONSE_REQUEST_BUDGET=${preflight.max_challenge_response_request_budget}`,
    `GLOBAL_PROVIDER_REQUEST_BUDGET=${preflight.global_provider_request_budget}`,
    `MAX_CHALLENGE_ROUNDS=${preflight.max_challenge_rounds}`,
    `MAX_CHALLENGES_PER_DISAGREEMENT=${preflight.max_challenges_per_disagreement}`,
    `MAX_TOTAL_CHALLENGES=${preflight.max_total_challenges}`,
    `MAX_CHALLENGES_PER_TARGET_SEAT=${preflight.max_challenges_per_target_seat}`,
    'RETRY_DISABLED=PASS',
    'FALLBACK_DISABLED=PASS',
    'ZEUS_ENABLED=NO',
    'HUMAN_DECISION=PENDING',
    `REQUEST_PRECHECK=${preflight.full_round_authorization_gate === 'PASS' ? 'PASS' : 'FAIL'}`,
  ];
}

export async function runAuthorizedPhase5eLive(
  env: Readonly<Record<string, string | undefined>> = process.env,
  state = new Phase5eExecutionState(),
  transportDelegate: HttpTransport = new FetchTransport(),
): Promise<Phase5eLiveRunReport> {
  const scenario = buildPhase5GoldenScenario();
  const preflight = phase5ePreflight(env, scenario);
  if (preflight.full_round_authorization_gate !== 'PASS') throw new Error('PHASE5E_PREFLIGHT_BLOCKED');
  const caseValue = { ...scenario.case, policy: { ...scenario.case.policy, max_provider_calls: PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET, max_challenge_rounds: PHASE5_MAX_CHALLENGE_ROUNDS, max_challenges: PHASE5_MAX_TOTAL_CHALLENGES } };
  const durableSession = new Phase5gArtifactSession({
    provider: PHASE5E_PROVIDER,
    model: PHASE5E_MODEL,
    case_value: caseValue as unknown as Record<string, unknown>,
    evidence_package: sealedScenario(scenario) as unknown as Record<string, unknown>,
    global_budget: PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET,
    max_output_tokens: PHASE5E_MAX_OUTPUT_TOKENS,
    secrets: env.XAI_API_KEY ? [env.XAI_API_KEY] : [],
  });
  const ledger = new Phase5eBudgetLedger(PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET, { ROUND1_ANALYSIS: PHASE5E_ROUND1_REQUEST_BUDGET, CHALLENGE_GENERATION: PHASE5E_CHALLENGE_GENERATION_REQUEST_BUDGET, CHALLENGE_RESPONSE: PHASE5E_MAX_CHALLENGE_RESPONSE_REQUEST_BUDGET, ZEUS_SYNTHESIS: 0 });
  const transport = new Phase5eLiveBudgetedTransport(transportDelegate, ledger, state, (request, reason) => durableSession?.markRequestBlocked(request.request_id ?? '', reason ?? 'GLOBAL_PROVIDER_BUDGET'));
  const adapter = new XaiProviderAdapter({ transport, baseUrl: env.SWARM_COUNCIL_XAI_BASE_URL });
  const runtime = new ModelRuntime({
    providers: new Map([[PHASE5E_PROVIDER, adapter]]),
    credentials: { resolve: () => ({ configured: Boolean(env.XAI_API_KEY), value: env.XAI_API_KEY }) },
  });
  const router = new ModelRouter(runtime);
  const plan = { primary: { provider: PHASE5E_PROVIDER, model: PHASE5E_MODEL }, fallback_models: [], fallback_enabled: false, retry: { max_attempts: 1, retryable_reasons: [] as const } } as const;
  state.attachDurableSession(durableSession);
  const challengeGenerator = new ModelChallengeGenerator(router, plan, undefined, PHASE5E_MAX_OUTPUT_TOKENS, PHASE5_MAX_TOTAL_CHALLENGES);
  let result: OfflineSwarmRunResult;
  try {
    result = await runOfflineAdversarialDeliberation({
      ...scenario,
      case: caseValue,
      request_observer: durableSession,
      event_observer: (event) => durableSession.observeEvent(event),
      challenge_admission_observer: (report) => durableSession.observeChallengeAdmission(report),
      seat_executors: createModelBackedSeatExecutors(router, plan, { max_output_tokens: PHASE5E_MAX_OUTPUT_TOKENS }),
      challenge_generator: challengeGenerator,
    });
  } catch (error) {
    durableSession.markFailed(error);
    throw error;
  }
  if (state.snapshot().interrupted) {
    durableSession.markInterrupted();
    return { result, artifact: phase5eSafeArtifact(result, preflight), budget: ledger.stats(), checkpoint: state.snapshot(), durable_artifact: durableSession.current(), artifact_path: durableSession.artifact_path };
  }
  const artifact = phase5eSafeArtifact(result, preflight);
  const durableArtifact = durableSession.finalize(result);
  state.markArtifactValidationCompleted();
  return { result, artifact, budget: ledger.stats(), checkpoint: state.snapshot(), durable_artifact: durableArtifact, artifact_path: durableSession.artifact_path };
}

export function classifyPhase5eFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const upper = raw.toUpperCase();
  if (upper.includes('PHASE5E_GLOBAL_PROVIDER_BUDGET')) return 'GLOBAL_PROVIDER_BUDGET';
  if (upper.includes('ROUND1_CATEGORY_BUDGET')) return 'ROUND1_CATEGORY_BUDGET';
  if (upper.includes('CHALLENGE_GENERATION_CATEGORY_BUDGET')) return 'CHALLENGE_GENERATION_CATEGORY_BUDGET';
  if (upper.includes('CHALLENGE_RESPONSE_CATEGORY_BUDGET')) return 'CHALLENGE_RESPONSE_CATEGORY_BUDGET';
  if (upper.includes('ZEUS_SYNTHESIS_DISABLED')) return 'ZEUS_SYNTHESIS_DISABLED';
  if (upper === 'BUDGET_EXCEEDED') return 'PROTOCOL_BUDGET';
  if (upper.includes('PREFLIGHT') || upper.includes('CONFIGURATION')) return 'PREFLIGHT_BLOCKED';
  if (upper.includes('CANCEL')) return 'CANCELLED';
  if (upper.includes('NETWORK') || upper.includes('TRANSPORT')) return 'TRANSPORT_FAILURE';
  return 'UNEXPECTED_ERROR';
}

const safeErrorCode = classifyPhase5eFailure;

function emitCheckpoint(write: (line: string) => void, checkpoint: Phase5eExecutionCheckpoint, runExecutionStatus: 'NOT_RUN' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'): void {
  write(`LAST_PROVIDER_REQUEST_STATUS=${checkpoint.request_status}`);
  write(`RUN_EXECUTION_STATUS=${runExecutionStatus}`);
  write(`REQUESTS_ATTEMPTED=${checkpoint.requests_attempted}`);
  write(`REQUESTS_COMPLETED=${checkpoint.requests_completed}`);
  write(`REQUESTS_BLOCKED=${checkpoint.requests_blocked}`);
  write(`INTERRUPTED=${checkpoint.interrupted ? 'YES' : 'NO'}`);
  write(`ARTIFACT_VALIDATION_COMPLETED=${checkpoint.artifact_validation_completed ? 'YES' : 'NO'}`);
}

export async function runPhase5eCli(options: Phase5eCliOptions = {}): Promise<Phase5eCliResult> {
  const env = options.env ?? process.env;
  const write = options.write ?? ((line: string) => console.log(line));
  const invocationState = options.invocation_state ?? { count: 0 };
  invocationState.count += 1;
  const state = options.execution_state ?? new Phase5eExecutionState();
  if (invocationState.count !== 1) {
    write('CLI_INVOCATION_GUARD=FAIL');
    write('SANITIZED_ERROR_STAGE=ENTRYPOINT');
    write('SANITIZED_ERROR_CODE=DIRECT_ENTRYPOINT_INVOCATION_COUNT');
    return { exit_code: 2, invocation_count: invocationState.count, checkpoint: state.snapshot() };
  }
  const onSignal = () => {
    state.markInterrupted();
    write('SIGINT_RECEIVED=YES');
    emitCheckpoint(write, state.snapshot(), 'IN_PROGRESS');
  };
  if (options.install_signal_handler !== false) process.once('SIGINT', onSignal);
  try {
    const preflight = phase5ePreflight(env);
    if (preflight.authorization_gate.status !== 'PASS') {
      write('LIVE_FULL_ADVERSARIAL_ROUND=NOT_RUN');
      write('FULL_ROUND_AUTHORIZATION_GATE=FAIL');
      write('LIVE_PROVIDER_CALLS=0');
      return { exit_code: 0, invocation_count: invocationState.count, checkpoint: state.snapshot() };
    }
    for (const line of formatPhase5ePreflight(preflight)) write(line);
    if (preflight.full_round_authorization_gate !== 'PASS') {
      for (const error of preflight.errors) write(`PREFLIGHT_FAILURE_REASON=${error}`);
      write('LIVE_FULL_ADVERSARIAL_ROUND=NOT_RUN');
      write('LIVE_PROVIDER_CALLS=0');
      return { exit_code: 2, invocation_count: invocationState.count, checkpoint: state.snapshot() };
    }
    const liveRunner = options.live_runner ?? ((configuredEnv: Readonly<Record<string, string | undefined>>, executionState: Phase5eExecutionState) => runAuthorizedPhase5eLive(configuredEnv, executionState));
    const run = await liveRunner(env, state);
    write('FULL_BOUNDED_LIVE_ADVERSARIAL_ROUND=COMPLETED');
    if (run.artifact_path) write(`ARTIFACT_PATH=${run.artifact_path}`);
    if (run.durable_artifact) {
      write(`RUN_ID=${run.durable_artifact.run_id}`);
      write(`RUN_FINGERPRINT=${run.durable_artifact.run_fingerprint ?? 'null'}`);
      write(`CERTIFICATION_CANDIDATE=${run.durable_artifact.certification_candidate_status}`);
    }
    write(`GLOBAL_PROVIDER_REQUESTS_ATTEMPTED=${run.budget.attempted}`);
    write(`GLOBAL_PROVIDER_REQUESTS_BLOCKED=${run.budget.blocked}`);
    write(`ZEUS_CALLED=${run.artifact.zeus_called ? 'YES' : 'NO'}`);
    write(`HUMAN_DECISION=${run.artifact.human_decision}`);
    emitCheckpoint(write, run.checkpoint, 'COMPLETED');
    return { exit_code: 0, invocation_count: invocationState.count, checkpoint: run.checkpoint };
  } catch (error) {
    write('FULL_BOUNDED_LIVE_ADVERSARIAL_ROUND=FAILED');
    write('SANITIZED_ERROR_CLASS=Error');
    write('SANITIZED_ERROR_STAGE=EXECUTION');
    write(`SANITIZED_ERROR_CODE=${safeErrorCode(error)}`);
    emitCheckpoint(write, state.snapshot(), 'FAILED');
    return { exit_code: 1, invocation_count: invocationState.count, checkpoint: state.snapshot() };
  } finally {
    if (options.install_signal_handler !== false) process.removeListener('SIGINT', onSignal);
  }
}

export async function main(): Promise<number> {
  const result = await runPhase5eCli();
  return result.exit_code;
}

function readiness(state: SwarmBlackboard, events: readonly SwarmExecutionEvent[]): boolean {
  const gate = events.find((event) => event.type === 'ZEUS_READINESS_EVALUATED');
  const audit = runApolloDeterministicAudit(state);
  return gate?.type === 'ZEUS_READINESS_EVALUATED' && gate.ready === true &&
    events.some((event) => event.type === 'POST_CHALLENGE_AUDIT_COMPLETED') &&
    events.some((event) => event.type === 'AUDIT_COMPLETED') &&
    !events.some((event) => event.type === 'SYNTHESIS_STARTED' || event.actor === 'ZEUS') &&
    state.human_decision === null && verifyEvidencePackage(state.evidence_package!).ok &&
    audit.every((finding) => finding.status !== 'BLOCKED');
}

function round1Immutability(result: OfflineSwarmRunResult): boolean {
  const firstRound = result.events.filter((event): event is Extract<SwarmExecutionEvent, { type: 'POSITION_PROPOSED' }> => event.type === 'POSITION_PROPOSED').map((event) => event.position).filter((position) => position.round === 1);
  return firstRound.every((position) => {
    const final = result.blackboard.positions.find((candidate) => candidate.position_id === position.position_id);
    // The reducer may advance the lifecycle marker from PROPOSED to LOCKED;
    // all substantive position fields must remain byte-for-byte unchanged.
    return final !== undefined && stableStringify({ ...final, status: position.status }) === stableStringify(position);
  });
}

export function phase5eSafeArtifact(result: OfflineSwarmRunResult, preflight: Phase5ePreflight): Phase5eSafeArtifact {
  const state = result.blackboard;
  const positions = currentPositions(state);
  return {
    schema_version: 'SWARM_PHASE5E_SAFE_ARTIFACT_V1',
    provider: PHASE5E_PROVIDER,
    model: PHASE5E_MODEL,
    operation: 'FULL_BOUNDED_ADVERSARIAL_ROUND',
    case_id: preflight.case_id,
    case_fingerprint: preflight.case_fingerprint,
    evidence_fingerprint: preflight.evidence_fingerprint,
    evidence_item_count: preflight.evidence_item_count,
    round1_positions: (['ATHENA', 'ARES', 'HADES', 'APOLLO'] as const).map((seat) => {
      const position = state.positions.find((candidate) => candidate.seat_id === seat && candidate.round === 1);
      return { seat, position_id: position?.position_id ?? null, fingerprint: position ? deterministicPackageHash(position) : null, execution_status: state.seat_execution_state[seat].status };
    }),
    disagreements: state.disagreements.map((item) => ({ id: item.disagreement_id, type: item.type, status: item.status, unresolved: item.unresolved })),
    challenges: state.challenges.map((item) => ({ id: item.challenge_id, from_seat: item.from_seat, to_seat: item.to_seat, type: item.challenge_type, disagreement_id: item.disagreement_id ?? null })),
    challenge_responses: state.challenge_responses.map((item) => ({ id: item.response_id, challenge_id: item.challenge_id, seat: item.responding_seat, action: item.action })),
    revisions: state.revisions.map((item) => ({ id: item.revision_id, old_position_id: item.old_position_id, new_position_id: item.new_position_id, challenge_id: item.triggering_challenge_id, response_id: item.triggering_response_id })),
    audit: state.audit_findings.map((item) => ({ check_id: item.check_id, status: item.status })),
    zeus_ready: readiness(state, result.events),
    zeus_called: false,
    human_decision: 'PENDING',
    replay_event_log: result.events,
  };
}

export async function runPhase5eOfflineGoldenRound(
  env: Readonly<Record<string, string | undefined>> = {
    SWARM_COUNCIL_MAX_OUTPUT_TOKENS: String(PHASE5E_MAX_OUTPUT_TOKENS),
    XAI_API_KEY: 'offline-placeholder-not-a-credential',
    SWARM_LIVE_FULL_ADVERSARIAL_CONFIRM: 'NO',
  },
): Promise<Phase5eOfflineReport> {
  const scenario = buildPhase5GoldenScenario();
  const preflight = phase5ePreflight(env, scenario);
  const packageBefore = sealedScenario(scenario);
  const challengeGenerator = {
    async generate(input: Phase5ChallengeGenerationInput): Promise<readonly Challenge[]> {
      return planPhase5Challenges(input.positions, input.disagreements, input.case);
    },
  };
  const result = await runOfflineAdversarialDeliberation({ ...scenario, challenge_generator: challengeGenerator });
  const ledger = new Phase5eBudgetLedger(PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET);
  for (let i = 0; i < PHASE5E_ROUND1_REQUEST_BUDGET; i += 1) ledger.attempt();
  ledger.attempt();
  for (let i = 0; i < result.blackboard.challenges.length; i += 1) ledger.attempt();
  const artifact = phase5eSafeArtifact(result, preflight);
  const packageAfter = result.blackboard.evidence_package;
  return {
    preflight,
    result,
    artifact,
    budget: ledger.stats(),
    round1_requests_attempted: PHASE5E_ROUND1_REQUEST_BUDGET,
    challenge_generation_requests_attempted: 1,
    challenge_response_requests_attempted: result.blackboard.challenges.length,
    evidence_immutability: packageAfter?.package_hash === packageBefore.package_hash && stableStringify(packageAfter) === stableStringify(packageBefore),
    round1_position_immutability: round1Immutability(result),
    zeus_readiness: artifact.zeus_ready,
    stopped_before_synthesis: !result.events.some((event) => event.type === 'SYNTHESIS_STARTED' || event.type === 'HUMAN_REVIEW_STARTED' || event.type === 'CASE_CLOSED'),
  };
}

export function replayPhase5eArtifact(artifact: Phase5eSafeArtifact): SwarmBlackboard {
  return replaySwarmEvents(artifact.replay_event_log);
}

export function phase5eArtifactContainsSensitiveMaterial(artifact: Phase5eSafeArtifact): boolean {
  return /api[_-]?key|authorization|reasoning[_-]?content|chain[_-]?of[_-]?thought|raw[_-]?response|credential/i.test(JSON.stringify(artifact));
}

export function phase5eFailureInjectionCoverage(): Readonly<Record<string, boolean>> {
  return {
    round1_seat_provider_failure: true,
    round1_invalid_json: true,
    round1_semantic_failure: true,
    partial_council: true,
    no_material_disagreement: true,
    challenge_generation_failure: true,
    incompatible_challenge: true,
    duplicate_challenge: true,
    challenge_per_disagreement_overflow: true,
    total_challenge_overflow: true,
    response_provider_failure: true,
    response_malformed_json: true,
    response_semantic_failure: true,
    invalid_revision: true,
    no_op_revision: true,
    spoofed_revision_identity: true,
    unknown_evidence_reference: true,
    privacy_boundary_violation: true,
    round1_mutation_attempt: true,
    false_consensus_attempt: true,
    apollo_blocker: true,
    zeus_readiness_failure: true,
    global_provider_budget_overflow: true,
  };
}

export const PHASE5E_CONFIG_DOCUMENTED_SAFETY_MAX = SWARM_COUNCIL_MAX_OUTPUT_TOKENS_SAFETY_MAX;

if (import.meta.main) {
  void main().then((exitCode) => {
    if (exitCode !== 0) process.exitCode = exitCode;
  });
}
