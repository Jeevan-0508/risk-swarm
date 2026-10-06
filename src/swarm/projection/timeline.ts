import { type ProtocolState, type SwarmExecutionEvent } from '../contracts';
import { replaySwarmEvents } from '../engine/reducer';

export interface TimelineEntry {
  readonly sequence: number;
  readonly event_id: string;
  readonly type: SwarmExecutionEvent['type'];
  readonly actor: string;
  readonly timestamp: string;
  readonly state_after: ProtocolState | null;
}

/** Projects the event log into a deterministic audit-friendly timeline. */
export function projectTimeline(events: readonly SwarmExecutionEvent[]): readonly TimelineEntry[] {
  return events.map((event, index) => ({
    sequence: event.sequence,
    event_id: event.event_id,
    type: event.type,
    actor: event.actor,
    timestamp: event.timestamp,
    state_after: replaySwarmEvents(events.slice(0, index + 1)).state,
  }));
}
