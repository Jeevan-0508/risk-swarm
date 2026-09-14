/**
 * EVOLUTION 5.0 Phase E - the evidence inspector. One card for one piece of evidence, assembled entirely
 * from `evidenceCard()`; this component decides layout and nothing else.
 *
 * Two rules it renders under. First, the `not recorded` block is always drawn, never suppressed when it
 * is long: a reader has to be able to see what the console does not know about a source. Second, the
 * strength bars are `reliability` and `relevance` exactly as the node stores them, with no combined
 * "score" - averaging two different judgements into one number is precisely the move that makes a
 * console look confident about something nobody assessed.
 */
import type { AgentId } from '../core/domain/model';
import type { EvidenceCard } from './evidence';
import { ACCENT } from './tokens';

function Cap({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-2xs uppercase tracking-[0.18em] text-fg-mute">{children}</div>;
}

function Meter({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-2xs uppercase tracking-[0.14em] text-fg-mute">{label}</span>
        <span className="num text-2xs text-fg-dim">{value.toFixed(2)}</span>
      </div>
      <div className="rs-meter mt-1.5">
        <div className="rs-meter-fill" style={{ width: `${Math.round(value * 100)}%`, background: accent }} />
      </div>
    </div>
  );
}

export function EvidenceInspector({ card, codename, onCursor }: {
  card: EvidenceCard;
  /** Passed in so this file stays free of the agent roster; the roster is the app's, not the console's. */
  codename: (agent: AgentId) => string;
  /** Jump the replay to the exchange that cited this. Omitted when there is no transcript to jump in. */
  onCursor?: (sequence: number) => void;
}) {
  if (!card.found || card.evidence === null) {
    return (
      <div className="rs-glass p-5">
        <Cap>evidence inspector</Cap>
        <p className="mt-3 text-sm leading-relaxed text-caution">
          <span className="num">{card.id}</span> is not an evidence node in this run's graph. Nothing is
          reconstructed to stand in for it.
        </p>
      </div>
    );
  }

  const e = card.evidence;

  return (
    <div className="rs-glass p-5" style={{ ['--rs-accent' as string]: ACCENT.signal }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Cap>evidence</Cap>
        <span className="num text-2xs text-fg-mute">{card.id}</span>
        <span className="ml-auto font-mono text-2xs uppercase tracking-[0.14em]" style={{ color: ACCENT.signal }}>
          tier {e.tier} · {e.source_type.replace(/_/g, ' ')}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-fg">{e.title}</p>
      <p className="mt-2 text-xs leading-relaxed text-fg-dim">{e.claim}</p>
      {e.excerpt_or_summary.length > 0 && (
        <p className="mt-3 border-l-2 border-line-bright pl-3 text-xs leading-relaxed text-fg-mute">{e.excerpt_or_summary}</p>
      )}

      {e.injection_suspected && (
        <p className="mt-3 text-xs leading-relaxed" style={{ color: ACCENT.block }}>
          Prompt-injection suspected in this source. It is kept on the record and marked rather than
          deleted, so a reader can see what was attempted.
        </p>
      )}

      <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div className="space-y-3">
          <Meter label="reliability" value={e.reliability} accent={ACCENT.support} />
          <Meter label="relevance" value={e.relevance} accent={ACCENT.signal} />
        </div>
        <div className="space-y-3">
          <div>
            <Cap>source</Cap>
            <div className="mt-1 text-xs text-fg-dim">{e.source}</div>
            {e.url === null ? (
              <div className="mt-0.5 text-2xs text-fg-mute">No URL recorded on this node.</div>
            ) : (
              <a href={e.url} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-2xs text-signal hover:underline">
                {e.url}
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Cap>published</Cap>
              <div className="num mt-1 text-2xs text-fg-dim">
                {e.publication_date ?? 'not published / unknown'}
              </div>
            </div>
            <div>
              <Cap>retrieved</Cap>
              <div className="num mt-1 text-2xs text-fg-dim">{e.retrieved_at}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div>
          <Cap>independence</Cap>
          <p className="mt-1.5 text-2xs leading-relaxed text-fg-mute">
            {e.cluster_id === null
              ? 'No cluster assigned, so this node is not known to duplicate another. That is an absence of evidence for duplication, not a finding of independence.'
              : `Clustered as ${e.cluster_id}. Anything else in that cluster is the same story reaching the run twice and must not be counted as a second voice.`}
          </p>
        </div>
        <div>
          <Cap>claim type</Cap>
          <p className="mt-1.5 text-2xs leading-relaxed text-fg-mute">
            {e.incident_claim
              ? 'A concrete incident claim - it asserts something happened.'
              : 'A structural claim - about how the network or the fraud works, not about one event.'}
          </p>
        </div>
      </div>

      {card.superseded_by.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-caution">
          Superseded by <span className="num">{card.superseded_by.join(', ')}</span>. The old node stays in
          the graph; the graph is append-only.
        </p>
      )}

      <div className="mt-5 grid gap-x-6 gap-y-5 lg:grid-cols-2">
        <div>
          <Cap>where it is used</Cap>
          {card.cited_in.length === 0 ? (
            <p className="mt-2 text-2xs leading-relaxed text-fg-mute">
              No exchange in the transcript cites this id
              {card.used_by.length > 0
                ? `, though the node records ${card.used_by.length} agent(s) as having used it. Agents consume evidence outside the transcript too.`
                : '. Nothing in the chamber referred to it.'}
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {card.cited_in.map((c) => (
                <li key={`${c.sequence}-${c.type}`}>
                  <button
                    type="button"
                    onClick={() => onCursor?.(c.sequence)}
                    disabled={onCursor === undefined}
                    className="flex w-full items-baseline gap-2 text-left text-2xs text-fg-mute transition-colors hover:text-fg disabled:hover:text-fg-mute"
                  >
                    <span className="num">{String(c.sequence).padStart(2, '0')}</span>
                    <span className="font-mono tracking-[0.12em] text-fg-dim">{codename(c.from_agent)}</span>
                    <span className="truncate">{c.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {card.used_by.length > 0 && (
            <p className="mt-2 text-2xs leading-relaxed text-fg-mute">
              recorded on the node as used by: {card.used_by.map(codename).join(', ')}
            </p>
          )}
        </div>

        <div>
          <Cap>what it connects to</Cap>
          {card.links.length === 0 ? (
            <p className="mt-2 text-2xs leading-relaxed text-fg-mute">
              This node carries no graph edge, so nothing in the run rests on it.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {card.links.map((l) => (
                <li key={`${l.direction}-${l.edge}-${l.node_id}`} className="text-2xs leading-relaxed">
                  <span className="font-mono uppercase tracking-[0.12em] text-fg-mute">
                    {l.direction === 'from_this' ? `${l.edge} \u2192` : `\u2190 ${l.edge}`}
                  </span>{' '}
                  <span className="num text-fg-mute">{l.node_kind}</span>{' '}
                  <span className="text-fg-dim">{l.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-5">
        <Cap>not recorded on this node</Cap>
        <ul className="mt-2 space-y-1.5">
          {card.not_recorded.map((g) => (
            <li key={g.field} className="text-2xs leading-relaxed text-fg-mute">
              <span className="font-mono uppercase tracking-[0.12em]" style={{ color: ACCENT.caution }}>{g.field}</span>
              {' \u2014 '}
              {g.why}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
