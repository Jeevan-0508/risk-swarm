/**
 * THE EXTERNAL RESEARCH SEAM.
 *
 * A provider is a named, declared capability that returns documents with provenance. The interface
 * is deliberately thinner than any single provider's API: it can only search and return records that
 * carry where they came from. A provider may not classify, score or conclude.
 *
 * Every provider id in `PROVIDERS` below was called from real browser page context before it was
 * written down here, and its CORS result recorded in `docs/EVOLUTION-4.0-OPEN-INTELLIGENCE.md`. A
 * provider that cannot be reached first-party is marked `requires_proxy`, and a proxied provider is
 * off unless the operator turns the proxy on - because a proxy inserts a third party into the
 * evidence chain and that has to be a decision, not a default.
 */

export type ProviderId =
  | 'wikipedia'
  | 'wikidata'
  | 'openalex'
  | 'crossref'
  | 'hackernews'
  | 'worldbank'
  | 'duckduckgo'
  | 'news_rss';

/**
 * What a provider is good for. A research dimension asks for capabilities; the planner matches.
 * These are claims about the *provider*, not about the truth of anything it returns.
 */
export type Capability =
  | 'definition'   // settled, encyclopaedic description of a subject
  | 'background'   // context and history
  | 'entity'       // resolves a named thing to an identifier
  | 'academic'     // peer-reviewed or preprint literature
  | 'current'      // recent, dated documents
  | 'technical'    // practitioner discussion
  | 'indicator'    // numeric series with a stated denominator and date
  | 'news';        // press reporting

/** Authority tier, declared by the provider. Mirrors the existing evidence tiering, never invents a new scale. */
export type Authority = 'primary_dataset' | 'reference_work' | 'peer_reviewed' | 'press' | 'community';

export interface ProviderDescriptor {
  id: ProviderId;
  label: string;
  /** What this provider is, and what it is not, in one sentence an operator can argue with. */
  remit: string;
  capabilities: Capability[];
  authority: Authority;
  /** Verified by measurement, not assumption. False means it only works behind the reader proxy. */
  cors_ok: boolean;
  requires_proxy: boolean;
  /** True when the provider needs no key of any kind. All shipped providers are keyless by design. */
  keyless: boolean;
}

/** The eight providers, with the CORS result measured on 2026-09-14 against localhost page context. */
export const PROVIDERS: readonly ProviderDescriptor[] = [
  {
    id: 'wikipedia',
    label: 'Wikipedia',
    remit: 'Encyclopaedic summaries of established subjects. Evidences the consensus description of a thing, never that the description is correct.',
    capabilities: ['definition', 'background'],
    authority: 'reference_work',
    cors_ok: true,
    requires_proxy: false,
    keyless: true,
  },
  {
    id: 'wikidata',
    label: 'Wikidata',
    remit: 'Resolves a name to a structured entity. Useful for disambiguation; its statements are crowd-maintained.',
    capabilities: ['entity'],
    authority: 'reference_work',
    cors_ok: true,
    requires_proxy: false,
    keyless: true,
  },
  {
    id: 'openalex',
    label: 'OpenAlex',
    remit: 'Scholarly works across every field, with dates and citation counts. Indexing is broad, so presence is not quality.',
    capabilities: ['academic', 'background', 'current'],
    authority: 'peer_reviewed',
    cors_ok: true,
    requires_proxy: false,
    keyless: true,
  },
  {
    id: 'crossref',
    label: 'Crossref',
    remit: 'DOI registration metadata. Authoritative that a work was published; says nothing about its findings.',
    capabilities: ['academic'],
    authority: 'peer_reviewed',
    cors_ok: true,
    requires_proxy: false,
    keyless: true,
  },
  {
    id: 'hackernews',
    label: 'Hacker News',
    remit: 'Practitioner discussion, dated and often current. A community signal: popularity here is not corroboration.',
    capabilities: ['technical', 'current'],
    authority: 'community',
    cors_ok: true,
    requires_proxy: false,
    keyless: true,
  },
  {
    id: 'worldbank',
    label: 'World Bank Open Data',
    remit: 'Official indicator series with a stated unit and year. The only shipped provider that supplies a denominator.',
    capabilities: ['indicator'],
    authority: 'primary_dataset',
    cors_ok: true,
    requires_proxy: false,
    keyless: true,
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo Instant Answer',
    remit: 'Short instant answers with a source link. Coverage is uneven and an empty answer is common and honest.',
    capabilities: ['definition', 'entity'],
    authority: 'reference_work',
    cors_ok: true,
    requires_proxy: false,
    keyless: true,
  },
  {
    id: 'news_rss',
    label: 'News search (RSS)',
    remit: 'Press reporting. Blocked by CORS first-party, so it only runs when the operator enables the reader proxy.',
    capabilities: ['news', 'current'],
    authority: 'press',
    cors_ok: false,
    requires_proxy: true,
    keyless: true,
  },
] as const;

export const providerById = (id: ProviderId): ProviderDescriptor => {
  const found = PROVIDERS.find((p) => p.id === id);
  if (found === undefined) throw new Error(`unknown provider: ${id}`);
  return found;
};

/** Providers declaring a capability, in descriptor order so selection is deterministic. */
export const providersFor = (capability: Capability): ProviderDescriptor[] => PROVIDERS.filter((p) => p.capabilities.includes(capability));

/** A single retrieved document. Nothing here is derived - it is what the provider said, sanitised. */
export interface ResearchDocument {
  provider: ProviderId;
  /** The exact query string that produced this document. */
  query: string;
  title: string;
  url: string | null;
  /** ISO date the source states, or null. Never defaulted to the clock: an undated source is undated. */
  published_at: string | null;
  /**
   * What that date actually is. A wiki revision timestamp is not a publication date and an index date
   * is neither, so the distinction is carried rather than flattened into one hopeful field.
   */
  date_kind: 'published' | 'revised' | 'indexed' | 'observed' | 'unknown';
  retrieved_at: string;
  /** Host or dataset name, used for source-concentration counting. */
  source_identity: string;
  /** Provider-supplied text, sanitised. Empty is allowed and is not an error. */
  excerpt: string;
  /** Numeric payload where the provider is an indicator series. Absent for document providers. */
  value: { number: number; unit: string; period: string } | null;
  /** True when the document came through the reader proxy rather than direct. */
  via_proxy: boolean;
}

export type ProviderOutcome =
  | { status: 'ok'; documents: ResearchDocument[] }
  | { status: 'empty'; reason: string }
  | { status: 'search_failed'; reason: string }
  | { status: 'unavailable'; reason: string };

export interface ProviderRequest {
  query: string;
  now: string;
  limit: number;
  /** Geographies the question named, for providers whose API is addressed by country. May be empty. */
  geo: string[];
  /** Set only when the operator enabled the reader proxy. A provider must not reach for it otherwise. */
  proxy: ((url: string) => string) | null;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

export interface ResearchProvider {
  readonly descriptor: ProviderDescriptor;
  search(request: ProviderRequest): Promise<ProviderOutcome>;
}
