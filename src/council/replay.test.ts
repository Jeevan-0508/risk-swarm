/**
 * Replay, tested for the one property that matters: it is a reading of the record, not a re-enactment.
 *
 * The spec forbids replay from re-running `investigate()` or the coordinator. That is asserted here two
 * ways - structurally (this module's own source imports neither, checked by reading the file) and
 * behaviourally (every frame's event is reference-identical to the stored object, so no frame can
 * contain anything the run did not store).
 */
import { describe, expect, it } from '../core/test/bdd';
import { createFileLoader } from '../core/integrations/loader.node';
import { investigate, type RunResult } from '../core/orchestrator/run';
import type { DeliberationEvent } from '../core/domain/model';
import { REPLAY_SPEEDS, advance, frameAt, frameIntervalMs, replay, rewind, transcriptDigest } from './replay';

let cached: RunResult | null = null;
async function reference(): Promise<RunResult> {
  cached ??= await investigate({
    loader: createFileLoader('public/snapshots'),
    run_id: 'RUN-COUNCIL-REPLAY',
    now: '2026-09-13T00:00:00.000Z',
    question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
    scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  });
  return cached;
}

describe('replay is a reading of the record, never a re-enactment', () => {
  it('imports neither the orchestrator nor the coordinator - the forbidden dependencies are absent, not merely unused', async () => {
    const source = await Bun.file('src/council/replay.ts').text();
    const imports = source.split('\n').filter((l) => /^\s*import\b/.test(l));
    expect(imports.length).toBe(1);
    for (const forbidden of ['orchestrator', 'coordinator', 'investigate', 'runDeliberation', 'agents/', 'graph']) {
      expect(imports.some((l) => l.includes(forbidden))).toBe(false);
    }
    // The one import it does have is a type, so replay cannot even reach a value from the engine.
    expect(imports[0].includes('import type')).toBe(true);
  });

  it('yields one frame per stored event, each holding the stored object itself', async () => {
    const { deliberation } = await reference();
    const frames = replay(deliberation.events);
    expect(frames.length).toBe(deliberation.events.length);
    frames.forEach((f, i) => {
      expect(f.event).toBe(deliberation.events[i]);
      expect(f.cursor).toBe(i);
      expect(f.read).toBe(i + 1);
      expect(f.total).toBe(deliberation.events.length);
    });
  });

  it('replays identically twice, and identically to the transcript itself', async () => {
    const { deliberation } = await reference();
    const a = replay(deliberation.events);
    const b = replay(deliberation.events);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.map((f) => f.event!.id).join(',')).toBe(deliberation.events.map((e) => e.id).join(','));
  });

  it('marks only the last frame finished, so nothing implies the council kept going', async () => {
    const { deliberation } = await reference();
    const frames = replay(deliberation.events);
    frames.forEach((f, i) => expect(f.finished).toBe(i === frames.length - 1));
  });

  it('reports the speaker and addressee exactly as the event names them, council-wide included', async () => {
    const { deliberation } = await reference();
    for (const f of replay(deliberation.events)) {
      expect(f.speaker).toBe(f.event!.from_agent);
      expect(f.addressee).toBe(f.event!.to_agent);
    }
  });
});

describe('the cursor cannot leave the transcript', () => {
  it('clamps a cursor past the end and before the beginning instead of wrapping', async () => {
    const { deliberation } = await reference();
    const events = deliberation.events;
    const last = events.length - 1;
    expect(frameAt(events, 9999).cursor).toBe(last);
    expect(frameAt(events, -50).cursor).toBe(-1);
    expect(frameAt(events, -50).event).toBe(null);
    expect(advance(events, last)).toBe(last);
    expect(advance(events, last + 5)).toBe(last);
    expect(rewind(-1)).toBe(-1);
  });

  it('handles an empty transcript without inventing a frame', () => {
    expect(replay([])).toEqual([]);
    const f = frameAt([], 0);
    expect(f.event).toBe(null);
    expect(f.total).toBe(0);
    expect(f.finished).toBe(true);
  });

  it('advances exactly one exchange per step whatever the speed - speed is pacing, never skipping', async () => {
    const { deliberation } = await reference();
    for (const speed of REPLAY_SPEEDS) {
      expect(frameIntervalMs(speed) > 0).toBe(true);
      let cursor = -1;
      const seen: string[] = [];
      while (cursor < deliberation.events.length - 1) {
        cursor = advance(deliberation.events, cursor);
        seen.push(deliberation.events[cursor].id);
      }
      expect(seen.join(',')).toBe(deliberation.events.map((e) => e.id).join(','));
    }
    expect(frameIntervalMs(4) < frameIntervalMs(1)).toBe(true);
  });
});

describe('the transcript digest is a tamper tell', () => {
  it('is stable across two identical runs of the same seed', async () => {
    const a = await reference();
    const b = await investigate({
      loader: createFileLoader('public/snapshots'),
      run_id: 'RUN-COUNCIL-REPLAY',
      now: '2026-09-13T00:00:00.000Z',
      question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
      scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
    });
    expect(transcriptDigest(b.deliberation.events)).toBe(transcriptDigest(a.deliberation.events));
  });

  it('changes on a single altered character of a single exchange', async () => {
    const { deliberation } = await reference();
    const before = transcriptDigest(deliberation.events);
    const tampered: DeliberationEvent[] = deliberation.events.map((e, i) =>
      i === 2 ? { ...e, content: `${e.content}.` } : e,
    );
    expect(transcriptDigest(tampered)).not.toBe(before);
  });

  it('changes when two exchanges are swapped, and when a citation is quietly dropped', async () => {
    const { deliberation } = await reference();
    const before = transcriptDigest(deliberation.events);

    const swapped = [...deliberation.events];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(transcriptDigest(swapped)).not.toBe(before);

    const withCitation = deliberation.events.findIndex((e) => e.evidence_ids.length > 0);
    expect(withCitation).not.toBe(-1);
    const stripped = deliberation.events.map((e, i) => (i === withCitation ? { ...e, evidence_ids: [] } : e));
    expect(transcriptDigest(stripped)).not.toBe(before);
  });

  it('labels itself non-cryptographic rather than implying it resists a forger', () => {
    expect(transcriptDigest([]).startsWith('fnv1a:')).toBe(true);
  });
});
