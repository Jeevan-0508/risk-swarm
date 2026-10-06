import { buildCertifiedPhase6Scenario } from '../src/swarm/evaluation/scenarios';
import { runOfflineAdversarialDeliberation } from '../src/swarm/engine/offline';
import { assessZeusReadiness, buildZeusInput, ZEUS_PROMPT_VERSION } from '../src/swarm/governance/zeus';
import type { HttpTransport } from '../src/swarm/models/transport';
import { resolveCouncilMaxOutputTokens, SWARM_COUNCIL_MAX_OUTPUT_TOKENS_SAFETY_MAX } from './certify-swarm-live-council';

export const PHASE6B_PROVIDER = 'xai' as const;
export const PHASE6B_MODEL = 'grok-4.7' as const;
export const PHASE6B_CONFIRMATION_VARIABLE = 'SWARM_LIVE_ZEUS_SYNTHESIS_CONFIRM' as const;
export const PHASE6B_REQUEST_BUDGET = 1 as const;
export const PHASE6B_EXPECTED_INPUT_FINGERPRINT = 'fnv1a:b2b37683' as const;
export const PHASE6B_HISTORICAL_BLOCKING_GATE = 'CREDENTIAL_PRESENCE' as const;

export type Phase6bGateStatus = 'PASS' | 'BLOCKED';

export interface Phase6bGate {
  readonly name: string;
  readonly status: Phase6bGateStatus;
  readonly reason?: string;
}

export interface Phase6bPreflight {
  readonly provider: typeof PHASE6B_PROVIDER;
  readonly model: typeof PHASE6B_MODEL;
  readonly zeus_prompt_version: typeof ZEUS_PROMPT_VERSION;
  readonly input_fingerprint: string | null;
  readonly expected_input_fingerprint: typeof PHASE6B_EXPECTED_INPUT_FINGERPRINT;
  readonly readiness: 'PASS' | 'BLOCKED';
  readonly human_decision: 'PENDING';
  readonly requested_max_output_tokens: number | null;
  readonly effective_max_output_tokens: number | null;
  readonly output_budget_safety_max: number;
  readonly credential_available: 'YES' | 'NO';
  readonly authorization_gate: Phase6bGateStatus;
  readonly request_budget: 1;
  readonly retry_disabled: true;
  readonly fallback_disabled: true;
  readonly gates: readonly Phase6bGate[];
  readonly request_precheck: 'PASS' | 'BLOCKED';
  readonly blocking_gate: string | null;
}

export interface Phase6bPreparationStatus {
  readonly phase6b: 'NOT_RUN';
  readonly preflight: Phase6bPreflight;
  readonly transport_entered: false;
  readonly live_network_calls: 0;
  readonly live_provider_calls: 0;
  readonly real_model_calls: 0;
  readonly requests_attempted: 0;
  readonly requests_completed: 0;
  readonly requests_blocked: 0 | 1;
}

export interface Phase6bRequestBudgetStats {
  readonly maximum: 1;
  readonly attempted: number;
  readonly blocked: number;
}

/** The Zeus live gate is intentionally independent from Phase 5 authorization. */
export function phase6bAuthorizationGate(env: Readonly<Record<string, string | undefined>> = process.env): Phase6bGateStatus {
  return env[PHASE6B_CONFIRMATION_VARIABLE] === 'YES' ? 'PASS' : 'BLOCKED';
}

function gate(name: string, status: Phase6bGateStatus, reason?: string): Phase6bGate {
  return reason === undefined ? { name, status } : { name, status, reason };
}

function credentialPresent(env: Readonly<Record<string, string | undefined>>): boolean {
  return typeof env.XAI_API_KEY === 'string' && env.XAI_API_KEY.length > 0;
}

/**
 * Builds all Phase 6B admission facts without constructing a provider, a
 * request body, or a transport. The environment value is inspected only for
 * presence; its contents never enter the returned diagnostic.
 */
export async function phase6bPreflight(env: Readonly<Record<string, string | undefined>> = process.env): Promise<Phase6bPreflight> {
  const offline = await runOfflineAdversarialDeliberation(buildCertifiedPhase6Scenario());
  const readiness = assessZeusReadiness(offline.blackboard);
  const input = readiness.ready ? buildZeusInput(offline.blackboard, readiness) : null;
  const budget = resolveCouncilMaxOutputTokens(env);
  const auth = phase6bAuthorizationGate(env);
  const hasCredential = credentialPresent(env);
  const gates: Phase6bGate[] = [
    gate('PHASE6A_INPUTS', readiness.ready ? 'PASS' : 'BLOCKED', readiness.ready ? undefined : 'ZEUS_READINESS_BLOCKED'),
    gate('ZEUS_INPUT_FINGERPRINT', input?.input_fingerprint === PHASE6B_EXPECTED_INPUT_FINGERPRINT ? 'PASS' : 'BLOCKED', input ? undefined : 'ZEUS_INPUT_UNAVAILABLE'),
    gate('HUMAN_AUTHORITY', offline.blackboard.human_decision === null ? 'PASS' : 'BLOCKED', offline.blackboard.human_decision === null ? undefined : 'HUMAN_DECISION_ALREADY_SET'),
    gate('PROVIDER_MODEL', env.SWARM_COUNCIL_PROVIDER === PHASE6B_PROVIDER && env.SWARM_COUNCIL_MODEL === PHASE6B_MODEL ? 'PASS' : 'BLOCKED', 'SWARM_COUNCIL_PROVIDER_MODEL_MUST_BE_XAI_GROK_4_7'),
    gate('CREDENTIAL_PRESENCE', hasCredential ? 'PASS' : 'BLOCKED', hasCredential ? undefined : 'XAI_CREDENTIAL_ABSENT'),
    gate('AUTHORIZATION_GATE', auth, auth === 'PASS' ? undefined : `${PHASE6B_CONFIRMATION_VARIABLE}_MUST_BE_YES`),
    gate('OUTPUT_BUDGET', budget.error === null && budget.effective_value !== null ? 'PASS' : 'BLOCKED', budget.error ?? undefined),
    gate('REQUEST_BUDGET', 'PASS'),
    gate('RETRY_POLICY', 'PASS'),
    gate('FALLBACK_POLICY', 'PASS'),
  ];
  const blocking = gates.find((item) => item.status === 'BLOCKED') ?? null;
  return {
    provider: PHASE6B_PROVIDER,
    model: PHASE6B_MODEL,
    zeus_prompt_version: ZEUS_PROMPT_VERSION,
    input_fingerprint: input?.input_fingerprint ?? null,
    expected_input_fingerprint: PHASE6B_EXPECTED_INPUT_FINGERPRINT,
    readiness: readiness.ready ? 'PASS' : 'BLOCKED',
    human_decision: 'PENDING',
    requested_max_output_tokens: budget.requested_value,
    effective_max_output_tokens: budget.effective_value,
    output_budget_safety_max: SWARM_COUNCIL_MAX_OUTPUT_TOKENS_SAFETY_MAX,
    credential_available: hasCredential ? 'YES' : 'NO',
    authorization_gate: auth,
    request_budget: PHASE6B_REQUEST_BUDGET,
    retry_disabled: true,
    fallback_disabled: true,
    gates,
    request_precheck: blocking === null ? 'PASS' : 'BLOCKED',
    blocking_gate: blocking?.name ?? null,
  };
}

/**
 * Phase 6B.1 stops at pretransport even when every gate is satisfied. This is
 * the proof boundary for the later live invocation; it cannot make a network
 * call and does not accept a transport callback.
 */
export async function preparePhase6bLiveZeus(
  env: Readonly<Record<string, string | undefined>> = process.env,
  _transportProbe?: HttpTransport,
): Promise<Phase6bPreparationStatus> {
  const preflight = await phase6bPreflight(env);
  return {
    phase6b: 'NOT_RUN',
    preflight,
    transport_entered: false,
    live_network_calls: 0,
    live_provider_calls: 0,
    real_model_calls: 0,
    requests_attempted: 0,
    requests_completed: 0,
    requests_blocked: preflight.request_precheck === 'BLOCKED' ? 1 : 0,
  };
}

/** One Zeus request is the maximum; a second reservation is always blocked. */
export class Phase6bRequestBudget {
  private attemptedCount = 0;
  private blockedCount = 0;

  reserve(): boolean {
    if (this.attemptedCount >= PHASE6B_REQUEST_BUDGET) {
      this.blockedCount += 1;
      return false;
    }
    this.attemptedCount += 1;
    return true;
  }

  stats(): Phase6bRequestBudgetStats {
    return { maximum: PHASE6B_REQUEST_BUDGET, attempted: this.attemptedCount, blocked: this.blockedCount };
  }
}

export function formatPhase6bPreflight(preflight: Phase6bPreflight): readonly string[] {
  return [
    'SWARM_2_PHASE_6B1_PRETRANSPORT_PREFLIGHT',
    `PROVIDER=${preflight.provider}`,
    `MODEL=${preflight.model}`,
    `ZEUS_PROMPT_VERSION=${preflight.zeus_prompt_version}`,
    `ZEUS_INPUT_FINGERPRINT=${preflight.input_fingerprint ?? 'null'}`,
    `EXPECTED_ZEUS_INPUT_FINGERPRINT=${preflight.expected_input_fingerprint}`,
    `ZEUS_READINESS=${preflight.readiness}`,
    `HUMAN_DECISION=${preflight.human_decision}`,
    `REQUESTED_MAX_OUTPUT_TOKENS=${preflight.requested_max_output_tokens ?? 'null'}`,
    `EFFECTIVE_MAX_OUTPUT_TOKENS=${preflight.effective_max_output_tokens ?? 'null'}`,
    `OUTPUT_BUDGET_SAFETY_MAX=${preflight.output_budget_safety_max}`,
    `XAI_CREDENTIAL_AVAILABLE=${preflight.credential_available}`,
    `AUTHORIZATION_GATE=${preflight.authorization_gate}`,
    `REQUEST_BUDGET=${preflight.request_budget}`,
    'RETRY_DISABLED=PASS',
    'FALLBACK_DISABLED=PASS',
    `REQUEST_PRECHECK=${preflight.request_precheck}`,
    `BLOCKING_GATE=${preflight.blocking_gate ?? 'NONE'}`,
    ...preflight.gates.map((item) => `GATE_${item.name}=${item.status}`),
    'TRANSPORT_ENTERED=NO',
    'LIVE_PROVIDER_CALLS=0',
  ];
}

if (import.meta.main) {
  const status = await preparePhase6bLiveZeus(process.env);
  for (const line of formatPhase6bPreflight(status.preflight)) console.log(line);
  console.log(`PHASE_2_6B_LIVE_ZEUS=${status.phase6b}`);
}
