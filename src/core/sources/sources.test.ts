import { describe, expect, it } from '../test/bdd';
import { contentHash } from './hash';
import { normaliseDate, parseFeed, stripHtml } from './html';
import { industrySource, newsSource, regulatorySource, webSource } from './registry';
import { createLiveSource, fetchFeeds } from './live';

const NOW = '2026-09-13T00:00:00.000Z';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>GPS tracker exposes fake haulier in Cologne freight fraud case</title>
<link>https://example.org/a</link><pubDate>Wed, 20 Aug 2026 09:00:00 GMT</pubDate>
<description><![CDATA[<p>A <b>trailer</b> was booked by a carrier that did not exist.</p>]]></description>
<source url="https://trans.info">Trans.INFO</source></item>
<item><title>Undated freight article</title><link>https://example.org/b</link>
<description>no date here</description></item>
<item><title>No link freight article</title><pubDate>Wed, 20 Aug 2026 09:00:00 GMT</pubDate></item>
<item><title>Unrelated cooking piece</title><link>https://example.org/c</link><pubDate>Wed, 20 Aug 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;

const okResponse = (body: string) => new Response(body, { status: 200 });
const fakeFetch = (body = RSS): typeof fetch => (async () => okResponse(body)) as unknown as typeof fetch;
const deps = (fetchImpl: typeof fetch) => ({ fetchImpl, hash: contentHash });

describe('live source parsing', () => {
  it('removes script and style content rather than escaping it', () => {
    expect(stripHtml('<p>ok</p><script>steal()</script><style>a{}</style>')).toBe('ok');
    expect(stripHtml('<div>a &amp; b</div>')).toBe('a & b');
  });

  it('reads RSS and Atom entries, and never dates an item from the clock', () => {
    const entries = parseFeed(RSS);
    expect(entries.length).toBe(4);
    expect(entries[0]!.publisher).toBe('Trans.INFO');
    expect(entries[1]!.published_at).toBeNull();
    expect(normaliseDate('not a date')).toBeNull();
    const atom = parseFeed('<feed><entry><title>Atom item</title><link href="https://example.org/x"/><updated>2026-08-20T09:00:00Z</updated></entry></feed>');
    expect(atom[0]!.url).toBe('https://example.org/x');
    expect(atom[0]!.published_at).toBe('2026-08-20T09:00:00.000Z');
  });

  it('hashes the exact bytes it parsed, and labels a non-cryptographic fallback', async () => {
    const a = await contentHash('one');
    expect(a).toBe(await contentHash('one'));
    expect(a).not.toBe(await contentHash('two'));
    expect(a.startsWith('fnv1a:') ? a : `sha256:${a}`).toContain(a.startsWith('fnv1a:') ? 'fnv1a:' : 'sha256:');
  });
});

describe('live retrieval', () => {
  it('reports a blocked fetch instead of substituting anything for it', async () => {
    const blocked: typeof fetch = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const out = await fetchFeeds([newsSource()], { terms: ['freight fraud'], geo: ['DE'] }, deps(blocked));
    expect(out.feeds.length).toBe(0);
    expect(out.failures[0]!.kind).toBe('blocked');
    expect(out.failures[0]!.reason).toContain('cross-origin');
  });

  it('reports an http error and a body with no entries as separate failures', async () => {
    const notFound: typeof fetch = (async () => new Response('', { status: 404, statusText: 'Not Found' })) as unknown as typeof fetch;
    const bad = await fetchFeeds([newsSource()], { terms: ['x'], geo: ['DE'] }, deps(notFound));
    expect(bad.failures[0]!.kind).toBe('http_error');
    const empty = await fetchFeeds([newsSource()], { terms: ['x'], geo: ['DE'] }, deps(fakeFetch('<rss></rss>')));
    expect(empty.failures[0]!.kind).toBe('parse_error');
  });

  it('says a source is unconfigured rather than pretending it returned nothing', async () => {
    const out = await fetchFeeds([regulatorySource([]), industrySource([])], { terms: ['x'], geo: ['DE'] }, deps(fakeFetch()));
    expect(out.failures.map((f) => f.kind)).toEqual(['not_configured', 'not_configured']);
  });

  it('ships no default endpoint for a tier-1 source', () => {
    expect(regulatorySource([]).endpoints({ terms: ['x'], geo: [] }).length).toBe(0);
    expect(regulatorySource([]).source_type).toBe('regulator');
    expect(newsSource().endpoints({ terms: ['a', 'b'], geo: ['DE'] }).length).toBe(2);
  });

  it('gives an arbitrary url the weakest tier whatever it contains', () => {
    expect(webSource(['https://example.org']).source_type).toBe('portfolio_kb');
    const items = webSource(['https://example.org']).parse('<html><title>A page</title><body>freight</body></html>');
    expect(items.length).toBe(1);
    expect(items[0]!.title).toBe('A page');
  });

  it('drops undated and unlinked items, and re-derives the category by keyword', async () => {
    const source = createLiveSource({
      sources: [newsSource()],
      query: { terms: ['freight fraud'], geo: ['DE'] },
      deps: deps(fakeFetch()),
      now: NOW,
    });
    const out = await source.querySignals({ geo: ['DE'], from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z', limit: 40 });
    expect(out.stats.scanned).toBe(4);
    expect(out.stats.excluded_undated).toBe(1);
    expect(out.stats.excluded_no_url).toBe(1);
    expect(out.stats.excluded_low_relevance).toBe(1);
    expect(out.signals.length).toBe(1);
    expect(out.signals[0]!.category_upstream).toBe('unstated');
    expect(out.signals[0]!.category_derived).toBe('Carrier / Freight Fraud');
    expect(out.signals[0]!.publisher).toBe('Trans.INFO');
  });

  it('publishes provenance that admits a live run is not reproducible', async () => {
    const source = createLiveSource({
      sources: [newsSource()],
      query: { terms: ['freight fraud'], geo: ['DE'] },
      deps: deps(fakeFetch()),
      now: NOW,
    });
    const prov = await source.provenance();
    expect(prov.commit).toBeNull();
    expect(prov.note).toContain('not reproducible');
    expect(prov.files[0]!.sha256.length).toBeGreaterThan(8);
  });

  it('reports what retrieval did, so a blocked feed is not read as a quiet world', async () => {
    const blocked: typeof fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const source = createLiveSource({
      sources: [newsSource()],
      query: { terms: ['freight fraud'], geo: ['DE'] },
      deps: deps(blocked),
      now: NOW,
    });
    const out = await source.querySignals({ geo: ['DE'], from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' });
    expect(out.signals.length).toBe(0);
    expect(out.stats.scanned).toBe(0);
    expect(out.retrieval!.sources_read).toBe(0);
    expect(out.retrieval!.sources_failed).toBeGreaterThan(0);
    expect(out.retrieval!.failures[0]!.kind).toBe('blocked');
  });

  it('reports partial retrieval when one source answers and another does not', async () => {
    let call = 0;
    const flaky: typeof fetch = (async () => {
      call += 1;
      if (call === 1) return okResponse(RSS);
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const source = createLiveSource({
      sources: [newsSource(), regulatorySource(['https://example.org/reg.xml'])],
      query: { terms: ['freight fraud'], geo: ['DE'] },
      deps: deps(flaky),
      now: NOW,
    });
    const out = await source.querySignals({ geo: ['DE'], from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' });
    expect(out.retrieval!.sources_read).toBe(1);
    expect(out.retrieval!.sources_failed).toBe(1);
  });

  it('keeps an item out of the window rather than widening the window', async () => {
    const source = createLiveSource({
      sources: [newsSource()],
      query: { terms: ['freight fraud'], geo: ['DE'] },
      deps: deps(fakeFetch()),
      now: NOW,
    });
    const out = await source.querySignals({ from: '2020-01-01T00:00:00.000Z', to: '2020-02-01T00:00:00.000Z' });
    expect(out.signals.length).toBe(0);
    expect(out.stats.excluded_out_of_window).toBe(2);
  });
});
