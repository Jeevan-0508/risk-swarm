/**
 * THE EIGHT PROVIDERS.
 *
 * Each one does exactly three things: build a URL from a query, read the response, and return
 * documents with provenance. None of them scores, classifies or concludes - that happens later, in
 * code that can be tested without a network.
 *
 * Every parser in this file was written against a real captured response from the live API, stored in
 * `./fixtures/`. A parser tested only against a fixture the author invented proves that the author is
 * self-consistent, not that the API returns what the parser expects; so the fixtures are recordings.
 *
 * Where an API returns a date, the *kind* of date is carried with it. A Wikipedia timestamp is the
 * last revision, Crossref's `indexed` is when Crossref saw it, and a World Bank observation is a
 * period, not a publication. Flattening those into one `published_at` would quietly manufacture
 * freshness.
 */
import { sanitiseText } from '../../ingest/sanitize';
import type { ProviderOutcome, ProviderRequest, ResearchDocument, ResearchProvider } from './types';
import { providerById } from './types';

const EXCERPT = 600;

const clean = (v: unknown, max = EXCERPT): string => sanitiseText(typeof v === 'string' ? v : '', max).text;
const stripTags = (v: unknown): string => (typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ') : '');
const hostOf = (url: string | null): string => {
  if (url === null) return 'unknown';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
};
const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.trim().length === 0) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** One fetch, with a timeout, returning parsed JSON or a typed failure. Never throws at the caller. */
async function getJson(request: ProviderRequest, url: string): Promise<{ ok: true; body: unknown } | { ok: false; outcome: ProviderOutcome }> {
  const target = request.proxy === null ? url : request.proxy(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const res = await request.fetchImpl(target, { signal: controller.signal });
    if (!res.ok) return { ok: false, outcome: { status: 'search_failed', reason: `SEARCH_FAILED: HTTP ${res.status}` } };
    const text = await res.text();
    if (text.trim().length === 0) return { ok: false, outcome: { status: 'empty', reason: 'The provider returned an empty body.' } };
    try {
      return { ok: true, body: JSON.parse(text) };
    } catch {
      return { ok: false, outcome: { status: 'search_failed', reason: 'SEARCH_FAILED: the response was not JSON.' } };
    }
  } catch (err) {
    // Provider errors can echo request headers, so the message is classified rather than interpolated.
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      outcome: {
        status: aborted ? 'search_failed' : 'unavailable',
        reason: aborted
          ? `SEARCH_FAILED: the provider did not answer within ${request.timeoutMs}ms.`
          : 'PROVIDER_UNAVAILABLE: the request could not be made at all, which in a browser usually means the provider sends no CORS header.',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

const ok = (documents: ResearchDocument[], reason: string): ProviderOutcome =>
  documents.length === 0 ? { status: 'empty', reason } : { status: 'ok', documents };

const base = (request: ProviderRequest, provider: ResearchDocument['provider']) => ({
  provider,
  query: request.query,
  retrieved_at: request.now,
  via_proxy: request.proxy !== null,
  value: null,
});

export const wikipediaProvider = (): ResearchProvider => ({
  descriptor: providerById('wikipedia'),
  async search(request) {
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=${request.limit}` +
      `&srsearch=${encodeURIComponent(request.query)}`;
    const got = await getJson(request, url);
    if (!got.ok) return got.outcome;
    const rows = (got.body as { query?: { search?: unknown[] } }).query?.search ?? [];
    const documents = rows.flatMap((raw) => {
      const r = raw as { title?: string; snippet?: string; timestamp?: string };
      const title = clean(r.title, 200);
      if (title.length === 0) return [];
      const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
      return [{
        ...base(request, 'wikipedia'),
        title,
        url: pageUrl,
        // The API's timestamp is the last revision, not a publication date, and is labelled as such.
        published_at: isoOrNull(r.timestamp),
        date_kind: 'revised' as const,
        source_identity: 'en.wikipedia.org',
        excerpt: clean(stripTags(r.snippet)),
      }];
    });
    return ok(documents, 'Wikipedia matched no article for this query.');
  },
});

export const wikidataProvider = (): ResearchProvider => ({
  descriptor: providerById('wikidata'),
  async search(request) {
    const url =
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&language=en&format=json&origin=*&limit=${request.limit}` +
      `&search=${encodeURIComponent(request.query)}`;
    const got = await getJson(request, url);
    if (!got.ok) return got.outcome;
    const rows = (got.body as { search?: unknown[] }).search ?? [];
    const documents = rows.flatMap((raw) => {
      const r = raw as { id?: string; concepturi?: string; display?: { label?: { value?: string }; description?: { value?: string } } };
      const label = clean(r.display?.label?.value, 200);
      if (label.length === 0 || typeof r.id !== 'string') return [];
      return [{
        ...base(request, 'wikidata'),
        title: `${label} (${r.id})`,
        url: typeof r.concepturi === 'string' ? r.concepturi : `https://www.wikidata.org/wiki/${r.id}`,
        published_at: null,
        date_kind: 'unknown' as const,
        source_identity: 'wikidata.org',
        excerpt: clean(r.display?.description?.value),
      }];
    });
    return ok(documents, 'Wikidata resolved no entity for this name.');
  },
});

/** OpenAlex returns abstracts as a word-to-positions map; rebuilding it is deterministic. */
export function abstractFromInverted(index: unknown): string {
  if (index === null || typeof index !== 'object') return '';
  const slots: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) if (typeof pos === 'number') slots.push([pos, word]);
  }
  return slots.sort((a, b) => a[0] - b[0]).map(([, w]) => w).join(' ');
}

export const openalexProvider = (): ResearchProvider => ({
  descriptor: providerById('openalex'),
  async search(request) {
    const url = `https://api.openalex.org/works?per-page=${request.limit}&search=${encodeURIComponent(request.query)}`;
    const got = await getJson(request, url);
    if (!got.ok) return got.outcome;
    const rows = (got.body as { results?: unknown[] }).results ?? [];
    const documents = rows.flatMap((raw) => {
      const r = raw as {
        display_name?: string; doi?: string; id?: string; publication_date?: string;
        abstract_inverted_index?: unknown; primary_location?: { source?: { display_name?: string } };
      };
      const title = clean(r.display_name, 250);
      if (title.length === 0) return [];
      const url2 = typeof r.doi === 'string' ? r.doi : typeof r.id === 'string' ? r.id : null;
      const venue = clean(r.primary_location?.source?.display_name, 120);
      const abstract = clean(abstractFromInverted(r.abstract_inverted_index));
      return [{
        ...base(request, 'openalex'),
        title,
        url: url2,
        published_at: isoOrNull(r.publication_date),
        date_kind: 'published' as const,
        source_identity: venue.length > 0 ? venue : 'openalex.org',
        excerpt: abstract.length > 0 ? abstract : venue,
      }];
    });
    return ok(documents, 'OpenAlex indexed no work for this query.');
  },
});

export const crossrefProvider = (): ResearchProvider => ({
  descriptor: providerById('crossref'),
  async search(request) {
    const url = `https://api.crossref.org/works?rows=${request.limit}&query=${encodeURIComponent(request.query)}`;
    const got = await getJson(request, url);
    if (!got.ok) return got.outcome;
    const rows = (got.body as { message?: { items?: unknown[] } }).message?.items ?? [];
    const documents = rows.flatMap((raw) => {
      const r = raw as {
        title?: string[]; URL?: string; abstract?: string; 'container-title'?: string[];
        issued?: { 'date-parts'?: number[][] }; indexed?: { 'date-time'?: string };
      };
      const title = clean(r.title?.[0], 250);
      if (title.length === 0) return [];
      const parts = r.issued?.['date-parts']?.[0];
      const issued =
        Array.isArray(parts) && typeof parts[0] === 'number'
          ? `${parts[0]}-${String(parts[1] ?? 1).padStart(2, '0')}-${String(parts[2] ?? 1).padStart(2, '0')}`
          : null;
      const venue = clean(r['container-title']?.[0], 120);
      return [{
        ...base(request, 'crossref'),
        title,
        url: typeof r.URL === 'string' ? r.URL : null,
        published_at: isoOrNull(issued) ?? isoOrNull(r.indexed?.['date-time']),
        // `issued` is a publication date; the fallback is when Crossref indexed it, which is not.
        date_kind: issued === null ? ('indexed' as const) : ('published' as const),
        source_identity: venue.length > 0 ? venue : 'crossref.org',
        excerpt: clean(stripTags(r.abstract)),
      }];
    });
    return ok(documents, 'Crossref registered no work for this query.');
  },
});

export const hackernewsProvider = (): ResearchProvider => ({
  descriptor: providerById('hackernews'),
  async search(request) {
    const url = `https://hn.algolia.com/api/v1/search?hitsPerPage=${request.limit}&query=${encodeURIComponent(request.query)}`;
    const got = await getJson(request, url);
    if (!got.ok) return got.outcome;
    const rows = (got.body as { hits?: unknown[] }).hits ?? [];
    const documents = rows.flatMap((raw) => {
      const r = raw as { title?: string; url?: string | null; created_at?: string; story_text?: string | null; objectID?: string; points?: number };
      const title = clean(r.title, 250);
      if (title.length === 0) return [];
      const link = typeof r.url === 'string' && r.url.length > 0 ? r.url : typeof r.objectID === 'string' ? `https://news.ycombinator.com/item?id=${r.objectID}` : null;
      return [{
        ...base(request, 'hackernews'),
        title,
        url: link,
        published_at: isoOrNull(r.created_at),
        date_kind: 'published' as const,
        // Identity is the linked host, not Hacker News: concentration must count the real publisher.
        source_identity: hostOf(link),
        excerpt: clean(stripTags(r.story_text)),
      }];
    });
    return ok(documents, 'Hacker News has no discussion matching this query.');
  },
});

/**
 * World Bank is addressed by country and indicator code, not by free text, so this provider declares
 * the series it knows how to reach. An unmatched question returns `empty` with the reason - which is
 * the honest answer to "what percentage", not an estimate.
 */
export const WORLDBANK_INDICATORS: ReadonlyArray<{ code: string; label: string; terms: string[] }> = [
  { code: 'NY.GDP.MKTP.CD', label: 'GDP (current US$)', terms: ['gdp', 'gross domestic product', 'economy size', 'output'] },
  { code: 'FP.CPI.TOTL.ZG', label: 'Inflation, consumer prices (annual %)', terms: ['inflation', 'consumer prices', 'cpi'] },
  { code: 'SL.UEM.TOTL.ZS', label: 'Unemployment (% of labour force)', terms: ['unemployment', 'jobless'] },
  { code: 'SP.POP.TOTL', label: 'Population, total', terms: ['population', 'inhabitants', 'people'] },
  { code: 'NE.EXP.GNFS.ZS', label: 'Exports of goods and services (% of GDP)', terms: ['exports', 'export share'] },
  { code: 'IS.ROD.GOOD.MT.K6', label: 'Road freight (million tonne-km)', terms: ['road freight', 'freight volume', 'tonne-km', 'goods transport'] },
  { code: 'IT.NET.USER.ZS', label: 'Individuals using the internet (% of population)', terms: ['internet users', 'internet penetration', 'online population'] },
];

const ISO3: Record<string, string> = {
  DE: 'DEU', AT: 'AUT', CH: 'CHE', NL: 'NLD', FR: 'FRA', PL: 'POL', UK: 'GBR', US: 'USA', IN: 'IND', CN: 'CHN', EU: 'EUU',
};

export const worldbankProvider = (): ResearchProvider => ({
  descriptor: providerById('worldbank'),
  async search(request) {
    const hay = request.query.toLowerCase();
    const indicator = WORLDBANK_INDICATORS.find((i) => i.terms.some((t) => hay.includes(t)));
    if (indicator === undefined) {
      return {
        status: 'empty',
        reason:
          `No World Bank series matches this query. This provider can only reach ${WORLDBANK_INDICATORS.length} declared ` +
          'indicators, so a rate or percentage cannot be evidenced here rather than being estimated.',
      };
    }
    const country = request.geo.map((g) => ISO3[g]).find((c) => c !== undefined) ?? 'WLD';
    const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicator.code}?format=json&per_page=${request.limit}&mrnev=${request.limit}`;
    const got = await getJson(request, url);
    if (!got.ok) return got.outcome;
    const body = got.body;
    const rows = Array.isArray(body) && Array.isArray(body[1]) ? (body[1] as unknown[]) : [];
    const documents = rows.flatMap((raw) => {
      const r = raw as { indicator?: { value?: string }; country?: { value?: string }; date?: string; value?: number | null };
      if (typeof r.value !== 'number' || typeof r.date !== 'string') return [];
      const label = clean(r.indicator?.value, 120) || indicator.label;
      const place = clean(r.country?.value, 80) || country;
      return [{
        ...base(request, 'worldbank'),
        title: `${label} — ${place}, ${r.date}`,
        url: `https://data.worldbank.org/indicator/${indicator.code}?locations=${country}`,
        // A World Bank date is the period observed, not a publication date.
        published_at: isoOrNull(`${r.date}-12-31`),
        date_kind: 'observed' as const,
        source_identity: 'data.worldbank.org',
        excerpt: `${label} for ${place} in ${r.date}: ${r.value}.`,
        value: { number: r.value, unit: label, period: r.date },
      }];
    });
    return ok(documents, `World Bank has no observation for ${indicator.code} in the requested country.`);
  },
});

export const duckduckgoProvider = (): ResearchProvider => ({
  descriptor: providerById('duckduckgo'),
  async search(request) {
    const url = `https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=${encodeURIComponent(request.query)}`;
    const got = await getJson(request, url);
    if (!got.ok) return got.outcome;
    const r = got.body as { Heading?: string; AbstractText?: string; AbstractURL?: string; AbstractSource?: string; RelatedTopics?: unknown[] };
    const documents: ResearchDocument[] = [];
    const heading = clean(r.Heading, 200);
    const abstract = clean(r.AbstractText);
    if (heading.length > 0 && abstract.length > 0) {
      documents.push({
        ...base(request, 'duckduckgo'),
        title: heading,
        url: typeof r.AbstractURL === 'string' && r.AbstractURL.length > 0 ? r.AbstractURL : null,
        published_at: null,
        date_kind: 'unknown' as const,
        // The instant answer restates another source, so identity is that source, not DuckDuckGo.
        source_identity: hostOf(typeof r.AbstractURL === 'string' ? r.AbstractURL : null),
        excerpt: abstract,
      });
    }
    for (const raw of (r.RelatedTopics ?? []).slice(0, Math.max(0, request.limit - documents.length))) {
      const t = raw as { Text?: string; FirstURL?: string };
      const text = clean(t.Text);
      if (text.length === 0 || typeof t.FirstURL !== 'string') continue;
      documents.push({
        ...base(request, 'duckduckgo'),
        title: text.slice(0, 200),
        url: t.FirstURL,
        published_at: null,
        date_kind: 'unknown' as const,
        source_identity: hostOf(t.FirstURL),
        excerpt: text,
      });
    }
    return ok(documents, 'DuckDuckGo has no instant answer for this query, which is common and is not a failure.');
  },
});

/**
 * News search. Google News RSS sends no CORS header, so this provider refuses to run first-party
 * rather than appearing to work and returning nothing - the exact failure this evolution was asked to
 * fix. With the reader proxy on it fetches through the proxy and says so on every document.
 */
export const newsProvider = (): ResearchProvider => ({
  descriptor: providerById('news_rss'),
  async search(request) {
    if (request.proxy === null) {
      return {
        status: 'unavailable',
        reason:
          'PROVIDER_UNAVAILABLE: news search is blocked by CORS from a browser and the reader proxy is off. ' +
          'Enable the proxy to use it, accepting that a third party then sits between this run and every document.',
      };
    }
    const region = request.geo[0] ?? 'US';
    const url =
      `https://news.google.com/rss/search?hl=en&gl=${encodeURIComponent(region)}&ceid=${encodeURIComponent(region)}:en` +
      `&q=${encodeURIComponent(request.query)}`;
    const target = request.proxy(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    let body: string;
    try {
      const res = await request.fetchImpl(target, { signal: controller.signal });
      if (!res.ok) return { status: 'search_failed', reason: `SEARCH_FAILED: the proxy answered HTTP ${res.status}.` };
      body = await res.text();
    } catch {
      return { status: 'search_failed', reason: 'SEARCH_FAILED: the proxied news request could not be completed.' };
    } finally {
      clearTimeout(timer);
    }

    const documents: ResearchDocument[] = [];
    for (const block of body.split(/<item>/i).slice(1, request.limit + 1)) {
      const pick = (tag: string): string => {
        const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
        return m === null ? '' : m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      };
      const title = clean(stripTags(pick('title')), 250);
      const link = pick('link');
      if (title.length === 0 || link.length === 0) continue;
      documents.push({
        ...base(request, 'news_rss'),
        title,
        url: link,
        published_at: isoOrNull(pick('pubDate')),
        date_kind: 'published' as const,
        source_identity: clean(stripTags(pick('source')), 80) || hostOf(link),
        excerpt: clean(stripTags(pick('description'))),
      });
    }
    return ok(documents, 'The news feed returned no recognisable item.');
  },
});

/** Every shipped provider, in descriptor order, so execution order is deterministic. */
export function allProviders(): ResearchProvider[] {
  return [
    wikipediaProvider(),
    wikidataProvider(),
    openalexProvider(),
    crossrefProvider(),
    hackernewsProvider(),
    worldbankProvider(),
    duckduckgoProvider(),
    newsProvider(),
  ];
}
