/**
 * The LIVE signal source. It fetches, hashes and sanitises, then hands the engine the same RawSignal
 * shape the snapshot source produces — so every agent downstream is unchanged, and every category is
 * re-derived here by keyword rather than trusted from the feed.
 *
 * Three rules hold whatever a feed returns:
 *   1. A blocked or failed fetch is reported as a failure. Nothing is substituted for it.
 *   2. An item with no usable url is dropped, because an unverifiable signal is not a weaker fact.
 *   3. Tier follows source_type, never the feed's own opinion of itself.
 */
import { sanitiseText, sourceIdentity } from '../ingest/sanitize';
import { deriveCategory, freightRelevance, type RawSignal, type SignalQuery, type SignalQueryResult, type SignalQueryStats, type SignalSource } from '../integrations/fomo';
import type { SnapshotSourceProvenance } from '../integrations/loader';
import { contentHash } from './hash';
import type { FeedFailure, FetchedFeed, LiveDeps, LiveQuery, LiveSource } from './types';

const DEFAULT_TIMEOUT_MS = 8_000;

export async function fetchFeeds(sources: LiveSource[], query: LiveQuery, deps: LiveDeps): Promise<{ feeds: FetchedFeed[]; failures: FeedFailure[] }> {
  const feeds: FetchedFeed[] = [];
  const failures: FeedFailure[] = [];
  const hash = deps.hash ?? contentHash;

  for (const source of sources) {
    const endpoints = source.endpoints(query);
    if (endpoints.length === 0) {
      failures.push({ source_key: source.key, endpoint: '—', kind: 'not_configured', reason: 'No endpoint configured for this source, so nothing was retrieved from it.' });
      continue;
    }
    for (const endpoint of endpoints) {
      try {
        const body = await withTimeout(deps.fetchImpl(endpoint), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS, endpoint);
        if (!body.ok) {
          failures.push({ source_key: source.key, endpoint, kind: 'http_error', reason: `HTTP ${body.status} ${body.statusText}`.trim() });
          continue;
        }
        const text = await body.text();
        const items = source.parse(text);
        if (items.length === 0) {
          failures.push({ source_key: source.key, endpoint, kind: 'parse_error', reason: 'The response contained no recognisable feed entries.' });
          continue;
        }
        feeds.push({ source_key: source.key, endpoint, content_hash: await hash(text), bytes: text.length, items });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const blocked = /cors|failed to fetch|network|load failed/i.test(message);
        failures.push({
          source_key: source.key,
          endpoint,
          kind: blocked ? 'blocked' : 'timeout',
          reason: blocked
            ? `The browser blocked this request (${message}). A page served from a static host cannot read a feed that does not allow cross-origin access.`
            : message,
        });
      }
    }
  }
  return { feeds, failures };
}

export interface LiveSourceOptions {
  sources: LiveSource[];
  query: LiveQuery;
  deps: LiveDeps;
  now: string;
  /** Used when a feed states no date. Such items are dropped, not dated from the clock. */
  onResult?: (result: { feeds: FetchedFeed[]; failures: FeedFailure[] }) => void;
}

export function createLiveSource(options: LiveSourceOptions): SignalSource {
  let fetched: { feeds: FetchedFeed[]; failures: FeedFailure[] } | null = null;

  const load = async () => {
    if (fetched === null) {
      fetched = await fetchFeeds(options.sources, options.query, options.deps);
      options.onResult?.(fetched);
    }
    return fetched;
  };

  const provenance = async (): Promise<SnapshotSourceProvenance> => {
    const { feeds, failures } = await load();
    return {
      key: 'live',
      upstream_repo: 'live retrieval',
      upstream_url: 'https://github.com/Jeevan-0508/risk-swarm',
      commit: null,
      note:
        `Retrieved in the browser at ${options.now}. ${feeds.length} feed(s) read, ${failures.length} failed or blocked. ` +
        'A live run is not reproducible: the same question asked tomorrow reads different documents.',
      files: feeds.map((f) => ({ upstream_path: f.endpoint, path: `${f.source_key}/live`, bytes: f.bytes, sha256: f.content_hash })),
    };
  };

  return {
    provenance,
    async querySignals(query: SignalQuery): Promise<SignalQueryResult> {
      const { feeds, failures } = await load();
      const stats: SignalQueryStats = {
        scanned: 0, excluded_no_url: 0, excluded_undated: 0, excluded_out_of_window: 0,
        excluded_low_relevance: 0, excluded_geo: 0, excluded_category: 0, category_disagreements: 0, returned: 0, truncated_by_limit: false,
      };
      const from = query.from === undefined ? null : Date.parse(query.from);
      const to = query.to === undefined ? null : Date.parse(query.to);
      const minRelevance = query.minFreightRelevance ?? 0.34;
      const signals: RawSignal[] = [];
      const seen = new Set<string>();

      for (const feed of feeds) {
        for (const item of feed.items) {
          stats.scanned += 1;
          if (item.url === null) {
            stats.excluded_no_url += 1;
            continue;
          }
          if (item.published_at === null) {
            stats.excluded_undated += 1;
            continue;
          }
          const at = Date.parse(item.published_at);
          if ((from !== null && at < from) || (to !== null && at > to)) {
            stats.excluded_out_of_window += 1;
            continue;
          }
          const title = sanitiseText(item.title, 300);
          if (title.text.length === 0) continue;
          const relevance = freightRelevance(title.text);
          if (relevance < minRelevance) {
            stats.excluded_low_relevance += 1;
            continue;
          }
          const key = `${title.text.toLowerCase()}|${item.url}`;
          if (seen.has(key)) continue;
          seen.add(key);

          const derived = deriveCategory(title.text);
          const publisher = sanitiseText(item.publisher, 80).text || feed.source_key;
          signals.push({
            external_id: `LIVE-${feed.source_key}-${signals.length + 1}`,
            title: title.text,
            publisher,
            url: item.url,
            published_at: new Date(at).toISOString(),
            retrieved_at: options.now,
            source_identity: sourceIdentity(item.url, publisher),
            // A live feed's own label is not carried through as a category: it is recorded as unstated
            // and re-derived by keyword, which is the check the FOMO pipeline was missing.
            category_upstream: 'unstated',
            category_derived: derived.category,
            category_confidence: derived.confidence,
            category_disagreement: derived.category === 'Unclassified',
            severity_hint: null,
            geo: query.geo ?? [],
            mode: [],
            freight_relevance: relevance,
            injection_suspected: title.injection_suspected,
            injection_matches: title.matches,
          });
          if (derived.category === 'Unclassified') stats.category_disagreements += 1;
        }
      }

      const limited = query.limit === undefined ? signals : signals.slice(0, query.limit);
      stats.truncated_by_limit = limited.length < signals.length;
      stats.returned = limited.length;
      return {
        signals: limited,
        stats,
        provenance: await provenance(),
        // Reported whatever happened, including when everything failed. Filtering statistics cannot
        // express "nothing was retrieved", and SCOUT has to be able to tell the two apart.
        retrieval: {
          sources_attempted: feeds.length + failures.length,
          sources_read: feeds.length,
          sources_failed: failures.length,
          failures: failures.map((f) => ({ source_key: f.source_key, kind: f.kind, reason: f.reason })),
        },
      };
    },
  };
}

function withTimeout(promise: Promise<Response>, ms: number, endpoint: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No response from ${endpoint} within ${ms}ms`)), ms);
    promise.then(
      (r) => { clearTimeout(timer); resolve(r); },
      (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}
