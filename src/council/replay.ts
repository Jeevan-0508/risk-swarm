/**
 * DETERMINISTIC REPLAY. A pure function over a stored transcript, and nothing else.
 *
 * The hard constraint, from the spec and enforced by `replay.test.ts`: replay may not re-run
 * `investigate()` and may not re-run the coordinator. It has no access to either - this module imports
 * a type and `Math`, and that is the whole dependency list. Watching a deliberation back is reading a
 * record, not re-enacting it, and if the two could ever disagree the record would stop being evidence.
 *
 * Every frame's `event` is the very object from the input array (reference-identical, asserted in the
 * tests), so replay cannot introduce, drop, paraphrase or reorder a single exchange.
 */
import type { AgentId, DeliberationEvent } from '../core/domain/model';

/** Multipliers on the frame interval. Speed changes pacing only; it can never skip an event. */
export const REPLAY_SPEEDS = [1, 2, 4] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Base milliseconds per exchange at 1x. Pacing, not data - the transcript has no per-event clock. */
export const REPLAY_INTERVAL_MS = 1400;

export const frameIntervalMs = (speed: ReplaySpeed): number => Math.round(REPLAY_INTERVAL_MS / speed);

export interface ReplayFrame {
  /** Index into the transcript. `-1` is the chamber before anyone has spoken. */
  cursor: number;
  /** The event at the cursor, or `null` before the first one. Never a synthesized placeholder. */
  event: DeliberationEvent | null;
  speaker: AgentId | null;
  /** `null` both before the first event and when a real event addresses the council as a whole. */
  addressee: AgentId | null;
  /** How many exchanges have been read, out of how many exist. */
  read: number;
  total: number;
  /** True once the cursor has reached the last stored event. There is nothing after it. */
  finished: boolean;
}

export function frameAt(events: DeliberationEvent[], cursor: number): ReplayFrame {
  const total = events.length;
  const clamped = Math.max(-1, Math.min(cursor, total - 1));
  const event = clamped < 0 ? null : events[clamped];
  return {
    cursor: clamped,
    event,
    speaker: event?.from_agent ?? null,
    addressee: event?.to_agent ?? null,
    read: clamped + 1,
    total,
    finished: total === 0 || clamped >= total - 1,
  };
}

/**
 * The next cursor position. Stops at the last event rather than wrapping: a deliberation that looped
 * would imply the council kept going, and it did not.
 */
export function advance(events: DeliberationEvent[], cursor: number): number {
  return Math.min(cursor + 1, events.length - 1);
}

export function rewind(cursor: number): number {
  return Math.max(-1, cursor - 1);
}

/**
 * Every frame of the whole transcript, in order. Exists so a test can assert the entire replay in one
 * pass instead of trusting a loop in a component, and so `replay.test.ts` can prove that replaying
 * twice yields byte-identical output.
 */
export function replay(events: DeliberationEvent[]): ReplayFrame[] {
  return events.map((_, i) => frameAt(events, i));
}

/**
 * A fingerprint of the transcript's evidential content: id, order, speaker, addressee, type, exact
 * words, and every cited id. Two transcripts share a digest only if every one of those is identical,
 * so a single altered character - or a reordered pair, or a quietly dropped citation - changes it.
 *
 * Deliberately **not** a security claim: FNV-1a is not cryptographic and cannot resist a determined
 * forger, and this project's rule is to label a non-cryptographic hash as one rather than imply
 * otherwise (`sources/hash.ts` already does exactly this). It is a tamper *tell* for a reader
 * comparing one rendering of a run against another, nothing more.
 */
export function transcriptDigest(events: DeliberationEvent[]): string {
  const canonical = events
    .map((e) =>
      [
        e.id,
        e.sequence,
        e.from_agent,
        e.to_agent ?? '-',
        e.type,
        e.status,
        e.requires_response ? '1' : '0',
        e.parent_event_id ?? '-',
        e.evidence_ids.join(','),
        e.claim_ids.join(','),
        e.content,
      ].join('\u001f'),
    )
    .join('\u001e');

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${hash.toString(16).padStart(8, '0')}`;
}
