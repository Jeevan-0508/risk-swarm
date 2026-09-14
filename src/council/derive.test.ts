/**
 * The Council's UI derivations, tested over the real reference run's real transcript rather than a
 * hand-drawn one wherever possible - the lesson this project has now relearned every phase: a fixture
 * proves the reducer's arithmetic, never that the arithmetic is true of the real system.
 */
import { describe, expect, it } from '../core/test/bdd';
import { createFileLoader } from '../core/integrations/loader.node';
import { investigate } from '../core/orchestrator/run';
import type { DeliberationEvent } from '../core/domain/model';
import { AGENT_ORDER } from '../app/lib/agents';
import { COUNCIL_ORDER, COUNCIL_SEATS, ringPoint } from './roster';
import { EVENT_TONE, OUTCOME_NOTE, OUTCOME_TONE, TONE_COLOR, chamberState, seatActivity, threads, typeTally, visible } from './derive';

const OPTIONS = {
  loader: createFileLoader('public/snapshots'),
  run_id: 'RUN-COUNCIL-UI',
  now: '2026-09-13T00:00:00.000Z',
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
};

let cached: Awaited<ReturnType<typeof investigate>> | null = null;
async function reference() {
  cached ??= await investigate({ ...OPTIONS });
  return cached;
}

describe('the Council roster (presentation only)', () => {
  it('seats all seven agents, in the pipeline order the engine itself uses', () => {
    expect(COUNCIL_ORDER).toEqual([...AGENT_ORDER]);
    for (const id of COUNCIL_ORDER) expect(COUNCIL_SEATS[id].accent.startsWith('#')).toBe(true);
  });

  it('gives every seat a distinct accent, so two agents are never confusable by colour', () => {
    const accents = new Set(COUNCIL_ORDER.map((id) => COUNCIL_SEATS[id].accent));
    expect(accents.size).toBe(COUNCIL_ORDER.length);
  });

  it('places seat 0 at twelve o\'clock and spreads the rest clockwise on one radius', () => {
    const n = 7;
    const first = ringPoint(0, n);
    expect(Math.round(first.x)).toBe(50);
    expect(Math.round(first.y)).toBe(12);
    for (let i = 0; i < n; i += 1) {
      const p = ringPoint(i, n);
      const r = Math.hypot(p.x - 50, p.y - 50);
      expect(Math.abs(r - 38) < 0.0001).toBe(true);
    }
  });
});

describe('the chamber state machine', () => {
  it('is empty with no events, whatever the cursor says', () => {
    expect(chamberState([], -1)).toBe('empty');
    expect(chamberState([], 99)).toBe('empty');
  });

  it('walks convening -> deliberating -> adjourned across a real transcript', async () => {
    const r = await reference();
    const events = r.deliberation.events;
    expect(events.length > 3).toBe(true);
    expect(chamberState(events, -1)).toBe('convening');
    expect(chamberState(events, 0)).toBe('deliberating');
    expect(chamberState(events, events.length - 1)).toBe('resolved');
  });
});

describe('visible()', () => {
  it('shows nothing before the first event and never more than the transcript holds', async () => {
    const { deliberation } = await reference();
    expect(visible(deliberation.events, -1)).toEqual([]);
    expect(visible(deliberation.events, 0).length).toBe(1);
    expect(visible(deliberation.events, 9999).length).toBe(deliberation.events.length);
  });

  it('returns a prefix of the real array - it can neither reorder nor invent an event', async () => {
    const { deliberation } = await reference();
    const cut = visible(deliberation.events, 5);
    cut.forEach((e, i) => expect(e).toBe(deliberation.events[i]));
  });
});

describe('seatActivity()', () => {
  it('counts exactly the real transcript, and totals back to it', async () => {
    const { deliberation } = await reference();
    const events = deliberation.events;
    const activity = seatActivity(events, events.length - 1);
    const spoke = COUNCIL_ORDER.reduce((n, id) => n + (activity[id]?.spoke ?? 0), 0);
    expect(spoke).toBe(events.length);

    const addressed = COUNCIL_ORDER.reduce((n, id) => n + (activity[id]?.addressed ?? 0), 0);
    expect(addressed).toBe(events.filter((e) => e.to_agent !== null).length);

    const unresolved = COUNCIL_ORDER.reduce((n, id) => n + (activity[id]?.unresolved ?? 0), 0);
    expect(unresolved).toBe(events.filter((e) => e.status === 'unresolved').length);
  });

  it('never counts an evidence id twice for the same agent', () => {
    const e = (i: number, ids: string[]): DeliberationEvent => ({
      id: `E${i}`, run_id: 'R', sequence: i, timestamp: '2026-01-01T00:00:00.000Z',
      from_agent: 'scout', to_agent: null, type: 'answer', content: 'x',
      evidence_ids: ids, claim_ids: [], parent_event_id: null, status: 'resolved', requires_response: false,
    });
    const activity = seatActivity([e(0, ['A', 'B']), e(1, ['B', 'C'])], 1);
    expect(activity.scout.evidence_cited).toBe(3);
    expect(activity.scout.spoke).toBe(2);
  });

  it('is all-zeroes before the first event', async () => {
    const { deliberation } = await reference();
    const activity = seatActivity(deliberation.events, -1);
    for (const id of COUNCIL_ORDER) expect(activity[id]?.spoke ?? 0).toBe(0);
  });
});

describe('threads()', () => {
  it('accounts for every real event exactly once, root or reply', async () => {
    const { deliberation } = await reference();
    const grouped = threads(deliberation.events);
    const seen = grouped.flatMap((t) => [t.root.id, ...t.replies.map((r) => r.id)]);
    expect(new Set(seen).size).toBe(deliberation.events.length);
    expect(seen.length).toBe(deliberation.events.length);
  });

  it('treats an event whose parent is missing as a root instead of dropping it', () => {
    const orphan: DeliberationEvent = {
      id: 'E1', run_id: 'R', sequence: 0, timestamp: '2026-01-01T00:00:00.000Z',
      from_agent: 'challenger', to_agent: null, type: 'challenge', content: 'x',
      evidence_ids: [], claim_ids: [], parent_event_id: 'GONE', status: 'unresolved', requires_response: true,
    };
    const grouped = threads([orphan]);
    expect(grouped.length).toBe(1);
    expect(grouped[0].root.id).toBe('E1');
  });
});

describe('typeTally()', () => {
  it('sums to the transcript length and is ordered densest first', async () => {
    const { deliberation } = await reference();
    const tally = typeTally(deliberation.events);
    expect(tally.reduce((n, t) => n + t.count, 0)).toBe(deliberation.events.length);
    for (let i = 1; i < tally.length; i += 1) expect(tally[i - 1].count >= tally[i].count).toBe(true);
  });
});

describe('the presentation maps stay total', () => {
  it('has a tone and a colour for all twelve event types the real transcript can contain', async () => {
    const { deliberation } = await reference();
    for (const e of deliberation.events) {
      expect(EVENT_TONE[e.type]).toBeDefined();
      expect(TONE_COLOR[EVENT_TONE[e.type]].startsWith('#')).toBe(true);
    }
  });

  it('has an honest note and a tone for the real outcome, and never calls a non-consensus a consensus', async () => {
    const { deliberation } = await reference();
    expect(OUTCOME_NOTE[deliberation.outcome]).toBeDefined();
    expect(OUTCOME_TONE[deliberation.outcome]).toBeDefined();
    for (const [outcome, note] of Object.entries(OUTCOME_NOTE)) {
      if (outcome === 'CONSENSUS' || outcome === 'QUALIFIED_CONSENSUS') continue;
      expect(/\bconsensus\b/i.test(note)).toBe(false);
    }
  });
});
