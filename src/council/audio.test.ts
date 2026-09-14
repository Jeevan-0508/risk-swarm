/**
 * The Council's sound, tested where the decisions are: `noteFor()`. The audible adapter around it has no
 * decisions of its own, so there is nothing there worth mocking an AudioContext for.
 *
 * The property that matters is the one that keeps the sound honest: it may distinguish only things that
 * are also written on screen, and it may never be the sole carrier of anything.
 */
import { describe, expect, it } from '../core/test/bdd';
import { createFileLoader } from '../core/integrations/loader.node';
import { investigate, type RunResult } from '../core/orchestrator/run';
import { DeliberationEventType, type DeliberationEvent } from '../core/domain/model';
import { AGENT_ORDER } from '../app/lib/agents';
import { createCouncilAudio, noteFor } from './audio';

let cached: RunResult | null = null;
async function reference(): Promise<RunResult> {
  cached ??= await investigate({
    loader: createFileLoader('public/snapshots'),
    run_id: 'RUN-COUNCIL-AUDIO',
    now: '2026-09-13T00:00:00.000Z',
    question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
    scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  });
  return cached;
}

const event = (over: Partial<DeliberationEvent> = {}): DeliberationEvent => ({
  id: 'E1', run_id: 'R', sequence: 0, timestamp: '2026-01-01T00:00:00.000Z',
  from_agent: 'scout', to_agent: null, type: 'answer', content: 'x',
  evidence_ids: [], claim_ids: [], parent_event_id: null, status: 'resolved', requires_response: false,
  ...over,
});

describe('the composition is total and deterministic', () => {
  it('has a playable note for every one of the twelve event types, from every seat', () => {
    expect(DeliberationEventType.options.length).toBe(12);
    for (const type of DeliberationEventType.options) {
      for (const from_agent of AGENT_ORDER) {
        const note = noteFor(event({ type, from_agent }));
        expect(note.freq > 0).toBe(true);
        expect(note.durationMs > 0).toBe(true);
        expect(note.gain > 0 && note.gain <= 1).toBe(true);
      }
    }
  });

  it('gives the same event the same note every time, and never consults a clock or a random source', async () => {
    const source = await Bun.file('src/council/audio.ts').text();
    expect(source.includes('Math.random')).toBe(false);
    expect(source.includes('Date.now')).toBe(false);
    const { deliberation } = await reference();
    for (const e of deliberation.events) {
      expect(JSON.stringify(noteFor(e))).toBe(JSON.stringify(noteFor(e)));
    }
  });

  it('gives each seat its own pitch, so a voice is identifiable before the label is read', () => {
    const pitches = AGENT_ORDER.map((from_agent) => noteFor(event({ from_agent })).freq);
    expect(new Set(pitches).size).toBe(AGENT_ORDER.length);
  });

  it('keeps every gain low enough to sit under a reading task rather than over it', async () => {
    const { deliberation } = await reference();
    for (const e of deliberation.events) expect(noteFor(e).gain <= 0.06).toBe(true);
  });
});

describe('sound distinguishes only what is also written on screen', () => {
  it('drops an unresolved exchange in pitch - and `status` is printed beside every event too', () => {
    const resolved = noteFor(event({ status: 'resolved' }));
    const unresolved = noteFor(event({ status: 'unresolved' }));
    expect(unresolved.freq < resolved.freq).toBe(true);
  });

  it('gives the adversarial and the closing registers audibly different voices', () => {
    const objection = noteFor(event({ type: 'objection' }));
    const resolution = noteFor(event({ type: 'resolution' }));
    expect(objection.wave).not.toBe(resolution.wave);
    expect(resolution.durationMs > objection.durationMs).toBe(true);
  });

  it('ignores an event\'s words entirely - the tone cannot leak content', () => {
    const a = noteFor(event({ content: 'a benign clarification' }));
    const b = noteFor(event({ content: 'CATASTROPHIC FRAUD CONFIRMED' }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('the adapter degrades quietly', () => {
  it('returns a working no-op where Web Audio does not exist, instead of throwing', async () => {
    const audio = createCouncilAudio();
    const { deliberation } = await reference();
    audio.play(deliberation.events[0]);
    audio.dispose();
    expect(typeof audio.play).toBe('function');
  });
});
