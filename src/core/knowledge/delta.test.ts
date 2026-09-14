import { describe, expect, it } from '../test/bdd';
import { Minter } from '../domain/build';
import { routeQuestion } from '../question/model';
import { planResearch, type ResearchPlan } from '../research/plan';
import { normalizeExternal } from '../research/normalize';
import type { ResearchDocument } from '../research/providers/types';
import { appendDelta, deltasForDomain, emptyLedger, pendingDeltas, proposeDelta } from './delta';

const NOW = '2026-09-14T00:00:00.000Z';
const minter = () => new Minter('RUN-KD', () => NOW);
const deps = (question: string) => ({ minter: minter(), now: NOW, question, hash: async (t: string) => `h${t.length}` });

const doc = (over: Partial<ResearchDocument> & { title: string }): ResearchDocument => ({
  provider: 'wikipedia',
  query: 'quantum computing',
  url: `https://en.wikipedia.org/wiki/${over.title.replace(/\s+/g, '_')}`,
  published_at: '2026-09-01T00:00:00.000Z',
  date_kind: 'published',
  retrieved_at: NOW,
  source_identity: 'en.wikipedia.org',
  excerpt: 'Quantum computers use qubits rather than bits.',
  value: null,
  via_proxy: false,
  ...over,
});

const OPTIONS = { run_id: 'RUN-KD', now: NOW };

async function planFor(question: string): Promise<ResearchPlan> {
  return planResearch(routeQuestion(question), { proxyEnabled: true });
}

describe('the research ledger', () => {
  it('proposes nothing when the plan never expected a knowledge update', async () => {
    const q = routeQuestion('What is the boiling point of water?'); // timeless
    const plan = await planFor('What is the boiling point of water?');
    expect(plan.knowledge_update_expected).toBe(false);
    const delta = await proposeDelta(q, plan, [], OPTIONS);
    expect(delta).toBeNull();
  });

  it('proposes a delta as status "proposed", never anything stronger, when an update is expected', async () => {
    const question = 'What are the latest developments in quantum computing?';
    const q = routeQuestion(question);
    const plan = await planFor(question);
    expect(plan.knowledge_update_expected).toBe(true);

    const normalized = await normalizeExternal(
      [doc({ title: 'Quantum computing' }), doc({ title: 'Qubit', source_identity: 'arxiv.org', provider: 'openalex' })],
      deps(question),
    );

    const delta = await proposeDelta(q, plan, normalized.items, OPTIONS);
    expect(delta).not.toBeNull();
    expect(delta!.status).toBe('proposed');
    expect(delta!.run_id).toBe('RUN-KD');
    expect(delta!.domain).toBe(q.domain);
    expect(delta!.subdomains).toEqual(q.subdomains);
    expect(delta!.question).toBe(question);
    expect(delta!.evidence_count).toBe(2);
    expect(delta!.distinct_source_count).toBe(2);
    expect(delta!.evidence_ids.length).toBe(2);
  });

  it('counts distinct sources, not documents: two items from the same source_identity count once', async () => {
    const question = 'What are the latest developments in quantum computing?';
    const q = routeQuestion(question);
    const plan = await planFor(question);
    const normalized = await normalizeExternal(
      [doc({ title: 'Quantum computing' }), doc({ title: 'Quantum computing history' })],
      deps(question),
    );
    const delta = await proposeDelta(q, plan, normalized.items, OPTIONS);
    expect(delta!.evidence_count).toBe(2);
    expect(delta!.distinct_source_count).toBe(1);
  });

  it('excludes internally-sourced evidence from the count: a delta is about what research reached, not what was already pinned', async () => {
    const question = 'What are the latest developments in quantum computing?';
    const q = routeQuestion(question);
    const plan = await planFor(question);
    const normalized = await normalizeExternal([doc({ title: 'Quantum computing' })], deps(question));
    // Simulate an internal-origin item by relabelling the provenance, the way normalizeInternal would produce it.
    const withInternal = [...normalized.items, { ...normalized.items[0]!, provenance: { ...normalized.items[0]!.provenance, origin: 'internal' as const } }];
    const delta = await proposeDelta(q, plan, withInternal, OPTIONS);
    expect(delta!.evidence_count).toBe(1);
  });

  it('says so, rather than fabricating support, when a knowledge update was expected but nothing was normalized', async () => {
    const question = 'What are the latest developments in quantum computing?';
    const q = routeQuestion(question);
    const plan = await planFor(question);
    const delta = await proposeDelta(q, plan, [], OPTIONS);
    expect(delta!.evidence_count).toBe(0);
    expect(delta!.rationale.toLowerCase()).toContain('no external evidence was normalized');
  });

  it('is deterministic: the same run, question and evidence always mint the same id', async () => {
    const question = 'What are the latest developments in quantum computing?';
    const q = routeQuestion(question);
    const plan = await planFor(question);
    const normalized = await normalizeExternal([doc({ title: 'Quantum computing' })], deps(question));
    const a = await proposeDelta(q, plan, normalized.items, OPTIONS);
    const b = await proposeDelta(q, plan, normalized.items, OPTIONS);
    expect(a!.id).toBe(b!.id);
  });

  it('is append-only and never mutates the ledger it was given', async () => {
    const question = 'What are the latest developments in quantum computing?';
    const q = routeQuestion(question);
    const plan = await planFor(question);
    const normalized = await normalizeExternal([doc({ title: 'Quantum computing' })], deps(question));
    const delta = await proposeDelta(q, plan, normalized.items, OPTIONS);

    const before = emptyLedger();
    const after = appendDelta(before, delta);
    expect(before.entries.length).toBe(0);
    expect(after.entries.length).toBe(1);
    expect(after.entries[0]!.status).toBe('proposed');
  });

  it('is a no-op appending null, the honest result of a run that expected no update', () => {
    const ledger = appendDelta(emptyLedger(), null);
    expect(ledger.entries.length).toBe(0);
  });

  it('can be queried by domain and by pending status', async () => {
    const question = 'What are the latest developments in quantum computing?';
    const q = routeQuestion(question);
    const plan = await planFor(question);
    const normalized = await normalizeExternal([doc({ title: 'Quantum computing' })], deps(question));
    const delta = await proposeDelta(q, plan, normalized.items, OPTIONS);
    const ledger = appendDelta(emptyLedger(), delta);

    expect(deltasForDomain(ledger, q.domain).length).toBe(1);
    expect(deltasForDomain(ledger, 'a domain nothing was ever proposed under').length).toBe(0);
    expect(pendingDeltas(ledger).length).toBe(1);
  });
});
