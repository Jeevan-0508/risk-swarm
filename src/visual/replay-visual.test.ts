/**
 * Replay determinism, at the visual layer.
 *
 * `council/replay.test.ts` already proves the transcript replays identically and that replay cannot
 * re-run the engine. This file proves the stronger property the console needs: **the same run, stepped
 * the same way, produces the same visual event sequence** - so a recorded demo and a live reader see the
 * same marks in the same order, and no animation is a function of a clock or a random number.
 */
import { describe, expect, it } from '../core/test/bdd';
import { createFileLoader } from '../core/integrations/loader.node';
import { investigate } from '../core/orchestrator/run';
import { advance, rewind } from '../council/replay';
import { visualEvents, visualFrame } from './events';
import { replayState } from './state';

const OPTIONS = {
  loader: createFileLoader('public/snapshots'),
  run_id: 'RUN-VISUAL-REPLAY',
  now: '2026-09-13T00:00:00.000Z',
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
};

let cached: Awaited<ReturnType<typeof investigate>> | null = null;
async function reference() {
  cached ??= await investigate({ ...OPTIONS });
  return cached;
}

/** Steps a replay from before the first event to the end, collecting what the console would draw. */
function walk(events: Awaited<ReturnType<typeof investigate>>['deliberation']['events']) {
  const marks = visualEvents(events);
  const frames: string[] = [];
  let cursor = -1;
  for (let guard = 0; guard <= events.length + 1; guard += 1) {
    frames.push(JSON.stringify({ cursor, state: replayState({ events, cursor, humanVerdict: null }), frame: visualFrame(marks, cursor) }));
    const next = advance(events, cursor);
    if (next === cursor) break;
    cursor = next;
  }
  return frames;
}

describe('the console replays deterministically', () => {
  it('draws the same marks, in the same order, on two identical walks of one run', async () => {
    const r = await reference();
    expect(walk(r.deliberation.events)).toEqual(walk(r.deliberation.events));
  });

  it('draws the same marks for two independent runs of the same investigation', async () => {
    // Two run ids, so the event *ids* legitimately differ - they carry the run they belong to. What must
    // not differ is the sequence of marks: the type, the seats, the order and how much was cited.
    const shape = (events: Awaited<ReturnType<typeof investigate>>['deliberation']['events']) =>
      visualEvents(events).map((v) => `${v.sequence}:${v.type}:${v.from}:${v.to ?? '-'}:${v.evidence_ids.length}:${v.unresolved}`);
    const a = await investigate({ ...OPTIONS, run_id: 'RUN-VR-A' });
    const b = await investigate({ ...OPTIONS, run_id: 'RUN-VR-B' });
    expect(shape(b.deliberation.events)).toEqual(shape(a.deliberation.events));
  });

  it('reaches every event exactly once, so no exchange can be skipped or shown twice', async () => {
    const r = await reference();
    const events = r.deliberation.events;
    const cursors: number[] = [];
    let cursor = -1;
    for (let guard = 0; guard <= events.length + 1; guard += 1) {
      const next = advance(events, cursor);
      if (next === cursor) break;
      cursor = next;
      cursors.push(cursor);
    }
    expect(cursors).toEqual(events.map((_, i) => i));
  });

  it('rewinds to the same frame it advanced from, so stepping is reversible', async () => {
    const r = await reference();
    const events = r.deliberation.events;
    const marks = visualEvents(events);
    for (let c = 0; c < events.length - 1; c += 1) {
      const forward = advance(events, c);
      expect(rewind(forward)).toBe(c);
      expect(visualFrame(marks, c)).toEqual(visualFrame(marks, rewind(forward)));
    }
  });

  it('draws nothing at all before the first event, rather than an idle animation', async () => {
    const r = await reference();
    const marks = visualEvents(r.deliberation.events);
    expect(visualFrame(marks, -1)).toEqual([]);
    expect(replayState({ events: r.deliberation.events, cursor: -1, humanVerdict: null })).toBe('IDLE');
  });

  it('cites no evidence in any frame that the transcript did not cite in that event', async () => {
    const r = await reference();
    const events = r.deliberation.events;
    const marks = visualEvents(events);
    for (const e of events) {
      for (const v of visualFrame(marks, e.sequence)) {
        for (const id of v.evidence_ids) expect(e.evidence_ids).toContain(id);
      }
    }
  });
});
