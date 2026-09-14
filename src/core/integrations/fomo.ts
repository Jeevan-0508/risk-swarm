/**
 * FOMO adapter - SCOUT's signal source.
 *
 * Upstream (github.com/Jeevan-0508/FOMO) publishes a scanner output of freight/logistics risk
 * signals collected from news RSS. Three upstream properties are deliberately distrusted here:
 *
 *  1. `category` is produced by OR-matched search queries, so a hit for one query can be labelled as
 *     another category. The adapter re-derives the category by keyword check and reports disagreement
 *     instead of silently relabelling.
 *  2. `severity` is a heuristic word match. It is imported as a hint and never used in scoring.
 *  3. `link` is a Google News redirect, so the aggregator host is never allowed to stand in for the
 *     publisher when independence is counted.
 */
import { sanitiseText, sourceIdentity } from '../ingest/sanitize';
import type { SnapshotLoader, SnapshotSourceProvenance } from './loader';
import type { FeedFailure } from '../sources/types';

export interface UpstreamSignal {
  category: string;
  title: string;
  link: string;
  source: string;
  pub_date: string;
  severity: string;
  found_at: string;
}

export interface RawSignal {
  external_id: string;
  title: string;
  publisher: string;
  url: string | null;
  published_at: string | null;
  retrieved_at: string;
  source_identity: string;
  category_upstream: string;
  category_derived: string;
  category_confidence: number;
  category_disagreement: boolean;
  severity_hint: string | null;
  geo: string[];
  mode: string[];
  freight_relevance: number;
  injection_suspected: boolean;
  injection_matches: string[];
}

export interface SignalQuery {
  geo?: string[];
  categories?: string[];
  from?: string;
  to?: string;
  minFreightRelevance?: number;
  limit?: number;
}

export interface SignalQueryStats {
  scanned: number;
  excluded_no_url: number;
  excluded_undated: number;
  excluded_out_of_window: number;
  excluded_low_relevance: number;
  excluded_geo: number;
  excluded_category: number;
  category_disagreements: number;
  returned: number;
  truncated_by_limit: boolean;
}

/**
 * What retrieval itself did, as distinct from what filtering did to the result. A pinned snapshot has no
 * retrieval report because there is nothing that can fail; a live source always has one, and a total
 * failure has to reach the agent, because "no signal" and "no retrieval" are different statements.
 */
export interface RetrievalFailureReport {
  source_key: string;
  kind: FeedFailure['kind'];
  reason: string;
}

export interface RetrievalReport {
  sources_attempted: number;
  sources_read: number;
  sources_failed: number;
  failures: RetrievalFailureReport[];
}

export interface SignalQueryResult {
  signals: RawSignal[];
  stats: SignalQueryStats;
  provenance: SnapshotSourceProvenance;
  /** Absent for a snapshot source, where retrieval cannot fail. */
  retrieval?: RetrievalReport;
}

const SNAPSHOT_PATH = 'fomo/signals.json';

/** Category keyword rules. Deliberately readable: this is a lexical check, not a classifier. */
const CATEGORY_RULES: Array<[string, string[]]> = [
  ['Missing Trailer / Phantom Carrier', ['missing trailer', 'trailer missing', 'phantom carrier', 'ghost carrier', 'vanished with', 'disappeared with the load', 'never delivered']],
  ['Cargo Theft', ['cargo theft', 'freight theft', 'stolen', 'theft', 'robbery', 'robbed', 'hijack', 'pilferage', 'burglary', 'looted', 'diebstahl', 'raub', 'gestohlen', 'ladungsdiebstahl']],
  ['Carrier / Freight Fraud', ['fraud', 'fraudulent', 'scam', 'scammer', 'fake carrier', 'fictitious', 'double broker', 'double-broker', 'identity theft', 'forged', 'counterfeit', 'betrug', 'gefälscht', 'embezzl', 'fake-frachtführer', 'fake frachtführer', 'scheinfirma', 'frachtbetrug', 'fake carrier', 'fake-carrier', 'falsche frachtführer']],
  ['Corporate Insolvency', ['insolven', 'bankrupt', 'liquidat', 'receivership', 'administration', 'wind-up', 'winding up', 'collapse', 'collapsed', 'pleite', 'zahlungsunfähig']],
  ['Regulatory / Compliance Risk', ['regulation', 'regulator', 'directive', 'compliance', 'court', 'ruling', 'fined', 'fine of', 'penalty', 'sanction', 'licence revoked', 'license revoked', 'operating authority', 'audit', 'investigation by', 'prosecut', 'gesetz', 'verordnung', 'bußgeld', 'due diligence law', 'legislation', 'law struck down', 'lieferkettengesetz', 'supply chain act', 'lksg']],
  ['Operational Disruption', ['strike', 'blockade', 'congestion', 'closure', 'closed', 'delay', 'flood', 'storm', 'outage', 'shortage', 'protest', 'streik', 'sperrung', 'staus']],
];

const FREIGHT_TERMS = [
  'freight', 'haulage', 'haulier', 'carrier', 'trucking', 'truck', 'lorry', 'trailer', 'logistics', 'transport', 'shipper', 'shipping', 'cargo', 'consignment', 'warehouse', 'supply chain', 'fleet', 'driver', 'broker', 'intermodal', 'container', 'depot', 'forwarder', 'forwarding',
  'spedition', 'frachtführer', 'lkw', 'fracht', 'ladung', 'transportunternehmen', 'logistik',
];

const GEO_RULES: Array<[string, string[]]> = [
  ['DE', ['germany', 'german', 'deutschland', 'deutsche', 'berlin', 'hamburg', 'munich', 'münchen', 'bavaria', 'bayern', 'frankfurt', 'cologne', 'köln', 'duisburg', 'leipzig', 'stuttgart', 'düsseldorf', 'nrw', 'saxony']],
  ['AT', ['austria', 'austrian', 'österreich', 'vienna', 'wien', 'graz', 'linz', 'salzburg']],
  ['CH', ['switzerland', 'swiss', 'schweiz', 'zurich', 'zürich', 'basel', 'geneva', 'bern']],
  ['PL', ['poland', 'polish', 'warsaw', 'gdansk', 'katowice']],
  ['NL', ['netherlands', 'dutch', 'rotterdam', 'amsterdam', 'venlo']],
  ['FR', ['france', 'french', 'paris', 'lyon', 'marseille']],
  ['UK', ['united kingdom', 'britain', 'british', 'england', 'london', 'wales', 'scotland']],
  ['US', ['united states', 'u.s.', 'usa', 'american', 'texas', 'california', 'florida', 'chicago']],
  ['EU', ['european union', 'eu-wide', 'brussels', 'europe', 'european']],
];

const MODE_RULES: Array<[string, string[]]> = [
  ['road', ['truck', 'lorry', 'trailer', 'haulage', 'haulier', 'road transport', 'driver', 'lkw', 'spedition', 'van']],
  ['rail', ['rail', 'railway', 'freight train', 'wagon', 'bahn', 'intermodal terminal']],
  ['sea', ['vessel', 'container ship', 'port of', 'seaport', 'maritime', 'shipping line', 'hafen']],
  ['air', ['air cargo', 'airfreight', 'air freight', 'airline', 'airport', 'flughafen']],
  ['intermodal', ['intermodal', 'combined transport', 'road to rail', 'kombinierter verkehr']],
];

const countHits = (haystack: string, terms: string[]): number => terms.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);

const matchList = (haystack: string, rules: Array<[string, string[]]>): string[] =>
  rules.filter(([, terms]) => terms.some((t) => haystack.includes(t))).map(([key]) => key);

/** FNV-1a over the upstream link: a stable id that survives re-syncs without needing a counter. */
export function externalId(link: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < link.length; i += 1) {
    h ^= link.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `FS-${h.toString(36).padStart(7, '0')}`;
}

/** Upstream titles carry a " - Publisher" suffix that would otherwise pollute similarity scoring. */
export function stripPublisherSuffix(title: string, publisher: string): string {
  const trimmed = title.trim();
  const short = publisher.trim().slice(0, 18);
  const idx = trimmed.lastIndexOf(' - ');
  if (idx > 20 && short.length > 2 && trimmed.slice(idx + 3).toLowerCase().startsWith(short.slice(0, 6).toLowerCase())) {
    return trimmed.slice(0, idx).trim();
  }
  return trimmed;
}

export interface DerivedCategory {
  category: string;
  confidence: number;
  scores: Record<string, number>;
}

/**
 * Re-derives the category from the title. Order matters: the first rule that scores highest wins,
 * and the rules are ordered from most specific to most generic so that "phantom carrier" is not
 * swallowed by "carrier".
 */
export function deriveCategory(title: string): DerivedCategory {
  const hay = title.toLowerCase();
  const scores: Record<string, number> = {};
  let best = 'Unclassified';
  let bestScore = 0;
  for (const [category, terms] of CATEGORY_RULES) {
    const score = countHits(hay, terms);
    scores[category] = score;
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = total === 0 ? 0 : Number((bestScore / total).toFixed(3));
  return { category: best, confidence, scores };
}

export function freightRelevance(title: string): number {
  const hay = title.toLowerCase();
  const hits = countHits(hay, FREIGHT_TERMS);
  return Number(Math.min(1, hits / 3).toFixed(3));
}

export function toRawSignal(u: UpstreamSignal): RawSignal | null {
  const publisher = sanitiseText(u.source, 80).text;
  const cleanTitle = sanitiseText(stripPublisherSuffix(u.title, u.source), 300);
  if (!cleanTitle.text) return null;
  const url = typeof u.link === 'string' && /^https?:\/\//.test(u.link) ? u.link : null;
  const parsed = Date.parse(u.pub_date ?? '');
  const derived = deriveCategory(cleanTitle.text);
  const hay = `${cleanTitle.text} ${publisher}`.toLowerCase();
  return {
    external_id: externalId(u.link ?? cleanTitle.text),
    title: cleanTitle.text,
    publisher,
    url,
    published_at: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
    retrieved_at: typeof u.found_at === 'string' ? u.found_at : '',
    source_identity: sourceIdentity(url, publisher),
    category_upstream: typeof u.category === 'string' ? u.category : 'unknown',
    category_derived: derived.category,
    category_confidence: derived.confidence,
    category_disagreement: derived.category !== u.category,
    severity_hint: typeof u.severity === 'string' ? u.severity : null,
    geo: matchList(hay, GEO_RULES),
    mode: matchList(hay, MODE_RULES),
    freight_relevance: freightRelevance(cleanTitle.text),
    injection_suspected: cleanTitle.injection_suspected,
    injection_matches: cleanTitle.matches,
  };
}

export interface SignalSource {
  querySignals(query: SignalQuery): Promise<SignalQueryResult>;
  provenance(): Promise<SnapshotSourceProvenance>;
}

export function createFomoSource(loader: SnapshotLoader): SignalSource {
  const provenance = async (): Promise<SnapshotSourceProvenance> => {
    const prov = await loader.provenance();
    const entry = prov.sources.find((s) => s.key === 'fomo');
    if (!entry) throw new Error('SNAPSHOT_UNAVAILABLE: no fomo provenance entry');
    return entry;
  };

  return {
    provenance,
    async querySignals(query: SignalQuery): Promise<SignalQueryResult> {
      const raw = await loader.loadJson<{ signals: UpstreamSignal[] }>(SNAPSHOT_PATH);
      const upstream = Array.isArray(raw?.signals) ? raw.signals : [];
      const minRelevance = query.minFreightRelevance ?? 0.34;
      const from = query.from ? Date.parse(query.from) : null;
      const to = query.to ? Date.parse(query.to) : null;

      const stats: SignalQueryStats = {
        scanned: upstream.length,
        excluded_no_url: 0,
        excluded_undated: 0,
        excluded_out_of_window: 0,
        excluded_low_relevance: 0,
        excluded_geo: 0,
        excluded_category: 0,
        category_disagreements: 0,
        returned: 0,
        truncated_by_limit: false,
      };

      const kept: RawSignal[] = [];
      for (const u of upstream) {
        const signal = toRawSignal(u);
        if (!signal) continue;
        // No url means no verifiable provenance. Such a signal is dropped, not downgraded.
        if (!signal.url) {
          stats.excluded_no_url += 1;
          continue;
        }
        if (!signal.published_at) {
          stats.excluded_undated += 1;
          continue;
        }
        const t = Date.parse(signal.published_at);
        if ((from !== null && t < from) || (to !== null && t > to)) {
          stats.excluded_out_of_window += 1;
          continue;
        }
        if (signal.freight_relevance < minRelevance) {
          stats.excluded_low_relevance += 1;
          continue;
        }
        if (query.geo && query.geo.length > 0 && !signal.geo.some((g) => query.geo?.includes(g))) {
          stats.excluded_geo += 1;
          continue;
        }
        if (query.categories && query.categories.length > 0 && !query.categories.includes(signal.category_derived)) {
          stats.excluded_category += 1;
          continue;
        }
        if (signal.category_disagreement) stats.category_disagreements += 1;
        kept.push(signal);
      }

      // Deterministic order: newest first, then by id, so a run is reproducible.
      kept.sort((a, b) => (a.published_at === b.published_at ? a.external_id.localeCompare(b.external_id) : (b.published_at ?? '').localeCompare(a.published_at ?? '')));
      const limit = query.limit ?? kept.length;
      const signals = kept.slice(0, limit);
      stats.truncated_by_limit = kept.length > signals.length;
      stats.returned = signals.length;

      return { signals, stats, provenance: await provenance() };
    },
  };
}
