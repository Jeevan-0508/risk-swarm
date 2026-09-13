/**
 * SCREEN 10 - KNOWLEDGE & PROVENANCE. Where the system's knowledge comes from: the pinned snapshots with
 * their upstream commit and content hash, the source tier ladder, and the injection defence applied to
 * everything that enters. If a figure on any other screen cannot be traced back to something here, it
 * should not be on that screen.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { FENCE_BREAKER_NAMES, INJECTION_PATTERN_NAMES } from '@core/ingest/sanitize';
import { TIER_WEIGHT } from '@core/domain/model';
import { useSession } from '@app/store/session';
import { MODE_NOTE } from '@app/lib/engine';
import { Empty, Metric, Panel, Row, STATUS_TONE, TIER_TONE, Tag } from '@app/ui/kit';

interface ProvenanceFile { upstream_path: string; path: string; bytes: number; sha256: string }
interface ProvenanceSource { key: string; upstream_repo: string; upstream_url: string; commit: string; note: string; files: ProvenanceFile[] }
interface ProvenanceDoc { schema_version: string; synced_at: string; synced_by: string; sources: ProvenanceSource[] }

const TIER_SOURCE: Record<number, string> = {
  1: 'Regulator, statute or official journal',
  2: 'Industry body, insurer or standards organisation',
  3: 'Press and trade reporting',
  4: 'Aggregator, forum or unattributed post',
  5: 'The system’s own reasoning',
};

export function Provenance() {
  const { active, mode, retrieval } = useSession();
  const run = active();
  const result = run?.result ?? null;
  const fetched = run === null ? undefined : retrieval[run.id];
  const [doc, setDoc] = useState<ProvenanceDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/snapshots/provenance.json`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((d: ProvenanceDoc) => setDoc(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const evidence = result === null ? [] : result.graph.all().filter((n) => n.kind === 'evidence');
  const byTier = new Map<number, number>();
  const bySourceType = new Map<string, number>();
  let injectionFlagged = 0;
  for (const e of evidence) {
    if (e.kind !== 'evidence') continue;
    byTier.set(e.tier, (byTier.get(e.tier) ?? 0) + 1);
    bySourceType.set(e.source_type, (bySourceType.get(e.source_type) ?? 0) + 1);
    if (e.injection_suspected) injectionFlagged += 1;
  }

  return (
    <Screen>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Metric label="snapshot sources" value={doc?.sources.length ?? '—'} sub={doc === null ? error ?? 'loading' : `synced ${doc.synced_at.slice(0, 10)}`} />
        <Metric label="pinned files" value={doc?.sources.reduce((n, s) => n + s.files.length, 0) ?? '—'} sub="each with an upstream commit and a sha256" />
        <Metric label="injection patterns" value={INJECTION_PATTERN_NAMES.length} sub="applied to every retrieved string before it is stored" />
        <Metric label="flagged in this run" value={result === null ? '—' : injectionFlagged} tone={injectionFlagged > 0 ? 'block' : 'support'}
          sub="a flagged source keeps half its tier weight and is never followed as an instruction" />
      </div>

      <Panel title="mode in force" aside={<Tag tone={mode === 'LIVE' ? 'caution' : 'support'}>{mode}</Tag>}>
        <p className="text-sm leading-relaxed text-fg-dim">{MODE_NOTE[mode]}</p>
      </Panel>

      {result !== null && (
        <Panel title="SENTINEL · evidence integrity" aside={<Tag tone={STATUS_TONE[result.sentinel.status]}>{result.sentinel.status}</Tag>} flush>
          <ul className="divide-y divide-line">
            {result.sentinel.checks.map((c) => (
              <li key={c.key} className="px-4 py-2.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Tag tone={STATUS_TONE[c.status]}>{c.status}</Tag>
                  <span className="text-sm text-fg">{c.label}</span>
                  {c.node_ids.length > 0 && <span className="num ml-auto text-2xs text-fg-mute">{c.node_ids.length} node(s)</span>}
                </div>
                <p className="mt-1 text-xs leading-snug text-fg-mute">{c.detail}</p>
              </li>
            ))}
          </ul>
          <p className="hair-t px-4 py-2.5 text-xs leading-relaxed text-fg-mute">
            SENTINEL validates the record this run produced — citations, dates, hashes, the graph's own
            shape. It never argues about the risk and never sends work back; that is the red team's and
            decision engine's job. A BLOCKED check here is a defect in this run's bookkeeping, not evidence
            that the recommendation itself is wrong.
          </p>
        </Panel>
      )}

      {fetched !== undefined && (
        <Panel title={`live retrieval · this run`} flush
          aside={<span className="num text-2xs text-fg-mute">{fetched.feeds.length} read · {fetched.failures.length} unavailable</span>}>
          {fetched.feeds.length === 0 && fetched.failures.length === 0 ? <Empty>No live endpoint was configured.</Empty> : (
            <ul className="divide-y divide-line">
              {fetched.feeds.map((f) => (
                <li key={`${f.source_key}:${f.endpoint}`} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Tag tone="support">{f.source_key}</Tag>
                    <span className="num text-2xs text-fg-mute">{(f.bytes / 1024).toFixed(1)} kB · {f.items.length} item(s)</span>
                  </div>
                  <p className="num mt-1 break-all text-2xs text-fg-dim">{f.endpoint}</p>
                  <p className="num mt-0.5 break-all text-2xs text-fg-mute">hash {f.content_hash}</p>
                </li>
              ))}
              {fetched.failures.map((f) => (
                <li key={`${f.source_key}:${f.endpoint}:${f.kind}`} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Tag tone="block">{f.kind}</Tag>
                    <span className="text-2xs text-fg-dim">{f.source_key}</span>
                  </div>
                  <p className="num mt-1 break-all text-2xs text-fg-mute">{f.endpoint}</p>
                  <p className="mt-0.5 text-xs leading-snug text-caution">{f.reason}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="hair-t px-4 py-2.5 text-xs leading-relaxed text-fg-mute">
            A feed that could not be read is listed with its reason and contributes nothing. It is never replaced
            with a plausible substitute. These hashes are session-only: a refetch produces different bytes, so they
            are not persisted as if they were pinned.
          </p>
        </Panel>
      )}

      <Panel title="pinned snapshots" flush>
        {doc === null ? <Empty>{error ?? 'Loading provenance…'}</Empty> : (
          <ul className="divide-y divide-line">
            {doc.sources.map((s) => (
              <li key={s.key} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm text-fg">{s.upstream_repo}</span>
                  <a href={s.upstream_url} target="_blank" rel="noreferrer" className="num text-2xs text-signal hover:underline">{s.upstream_url}</a>
                  <span className="num ml-auto text-2xs text-fg-mute">commit {s.commit.slice(0, 10)}</span>
                </div>
                <p className="mt-1 text-xs leading-snug text-fg-mute">{s.note}</p>
                <ul className="mt-2 divide-y divide-line">
                  {s.files.map((f) => (
                    <li key={f.path} className="py-1.5">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="num text-2xs text-fg-dim">{f.path}</span>
                        <span className="num text-2xs text-fg-mute">{(f.bytes / 1024).toFixed(1)} kB</span>
                      </div>
                      <p className="num mt-0.5 break-all text-2xs text-fg-mute">sha256 {f.sha256}</p>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {doc !== null && (
          <p className="hair-t px-4 py-2.5 text-xs leading-relaxed text-fg-mute">
            Synced by <span className="num">{doc.synced_by}</span>. The hash is checked before a run, so a
            snapshot that has drifted from what was reviewed fails loudly instead of quietly changing an
            answer.
          </p>
        )}
      </Panel>

      <Panel title="source tier ladder" aside={<span className="text-2xs text-fg-mute">tier is derived from source type, never supplied by a caller</span>} flush>
        <ul className="divide-y divide-line">
          {[1, 2, 3, 4, 5].map((t) => (
            <li key={t} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5">
              <Tag tone={TIER_TONE[t] ?? 'neutral'}>tier {t}</Tag>
              <span className="text-sm text-fg-dim">{TIER_SOURCE[t]}</span>
              <span className="num ml-auto text-2xs text-fg-mute">
                weight {TIER_WEIGHT[t as 1 | 2 | 3 | 4 | 5]}
                {result !== null && ` · ${byTier.get(t) ?? 0} in this run`}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {result !== null && (
        <Panel title={`evidence in this run · ${evidence.length}`} flush>
          <ul className="divide-y divide-line">
            {[...bySourceType.entries()].sort((a, b) => b[1] - a[1]).map(([type, n]) => (
              <li key={type} className="px-4 py-2"><Row k={type} v={`${n} object(s)`} /></li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="what is done to text before it is trusted">
        <div className="divide-y divide-line">
          <Row k="Instruction stripping" v={INJECTION_PATTERN_NAMES.join(", ")} />
          <Row k="Fence breakers neutralised" v={FENCE_BREAKER_NAMES.join(", ")} />
          <Row k="On a match" v="the evidence is flagged, its tier weight halved, and the text kept as data" />
          <Row k="Never" v="retrieved text is never executed, followed, or treated as a system instruction" />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-fg-mute">
          A retrieved document is evidence about the world, not a message to this program. The sanitiser
          exists because the difference is invisible in plain text, and any system that retrieves from the
          open web will eventually be handed a document that tries to give it orders.
        </p>
      </Panel>
    </Screen>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Knowledge &amp; Provenance</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-dim">
          Every claim this system makes rests on something listed here. The snapshots are pinned to an
          upstream commit and a content hash, the tier of a source decides how much weight it can carry,
          and nothing retrieved is ever read as an instruction.
        </p>
      </div>
      {children}
    </div>
  );
}
