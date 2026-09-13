/**
 * LIVE retrieval seam. A live source is a named endpoint that returns items; it does not decide how much
 * they are worth. Tier follows source_type through the fixed map in the domain model, exactly as it does
 * for a snapshot, so switching to LIVE can add evidence but can never promote it.
 */
import type { SourceType } from '../domain/model';

export interface LiveItem {
  title: string;
  url: string | null;
  publisher: string;
  /** Published date as stated by the source. Never the retrieval time. */
  published_at: string | null;
  summary: string;
}

export interface FetchedFeed {
  source_key: string;
  endpoint: string;
  /** sha256 of the exact bytes parsed, so a later run can prove it read the same document. */
  content_hash: string;
  bytes: number;
  items: LiveItem[];
}

export interface FeedFailure {
  source_key: string;
  endpoint: string;
  /** Stated plainly. A blocked fetch is reported, never replaced with a plausible item. */
  reason: string;
  kind: 'blocked' | 'http_error' | 'parse_error' | 'timeout' | 'not_configured';
}

export interface LiveSource {
  key: string;
  label: string;
  source_type: SourceType;
  /** What this source is for, shown in the UI beside its tier. */
  remit: string;
  endpoints(query: LiveQuery): string[];
  parse(body: string): LiveItem[];
}

export interface LiveQuery {
  terms: string[];
  geo: string[];
  /** Language/region hint some feeds accept. Optional everywhere. */
  locale?: string;
}

export interface LiveFetchResult {
  feeds: FetchedFeed[];
  failures: FeedFailure[];
}

export interface LiveDeps {
  fetchImpl: typeof fetch;
  hash: (body: string) => Promise<string>;
  timeoutMs?: number;
}
