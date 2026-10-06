import type { SwarmExecutionEvent, SwarmBlackboard } from '../contracts';
import {
  assessZeusReadiness,
  buildZeusInput,
  FixtureZeusSynthesisExecutor,
  convertZeusSynthesis,
  ZEUS_PROMPT_VERSION,
  type ZeusSynthesisExecutor,
} from '../governance/zeus';
import { emptySwarmBlackboard, reduceSwarmEvent } from './reducer';

export interface OfflineZeusRunResult {
  readonly blackboard: SwarmBlackboard;
  readonly events: readonly SwarmExecutionEvent[];
  readonly provider_requests: 0;
  readonly executor_invocations: 1;
}

function append(state: SwarmBlackboard, type: SwarmExecutionEvent['type'], payload: Record<string, unknown>, actor: string): SwarmBlackboard {
  const sequence = state.execution_events.length + 1;
  return reduceSwarmEvent(state, {
    event_id: `offline-zeus-event-${sequence}` as import('../contracts').ExecutionEventId,
    case_id: state.case!.case_id,
    protocol_version: state.protocol_version,
    sequence,
    timestamp: state.case!.created_at,
    actor,
    type,
    ...payload,
  } as SwarmExecutionEvent);
}

/** Executes the Phase 6A protocol locally. The executor is a fixture seam;
 * this function never constructs a provider or performs transport. */
export async function runOfflineZeusSynthesis(
  phase5: { readonly blackboard: SwarmBlackboard; readonly events: readonly SwarmExecutionEvent[] },
  executor: ZeusSynthesisExecutor = new FixtureZeusSynthesisExecutor(),
): Promise<OfflineZeusRunResult> {
  const readiness = assessZeusReadiness(phase5.blackboard);
  if (!readiness.ready) throw new Error(`ZEUS_NOT_READY:${readiness.reason}`);
  const input = buildZeusInput(phase5.blackboard, readiness);
  let state = append(phase5.blackboard, 'ZEUS_SYNTHESIS_REQUESTED', { input, input_fingerprint: input.input_fingerprint, request_budget: 1 }, 'SYSTEM');
  state = append(state, 'ZEUS_SYNTHESIS_STARTED', { input_fingerprint: input.input_fingerprint, prompt_version: ZEUS_PROMPT_VERSION }, 'ZEUS');
  const output = await executor.synthesize(input);
  const synthesis = convertZeusSynthesis(output, input);
  state = append(state, 'ZEUS_SYNTHESIS_COMPLETED', { synthesis }, 'ZEUS');
  state = append(state, 'HUMAN_REVIEW_REQUIRED', { human_decision_required: true, decision_status: 'PENDING' }, 'SYSTEM');
  return { blackboard: state, events: state.execution_events, provider_requests: 0, executor_invocations: 1 };
}

export function replayOfflineZeus(events: readonly SwarmExecutionEvent[]): SwarmBlackboard {
  let state = emptySwarmBlackboard();
  for (const event of events) state = reduceSwarmEvent(state, event);
  return state;
}
