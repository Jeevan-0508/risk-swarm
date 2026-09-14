/**
 * EVOLUTION 5.0 Phase H. The pieces of the research pipeline were already tested; what was never tested is
 * the thing that did not exist - the caller that composes them. These tests defend only what composition
 * can get wrong, with stub providers and a real committed knowledge index, so no network is touched.
 */
import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { createInternalKnowledge } from '../knowledge/internal';
import { research, researchRunId, type ResearchDeps } from './session';
import { PROVIDERS, providerById, type ProviderId, type ProviderOutcome, type ResearchDocument, type ResearchProvider } from './providers/types';

const NOW = '2026-09-14T00:00:00.000Z';

const doc = (over: Partial<ResearchDocument> & { title: string }): ResearchDocument => ({
  provider: 'wikipedia',
  query: 'q',
  url: `https://example.com/${over.title.replace(/\s+/g, '-')}`,
  published_at: '2026-09-01T00:00:00.000Z',
  date_kind: 'published',
  retrieved_at: NOW,
  source_identity: 'example.com',
  excerpt: 'a sentence of source text long enough to be an excerpt',
  value: null,
  via_proxy: false,
  ...over,
});

const stub = (id: ProviderId, outcome: ProviderOutcome): ResearchProvider => ({
  descriptor: providerById(id),
  async search() {
    return outcome;
  },
});

const allStubs = (outcome: ProviderOutcome): ResearchProvider[] => PROVIDERS.map((p) => stub(p.id, outcome));

function deps(over: Partial<ResearchDeps> = {}): ResearchDeps {
  return {
    providers: allStubs({ status: 'ok', documents: [doc({ title: 'Surface codes explained' })] }),
    knowledge: createInternalKnowledge(createFileLoader('public/snapshots')),
    fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
    now: NOW,
    hash: async (t: string) => `h${t.length}`,
    clock: () => 0,
    ...over,
  };
}

const QUESTION = 'How does a quantum error-correcting code actually work?';

describe('one research pass, composed', () => {
  it('reads the clock once: every timestamp in the pass is the same instant', async () => {
    const out = await research({ question: QUESTION, proxyEnabled: false }, deps());
    expect(out.now).toBe(NOW);
    expect(out.run_id).toBe(researchRunId(NOW));
    for (const item of out.merged.items) {
      expect(item.evidence.created_at).toBe(NOW);
      expect(item.evidence.run_id).toBe(out.run_id);
    }
  });

  it('never hands a provider a proxy the operator did not enable', async () => {
    let sawProxy: unknown = 'unset';
    const spy: ResearchProvider = {
      descriptor: providerById('wikipedia'),
      async search(request) {
        sawProxy = request.proxy;
        return { status: 'empty', reason: 'nothing' };
      },
    };
    await research({ question: QUESTION, proxyEnabled: false }, deps({ providers: [spy], proxy: (u) => `https://proxy/${u}` }));
    expect(sawProxy).toBe(null);
  });

  it('hands the proxy through when the operator did enable it', async () => {
    let sawProxy: unknown = 'unset';
    const spy: ResearchProvider = {
      descriptor: providerById('wikipedia'),
      async search(request) {
        sawProxy = request.proxy === null ? null : request.proxy('https://x/y');
        return { status: 'empty', reason: 'nothing' };
      },
    };
    await research({ question: QUESTION, proxyEnabled: true }, deps({ providers: [spy], proxy: (u) => `https://proxy/${u}` }));
    expect(sawProxy).toBe('https://proxy/https://x/y');
  });

  it('normalises nothing when nothing was retained, rather than producing an empty report that reads as a result', async () => {
    const out = await research(
      { question: QUESTION, proxyEnabled: false },
      deps({ providers: allStubs({ status: 'search_failed', reason: 'SEARCH_FAILED: stubbed' }) }),
    );
    expect(out.execution.status).toBe('search_failed');
    expect(out.external).toBe(null);
    expect(out.merged.items.filter((i) => i.provenance.origin === 'external').length).toBe(0);
  });

  it('merges external and internal into exactly their union - no extra item appears from merging', async () => {
    const out = await research({ question: QUESTION, proxyEnabled: false }, deps());
    const expected = (out.external?.items.length ?? 0) + (out.internal?.items.length ?? 0);
    expect(out.merged.items.length).toBe(expected);
    const ids = new Set(out.merged.items.map((i) => i.evidence.id));
    expect(ids.size).toBe(out.merged.items.length);
  });

  it('labels each item with the side of the boundary it really came from', async () => {
    const out = await research({ question: QUESTION, proxyEnabled: false }, deps());
    for (const item of out.external?.items ?? []) expect(item.provenance.origin).toBe('external');
    for (const item of out.internal?.items ?? []) {
      expect(item.provenance.origin).toBe('internal');
      expect(item.provenance.provider).toBe('repository');
    }
  });

  it('reports a skipped internal search as null, not as a search that found nothing', async () => {
    const skipped = { ...deps() };
    // A timeless definition question the planner does not route to internal knowledge.
    const out = await research({ question: 'What is the boiling point of water?', proxyEnabled: false }, skipped);
    if (out.plan.internal.search) {
      expect(out.internal_outcome !== null).toBe(true);
    } else {
      expect(out.internal_outcome).toBe(null);
      expect(out.internal).toBe(null);
      expect(out.plan.internal.rationale.length > 10).toBe(true);
    }
  });

  it('lowers the call budget when asked and never raises it', async () => {
    const tight = await research({ question: QUESTION, proxyEnabled: false, maxProviderCalls: 2 }, deps());
    expect(tight.plan.budget.max_provider_calls).toBe(2);
    expect(tight.execution.counters.queries_issued <= 2).toBe(true);
    const open = await research({ question: QUESTION, proxyEnabled: false }, deps());
    expect(open.plan.budget.max_provider_calls > 2).toBe(true);
  });

  it('carries every provider failure through to the caller with the provider\u2019s own reason', async () => {
    const out = await research(
      { question: QUESTION, proxyEnabled: false },
      deps({ providers: allStubs({ status: 'unavailable', reason: 'PROVIDER_UNAVAILABLE: stubbed CORS' }) }),
    );
    expect(out.execution.attempts.length > 0).toBe(true);
    for (const a of out.execution.attempts) {
      expect(a.status).toBe('unavailable');
      expect(a.reason).toBe('PROVIDER_UNAVAILABLE: stubbed CORS');
    }
  });

  it('is deterministic given the same clock, providers and question', async () => {
    const a = await research({ question: QUESTION, proxyEnabled: false }, deps());
    const b = await research({ question: QUESTION, proxyEnabled: false }, deps());
    expect(a.run_id).toBe(b.run_id);
    expect(a.merged.items.map((i) => i.evidence.title)).toEqual(b.merged.items.map((i) => i.evidence.title));
    expect(JSON.stringify(a.execution.counters)).toBe(JSON.stringify(b.execution.counters));
  });
});
