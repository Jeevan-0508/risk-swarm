/**
 * THE COUNCIL's chamber - the whole presentational tree, deliberately free of the session store, of
 * `localStorage` and of the stylesheet import, so a test can render it over a real `investigate()`
 * result with no browser and no mocking. `Council.tsx` is the thin shell that finds the run and hands
 * it here; everything below is a pure function of a `RunResult`.
 *
 * The single rule this file exists under: **it renders events, it never makes them.** Every line in the
 * transcript comes from `result.deliberation.events`, which the coordinator emitted from real agent
 * output with every cited id already filtered against the graph. There is no code path in this folder
 * that can construct a `DeliberationEvent`, and `render.test.tsx` asserts that over the real run.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AgentId, DeliberationEvent } from '../core/domain/model';
import type { RunResult } from '../core/orchestrator/run';
import { AGENT_CODENAME, AGENT_LABEL } from '../app/lib/agents';
import { COUNCIL_ORDER, COUNCIL_SEATS, ringPoint } from './roster';
import { EVENT_TONE, OUTCOME_NOTE, OUTCOME_TONE, TONE_COLOR, chamberState, seatActivity, visible } from './derive';

const CHAMBER_LABEL: Record<ReturnType<typeof chamberState>, string> = {
  empty: 'no transcript',
  convening: 'convening',
  deliberating: 'in session',
  resolved: 'adjourned',
};

export function Label({ children }: { children: ReactNode }) {
  return <div className="font-mono text-2xs uppercase tracking-[0.18em] text-fg-mute">{children}</div>;
}

/** ZONE 1 - COUNCIL CORE. Seven seats on a ring, lit by whoever is speaking at the cursor. */
function CouncilCore({ events, cursor, onSelect, selected }: {
  events: DeliberationEvent[];
  cursor: number;
  selected: AgentId | null;
  onSelect: (id: AgentId | null) => void;
}) {
  const state = chamberState(events, cursor);
  const activity = useMemo(() => seatActivity(events, cursor), [events, cursor]);
  const current = cursor >= 0 ? events[Math.min(cursor, events.length - 1)] : undefined;
  const speaker = current?.from_agent ?? null;
  const addressee = current?.to_agent ?? null;

  const points = useMemo(
    () => COUNCIL_ORDER.map((_, i) => ringPoint(i, COUNCIL_ORDER.length)),
    [],
  );
  const from = speaker === null ? null : points[COUNCIL_ORDER.indexOf(speaker)];
  const to = addressee === null ? null : points[COUNCIL_ORDER.indexOf(addressee)];
  const tone = current === undefined ? TONE_COLOR.state : TONE_COLOR[EVENT_TONE[current.type]];

  return (
    <div className="cn-chamber">
      <div className="cn-ring" />
      <div className="cn-ring cn-ring-2" />
      <div className="cn-ring cn-ring-3" />

      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {from !== null && to !== null && (
          <line className="cn-beam" x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={tone} strokeWidth={0.4} />
        )}
      </svg>

      <div className="cn-core">
        <Label>{CHAMBER_LABEL[state]}</Label>
        <div className="num mt-2 text-3xl font-light leading-none">
          {Math.max(0, Math.min(cursor + 1, events.length))}
          <span className="text-fg-mute">/{events.length}</span>
        </div>
        <div className="mt-1.5 text-2xs text-fg-mute">exchanges read</div>
      </div>

      {COUNCIL_ORDER.map((id, i) => {
        const p = points[i];
        const seat = COUNCIL_SEATS[id];
        const act = activity[id];
        const spoke = (act?.spoke ?? 0) > 0;
        const right = p.x > 52;
        const classes = [
          'cn-seat',
          spoke ? 'cn-seat-spoken' : 'cn-seat-quiet',
          id === speaker ? 'cn-speaking' : '',
          id === addressee ? 'cn-addressed' : '',
        ].join(' ');
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(selected === id ? null : id)}
            style={{ left: `${p.x}%`, top: `${p.y}%`, ['--cn-accent' as string]: seat.accent }}
            className={classes}
            aria-pressed={selected === id}
            title={`${AGENT_CODENAME[id]} - ${AGENT_LABEL[id]}`}
          >
            <span className="flex items-center gap-2" style={{ flexDirection: right ? 'row' : 'row-reverse' }}>
              <span className="cn-dot" />
              <span className="text-left">
                <span
                  className="block font-mono text-2xs tracking-[0.16em]"
                  style={{ color: seat.accent, textDecoration: selected === id ? 'underline' : 'none' }}
                >
                  {AGENT_CODENAME[id]}
                </span>
                <span className="num block text-2xs text-fg-mute">
                  {act?.spoke ?? 0} said{(act?.unresolved ?? 0) > 0 ? ` · ${act.unresolved} open` : ''}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** ZONE 2 - LIVE DELIBERATION. The transcript, in `sequence` order, nothing inserted. */
function Deliberation({ events, cursor, onCursor, filter }: {
  events: DeliberationEvent[];
  cursor: number;
  onCursor: (n: number) => void;
  filter: AgentId | null;
}) {
  const shown = visible(events, cursor).filter((e) => filter === null || e.from_agent === filter || e.to_agent === filter);

  if (events.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-fg-mute">This run produced no deliberation transcript.</p>;
  }

  return (
    <div className="cn-scroll max-h-[62vh] overflow-y-auto">
      {shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-fg-mute">
          Nothing read yet from {filter === null ? 'the council' : AGENT_CODENAME[filter]}.
        </p>
      ) : (
        shown.map((e) => {
          const color = TONE_COLOR[EVENT_TONE[e.type]];
          const focus = e.sequence === cursor;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onCursor(e.sequence)}
              style={{ ['--cn-tone' as string]: color }}
              className={`cn-event cn-enter block w-full px-4 py-3 text-left ${focus ? 'cn-event-focus' : ''}`}
            >
              <div className="flex items-baseline gap-2">
                <span className="num text-2xs text-fg-mute">{String(e.sequence).padStart(2, '0')}</span>
                <span className="font-mono text-2xs tracking-[0.14em]" style={{ color: COUNCIL_SEATS[e.from_agent].accent }}>
                  {AGENT_CODENAME[e.from_agent]}
                </span>
                {e.to_agent !== null && (
                  <>
                    <span className="text-2xs text-fg-mute">&#8594;</span>
                    <span className="font-mono text-2xs tracking-[0.14em]" style={{ color: COUNCIL_SEATS[e.to_agent].accent }}>
                      {AGENT_CODENAME[e.to_agent]}
                    </span>
                  </>
                )}
                <span className="ml-auto font-mono text-2xs uppercase tracking-[0.12em]" style={{ color }}>
                  {e.type}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-dim">{e.content}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-mute">
                <span className={e.status === 'unresolved' ? 'text-caution' : ''}>{e.status}</span>
                {e.evidence_ids.length > 0 && <span className="num">{e.evidence_ids.length} evidence</span>}
                {e.claim_ids.length > 0 && <span className="num">{e.claim_ids.length} claim</span>}
                {e.requires_response && <span>awaiting response</span>}
              </div>
            </button>
          );
        })
      )}
    </div>
  );
}

/** ZONE 4 - DECISION CORE. The band and its qualifiers only; screen 07 remains the brief. */
function DecisionCore({ result }: { result: RunResult }) {
  const d = result.outputs.decision.decision;
  const report = result.deliberation;
  const outcomeColor = TONE_COLOR[OUTCOME_TONE[report.outcome]];

  return (
    <div className="cn-hair p-5">
      <Label>decision core</Label>
      <div className="mt-3 text-3xl font-light leading-none tracking-tight">{d.action_band.replace(/_/g, ' ')}</div>
      <div className="num mt-2 text-xs text-fg-dim">
        {d.severity_band} severity · urgency {d.urgency} · confidence{' '}
        {d.confidence === null ? <span className="text-caution">withheld</span> : d.confidence.toFixed(2)}
      </div>
      {d.confidence === null && d.confidence_blocked_reason !== null && (
        <p className="mt-2 text-2xs leading-relaxed text-fg-mute">{d.confidence_blocked_reason}</p>
      )}

      <div className="mt-5" style={{ borderTop: '1px solid rgba(120,140,180,0.18)' }} />

      <Label>
        <span className="mt-4 block">deliberation outcome</span>
      </Label>
      <div className="mt-2 font-mono text-sm tracking-[0.1em]" style={{ color: outcomeColor }}>
        {report.outcome.replace(/_/g, ' ')}
      </div>
      <p className="mt-2 text-2xs leading-relaxed text-fg-mute">{OUTCOME_NOTE[report.outcome]}</p>
      <div className="num mt-3 text-2xs text-fg-mute">
        {report.events.length} events · {report.rounds_used} rounds
        {report.limited_by !== null && <span className="text-caution"> · stopped by {report.limited_by}</span>}
      </div>

      {d.unresolved_objections.length > 0 && (
        <div className="num mt-3 text-2xs text-objection">{d.unresolved_objections.length} objections unresolved</div>
      )}

      <Link
        to="/brief"
        className="mt-5 inline-block border border-line-bright px-3 py-2 font-mono text-2xs uppercase tracking-[0.14em] text-fg-dim transition-colors hover:text-fg"
      >
        open the decision brief &#8599;
      </Link>
      <p className="mt-3 text-2xs leading-relaxed text-fg-mute">
        The recommendation, its gates and its caps are rendered once, by screen 07. The chamber links to
        it rather than printing a second version that could disagree.
      </p>
    </div>
  );
}

export function Chamber({ result }: { result: RunResult }) {
  const events = result.deliberation.events;
  const [cursor, setCursor] = useState(events.length - 1);
  const [seat, setSeat] = useState<AgentId | null>(null);

  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-6 pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-8">
        <div className="cn-hair p-6">
          <CouncilCore events={events} cursor={cursor} selected={seat} onSelect={setSeat} />
        </div>
        <DecisionCore result={result} />
      </div>

      <div className="cn-hair">
        <div className="flex items-baseline justify-between gap-4 px-4 py-3" style={{ borderBottom: '1px solid rgba(120,140,180,0.18)' }}>
          <Label>live deliberation</Label>
          <div className="flex items-center gap-3">
            {seat !== null && (
              <button type="button" onClick={() => setSeat(null)} className="font-mono text-2xs uppercase tracking-[0.12em] text-fg-mute hover:text-fg">
                clear filter
              </button>
            )}
            <span className="num text-2xs text-fg-mute">{cursor + 1}/{events.length}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid rgba(120,140,180,0.12)' }}>
          <button type="button" onClick={() => setCursor(-1)} className="font-mono text-2xs uppercase tracking-[0.12em] text-fg-mute hover:text-fg">start</button>
          <button type="button" onClick={() => setCursor((c) => Math.max(-1, c - 1))} className="font-mono text-2xs uppercase tracking-[0.12em] text-fg-mute hover:text-fg">back</button>
          <button type="button" onClick={() => setCursor((c) => Math.min(events.length - 1, c + 1))} className="font-mono text-2xs uppercase tracking-[0.12em] text-fg-mute hover:text-fg">next</button>
          <button type="button" onClick={() => setCursor(events.length - 1)} className="ml-auto font-mono text-2xs uppercase tracking-[0.12em] text-fg-mute hover:text-fg">whole transcript</button>
        </div>
        <Deliberation events={events} cursor={cursor} onCursor={setCursor} filter={seat} />
      </div>
    </div>
  );
}
