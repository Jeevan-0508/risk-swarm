/**
 * The evidence inspector's derivation, tested over the real reference run's real graph.
 *
 * The property under test is not that the card is well-formed - a fixture would show that. It is that
 * every field on the card is a field the engine really wrote, that nothing is filled in when the node is
 * silent, and that the citation list is the transcript's own and not a restatement of the node's
 * `agents_that_used_it`.
 */
import { describe, expect, it } from '../core/test/bdd';
import { createFileLoader } from '../core/integrations/loader.node';
import { investigate } from '../core/orchestrator/run';
import { EVIDENCE_GAPS, citedEvidenceIds, evidenceCard } from './evidence';

const OPTIONS = {
  loader: createFileLoader('public/snapshots'),
  run_id: 'RUN-EVIDENCE',
  now: '2026-09-13T00:00:00.000Z',
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
};

let cached: Awaited<ReturnType<typeof investigate>> | null = null;
async function reference() {
  cached ??= await investigate({ ...OPTIONS });
  return cached;
}

describe('the cited-evidence index', () => {
  it('lists only ids the transcript really cited, each once, in the order a reader meets it', async () => {
    const r = await reference();
    const events = r.deliberation.events;
    const ids = citedEvidenceIds(events);

    expect(new Set(ids).size).toBe(ids.length);

    const flat = events.flatMap((e) => e.evidence_ids);
    for (const id of ids) expect(flat.includes(id)).toBe(true);
    expect(ids.length).toBe(new Set(flat).size);

    // First appearance order, read off the transcript itself.
    const firstSeen = ids.map((id) => events.findIndex((e) => e.evidence_ids.includes(id)));
    expect(firstSeen).toEqual([...firstSeen].sort((a, b) => a - b));
  });

  it('never offers an id the graph cannot resolve, because the coordinator filtered citations already', async () => {
    const r = await reference();
    for (const id of citedEvidenceIds(r.deliberation.events)) {
      expect(r.graph.has(id)).toBe(true);
      expect(r.graph.get(id)?.kind).toBe('evidence');
    }
  });
});

describe('an evidence card over the real graph', () => {
  it('copies the node verbatim and adds no field of its own', async () => {
    const r = await reference();
    const ids = citedEvidenceIds(r.deliberation.events);
    expect(ids.length > 0).toBe(true);

    for (const id of ids) {
      const card = evidenceCard(r.graph, id, r.deliberation.events);
      const node = r.graph.get(id);
      expect(node !== undefined && node.kind === 'evidence').toBe(true);
      if (node === undefined || node.kind !== 'evidence') continue;
      expect(card.found).toBe(true);
      expect(card.evidence).toBe(node);
      expect(card.id).toBe(id);
      expect(card.used_by).toEqual(node.agents_that_used_it);
    }
  });

  it('reads citations off the transcript, at the real sequence, by the real author', async () => {
    const r = await reference();
    const events = r.deliberation.events;
    for (const id of citedEvidenceIds(events)) {
      const card = evidenceCard(r.graph, id, events);
      const expected = events.filter((e) => e.evidence_ids.includes(id));
      expect(card.cited_in.length).toBe(expected.length);
      expect(card.cited_in.length > 0).toBe(true);
      card.cited_in.forEach((c, i) => {
        expect(c.sequence).toBe(expected[i].sequence);
        expect(c.from_agent).toBe(expected[i].from_agent);
        expect(c.type).toBe(expected[i].type);
      });
    }
  });

  it('shows only edges that exist in the graph, in the direction they were stored', async () => {
    const r = await reference();
    for (const id of citedEvidenceIds(r.deliberation.events)) {
      const card = evidenceCard(r.graph, id, r.deliberation.events);
      for (const l of card.links) {
        expect(r.graph.has(l.node_id)).toBe(true);
        expect(r.graph.get(l.node_id)?.kind).toBe(l.node_kind);
        const from = l.direction === 'from_this' ? id : l.node_id;
        const to = l.direction === 'from_this' ? l.node_id : id;
        expect(r.graph.edges({ from, to }).some((e) => e.kind === l.edge)).toBe(true);
      }
    }
  });

  it('names every field it cannot show, on every card, rather than hiding the row', async () => {
    const r = await reference();
    const fields = EVIDENCE_GAPS.map((g) => g.field);
    expect(fields).toEqual(['content hash', 'freshness verdict', 'validation status', 'retrieval query']);
    for (const g of EVIDENCE_GAPS) expect(g.why.length > 40).toBe(true);

    for (const id of citedEvidenceIds(r.deliberation.events)) {
      expect(evidenceCard(r.graph, id, r.deliberation.events).not_recorded.map((g) => g.field)).toEqual(fields);
    }
  });

  it('confirms the reason the hash row is empty - no node in the real graph carries one', async () => {
    const r = await reference();
    for (const node of r.graph.all()) {
      if (node.kind !== 'evidence') continue;
      expect('content_hash' in node).toBe(false);
    }
  });

  it('refuses an unknown id instead of rendering a blank card that would read as a real source', async () => {
    const r = await reference();
    const card = evidenceCard(r.graph, 'EV-DOES-NOT-EXIST', r.deliberation.events);
    expect(card.found).toBe(false);
    expect(card.evidence).toBe(null);
    expect(card.cited_in).toEqual([]);
    expect(card.links).toEqual([]);
    expect(card.not_recorded.length).toBe(EVIDENCE_GAPS.length);
  });

  it('refuses a real id of the wrong kind - a decision is not evidence', async () => {
    const r = await reference();
    const decision = r.outputs.decision.decision.id;
    expect(r.graph.has(decision)).toBe(true);
    expect(evidenceCard(r.graph, decision, r.deliberation.events).found).toBe(false);
  });

  it('is a pure reduction - two calls over the same run agree exactly', async () => {
    const r = await reference();
    const id = citedEvidenceIds(r.deliberation.events)[0];
    const a = evidenceCard(r.graph, id, r.deliberation.events);
    const b = evidenceCard(r.graph, id, r.deliberation.events);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
