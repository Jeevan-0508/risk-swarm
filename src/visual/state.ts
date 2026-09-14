/**
 * The system state the intelligence core displays.
 *
 * The rule this module exists to enforce: **a state is a statement about a record, never a mood.**
 * Nine states are declared because the console has nine things it can truthfully say, and each one is
 * derived from something the engine wrote down. Three of them - RESEARCHING, ANALYZING, DECISION_READY -
 * can only come from the live phase channel of a run that is still in flight, because a stored
 * `RunResult` has no way to distinguish "retrieving" from "retrieved". They are therefore unreachable
 * during replay, and the core must not animate them there. That absence is the honest answer.
 */
import type { DeliberationEvent } from '../core/domain/model';
import { EVENT_TONE, visible } from '../council/derive';

export type SystemState =
  | 'IDLE'
  | 'RESEARCHING'
  | 'ANALYZING'
  | 'DELIBERATING'
  | 'CHALLENGED'
  | 'RECONCILING'
  | 'DECISION_READY'
  | 'HUMAN_REVIEW'
  | 'RESOLVED';

/** One honest sentence per state. The core prints this, so none of them may overstate. */
export const SYSTEM_STATE_NOTE: Record<SystemState, string> = {
  IDLE: 'Nothing is running and nothing has been read.',
  RESEARCHING: 'Retrieval is in progress. Sources are being read, not yet assessed.',
  ANALYZING: 'Retrieved evidence is being deduplicated, matched and mapped by the seated agents.',
  DELIBERATING: 'The council is exchanging positions. Nothing is settled at this point in the record.',
  CHALLENGED: 'An objection is standing unanswered at this point in the record.',
  RECONCILING: 'A position is being defended or revised in answer to a challenge.',
  DECISION_READY: 'The decision engine has published a recommendation. No human has ruled on it.',
  HUMAN_REVIEW: 'The record is complete and the human decision is outstanding. The system stops here.',
  RESOLVED: 'A human recorded a verdict. That verdict, not the recommendation, is the outcome.',
};

/**
 * The seven phase names `orchestrator/run.ts` really emits, mapped to what the core may say while one
 * is in flight. A phase this map does not know leaves the state alone rather than guessing.
 */
export const PHASE_STATE: Record<string, SystemState> = {
  discover: 'RESEARCHING',
  deduplicate: 'ANALYZING',
  analyse: 'ANALYZING',
  govern: 'ANALYZING',
  challenge: 'DELIBERATING',
  red_team: 'DELIBERATING',
  decide: 'RECONCILING',
};

export interface LiveStateInput {
  /** True only between start and settle. The store owns this; it is not inferred from a result. */
  running: boolean;
  /** The most recent phase name the engine reported, or null if none has arrived. */
  phase: string | null;
}

/** The state of a run still in flight. Returns null when there is nothing live to report. */
export function liveState(input: LiveStateInput): SystemState | null {
  if (!input.running) return null;
  if (input.phase === null) return 'RESEARCHING';
  return PHASE_STATE[input.phase] ?? 'ANALYZING';
}

export interface ReplayStateInput {
  events: DeliberationEvent[];
  /** Reading position. -1 means nothing has been read yet. */
  cursor: number;
  /** Whether a human has recorded a verdict on this run. Not a guess: null means none was recorded. */
  humanVerdict: string | null;
}

/**
 * The state the *record* was in at the reading position. This is a claim about the transcript, not
 * about the present moment, which is why the core labels it with the event number it belongs to.
 *
 * `CHALLENGED` requires an attack-tone event that is genuinely still `unresolved`; `RECONCILING`
 * requires a defence or revision to have actually followed one. Neither is inferred from vibes.
 */
export function replayState(input: ReplayStateInput): SystemState {
  const { events, cursor } = input;
  if (events.length === 0) return terminalState(input.humanVerdict);
  if (cursor < 0) return 'IDLE';

  const read = visible(events, cursor);
  const last = read[read.length - 1];
  if (last === undefined) return 'IDLE';

  if (cursor >= events.length - 1) return terminalState(input.humanVerdict);

  const tone = EVENT_TONE[last.type];
  if (tone === 'attack' && last.status === 'unresolved') return 'CHALLENGED';
  if (tone === 'defend' || tone === 'revise') return 'RECONCILING';
  if (tone === 'escalate') return 'CHALLENGED';
  return 'DELIBERATING';
}

function terminalState(humanVerdict: string | null): SystemState {
  return humanVerdict === null ? 'HUMAN_REVIEW' : 'RESOLVED';
}

/**
 * What the core shows. A live run outranks a reading position, because a state that is happening beats
 * a state that was recorded. Nothing else is consulted.
 */
export function systemState(live: LiveStateInput, replay: ReplayStateInput): SystemState {
  return liveState(live) ?? replayState(replay);
}

/**
 * States that cannot be reached from a stored run, only from a live one. Exported so the console can
 * say so out loud instead of quietly never showing them.
 */
export const LIVE_ONLY_STATES: SystemState[] = ['RESEARCHING', 'ANALYZING', 'DECISION_READY'];
