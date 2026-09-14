/**
 * RESEARCH EXECUTION.
 *
 * Runs a plan and reports what actually happened. Every number this module publishes is a count of a
 * real event: queries it issued, documents a provider returned, documents it kept, duplicates it
 * dropped, providers that failed. Nothing is estimated and nothing is rounded up, because these
 * counters are what the UI displays as "RESEARCHING - 12 queries, 47 results, 18 retained" and a
 * display that overstates retrieval is worse than no display.
 *
 * Budgets are enforced here rather than trusted upstream. Hitting one produces `limit_reached` with
 * the dimension that was cut, so a short result set can never be mistaken for a thorough one.
 */
import type { ResearchPlan } from './plan';
import type { ProviderId, ResearchDocument, ResearchProvider } from './providers/types';

export type ResearchEvent =
  | { kind: 'plan_started'; queries: number; providers: ProviderId[] }
  | { kind: 'query_issued'; dimension: string; provider: ProviderId; query: string }
  | { kind: 'provider_answered'; dimension: string; provider: ProviderId; returned: number }
  | { kind: 'provider_empty'; dimension: string; provider: ProviderId; reason: string }
  | { kind: 'provider_failed'; dimension: string; provider: ProviderId; status: 'search_failed' | 'unavailable'; reason: string }
  | { kind: 'document_retained'; provider: ProviderId; title: string; source_identity: string }
  | { kind: 'duplicate_dropped'; kept: string; dropped: string; reason: string }
  | { kind: 'limit_reached'; limit: string }
  | { kind: 'plan_finished'; retained: number; ms: number };

export interface Attempt {
  dimension: string;
  provider: ProviderId;
  query: string;
  status: 'ok' | 'empty' | 'search_failed' | 'unavailable' | 'skipped_budget';
  reason: string | null;
  returned: number;
  retained: number;
  ms: number;
}

export interface DuplicateDrop {
  kept: string;
  dropped: string;
  reason: 'same_url' | 'same_title_and_source';
}

export interface SourceShare {
  source_identity: string;
  count: number;
  share: number;
}

export interface ResearchExecution {
  plan: ResearchPlan;
  started_at: string;
  ms: number;
  /**
   * `ok` when every attempt answered, `partial` when some failed, `search_failed` when none answered
   * at all, `limit_reached` when a budget stopped the plan early.
   */
  status: 'ok' | 'partial' | 'search_failed' | 'limit_reached';
  documents: ResearchDocument[];
  attempts: Attempt[];
  counters: {
    queries_issued: number;
    documents_returned: number;
    documents_retained: number;
    duplicates_dropped: number;
    providers_ok: number;
    providers_empty: number;
    providers_failed: number;
    providers_unavailable: number;
    dated_documents: number;
    undated_documents: number;
  };
  duplicates: DuplicateDrop[];
  /** Share of retained documents per source identity. High concentration is not corroboration. */
  source_concentration: SourceShare[];
  limit_reached: string | null;
  notes: string[];
}

export interface ExecuteDeps {
  providers: ResearchProvider[];
  fetchImpl: typeof fetch;
  now: string;
  /** Set only when the operator turned the reader proxy on. */
  proxy?: ((url: string) => string) | null;
  timeoutMs?: number;
  onEvent?: (event: ResearchEvent) => void;
  /** Injected so the elapsed measurement is testable. Defaults to the real clock. */
  clock?: () => number;
}

/** Query strings differing only in case, punctuation or spacing are the same query. */
const normaliseUrl = (url: string | null): string | null => {
  if (url === null) return null;
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
};
const normaliseTitle = (title: string): string => title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

export async function executeResearch(plan: ResearchPlan, deps: ExecuteDeps): Promise<ResearchExecution> {
  const clock = deps.clock ?? (() => Date.now());
  const started = clock();
  const emit = (event: ResearchEvent) => deps.onEvent?.(event);
  const byId = new Map(deps.providers.map((p) => [p.descriptor.id, p]));
  const proxy = deps.proxy ?? null;

  const attempts: Attempt[] = [];
  const documents: ResearchDocument[] = [];
  const duplicates: DuplicateDrop[] = [];
  const notes: string[] = [];
  const seenUrl = new Map<string, string>();
  const seenTitle = new Map<string, string>();
  let returnedTotal = 0;
  let queries = 0;
  let limit_reached: string | null = null;

  emit({ kind: 'plan_started', queries: plan.external.call_count, providers: plan.external.providers });

  outer: for (const dimension of plan.dimensions) {
    for (const query of dimension.queries) {
      for (const providerId of dimension.providers) {
        if (limit_reached !== null) {
          attempts.push({ dimension: dimension.key, provider: providerId, query, status: 'skipped_budget', reason: limit_reached, returned: 0, retained: 0, ms: 0 });
          continue;
        }
        if (queries >= plan.budget.max_provider_calls) {
          limit_reached = `LIMIT_REACHED: the ${plan.budget.max_provider_calls}-call budget was exhausted at dimension "${dimension.label}".`;
          emit({ kind: 'limit_reached', limit: limit_reached });
          continue;
        }
        if (clock() - started > plan.budget.max_ms) {
          limit_reached = `LIMIT_REACHED: external retrieval passed its ${plan.budget.max_ms}ms ceiling at dimension "${dimension.label}".`;
          emit({ kind: 'limit_reached', limit: limit_reached });
          continue;
        }

        const provider = byId.get(providerId);
        if (provider === undefined) {
          attempts.push({ dimension: dimension.key, provider: providerId, query, status: 'unavailable', reason: 'PROVIDER_UNAVAILABLE: not registered in this build.', returned: 0, retained: 0, ms: 0 });
          continue;
        }

        queries += 1;
        emit({ kind: 'query_issued', dimension: dimension.key, provider: providerId, query });
        const t0 = clock();
        const outcome = await provider.search({
          query,
          now: deps.now,
          limit: plan.budget.max_results_per_query,
          geo: plan.question.geo,
          proxy: provider.descriptor.requires_proxy || proxy !== null ? proxy : null,
          fetchImpl: deps.fetchImpl,
          timeoutMs: deps.timeoutMs ?? 12_000,
        });
        const ms = clock() - t0;

        if (outcome.status !== 'ok') {
          attempts.push({ dimension: dimension.key, provider: providerId, query, status: outcome.status, reason: outcome.reason, returned: 0, retained: 0, ms });
          if (outcome.status === 'empty') emit({ kind: 'provider_empty', dimension: dimension.key, provider: providerId, reason: outcome.reason });
          else emit({ kind: 'provider_failed', dimension: dimension.key, provider: providerId, status: outcome.status, reason: outcome.reason });
          continue;
        }

        returnedTotal += outcome.documents.length;
        emit({ kind: 'provider_answered', dimension: dimension.key, provider: providerId, returned: outcome.documents.length });
        let retained = 0;
        for (const doc of outcome.documents) {
          if (documents.length >= plan.budget.max_documents) {
            limit_reached = `LIMIT_REACHED: the ${plan.budget.max_documents}-document budget was reached, so later dimensions were not retrieved.`;
            emit({ kind: 'limit_reached', limit: limit_reached });
            break;
          }
          const urlKey = normaliseUrl(doc.url);
          const titleKey = `${normaliseTitle(doc.title)}|${doc.source_identity.toLowerCase()}`;
          if (urlKey !== null && seenUrl.has(urlKey)) {
            const kept = seenUrl.get(urlKey)!;
            duplicates.push({ kept, dropped: doc.title, reason: 'same_url' });
            emit({ kind: 'duplicate_dropped', kept, dropped: doc.title, reason: 'same_url' });
            continue;
          }
          if (seenTitle.has(titleKey)) {
            const kept = seenTitle.get(titleKey)!;
            duplicates.push({ kept, dropped: doc.title, reason: 'same_title_and_source' });
            emit({ kind: 'duplicate_dropped', kept, dropped: doc.title, reason: 'same_title_and_source' });
            continue;
          }
          if (urlKey !== null) seenUrl.set(urlKey, doc.title);
          seenTitle.set(titleKey, doc.title);
          documents.push(doc);
          retained += 1;
          emit({ kind: 'document_retained', provider: providerId, title: doc.title, source_identity: doc.source_identity });
        }
        attempts.push({ dimension: dimension.key, provider: providerId, query, status: 'ok', reason: null, returned: outcome.documents.length, retained, ms });
        if (limit_reached !== null) continue outer;
      }
    }
  }

  const counts = new Map<string, number>();
  for (const d of documents) counts.set(d.source_identity, (counts.get(d.source_identity) ?? 0) + 1);
  const source_concentration: SourceShare[] = [...counts.entries()]
    .map(([source_identity, count]) => ({ source_identity, count, share: documents.length === 0 ? 0 : Number((count / documents.length).toFixed(4)) }))
    .sort((a, b) => b.count - a.count || a.source_identity.localeCompare(b.source_identity));

  const answered = attempts.filter((a) => a.status === 'ok').length;
  const failed = attempts.filter((a) => a.status === 'search_failed').length;
  const unavailable = attempts.filter((a) => a.status === 'unavailable').length;
  const empty = attempts.filter((a) => a.status === 'empty').length;

  const status: ResearchExecution['status'] =
    limit_reached !== null ? 'limit_reached' : answered === 0 && attempts.length > 0 ? 'search_failed' : failed + unavailable > 0 ? 'partial' : 'ok';

  if (status === 'search_failed') notes.push('SEARCH_FAILED: no provider answered, so nothing in this run rests on external evidence.');
  if (unavailable > 0) notes.push(`${unavailable} attempt(s) could not be made at all. In a browser that normally means the provider sends no CORS header.`);
  const top = source_concentration[0];
  if (top !== undefined && documents.length >= 4 && top.share >= 0.5) {
    notes.push(`${Math.round(top.share * 100)}% of retained documents come from ${top.source_identity}. Repetition by one source is not corroboration.`);
  }
  const undated = documents.filter((d) => d.published_at === null).length;
  if (undated > 0) notes.push(`FRESHNESS_UNKNOWN for ${undated} of ${documents.length} document(s): the source states no date, and the clock was not substituted for one.`);

  const ms = clock() - started;
  emit({ kind: 'plan_finished', retained: documents.length, ms });

  return {
    plan,
    started_at: deps.now,
    ms,
    status,
    documents,
    attempts,
    counters: {
      queries_issued: queries,
      documents_returned: returnedTotal,
      documents_retained: documents.length,
      duplicates_dropped: duplicates.length,
      providers_ok: answered,
      providers_empty: empty,
      providers_failed: failed,
      providers_unavailable: unavailable,
      dated_documents: documents.length - undated,
      undated_documents: undated,
    },
    duplicates,
    source_concentration,
    limit_reached,
    notes: [...plan.notes, ...notes],
  };
}
