/**
 * SCREEN 08 - HISTORY. Finished runs, kept in the browser. What was asked, what was recommended, and
 * whether a human ever ruled on it. A stored run is reloaded through the same schema a live one passes.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@app/store/session';
import { historyIsDurable } from '@app/lib/persist';
import { BAND_TONE, Button, Empty, Metric, Panel, SEVERITY_TONE, Tag, type Tone } from '@app/ui/kit';

const STATUS_TONE: Record<string, Tone> = { complete: 'support', running: 'signal', stopped: 'caution', failed: 'block' };
const VERDICT_TONE: Record<string, Tone> = { accepted: 'support', overridden: 'caution', rejected: 'objection' };

export function History() {
  const { runs, activeId, select, discard, discardAll } = useSession();
  const withResult = runs.filter((r) => r.result !== null);
  const ruled = withResult.filter((r) => r.human !== null);

  return (
    <Screen>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Metric label="runs held" value={runs.length} />
        <Metric label="published" value={withResult.length} sub="reached a recommendation" />
        <Metric label="ruled on by a human" value={ruled.length} tone={ruled.length > 0 ? 'support' : 'caution'}
          sub={ruled.length === 0 ? 'nothing here has been decided yet' : 'verdict recorded beside the recommendation'} />
        <Metric label="storage" value={historyIsDurable ? 'browser' : 'session'} mono={false}
          sub={historyIsDurable ? 'localStorage on this device only — nothing leaves the browser' : 'storage unavailable, so history lasts until this tab closes'} />
      </div>

      <Panel title={`runs · ${runs.length}`} aside={runs.length > 0 ? <Button variant="danger" onClick={discardAll}>discard all</Button> : undefined} flush>
        {runs.length === 0 ? <Empty>Nothing yet. Run an investigation and it appears here.</Empty> : (
          <ul className="divide-y divide-line">
            {runs.map((r) => {
              const d = r.result?.outputs.decision.decision ?? null;
              return (
                <li key={r.id} className={`px-4 py-3 ${r.id === activeId ? 'bg-ink-700' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-2xs text-fg-mute">{r.id}</span>
                    <Tag>{r.mode}</Tag>
                    <Tag tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Tag>
                    {d !== null && <Tag tone={BAND_TONE[d.action_band] ?? 'neutral'}>{d.action_band.replace(/_/g, ' ')}</Tag>}
                    {d !== null && <Tag tone={SEVERITY_TONE[d.severity_band] ?? 'neutral'}>{d.severity_band} {d.severity_score.toFixed(3)}</Tag>}
                    {d !== null && <Tag tone={d.confidence === null ? 'block' : 'support'}>{d.confidence === null ? 'confidence withheld' : `confidence ${d.confidence.toFixed(2)}`}</Tag>}
                    {r.human !== null && <Tag tone={VERDICT_TONE[r.human.verdict] ?? 'neutral'}>human {r.human.verdict} → {r.human.band}</Tag>}
                    <span className="num ml-auto text-2xs text-fg-mute" title="asked at">{r.created_at.replace('T', ' ').slice(0, 16)}</span>
                    <span className="num text-2xs text-fg-mute" title="result at">
                      → {r.completed_at === null ? 'time not recorded' : r.completed_at.replace('T', ' ').slice(11, 16)}
                      {elapsed(r.created_at, r.completed_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-snug text-fg-dim">{r.question}</p>
                  {r.error !== null && <p className="mt-1.5 text-xs leading-snug text-block">{r.error}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {r.result !== null && (
                      <Link to={`/history/${r.id}`}
                        className="border border-line-bright px-2 py-0.5 font-mono text-2xs uppercase tracking-[0.1em] text-fg transition-colors hover:bg-fg hover:text-ink-900">
                        open case file
                      </Link>
                    )}
                    <Button variant="ghost" onClick={() => select(r.id)} disabled={r.id === activeId}>
                      {r.id === activeId ? 'loaded' : 'load'}
                    </Button>
                    <Button variant="ghost" onClick={() => discard(r.id)}>discard</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="what is stored">
        <p className="mb-3 text-sm leading-relaxed text-fg-dim">
          Opening a case file lays out one run in full — when it was asked, when it answered, what each agent
          said in turn, who disagreed with whom, and what was recommended — and downloads it as HTML, Word,
          markdown, JSON or a printed PDF.
        </p>
        <p className="text-sm leading-relaxed text-fg-dim">
          A stored run holds the whole graph, every agent output, the scoring policy in force and the
          budget spent. On reload it is validated against the same schema a live run passes, and a record
          that no longer parses is dropped rather than repaired — a silently patched audit trail is worse
          than a missing one. Nothing is uploaded anywhere.
        </p>
      </Panel>
    </Screen>
  );
}

/** Blank rather than 0.0s when a run predates completion tracking: an invented duration is worse than none. */
function elapsed(asked: string, completed: string | null): string {
  if (completed === null) return '';
  const ms = Date.parse(completed) - Date.parse(asked);
  if (!Number.isFinite(ms) || ms < 0) return '';
  return ` · ${(ms / 1000).toFixed(1)}s`;
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">History</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-dim">
          Past investigations, on this device. Keeping them is what makes the system answerable later:
          what it recommended, what a human did about it, and whether that turned out to be right.
        </p>
      </div>
      {children}
    </div>
  );
}
