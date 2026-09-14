/**
 * Per-agent station state. Pure, like everything else in this folder that decides what a mark means.
 *
 * Twelve states are declared because the console has twelve things it can truthfully say about a seat.
 * Only one of them - RESEARCHING - is unreachable while reading a stored run, for the same reason the
 * core cannot show it: a finished `RunResult` records that retrieval happened, never that it is
 * happening. Listing it in `STATION_LIVE_ONLY` is cheaper than an animation that lies.
 *
 * The distinction the derivation defends: STOOD_DOWN is not IDLE. A seat the pack never asked, and a
 * seat that was asked and has not spoken yet, are different facts and get different marks.
 */
import type { AgentId, DeliberationEvent } from '../core/domain/model';
import type { PhaseLogEntry } from '../core/orchestrator/run';
import { EVENT_TONE, seatActivity, type SeatStanding } from '../council/derive';

export type StationState =
  | 'IDLE'
  | 'LISTENING'
  | 'RESEARCHING'
  | 'ANALYZING'
  | 'QUESTIONING'
  | 'CHALLENGING'
  | 'DEFENDING'
  | 'REVIEWING'
  | 'AGREEING'
  | 'DISAGREEING'
  | 'STOOD_DOWN'
  | 'COMPLETE';

/** Reachable only from a run in flight. Named so the console can say why it never appears in replay. */
export const STATION_LIVE_ONLY: StationState[] = ['RESEARCHING'];

export interface Station {
  agent: AgentId;
  state: StationState;
  /** Events this seat authored in the part of the transcript that has been read. */
  spoke: number;
  /** Its own authored events still carrying `unresolved`. The count the brief prints. */
  unresolved: number;
  /** Distinct evidence ids it cited. Zero is a fact, not a missing value. */
  evidence_cited: number;
  /** The engine's own participation reason. Never composed here. */
  reason: string;
  /** What this seat last said in the read prefix, verbatim, or null if it has not spoken. */
  last_said: string | null;
  /** The reasoning status the engine recorded for this agent's phase, or null if it never ran. */
  reasoning_status: string | null;
}

export interface StationInput {
  events: DeliberationEvent[];
  cursor: number;
  standing: Record<AgentId, SeatStanding>;
  /** `RunResult.log` - the real phase record, used only for `reasoning_status`. */
  log: PhaseLogEntry[];
  order: readonly AgentId[];
}

export function stations(input: StationInput): Station[] {
  const { events, cursor, standing, log, order } = input;
  const activity = seatActivity(events, cursor);
  const current = cursor >= 0 && events.length > 0 ? events[Math.min(cursor, events.length - 1)] : undefined;
  const read = cursor < 0 ? [] : events.slice(0, Math.min(cursor + 1, events.length));
  const finished = events.length > 0 && cursor >= events.length - 1;

  return order.map((agent) => {
    const act = activity[agent];
    const stand = standing[agent];
    const spoke = act?.spoke ?? 0;
    const mine = read.filter((e) => e.from_agent === agent);
    const status = log.find((entry) => entry.agent === agent)?.reasoning_status ?? null;

    return {
      agent,
      state: stateOf({ agent, current, spoke, finished, participating: stand?.participating ?? true }),
      spoke,
      unresolved: act?.unresolved ?? 0,
      evidence_cited: act?.evidence_cited ?? 0,
      reason: stand?.reason ?? 'No participation decision was recorded for this run.',
      last_said: mine.length === 0 ? null : mine[mine.length - 1].content,
      reasoning_status: status,
    };
  });
}

function stateOf(ctx: {
  agent: AgentId;
  current: DeliberationEvent | undefined;
  spoke: number;
  finished: boolean;
  participating: boolean;
}): StationState {
  if (!ctx.participating) return 'STOOD_DOWN';
  const e = ctx.current;
  if (e === undefined) return 'IDLE';

  if (e.from_agent === ctx.agent) {
    if (e.type === 'disagreement') return 'DISAGREEING';
    if (e.type === 'revision') return 'REVIEWING';
    if (e.type === 'answer') return 'ANALYZING';
    switch (EVENT_TONE[e.type]) {
      case 'ask': return 'QUESTIONING';
      case 'attack': return 'CHALLENGING';
      case 'escalate': return 'CHALLENGING';
      case 'defend': return 'DEFENDING';
      case 'agree': return 'AGREEING';
      case 'revise': return 'REVIEWING';
      default: return 'ANALYZING';
    }
  }
  if (e.to_agent === ctx.agent) return 'LISTENING';
  if (ctx.finished) return ctx.spoke > 0 ? 'COMPLETE' : 'IDLE';
  return 'IDLE';
}

/** One short label per state. Lower case on purpose: the console shouts with colour, not with capitals. */
export const STATION_LABEL: Record<StationState, string> = {
  IDLE: 'idle',
  LISTENING: 'addressed',
  RESEARCHING: 'retrieving',
  ANALYZING: 'stating',
  QUESTIONING: 'asking',
  CHALLENGING: 'challenging',
  DEFENDING: 'defending',
  REVIEWING: 'revising',
  AGREEING: 'agreeing',
  DISAGREEING: 'disagreeing',
  STOOD_DOWN: 'stood down',
  COMPLETE: 'complete',
};
