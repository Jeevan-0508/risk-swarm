/**
 * Normalization. One retrieved thing in, one `Evidence` node plus its provenance out.
 *
 * This is the only place where a retrieved document becomes evidence, and it is deliberately the
 * narrowest part of the system: it decides what a document is, not what it means. Three rules hold
 * whatever came back.
 *
 *   1. Nothing is dropped for being off-domain. The old freight relevance gate ran here in spirit and
 *      it was the reason the swarm could only think about one subject: an item below the threshold was
 *      deleted before any agent saw it. Relevance is now measured and reported, never used to exclude.
 *      Irrelevant evidence is a metric, not a filter.
 *   2. A date is only presented as a publication date when the provider said it was one. An index date
 *      is when an aggregator noticed a document, which is not when the document was written.
 *   3. Repetition is not corroboration. Ten pages of one site making one claim is one source, and the
 *      report says so in those words.
 */
import { TIER_WEIGHT, TIER_OF_SOURCE_TYPE, type Evidence, type SourceType, type Tier } from '../domain/model';
import type { Minter } from '../domain/build';
import { canonicalHost, isAggregator, sanitiseText, sourceIdentity } from '../ingest/sanitize';
import { classifySource } from '../agents/types';
import { contentHash } from '../sources/hash';
import { keywordsOf } from '../question/model';
import type { KnowledgeHit } from '../knowledge/internal';
import type { ProviderId, ResearchDocument } from './providers/types';

/** How old the content is, relative to the run clock. Reported per item, never averaged away. */
export type EvidenceFreshness = 'fresh' | 'recent' | 'aging' | 'stale' | 'unknown';

const DAY_MS = 86_400_000;
const FRESHNESS_DAYS: Array<[EvidenceFreshness, number]> = [
  ['fresh', 30],
  ['recent', 180],
  ['aging', 730],
];

/** Provider kind, used only when the host itself carries no authority signal. */
const PROVIDER_SOURCE_TYPE: Record<ProviderId, SourceType> = {
  wikipedia: 'reference_work',
  wikidata: 'reference_work',
  duckduckgo: 'reference_work',
  openalex: 'academic',
  crossref: 'academic',
  worldbank: 'statistical_body',
  hackernews: 'news',
  news_rss: 'news',
};

export interface EvidenceProvenance {
  /** The system knows which side of its own boundary a claim came from, and says so. */
  origin: 'internal' | 'external';
  provider: ProviderId | 'repository';
  /** The exact query text that produced this document, not a summary of the search. */
  query: string;
  retrieved_at: string;
  via_proxy: boolean;
  source_identity: string;
  /** Where it lives: a url for external, a repository path for internal. */
  location: string;
  /** sha256 of the exact text used as the excerpt, so a later run can prove it read the same words. */
  content_hash: string;
  /** What the date actually is. Carried even when the date was rejected as a publication date. */
  date_kind: ResearchDocument['date_kind'] | 'record_updated';
  stated_date: string | null;
}

export interface SourceQuality {
  source_type: SourceType;
  tier: Tier;
  /** The group a source belongs to when independence is counted. Same group means not independent. */
  independence_group: string;
  /** Honest limits on this source. Never empty when a limit is known. */
  caveats: string[];
}

export interface NormalizedEvidence {
  evidence: Evidence;
  provenance: EvidenceProvenance;
  quality: SourceQuality;
  freshness: EvidenceFreshness;
  /** Measured overlap with the question, 0-1. Low relevance is reported, not removed. */
  relevance: number;
}

export interface DroppedDocument {
  reason: 'no_location' | 'empty_text';
  title: string;
  detail: string;
}

export interface CorroborationReport {
  claim: string;
  documents: number;
  distinct_sources: number;
  distinct_providers: number;
  /** True when the same claim came back more times than there are sources behind it. */
  repetition_only: boolean;
  note: string;
}

export interface NormalizationReport {
  items: NormalizedEvidence[];
  dropped: DroppedDocument[];
  corroboration: CorroborationReport[];
  counters: {
    normalized: number;
    internal: number;
    external: number;
    /** Counted for the metric, not excluded. */
    low_relevance: number;
    undated: number;
    injection_suspected: number;
    aggregator_hosted: number;
    proxied: number;
  };
  notes: string[];
}

export interface NormalizeDeps {
  minter: Minter;
  now: string;
  /** The question, used to measure relevance. It never decides inclusion. */
  question: string;
  hash?: (text: string) => Promise<string>;
  /** Used for reporting only. An item below it is kept and counted. */
  lowRelevanceThreshold?: number;
}

export function freshnessOf(date: string | null, now: string): EvidenceFreshness {
  if (date === null) return 'unknown';
  const at = Date.parse(date);
  const ref = Date.parse(now);
  if (Number.isNaN(at) || Number.isNaN(ref)) return 'unknown';
  const days = (ref - at) / DAY_MS;
  // A date in the future is not fresh, it is wrong, and saying "unknown" is the honest answer.
  if (days < -1) return 'unknown';
  for (const [tier, limit] of FRESHNESS_DAYS) if (days <= limit) return tier;
  return 'stale';
}

/**
 * Term overlap between the question and the document, weighted towards the title. This is a measured
 * signal about wording, not a judgement about meaning: a relevant document phrased differently scores
 * low, which is exactly why the score does not gate anything.
 */
export function measureRelevance(question: string, title: string, excerpt: string): number {
  const wanted = new Set(keywordsOf(question));
  if (wanted.size === 0) return 0;
  const inTitle = new Set(keywordsOf(title));
  const inBody = new Set(keywordsOf(excerpt));
  let score = 0;
  for (const term of wanted) {
    if (inTitle.has(term)) score += 1;
    else if (inBody.has(term)) score += 0.5;
  }
  return Math.min(1, score / wanted.size);
}

/** The date a claim carries, and whether it may be presented as a publication date. */
function resolveDate(doc: ResearchDocument): { publication_date: string | null; caveat: string | null } {
  if (doc.published_at === null) return { publication_date: null, caveat: 'The source stated no date, so this claim cannot be placed in time.' };
  switch (doc.date_kind) {
    case 'published':
      return { publication_date: doc.published_at, caveat: null };
    case 'revised':
      return { publication_date: doc.published_at, caveat: 'The date is the last revision, not first publication: the claim may be older than the date suggests.' };
    case 'observed':
      return { publication_date: doc.published_at, caveat: 'The date is the period the value describes, not when it was published.' };
    case 'indexed':
      return { publication_date: null, caveat: `The only date available was an index date (${doc.published_at}), which is when an aggregator saw the document, not when it was written.` };
    default:
      return { publication_date: null, caveat: 'The date could not be interpreted and was discarded rather than guessed.' };
  }
}

function classifyExternal(doc: ResearchDocument): SourceQuality {
  const host = canonicalHost(doc.url);
  const byHost = classifySource(host);
  // classifySource returns 'news' both for a news host and for a host it has no opinion about, so the
  // provider's own kind is used unless the host carried real authority.
  const source_type: SourceType = byHost === 'news' ? PROVIDER_SOURCE_TYPE[doc.provider] : byHost;
  const caveats: string[] = [];
  if (source_type === 'reference_work') caveats.push('A reference work summarises other sources; it is a starting point for a claim, not the authority behind it.');
  if (source_type === 'academic') caveats.push('A single paper is one research result, not a settled position in its field.');
  if (source_type === 'statistical_body') caveats.push('An indicator is defined by its methodology; the number is only comparable where the definition is.');
  if (isAggregator(doc.url)) caveats.push('The link is an aggregator redirect, so the publisher behind it is asserted by the feed rather than proven by the url.');
  if (doc.via_proxy) caveats.push('Retrieved through the reader proxy, so a third party stood between this system and the source.');
  return {
    source_type,
    tier: TIER_OF_SOURCE_TYPE[source_type],
    independence_group: doc.source_identity || sourceIdentity(doc.url),
    caveats,
  };
}

export async function normalizeExternal(docs: ResearchDocument[], deps: NormalizeDeps): Promise<NormalizationReport> {
  const hash = deps.hash ?? contentHash;
  const threshold = deps.lowRelevanceThreshold ?? 0.2;
  const items: NormalizedEvidence[] = [];
  const dropped: DroppedDocument[] = [];

  for (const doc of docs) {
    const title = sanitiseText(doc.title, 300);
    const excerpt = sanitiseText(doc.excerpt, 1200);
    if (doc.url === null || doc.url.length === 0) {
      dropped.push({ reason: 'no_location', title: title.text, detail: 'An external claim with no url cannot be checked, so it is not a weaker fact - it is not a fact.' });
      continue;
    }
    const url = doc.url;
    if (title.text.length === 0) {
      dropped.push({ reason: 'empty_text', title: '(untitled)', detail: 'Nothing survived sanitisation, so there was no claim left to record.' });
      continue;
    }
    const quality = classifyExternal(doc);
    const { publication_date, caveat } = resolveDate(doc);
    if (caveat !== null) quality.caveats.push(caveat);
    const injection = title.injection_suspected || excerpt.injection_suspected;
    if (injection) quality.caveats.push('The retrieved text contained instruction-shaped content and was downgraded rather than obeyed.');
    const relevance = measureRelevance(deps.question, title.text, excerpt.text);

    const evidence = deps.minter.evidence('scout', {
      source: doc.source_identity || quality.independence_group,
      source_type: quality.source_type,
      url: doc.url,
      title: title.text,
      publication_date,
      retrieved_at: doc.retrieved_at,
      claim: title.text,
      excerpt_or_summary: excerpt.text,
      // Reliability is the tier weight, halved when the text tried to give instructions. It is never
      // raised: no provider can argue itself into a stronger tier.
      reliability: injection ? TIER_WEIGHT[quality.tier] / 2 : TIER_WEIGHT[quality.tier],
      relevance,
      agents_that_used_it: ['scout'],
      cluster_id: null,
      injection_suspected: injection,
      // A research document describes the world; only a news-tier item is a report of a specific event.
      incident_claim: quality.source_type === 'news',
    });

    items.push({
      evidence,
      provenance: {
        origin: 'external',
        provider: doc.provider,
        query: doc.query,
        retrieved_at: doc.retrieved_at,
        via_proxy: doc.via_proxy,
        source_identity: quality.independence_group,
        location: url,
        content_hash: await hash(excerpt.text || title.text),
        date_kind: doc.date_kind,
        stated_date: doc.published_at,
      },
      quality,
      freshness: freshnessOf(publication_date, deps.now),
      relevance,
    });
  }

  return finish(items, dropped, threshold);
}

export async function normalizeInternal(hits: KnowledgeHit[], deps: NormalizeDeps): Promise<NormalizationReport> {
  const hash = deps.hash ?? contentHash;
  const threshold = deps.lowRelevanceThreshold ?? 0.2;
  const items: NormalizedEvidence[] = [];
  const dropped: DroppedDocument[] = [];

  for (const hit of hits) {
    const record = hit.record;
    const text = sanitiseText(record.text, 1200);
    if (record.path.length === 0) {
      dropped.push({ reason: 'no_location', title: record.title, detail: 'A knowledge record with no path cannot be traced back to a file, so it is not usable as evidence.' });
      continue;
    }
    const caveats = ['This is what the repository holds, which is not the same as what is currently true.'];
    if (record.truncated) caveats.push('The record was clipped when the index was built, so the passage is incomplete.');
    if (record.updated_at === null) caveats.push('The record states no date, so its age is unknown.');

    const evidence = deps.minter.evidence('scout', {
      source: record.source,
      source_type: 'portfolio_kb',
      url: null,
      title: record.title,
      publication_date: record.updated_at,
      retrieved_at: deps.now,
      claim: record.title,
      excerpt_or_summary: text.text,
      reliability: TIER_WEIGHT[TIER_OF_SOURCE_TYPE.portfolio_kb],
      // Internal search already measured this against the query, so it is not re-measured here.
      relevance: hit.score,
      agents_that_used_it: ['scout'],
      cluster_id: null,
      injection_suspected: text.injection_suspected,
      incident_claim: false,
    });

    items.push({
      evidence,
      provenance: {
        origin: 'internal',
        provider: 'repository',
        query: deps.question,
        retrieved_at: deps.now,
        via_proxy: false,
        source_identity: record.source,
        location: `${record.path}#${record.ref}`,
        // The index already hashed the record; rehashing the clipped text would hash a different thing.
        content_hash: record.sha256 || (await hash(text.text)),
        date_kind: 'record_updated',
        stated_date: record.updated_at,
      },
      quality: { source_type: 'portfolio_kb', tier: TIER_OF_SOURCE_TYPE.portfolio_kb, independence_group: `repository:${record.source}`, caveats },
      freshness: freshnessOf(record.updated_at, deps.now),
      relevance: hit.score,
    });
  }

  return finish(items, dropped, threshold);
}

export function mergeNormalization(...reports: NormalizationReport[]): NormalizationReport {
  const items = reports.flatMap((r) => r.items);
  const dropped = reports.flatMap((r) => r.dropped);
  return finish(items, dropped, 0.2, reports.flatMap((r) => r.notes.filter((n) => !n.startsWith('Corroboration'))));
}

function claimKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function assessCorroboration(items: NormalizedEvidence[]): CorroborationReport[] {
  const groups = new Map<string, NormalizedEvidence[]>();
  for (const item of items) {
    const key = claimKey(item.evidence.title);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [item]);
    else bucket.push(item);
  }
  const reports: CorroborationReport[] = [];
  for (const [claim, group] of groups) {
    if (group.length < 2) continue;
    const sources = new Set(group.map((g) => g.quality.independence_group));
    const providers = new Set(group.map((g) => g.provenance.provider));
    const repetition_only = sources.size < group.length;
    reports.push({
      claim,
      documents: group.length,
      distinct_sources: sources.size,
      distinct_providers: providers.size,
      repetition_only,
      note:
        sources.size === 1
          ? `${group.length} document(s) carry this claim but they all come from ${[...sources][0]}. That is one source repeating itself, not independent confirmation.`
          : `${sources.size} distinct source(s) carry this claim. Distinct hosts are not proof of independence: they may all be repeating one original.`,
    });
  }
  return reports.sort((a, b) => b.documents - a.documents || a.claim.localeCompare(b.claim));
}

function finish(items: NormalizedEvidence[], dropped: DroppedDocument[], threshold: number, carried: string[] = []): NormalizationReport {
  const corroboration = assessCorroboration(items);
  const counters = {
    normalized: items.length,
    internal: items.filter((i) => i.provenance.origin === 'internal').length,
    external: items.filter((i) => i.provenance.origin === 'external').length,
    low_relevance: items.filter((i) => i.relevance < threshold).length,
    undated: items.filter((i) => i.freshness === 'unknown').length,
    injection_suspected: items.filter((i) => i.evidence.injection_suspected).length,
    aggregator_hosted: items.filter((i) => i.provenance.origin === 'external' && isAggregator(i.evidence.url)).length,
    proxied: items.filter((i) => i.provenance.via_proxy).length,
  };
  const notes = [...carried];
  if (items.length === 0) notes.push('Nothing was normalized, so no claim in this run rests on retrieved evidence.');
  if (counters.low_relevance > 0) {
    notes.push(
      `${counters.low_relevance} of ${items.length} item(s) scored below ${threshold} on wording overlap with the question. They were kept: a low score means the words differ, not that the document is irrelevant.`,
    );
  }
  if (counters.undated > 0) notes.push(`${counters.undated} item(s) carry no usable date, so their age is unknown rather than recent.`);
  const repetition = corroboration.filter((c) => c.repetition_only).length;
  if (repetition > 0) notes.push(`Corroboration check: ${repetition} claim(s) appear more than once from fewer sources than documents. Repetition is not corroboration.`);
  const stale = items.filter((i) => i.freshness === 'stale').length;
  if (stale > 0) notes.push(`${stale} item(s) are more than two years old, which may be correct for structure and wrong for current state.`);
  return { items, dropped, corroboration, counters, notes };
}
