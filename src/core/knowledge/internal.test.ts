import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { createMemoryLoader } from '../integrations/loader';
import { routeQuestion } from '../question/model';
import { planResearch } from '../research/plan';
import { KNOWLEDGE_INDEX_PATH, createInternalKnowledge } from './internal';

const loader = createFileLoader('public/snapshots');
const knowledge = () => createInternalKnowledge(loader);

describe('internal knowledge retrieval', () => {
  it('reads the committed index and reports its hash and size', async () => {
    const meta = await knowledge().meta();
    expect(meta).not.toBe(null);
    expect(meta!.record_count > 100).toBe(true);
    expect(meta!.content_hash.length).toBe(64);
    expect(meta!.sources.length > 1).toBe(true);
  });

  it('indexes all three kinds of repository knowledge, not just the freight taxonomy', async () => {
    const out = await knowledge().search(['taxonomy'], { limit: 200, minScore: 0 });
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    const kinds = new Set(out.hits.map((h) => h.record.source_kind));
    const all = await knowledge().search(['pattern', 'control', 'architecture'], { limit: 300, minScore: 0 });
    expect(all.status).toBe('ok');
    if (all.status !== 'ok') return;
    const allKinds = new Set(all.hits.map((h) => h.record.source_kind));
    expect(allKinds.has('taxonomy') || kinds.has('taxonomy')).toBe(true);
    expect(allKinds.has('document')).toBe(true);
  });

  it('finds the freight pattern it was always able to find', async () => {
    const out = await knowledge().search(['phantom carrier fraud']);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.hits.some((h) => h.record.ref === 'FFT-002')).toBe(true);
    const hit = out.hits.find((h) => h.record.ref === 'FFT-002')!;
    expect(hit.record.path).toBe('freight-risk-atlas/taxonomy.json');
    expect(hit.record.sha256.length).toBe(64);
    expect(hit.matched_terms.length > 0).toBe(true);
  });

  it('finds a governance control from a completely different domain', async () => {
    const out = await knowledge().search(['AI system inventory registration'], { kinds: ['controls'] });
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.hits.length > 0).toBe(true);
    expect(out.hits.every((h) => h.record.source_kind === 'controls')).toBe(true);
  });

  it('reports an honest empty rather than implying nothing exists', async () => {
    const out = await knowledge().search(['zzzqqqxxnonexistentterm']);
    expect(out.status).toBe('empty');
    if (out.status !== 'empty') return;
    expect(out.reason.includes('not that nothing exists')).toBe(true);
  });

  it('reports INTERNAL_KNOWLEDGE_UNAVAILABLE when the index is missing', async () => {
    const out = await createInternalKnowledge(createMemoryLoader({})).search(['anything']);
    expect(out.status).toBe('unavailable');
    if (out.status !== 'unavailable') return;
    expect(out.reason.startsWith('INTERNAL_KNOWLEDGE_UNAVAILABLE')).toBe(true);
  });

  it('survives an index whose records key is not an array', async () => {
    const broken = createMemoryLoader({ [KNOWLEDGE_INDEX_PATH]: { records: 'nope' } });
    const out = await createInternalKnowledge(broken).search(['anything']);
    expect(out.status).toBe('unavailable');
  });

  it('is deterministic and stable under tie-breaking', async () => {
    const a = await knowledge().search(['fraud', 'carrier']);
    const b = await knowledge().search(['fraud', 'carrier']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('ranks a specific term above a term that appears in almost every record', async () => {
    const specific = await knowledge().search(['seal tampering reseal']);
    expect(specific.status).toBe('ok');
    if (specific.status !== 'ok') return;
    expect(specific.hits[0]?.record.ref).toBe('FFT-007');
  });

  it('answers the planner\u2019s internal queries for an off-domain question', async () => {
    const plan = planResearch(routeQuestion('Explain quantum computing.'));
    const out = await knowledge().search(plan.internal.queries);
    // The repository holds nothing about quantum computing, and saying so is the correct answer.
    expect(out.status === 'ok' || out.status === 'empty').toBe(true);
    if (out.status === 'ok') {
      for (const h of out.hits) expect(h.score <= 1).toBe(true);
    }
  });
});
