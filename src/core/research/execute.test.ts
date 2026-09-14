import { describe, expect, it } from '../test/bdd';
import { routeQuestion } from '../question/model';
import { planResearch } from './plan';
import { executeResearch, type ResearchEvent } from './execute';
import type { ProviderId, ProviderOutcome, ResearchDocument, ResearchProvider } from './providers/types';
import { PROVIDERS, providerById } from './providers/types';

const NOW = '2026-09-14T00:00:00.000Z';

const doc = (over: Partial<ResearchDocument> & { title: string }): ResearchDocument => ({
  provider: 'wikipedia',
  query: 'q',
  url: `https://example.com/${over.title.replace(/\s+/g, '-')}`,
  published_at: '2026-09-01T00:00:00.000Z',
  date_kind: 'published',
  retrieved_at: NOW,
  source_identity: 'example.com',
  excerpt: 'text',
  value: null,
  via_proxy: false,
  ...over,
});

/** A provider that returns whatever the test says, so execution is tested without a network. */
const stub = (id: ProviderId, outcome: ProviderOutcome | (() => ProviderOutcome)): ResearchProvider => ({
  descriptor: providerById(id),
  async search() {
    return typeof outcome === 'function' ? outcome() : outcome;
  },
});

const allStubs = (outcome: ProviderOutcome): ResearchProvider[] => PROVIDERS.map((p) => stub(p.id, outcome));

const exec = (question: string, providers: ResearchProvider[], over: Partial<Parameters<typeof executeResearch>[1]> = {}) =>
  executeResearch(planResearch(routeQuestion(question)), {
    providers,
    fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
    now: NOW,
    clock: () => 0,
    ...over,
  });

describe('research execution counts only what happened', () => {
  it('reports retained, returned and duplicate counts that add up', async () => {
    const out = await exec('Explain quantum computing.', allStubs({ status: 'ok', documents: [doc({ title: 'A' }), doc({ title: 'A' })] }));
    expect(out.counters.documents_returned).toBe(out.counters.documents_retained + out.counters.duplicates_dropped);
    expect(out.counters.queries_issued).toBe(out.attempts.filter((a) => a.status !== 'skipped_budget' && a.status !== 'unavailable').length);
  });

  it('drops a document with the same url and records which one it kept', async () => {
    const out = await exec('Explain quantum computing.', allStubs({ status: 'ok', documents: [doc({ title: 'First' }), doc({ title: 'Second', url: 'https://www.example.com/First/' })] }));
    expect(out.duplicates.some((d) => d.reason === 'same_url' && d.kept === 'First')).toBe(true);
  });

  it('drops a restatement with the same title and source even when the url differs', async () => {
    const out = await exec('Explain quantum computing.', allStubs({
      status: 'ok',
      documents: [doc({ title: 'Same Story' }), doc({ title: 'same story!', url: 'https://example.com/other' })],
    }));
    expect(out.duplicates.some((d) => d.reason === 'same_title_and_source')).toBe(true);
  });

  it('keeps two documents with the same title from different sources, because that is corroboration', async () => {
    // One shot only: the plan calls several providers, and a stub that answered every
    // call would duplicate itself, which is a different behaviour from the one under test.
    let served = false;
    const once = (): ProviderOutcome => {
      if (served) return { status: 'empty', reason: 'already served' };
      served = true;
      return {
        status: 'ok',
        documents: [doc({ title: 'Same Story' }), doc({ title: 'Same Story', url: 'https://other.org/x', source_identity: 'other.org' })],
      };
    };
    const out = await exec('Explain quantum computing.', PROVIDERS.map((p) => stub(p.id, once)));
    expect(out.counters.documents_retained).toBe(2);
    expect(out.duplicates.length).toBe(0);
  });

  it('warns when one source dominates, and does not call it corroboration', async () => {
    const many = Array.from({ length: 6 }, (_, i) => doc({ title: `Story ${i}` }));
    const out = await exec('Explain quantum computing.', allStubs({ status: 'ok', documents: many }));
    expect(out.source_concentration[0].source_identity).toBe('example.com');
    expect(out.notes.some((n) => n.includes('is not corroboration'))).toBe(true);
  });

  it('reports FRESHNESS_UNKNOWN rather than dating a document from the clock', async () => {
    const out = await exec('Explain quantum computing.', allStubs({ status: 'ok', documents: [doc({ title: 'Undated', published_at: null, date_kind: 'unknown' })] }));
    expect(out.documents.every((d) => d.published_at === null || d.published_at !== NOW)).toBe(true);
    expect(out.notes.some((n) => n.includes('FRESHNESS_UNKNOWN'))).toBe(true);
    expect(out.counters.undated_documents > 0).toBe(true);
  });
});

describe('research execution when things go wrong', () => {
  it('reports SEARCH_FAILED when no provider answers, and retains nothing', async () => {
    const out = await exec('Explain quantum computing.', allStubs({ status: 'search_failed', reason: 'SEARCH_FAILED: HTTP 500' }));
    expect(out.status).toBe('search_failed');
    expect(out.documents.length).toBe(0);
    expect(out.notes.some((n) => n.includes('nothing in this run rests on external evidence'))).toBe(true);
  });

  it('reports partial when some providers fail and some answer', async () => {
    const providers = PROVIDERS.map((p, i) =>
      i % 2 === 0 ? stub(p.id, { status: 'ok', documents: [doc({ title: `T${i}` })] }) : stub(p.id, { status: 'unavailable', reason: 'PROVIDER_UNAVAILABLE: CORS' }),
    );
    const out = await exec('Explain quantum computing.', providers);
    expect(out.status).toBe('partial');
    expect(out.counters.providers_unavailable > 0).toBe(true);
    expect(out.notes.some((n) => n.includes('CORS header'))).toBe(true);
  });

  it('treats an empty provider as neither success nor failure', async () => {
    const out = await exec('Explain quantum computing.', allStubs({ status: 'empty', reason: 'nothing matched' }));
    expect(out.counters.providers_empty > 0).toBe(true);
    expect(out.counters.providers_failed).toBe(0);
    expect(out.status).toBe('search_failed');
  });

  it('names a provider that is planned but not registered instead of skipping it silently', async () => {
    const out = await exec('Explain quantum computing.', [stub('wikipedia', { status: 'ok', documents: [doc({ title: 'A' })] })]);
    expect(out.attempts.some((a) => a.status === 'unavailable' && a.reason?.includes('not registered'))).toBe(true);
  });
});

describe('research budgets are enforced here, not trusted upstream', () => {
  it('stops at the document budget and says which limit was hit', async () => {
    const plan = planResearch(routeQuestion('What are the major emerging risks in European freight?'), { budget: { max_documents: 2 } });
    const out = await executeResearch(plan, {
      providers: allStubs({ status: 'ok', documents: [doc({ title: 'A' }), doc({ title: 'B' }), doc({ title: 'C' })] }),
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
      now: NOW,
      clock: () => 0,
    });
    expect(out.status).toBe('limit_reached');
    expect(out.limit_reached).toContain('document budget');
    expect(out.documents.length).toBe(2);
  });

  it('stops at the time ceiling using the injected clock', async () => {
    let t = 0;
    const plan = planResearch(routeQuestion('What are the major emerging risks in European freight?'));
    const out = await executeResearch(plan, {
      providers: allStubs({ status: 'ok', documents: [doc({ title: 'A' })] }),
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
      now: NOW,
      clock: () => (t += 20_000),
    });
    expect(out.status).toBe('limit_reached');
    expect(out.limit_reached).toContain('ms ceiling');
  });

  it('never issues more queries than the plan budget allows', async () => {
    const plan = planResearch(routeQuestion('What are the major emerging risks in European freight?'), { budget: { max_provider_calls: 3 } });
    const out = await executeResearch(plan, {
      providers: allStubs({ status: 'ok', documents: [doc({ title: 'A' })] }),
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
      now: NOW,
      clock: () => 0,
    });
    expect(out.counters.queries_issued <= 3).toBe(true);
  });
});

describe('research events are emitted from real execution only', () => {
  it('emits one query_issued per issued query and never more', async () => {
    const events: ResearchEvent[] = [];
    const out = await exec('Explain quantum computing.', allStubs({ status: 'ok', documents: [doc({ title: 'A' })] }), { onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.kind === 'query_issued').length).toBe(out.counters.queries_issued);
    expect(events.filter((e) => e.kind === 'document_retained').length).toBe(out.counters.documents_retained);
    expect(events[0].kind).toBe('plan_started');
    expect(events[events.length - 1].kind).toBe('plan_finished');
  });

  it('emits no document_retained event when every provider fails', async () => {
    const events: ResearchEvent[] = [];
    await exec('Explain quantum computing.', allStubs({ status: 'search_failed', reason: 'SEARCH_FAILED' }), { onEvent: (e) => events.push(e) });
    expect(events.some((e) => e.kind === 'document_retained')).toBe(false);
    expect(events.some((e) => e.kind === 'provider_failed')).toBe(true);
  });

  it('passes the proxy only to a provider entitled to it', async () => {
    const seen: Array<boolean> = [];
    const provider: ResearchProvider = {
      descriptor: providerById('wikipedia'),
      async search(req) {
        seen.push(req.proxy !== null);
        return { status: 'empty', reason: 'x' };
      },
    };
    await exec('Explain quantum computing.', [provider]);
    expect(seen.length > 0).toBe(true);
    expect(seen.every((p) => p === false)).toBe(true);
  });
});
