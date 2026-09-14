/**
 * The visual layer, tested over the real reference run.
 *
 * What is actually being defended here: the renderer cannot manufacture intelligence. Every mark it may
 * draw has to trace back to a transcript event the coordinator emitted, and every state the core may
 * display has to be a true statement about a record. A fixture would prove the arithmetic; only the real
 * run proves the claim.
 */
import { describe, expect, it } from '../core/test/bdd';
import { createFileLoader } from '../core/integrations/loader.node';
import { investigate } from '../core/orchestrator/run';
import { EVENT_PROJECTION, UNPRODUCIBLE, visualEvents, visualFrame, type VisualEventType } from './events';
import { LIVE_ONLY_STATES, PHASE_STATE, SYSTEM_STATE_NOTE, liveState, replayState, systemState } from './state';

const OPTIONS = {
  loader: createFileLoader('public/snapshots'),
  run_id: 'RUN-VISUAL',
  now: '2026-09-13T00:00:00.000Z',
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
};

let cached: Awaited<ReturnType<typeof investigate>> | null = null;
async function reference() {
  cached ??= await investigate({ ...OPTIONS });
  return cached;
}

describe('visual events are projections of the transcript, never inventions', () => {
  it('traces every mark back to a real event id and a real stored sequence', async () => {
    const r = await reference();
    const ids = new Set(r.deliberation.events.map((e) => e.id));
    const sequences = new Set(r.deliberation.events.map((e) => e.sequence));
    const marks = visualEvents(r.deliberation.events);
    expect(marks.length > 0).toBe(true);
    for (const v of marks) {
      expect(ids.has(v.source_event_id)).toBe(true);
      expect(sequences.has(v.sequence)).toBe(true);
    }
  });

  it('never emits a type nothing can produce', async () => {
    const r = await reference();
    const seen = new Set(visualEvents(r.deliberation.events).map((v) => v.type));
    for (const type of Object.keys(UNPRODUCIBLE) as VisualEventType[]) expect(seen.has(type)).toBe(false);
  });

  it('states why each unproducible type is absent, so silence is never mistaken for a gap', () => {
    for (const [type, reason] of Object.entries(UNPRODUCIBLE)) {
      expect(reason.length > 20).toBe(true);
      expect(type.length > 0).toBe(true);
    }
  });

  it('cites evidence only where the event really cited some', async () => {
    const r = await reference();
    const marks = visualEvents(r.deliberation.events);
    const byId = new Map(r.deliberation.events.map((e) => [e.id, e]));
    for (const v of marks.filter((m) => m.type === 'EVIDENCE_RECEIVED')) {
      expect(byId.get(v.source_event_id)!.evidence_ids.length > 0).toBe(true);
    }
    const silent = r.deliberation.events.filter((e) => e.evidence_ids.length === 0).map((e) => e.id);
    for (const id of silent) {
      expect(marks.some((m) => m.type === 'EVIDENCE_RECEIVED' && m.source_event_id === id)).toBe(false);
    }
  });

  it('is deterministic: the same transcript projects identically twice', async () => {
    const r = await reference();
    const a = visualEvents(r.deliberation.events);
    const b = visualEvents(r.deliberation.events);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('preserves stored order - it can reorder nothing, because it reads sequence', async () => {
    const r = await reference();
    const marks = visualEvents(r.deliberation.events);
    const seen = marks.map((m) => m.sequence);
    expect([...seen].sort((x, y) => x - y)).toEqual(seen);
  });

  it('projects one frame per reading position, and an empty frame where no event exists', async () => {
    const r = await reference();
    const marks = visualEvents(r.deliberation.events);
    for (const e of r.deliberation.events) {
      const frame = visualFrame(marks, e.sequence);
      expect(frame.length > 0).toBe(true);
      expect(frame.every((v) => v.source_event_id === e.id || v.type === 'AGENT_DEACTIVATE')).toBe(true);
    }
    expect(visualFrame(marks, 10_000)).toEqual([]);
  });

  it('maps every declared transcript event type, so a new one cannot render as nothing', () => {
    for (const type of Object.keys(EVENT_PROJECTION)) expect(EVENT_PROJECTION[type as keyof typeof EVENT_PROJECTION]).toBeTruthy();
  });
});

describe('the core state is a statement about a record', () => {
  it('is IDLE with nothing running and nothing read', async () => {
    const r = await reference();
    expect(systemState({ running: false, phase: null }, { events: r.deliberation.events, cursor: -1, humanVerdict: null })).toBe('IDLE');
  });

  it('reads the whole transcript as awaiting a human when no verdict was recorded', async () => {
    const r = await reference();
    const events = r.deliberation.events;
    expect(replayState({ events, cursor: events.length - 1, humanVerdict: null })).toBe('HUMAN_REVIEW');
    expect(replayState({ events, cursor: events.length - 1, humanVerdict: 'accepted' })).toBe('RESOLVED');
  });

  it('says CHALLENGED only where a real objection is really still unresolved', async () => {
    const r = await reference();
    const events = r.deliberation.events;
    for (let c = 0; c < events.length - 1; c += 1) {
      if (replayState({ events, cursor: c, humanVerdict: null }) !== 'CHALLENGED') continue;
      const e = events[c];
      expect(['challenge', 'objection', 'disagreement', 'escalation']).toContain(e.type);
      if (e.type !== 'escalation') expect(e.status).toBe('unresolved');
    }
  });

  it('lets a live run outrank a reading position, and maps only phases the engine really emits', async () => {
    const r = await reference();
    const replay = { events: r.deliberation.events, cursor: -1, humanVerdict: null };
    expect(systemState({ running: true, phase: 'discover' }, replay)).toBe('RESEARCHING');
    expect(systemState({ running: true, phase: 'challenge' }, replay)).toBe('DELIBERATING');
    const phases = new Set(r.log.map((entry) => entry.phase));
    for (const phase of phases) expect(PHASE_STATE[phase]).toBeTruthy();
  });

  it('reports no live state when nothing is in flight, rather than a plausible-looking one', () => {
    expect(liveState({ running: false, phase: 'discover' })).toBeNull();
  });

  it('keeps the live-only states out of replay, and names them so the absence is visible', async () => {
    const r = await reference();
    const events = r.deliberation.events;
    const reached = new Set([-1, ...events.map((_, i) => i)].map((c) => replayState({ events, cursor: c, humanVerdict: null })));
    for (const state of LIVE_ONLY_STATES) expect(reached.has(state)).toBe(false);
    expect(LIVE_ONLY_STATES.length > 0).toBe(true);
  });

  it('gives every state one honest sentence, none of which claims a consensus', () => {
    for (const note of Object.values(SYSTEM_STATE_NOTE)) {
      expect(note.length > 25).toBe(true);
      expect(/consensus/i.test(note)).toBe(false);
    }
  });
});
