/**
 * SCREEN 12 - INTERNAL KNOWLEDGE. What this system already holds, before it retrieves anything.
 *
 * EVOLUTION 5.0 Phase G. `core/knowledge/internal.ts` has been tested and buildable since EVOLUTION 4.0
 * and had no screen, which meant the honest answer to "what do you already know about this?" was
 * unreachable. This screen is that answer and nothing more: it runs the module's own `search()` and prints
 * what comes back.
 *
 * Three things it deliberately does not do. It does not rank differently from the engine - the score
 * shown is the score the engine would use. It does not hide a miss: `empty` and `unavailable` are
 * rendered with the module's own reason string, verbatim, because "the repository holds nothing on this"
 * and "the index could not be read" are different facts and both are useful. And it does not summarise a
 * record - the text shown is the indexed text, clipped by the indexer, with its own hash beside it, so a
 * claim can be traced to the bytes that were read.
 */
import { useCallback, useEffect, useState } from 'react';
import { snapshotLoader } from '@app/lib/engine';
import { Button, Empty, Field, Panel, Row, Tag, inputClass } from '@app/ui/kit';
import {
  createInternalKnowledge,
  type IndexMeta,
  type InternalOutcome,
  type KnowledgeRecord,
} from '@core/knowledge/internal';

const KINDS: Array<KnowledgeRecord['source_kind']> = ['taxonomy', 'controls', 'document'];

const KIND_TONE: Record<KnowledgeRecord['source_kind'], 'signal' | 'support' | 'neutral'> = {
  taxonomy: 'signal',
  controls: 'support',
  document: 'neutral',
};

const EXAMPLES = [
  'phantom carrier fraud',
  'how is confidence gated',
  'append-only graph',
  'prompt injection',
];

export function InternalKnowledge() {
  const [knowledge] = useState(() => createInternalKnowledge(snapshotLoader()));
  const [meta, setMeta] = useState<IndexMeta | null>(null);
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [kinds, setKinds] = useState<Array<KnowledgeRecord['source_kind']>>([]);
  const [outcome, setOutcome] = useState<InternalOutcome | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let live = true;
    knowledge.meta().then((m) => {
      if (!live) return;
      setMeta(m);
      setMetaLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [knowledge]);

  const search = useCallback(async () => {
    const q = query.trim();
    if (q.length === 0) return;
    setSearching(true);
    const result = await knowledge.search([q], { limit: 12, kinds: kinds.length === 0 ? undefined : kinds });
    setOutcome(result);
    setSearching(false);
  }, [knowledge, query, kinds]);

  const toggleKind = (k: KnowledgeRecord['source_kind']) =>
    setKinds((current) => (current.includes(k) ? current.filter((x) => x !== k) : [...current, k]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Internal Knowledge</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
          What this system already holds, compiled from the repository into one pinned, hashed index. Search
          it before spending a run: a question already answered here does not need retrieving.
        </p>
      </div>

      <Panel title="the index" aside={<span className="text-2xs text-fg-mute">pinned and hashed</span>}>
        {!metaLoaded ? (
          <p className="text-xs text-fg-mute">Reading the index.</p>
        ) : meta === null ? (
          <p className="text-xs leading-relaxed text-caution">
            The knowledge index could not be read, so this screen cannot say what the system holds. It is not
            saying the system holds nothing. Rebuild it with{' '}
            <span className="num">node scripts/build-knowledge-index.mjs</span>.
          </p>
        ) : (
          <>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <Row k="records" v={<span className="num text-sm">{meta.record_count}</span>} />
              <Row k="built at" v={<span className="num text-xs">{meta.built_at}</span>} />
              <Row k="content hash" v={<span className="num text-xs" title={meta.content_hash}>{meta.content_hash.slice(0, 16)}…</span>} />
              <Row k="sources" v={<span className="num text-sm">{meta.sources.length}</span>} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 hair-t pt-3">
              {meta.sources.map((s) => (
                <span key={s} className="num border border-line px-1.5 py-0.5 text-2xs text-fg-mute">{s}</span>
              ))}
            </div>
          </>
        )}
      </Panel>

      <Panel title="search what we already hold">
        <Field label="query" hint="Ranked by inverse-document-frequency weighted term overlap. The score is relative to the best hit in this search only.">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void search();
            }}
            placeholder="phantom carrier fraud"
            className={inputClass}
          />
        </Field>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => toggleKind(k)}
              className={`border px-2 py-1 font-mono text-2xs uppercase tracking-[0.1em] transition-colors ${
                kinds.includes(k) ? 'border-signal/60 bg-signal/10 text-signal' : 'border-line text-fg-mute hover:text-fg'
              }`}
            >
              {k}
            </button>
          ))}
          <span className="text-2xs text-fg-mute">{kinds.length === 0 ? 'all kinds' : `${kinds.length} of ${KINDS.length} kinds`}</span>
          <Button onClick={() => void search()} disabled={query.trim().length === 0 || searching} className="ml-auto">
            {searching ? 'searching' : 'search'}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 hair-t pt-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setQuery(ex)}
              className="hair px-2.5 py-1 text-xs text-fg-dim transition-colors hover:border-line-bright hover:text-fg"
            >
              {ex}
            </button>
          ))}
        </div>
      </Panel>

      {outcome === null ? (
        <Panel title="results">
          <Empty>Nothing searched yet.</Empty>
        </Panel>
      ) : outcome.status === 'unavailable' ? (
        <Panel title="results">
          <p className="text-xs leading-relaxed text-caution">{outcome.reason}</p>
        </Panel>
      ) : outcome.status === 'empty' ? (
        <Panel title="results" aside={<span className="text-2xs text-fg-mute">no match</span>}>
          <p className="text-xs leading-relaxed text-fg-dim">{outcome.reason}</p>
          <p className="mt-2 text-2xs leading-relaxed text-fg-mute">
            terms searched: {outcome.terms_searched.length === 0 ? 'none survived stopword removal' : outcome.terms_searched.join(', ')}
          </p>
        </Panel>
      ) : (
        <Panel
          title="results"
          aside={<span className="num text-2xs text-fg-mute">{outcome.hits.length} hit{outcome.hits.length === 1 ? '' : 's'}</span>}
          flush
        >
          <p className="hair-b px-4 py-2.5 text-2xs leading-relaxed text-fg-mute">
            terms searched: {outcome.terms_searched.join(', ')} &middot; index {outcome.index.record_count} records
          </p>
          <ul>
            {outcome.hits.map((h) => (
              <li key={h.record.id} className="hair-b px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Tag tone={KIND_TONE[h.record.source_kind]}>{h.record.source_kind}</Tag>
                  <span className="text-sm text-fg">{h.record.title}</span>
                  <span className="num ml-auto text-2xs text-fg-mute">{h.score.toFixed(2)}</span>
                </div>
                <div className="num mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-mute">
                  <span>{h.record.path}#{h.record.ref}</span>
                  <span title={h.record.sha256}>sha256 {h.record.sha256.slice(0, 12)}</span>
                  <span>{h.record.bytes} bytes</span>
                  {h.record.updated_at !== null && <span>{h.record.updated_at}</span>}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-fg-dim">{h.record.text}</p>
                {h.record.truncated && (
                  <p className="mt-1.5 text-2xs leading-relaxed text-caution">
                    Clipped by the indexer at {h.record.bytes} bytes. This is not the whole section; read the
                    file at the ref above before relying on it.
                  </p>
                )}
                <p className="mt-1.5 text-2xs leading-relaxed text-fg-mute">matched: {h.matched_terms.join(', ')}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
