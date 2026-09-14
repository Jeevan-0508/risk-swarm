/**
 * Visual events - the only thing the renderer is allowed to animate.
 *
 * The distinction this module exists to make impossible to blur: a `VisualEvent` is a *projection* of a
 * `DeliberationEvent` that the coordinator already emitted. Every one carries `source_event_id`, so any
 * mark on screen can be traced back to a line of the transcript. There is no constructor here that can
 * invent one, and `events.test.ts` asserts that over the real reference run.
 *
 * Three declared types are deliberately never produced here, and the console says so rather than
 * quietly omitting them - see `UNPRODUCIBLE`.
 */
import type { AgentId, DeliberationEvent, DeliberationEventType } from '../core/domain/model';

export type VisualEventType =
  | 'AGENT_ACTIVATE'
  | 'AGENT_DEACTIVATE'
  | 'QUESTION_SENT'
  | 'ANSWER_RECEIVED'
  | 'EVIDENCE_RECEIVED'
  | 'EVIDENCE_SELECTED'
  | 'CHALLENGE_RAISED'
  | 'DEFENSE_RAISED'
  | 'REVISION_MADE'
  | 'DISAGREEMENT'
  | 'AGREEMENT'
  | 'RED_TEAM_ALERT'
  | 'DECISION_READY'
  | 'HUMAN_REVIEW'
  | 'KNOWLEDGE_DELTA';

export interface VisualEvent {
  type: VisualEventType;
  /** The transcript event this was projected from. Never empty, never synthesised. */
  source_event_id: string;
  /** The stored sequence of that event. Read, never recomputed. */
  sequence: number;
  from: AgentId;
  to: AgentId | null;
  evidence_ids: string[];
  unresolved: boolean;
}

/**
 * Which typed visual event a real transcript event projects to. `escalation` is intentionally absent:
 * it is projected by author, because an escalation from the red team means something different from an
 * escalation by anyone else, and one shared mark would flatten that.
 */
export const EVENT_PROJECTION: Record<DeliberationEventType, VisualEventType> = {
  question: 'QUESTION_SENT',
  clarification: 'QUESTION_SENT',
  answer: 'ANSWER_RECEIVED',
  challenge: 'CHALLENGE_RAISED',
  objection: 'CHALLENGE_RAISED',
  disagreement: 'DISAGREEMENT',
  defense: 'DEFENSE_RAISED',
  rebuttal: 'DEFENSE_RAISED',
  agreement: 'AGREEMENT',
  revision: 'REVISION_MADE',
  escalation: 'CHALLENGE_RAISED',
  resolution: 'DECISION_READY',
};

/**
 * Declared, and never emitted by `visualEvents()`. Not an oversight in each case:
 *
 * - `KNOWLEDGE_DELTA` has no live producer at all - `core/knowledge/delta.ts` is not called by any run.
 * - `HUMAN_REVIEW` is a fact about the session store, not about the transcript, so it is raised by the
 *   core's state machine rather than projected from an event.
 * - `EVIDENCE_SELECTED` is a human's click. Deriving it from a transcript would be inventing intent.
 */
export const UNPRODUCIBLE: Record<'KNOWLEDGE_DELTA' | 'HUMAN_REVIEW' | 'EVIDENCE_SELECTED', string> = {
  KNOWLEDGE_DELTA: 'No run produces a knowledge delta yet, so nothing can be shown arriving.',
  HUMAN_REVIEW: 'Raised by the core from the session record, not projected from a transcript event.',
  EVIDENCE_SELECTED: 'A reader\'s selection. The transcript has no opinion about what you clicked.',
};

/**
 * Projects the transcript, in stored `sequence` order, into the marks the renderer may draw.
 *
 * Per transcript event, in this order: the author activates; the previous author stands down if it was
 * somebody else; the typed projection; and `EVIDENCE_RECEIVED` only when the event really cited
 * something. An event citing nothing produces no evidence mark, which is the point.
 */
export function visualEvents(events: DeliberationEvent[]): VisualEvent[] {
  const out: VisualEvent[] = [];
  let previous: AgentId | null = null;

  for (const e of events) {
    const base = {
      source_event_id: e.id,
      sequence: e.sequence,
      from: e.from_agent,
      to: e.to_agent,
      evidence_ids: e.evidence_ids,
      unresolved: e.status === 'unresolved',
    };

    if (previous !== null && previous !== e.from_agent) {
      out.push({ ...base, type: 'AGENT_DEACTIVATE', from: previous, to: null, evidence_ids: [] });
    }
    out.push({ ...base, type: 'AGENT_ACTIVATE' });
    out.push({ ...base, type: projectionOf(e) });
    if (e.evidence_ids.length > 0) out.push({ ...base, type: 'EVIDENCE_RECEIVED' });
    previous = e.from_agent;
  }
  return out;
}

function projectionOf(e: DeliberationEvent): VisualEventType {
  if (e.type === 'escalation') return e.from_agent === 'red_team' ? 'RED_TEAM_ALERT' : 'CHALLENGE_RAISED';
  return EVENT_PROJECTION[e.type];
}

/** The marks belonging to one reading position. The renderer draws this frame and nothing else. */
export function visualFrame(all: VisualEvent[], sequence: number): VisualEvent[] {
  return all.filter((v) => v.sequence === sequence);
}
