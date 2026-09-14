/**
 * Pure derivations the Council screen renders over. No React, no DOM, no clock, no randomness - so the
 * chamber's entire visual state is a function of a stored transcript, and a test can assert it without
 * mounting anything.
 *
 * Hard rule, enforced by `derive.test.ts`: every function here is a *reduction* of events that already
 * exist. Nothing in this file can produce a `DeliberationEvent`, and nothing in it may reorder one -
 * `sequence` is authoritative and is read, never recomputed.
 */
import type { AgentId, DeliberationEvent, DeliberationEventType, DeliberationOutcome } from '../core/domain/model';

/** Which visual register an event type reads in. Presentation only; carries no evidential meaning. */
export type EventTone = 'ask' | 'state' | 'attack' | 'defend' | 'agree' | 'revise' | 'escalate' | 'close';

export const EVENT_TONE: Record<DeliberationEventType, EventTone> = {
  question: 'ask',
  clarification: 'ask',
  answer: 'state',
  challenge: 'attack',
  disagreement: 'attack',
  objection: 'attack',
  defense: 'defend',
  rebuttal: 'defend',
  agreement: 'agree',
  revision: 'revise',
  escalation: 'escalate',
  resolution: 'close',
};

export const TONE_COLOR: Record<EventTone, string> = {
  ask: '#9ec3ff',
  state: '#9aa5b4',
  attack: '#ff9f7a',
  defend: '#e0a33c',
  agree: '#3fb98a',
  revise: '#8b7bd8',
  escalate: '#d6425b',
  close: '#e7ebf1',
};

/**
 * The chamber's four states. A state machine over the transcript's own extent, not a timer: `convening`
 * is before the first event, `resolved` is once the terminal event has been reached.
 */
export type ChamberState = 'empty' | 'convening' | 'deliberating' | 'resolved';

export function chamberState(events: DeliberationEvent[], cursor: number): ChamberState {
  if (events.length === 0) return 'empty';
  if (cursor < 0) return 'convening';
  return cursor >= events.length - 1 ? 'resolved' : 'deliberating';
}

export interface SeatActivity {
  /** Events this agent authored. */
  spoke: number;
  /** Events addressed to this agent by name. Council-wide events count for nobody. */
  addressed: number;
  /** Authored events still carrying `unresolved`. The count the brief prints, not a sentiment score. */
  unresolved: number;
  /** Distinct evidence node ids cited across everything this agent said. */
  evidence_cited: number;
}

const EMPTY_ACTIVITY: SeatActivity = { spoke: 0, addressed: 0, unresolved: 0, evidence_cited: 0 };

/** Per-agent counts over the events up to and including `cursor`. `cursor < 0` yields all-zeroes. */
export function seatActivity(events: DeliberationEvent[], cursor: number): Record<AgentId, SeatActivity> {
  const out = {} as Record<AgentId, SeatActivity>;
  const cited = new Map<AgentId, Set<string>>();
  const at = (id: AgentId) => (out[id] ??= { ...EMPTY_ACTIVITY });

  for (const e of visible(events, cursor)) {
    const seat = at(e.from_agent);
    seat.spoke += 1;
    if (e.status === 'unresolved') seat.unresolved += 1;
    const set = cited.get(e.from_agent) ?? new Set<string>();
    for (const id of e.evidence_ids) set.add(id);
    cited.set(e.from_agent, set);
    if (e.to_agent !== null) at(e.to_agent).addressed += 1;
  }
  for (const [id, set] of cited) at(id).evidence_cited = set.size;
  return out;
}

/** The prefix of the transcript that has been reached. Never a copy of anything outside `events`. */
export function visible(events: DeliberationEvent[], cursor: number): DeliberationEvent[] {
  if (cursor < 0) return [];
  return events.slice(0, Math.min(cursor + 1, events.length));
}

export interface ExchangeThread {
  /** The event that opened the thread - it has no parent inside the transcript. */
  root: DeliberationEvent;
  /** Direct replies, in `sequence` order. One level deep: the coordinator never nests further. */
  replies: DeliberationEvent[];
}

/**
 * Groups the transcript into root events and their replies via `parent_event_id`. An event whose parent
 * is not in the transcript is treated as a root rather than dropped - losing a real event to keep the
 * tree tidy would be exactly the silent truncation this project refuses everywhere else.
 */
export function threads(events: DeliberationEvent[]): ExchangeThread[] {
  const ids = new Set(events.map((e) => e.id));
  const byParent = new Map<string, DeliberationEvent[]>();
  const roots: DeliberationEvent[] = [];

  for (const e of events) {
    const parent = e.parent_event_id;
    if (parent !== null && ids.has(parent)) {
      byParent.set(parent, [...(byParent.get(parent) ?? []), e]);
    } else {
      roots.push(e);
    }
  }
  return roots.map((root) => ({ root, replies: byParent.get(root.id) ?? [] }));
}

export interface TypeTally {
  type: DeliberationEventType;
  count: number;
}

/** Event-type histogram, densest first, ties broken by the type's own name so it is stable. */
export function typeTally(events: DeliberationEvent[]): TypeTally[] {
  const counts = new Map<DeliberationEventType, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * The one sentence the chamber puts under its outcome. Written here rather than in the coordinator
 * because it is presentation - but every phrase states what the outcome literally means, and none of
 * them says "consensus" for an outcome that is not one.
 */
export const OUTCOME_NOTE: Record<DeliberationOutcome, string> = {
  CONSENSUS: 'No objection survived the session, and nothing was left open.',
  QUALIFIED_CONSENSUS: 'Agreement on the recommendation, with named reservations still on the record.',
  MATERIAL_DISAGREEMENT: 'The council did not converge. The objections are printed, not averaged away.',
  UNRESOLVED: 'Questions were put that this run had no answer for. They stay open.',
  LIMIT_REACHED: 'A deliberation budget stopped the session. Silence here is a cut-off, not an agreement.',
};

export const OUTCOME_TONE: Record<DeliberationOutcome, EventTone> = {
  CONSENSUS: 'agree',
  QUALIFIED_CONSENSUS: 'defend',
  MATERIAL_DISAGREEMENT: 'attack',
  UNRESOLVED: 'ask',
  LIMIT_REACHED: 'escalate',
};
