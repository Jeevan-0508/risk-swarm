/**
 * INTERNAL KNOWLEDGE RETRIEVAL.
 *
 * The repository is treated as organisational memory: taxonomy patterns, governance controls and
 * documentation sections, compiled into one pinned hashed index by
 * `scripts/build-knowledge-index.mjs` and served through the existing snapshot loader, so the same
 * code runs in the browser and in tests.
 *
 * Two properties matter more than ranking quality:
 *
 *   1. A hit is citable. Every record carries its file, its ref and its own content hash, so a claim
 *      drawn from internal knowledge can be traced to the exact text that was read.
 *   2. A miss is reported. An empty result is `empty` with a reason, and a missing index is
 *      `unavailable`. Neither is ever presented as "nothing exists on this subject".
 *
 * Ranking is inverse-document-frequency weighted term overlap. It is deliberately simple and
 * deliberately explained rather than tuned: the score is shown to the operator beside the hit, and a
 * score nobody can explain is worse than a crude one everybody can.
 */
import type { SnapshotLoader } from '../integrations/loader';
import { keywordsOf } from '../question/model';

export interface KnowledgeRecord {
  id: string;
  source_kind: 'taxonomy' | 'controls' | 'document';
  source: string;
  path: string;
  ref: string;
  title: string;
  text: string;
  truncated: boolean;
  bytes: number;
  sha256: string;
  updated_at: string | null;
  facets: Record<string, unknown>;
}

export interface KnowledgeIndex {
  schema_version: string;
  built_at: string;
  content_hash: string;
  record_count: number;
  sources: string[];
  note: string;
  records: KnowledgeRecord[];
}

export interface KnowledgeHit {
  record: KnowledgeRecord;
  /** 0-1, relative to the best hit in this search. Comparable within one search, not across searches. */
  score: number;
  matched_terms: string[];
}

export interface IndexMeta {
  built_at: string;
  content_hash: string;
  record_count: number;
  sources: string[];
}

export type InternalOutcome =
  | { status: 'ok'; hits: KnowledgeHit[]; queries: string[]; terms_searched: string[]; index: IndexMeta }
  | { status: 'empty'; reason: string; queries: string[]; terms_searched: string[]; index: IndexMeta }
  | { status: 'unavailable'; reason: string; queries: string[] };

export interface SearchOptions {
  limit?: number;
  /** Records scoring below this fraction of the best hit are dropped. Reported, not hidden. */
  minScore?: number;
  kinds?: Array<KnowledgeRecord['source_kind']>;
}

export interface InternalKnowledge {
  meta(): Promise<IndexMeta | null>;
  search(queries: string[], options?: SearchOptions): Promise<InternalOutcome>;
}

export const KNOWLEDGE_INDEX_PATH = 'knowledge/index.json';

/** Terms a record contributes, title weighted by being listed twice - the only weighting in the scorer. */
function termsOf(record: KnowledgeRecord): string[] {
  return [...keywordsOf(record.title), ...keywordsOf(record.title), ...keywordsOf(record.text)];
}

export function createInternalKnowledge(loader: SnapshotLoader): InternalKnowledge {
  let loaded: Promise<KnowledgeIndex | null> | null = null;
  const load = (): Promise<KnowledgeIndex | null> => {
    if (loaded === null) {
      loaded = loader
        .loadJson<KnowledgeIndex>(KNOWLEDGE_INDEX_PATH)
        .then((idx) => (Array.isArray(idx?.records) ? idx : null))
        .catch(() => null);
    }
    return loaded;
  };

  let prepared: { index: KnowledgeIndex; termsById: Map<string, Map<string, number>>; df: Map<string, number> } | null = null;
  const prepare = async () => {
    if (prepared !== null) return prepared;
    const index = await load();
    if (index === null) return null;
    const termsById = new Map<string, Map<string, number>>();
    const df = new Map<string, number>();
    for (const record of index.records) {
      const counts = new Map<string, number>();
      for (const t of termsOf(record)) counts.set(t, (counts.get(t) ?? 0) + 1);
      termsById.set(record.id, counts);
      for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    }
    prepared = { index, termsById, df };
    return prepared;
  };

  const metaOf = (index: KnowledgeIndex): IndexMeta => ({
    built_at: index.built_at,
    content_hash: index.content_hash,
    record_count: index.record_count,
    sources: index.sources,
  });

  return {
    async meta() {
      const index = await load();
      return index === null ? null : metaOf(index);
    },

    async search(queries, options = {}) {
      const ready = await prepare();
      if (ready === null) {
        return {
          status: 'unavailable',
          reason: 'INTERNAL_KNOWLEDGE_UNAVAILABLE: the knowledge index could not be read, so this run cannot say what it already held.',
          queries,
        };
      }
      const { index, termsById, df } = ready;
      const terms = [...new Set(queries.flatMap((q) => keywordsOf(q)))];
      const meta = metaOf(index);
      if (terms.length === 0) {
        return { status: 'empty', reason: 'No searchable term survived stopword removal.', queries, terms_searched: terms, index: meta };
      }

      const total = index.records.length;
      const kinds = options.kinds;
      const raw: Array<{ record: KnowledgeRecord; score: number; matched: string[] }> = [];
      for (const record of index.records) {
        if (kinds !== undefined && !kinds.includes(record.source_kind)) continue;
        const counts = termsById.get(record.id);
        if (counts === undefined) continue;
        let score = 0;
        const matched: string[] = [];
        for (const term of terms) {
          const tf = counts.get(term);
          if (tf === undefined) continue;
          const seen = df.get(term) ?? 1;
          // Plain idf: a term in almost every record tells the reader nothing about this one.
          score += Math.log(1 + total / seen) * (1 + Math.log(tf));
          matched.push(term);
        }
        if (score > 0) raw.push({ record, score, matched });
      }

      if (raw.length === 0) {
        return {
          status: 'empty',
          reason: `No internal record matched any of ${terms.length} term(s). This means the repository holds nothing on the subject, not that nothing exists.`,
          queries,
          terms_searched: terms,
          index: meta,
        };
      }

      const best = Math.max(...raw.map((r) => r.score));
      const minScore = options.minScore ?? 0.08;
      const hits = raw
        .map((r) => ({ record: r.record, score: Number((r.score / best).toFixed(4)), matched_terms: r.matched.slice().sort() }))
        .filter((h) => h.score >= minScore)
        // Ties break on id so the order is stable across runs and platforms.
        .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))
        .slice(0, options.limit ?? 8);

      return { status: 'ok', hits, queries, terms_searched: terms, index: meta };
    },
  };
}
