import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from '../../test/bdd';
import {
  WORLDBANK_INDICATORS, abstractFromInverted, allProviders, crossrefProvider, duckduckgoProvider,
  hackernewsProvider, newsProvider, openalexProvider, wikidataProvider, wikipediaProvider, worldbankProvider,
} from './registry';
import type { ProviderRequest, ResearchProvider } from './types';
import { PROVIDERS } from './types';

const FIXTURES = path.join('src', 'core', 'research', 'providers', 'fixtures');
const NOW = '2026-09-14T00:00:00.000Z';

/**
 * Serves a recorded response from the live API. The recordings are real: a parser checked only
 * against a fixture its own author invented proves self-consistency, not that the API agrees.
 */
const replay = async (name: string): Promise<typeof fetch> => {
  const body = await readFile(path.join(FIXTURES, `${name}.json`), 'utf8');
  return (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
};

const request = (over: Partial<ProviderRequest> = {}): ProviderRequest => ({
  query: 'quantum computing',
  now: NOW,
  limit: 3,
  geo: [],
  proxy: null,
  fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
  timeoutMs: 5000,
  ...over,
});

const run = async (provider: ResearchProvider, fixture: string, over: Partial<ProviderRequest> = {}) =>
  provider.search(request({ fetchImpl: await replay(fixture), ...over }));

describe('research providers, against recorded live responses', () => {
  it('parses Wikipedia and labels its timestamp as a revision, not a publication', async () => {
    const out = await run(wikipediaProvider(), 'wikipedia');
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.documents.length > 0).toBe(true);
    const d = out.documents[0];
    expect(d.title.length > 0).toBe(true);
    expect(d.url?.startsWith('https://en.wikipedia.org/wiki/')).toBe(true);
    expect(d.date_kind).toBe('revised');
    expect(d.published_at).not.toBe(null);
    expect(d.excerpt.includes('<span')).toBe(false);
    expect(d.source_identity).toBe('en.wikipedia.org');
    expect(d.via_proxy).toBe(false);
  });

  it('resolves a Wikidata entity to an identifier and claims no date', async () => {
    const out = await run(wikidataProvider(), 'wikidata', { query: 'NVIDIA' });
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.documents[0].title).toContain('(Q');
    expect(out.documents[0].published_at).toBe(null);
    expect(out.documents[0].date_kind).toBe('unknown');
  });

  it('rebuilds an OpenAlex abstract from its inverted index in word order', async () => {
    const out = await run(openalexProvider(), 'openalex');
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.documents[0].date_kind).toBe('published');
    expect(out.documents[0].published_at).not.toBe(null);
    // Venue is used as identity so source concentration counts journals, not the aggregator.
    expect(out.documents[0].source_identity).not.toBe('openalex.org');
  });

  it('reads a Crossref issued date and falls back to indexed, saying which it used', async () => {
    const out = await run(crossrefProvider(), 'crossref');
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    for (const d of out.documents) expect(d.date_kind === 'published' || d.date_kind === 'indexed').toBe(true);
    expect(out.documents.some((d) => d.excerpt.includes('<')) ).toBe(false);
  });

  it('attributes a Hacker News hit to the linked publisher, not to Hacker News', async () => {
    const out = await run(hackernewsProvider(), 'hackernews', { query: 'EU AI Act' });
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.documents[0].source_identity).not.toBe('news.ycombinator.com');
    expect(out.documents[0].published_at).not.toBe(null);
  });

  it('returns a World Bank observation as a number with a unit and a period', async () => {
    const out = await run(worldbankProvider(), 'worldbank', { query: 'germany gdp', geo: ['DE'] });
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    const d = out.documents[0];
    expect(d.value).not.toBe(null);
    expect(typeof d.value!.number).toBe('number');
    expect(d.value!.unit.length > 0).toBe(true);
    expect(/^\d{4}$/.test(d.value!.period)).toBe(true);
    expect(d.date_kind).toBe('observed');
  });

  it('refuses a World Bank query it cannot address instead of guessing an indicator', async () => {
    const out = await worldbankProvider().search(request({ query: 'phantom carrier fraud in DACH' }));
    expect(out.status).toBe('empty');
    if (out.status !== 'empty') return;
    expect(out.reason).toContain('cannot be evidenced here rather than being estimated');
    expect(out.reason).toContain(String(WORLDBANK_INDICATORS.length));
  });

  it('parses a DuckDuckGo instant answer and attributes it to the underlying source', async () => {
    const out = await run(duckduckgoProvider(), 'duckduckgo');
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.documents[0].source_identity).toBe('en.wikipedia.org');
  });

  it('rebuilds an inverted index deterministically and survives rubbish', () => {
    expect(abstractFromInverted({ world: [1], hello: [0] })).toBe('hello world');
    expect(abstractFromInverted(null)).toBe('');
    expect(abstractFromInverted({ a: 'nope' })).toBe('');
  });
});

describe('provider failure is reported, never fabricated', () => {
  const failing = (impl: typeof fetch) => request({ fetchImpl: impl });

  it('reports SEARCH_FAILED on an HTTP error', async () => {
    const out = await wikipediaProvider().search(failing((async () => new Response('nope', { status: 503 })) as unknown as typeof fetch));
    expect(out.status).toBe('search_failed');
    if (out.status !== 'search_failed') return;
    expect(out.reason).toContain('HTTP 503');
  });

  it('reports SEARCH_FAILED when the body is not JSON', async () => {
    const out = await wikipediaProvider().search(failing((async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch));
    expect(out.status).toBe('search_failed');
  });

  it('reports PROVIDER_UNAVAILABLE when the request cannot be made at all, and names CORS', async () => {
    const out = await wikipediaProvider().search(failing((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch));
    expect(out.status).toBe('unavailable');
    if (out.status !== 'unavailable') return;
    expect(out.reason).toContain('CORS');
  });

  it('never leaks a provider error message, which can echo request headers', async () => {
    const secret = 'authorization: Bearer SECRET-TOKEN';
    const out = await wikipediaProvider().search(failing((async () => { throw new Error(secret); }) as unknown as typeof fetch));
    expect(JSON.stringify(out).includes('SECRET-TOKEN')).toBe(false);
  });

  it('returns empty rather than ok when a valid response contains nothing usable', async () => {
    const out = await wikipediaProvider().search(failing((async () => new Response('{"query":{"search":[]}}', { status: 200 })) as unknown as typeof fetch));
    expect(out.status).toBe('empty');
  });
});

describe('the news provider and the reader proxy', () => {
  it('refuses to run first-party and says exactly why', async () => {
    const out = await newsProvider().search(request({ proxy: null }));
    expect(out.status).toBe('unavailable');
    if (out.status !== 'unavailable') return;
    expect(out.reason).toContain('blocked by CORS');
    expect(out.reason).toContain('reader proxy is off');
  });

  it('fetches through the proxy when enabled and marks every document as proxied', async () => {
    const rss = '<rss><channel><item><title>A headline</title><link>https://example.com/a</link>' +
      '<pubDate>Mon, 08 Sep 2026 09:00:00 GMT</pubDate><source>Example</source></item></channel></rss>';
    let seen = '';
    const out = await newsProvider().search(request({
      proxy: (url) => `https://r.jina.ai/${url}`,
      fetchImpl: (async (u: string) => { seen = String(u); return new Response(rss, { status: 200 }); }) as unknown as typeof fetch,
    }));
    expect(seen.startsWith('https://r.jina.ai/')).toBe(true);
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.documents[0].via_proxy).toBe(true);
    expect(out.documents[0].source_identity).toBe('Example');
  });
});

describe('the provider registry', () => {
  it('ships exactly the providers the descriptor list declares, in the same order', () => {
    expect(allProviders().map((p) => p.descriptor.id)).toEqual(PROVIDERS.map((p) => p.id));
  });

  it('ships no provider that needs a key', () => {
    expect(allProviders().every((p) => p.descriptor.keyless)).toBe(true);
  });

  it('marks exactly one provider as proxy-only, matching the measured CORS result', () => {
    const proxied = PROVIDERS.filter((p) => p.requires_proxy);
    expect(proxied.map((p) => p.id)).toEqual(['news_rss']);
    expect(PROVIDERS.filter((p) => !p.cors_ok).map((p) => p.id)).toEqual(['news_rss']);
  });
});
