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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AgentId, DeliberationEvent } from '../core/domain/model';
import type { RunResult } from '../core/orchestrator/run';
import { COUNCIL_ORDER, COUNCIL_SEATS, ringPoint } from './roster';
import type { Pattern } from '../core/integrations/atlas';
import { decisionLineage, evidenceNeeded, sourceConcentration } from '../core/lineage/lineage';
import { AGENT_CODENAME, AGENT_LABEL, AGENT_REMIT, agentOutput } from '../app/lib/agents';
import { createCouncilAudio, type CouncilAudio } from './audio';
import { routeCommand, type CommandResult } from './capability';
import { REPLAY_SPEEDS, advance, frameIntervalMs, rewind, transcriptDigest, type ReplaySpeed } from './replay';
import { EVENT_TONE, OUTCOME_NOTE, OUTCOME_TONE, TONE_COLOR, seatStanding, typeTally, visible } from './derive';
import { Core } from '../visual/Core';
import { RingStation, StackStation, type StationChrome } from '../visual/Station';
import { stations } from '../visual/stations';
import { SYSTEM_STATE_NOTE, systemState } from '../visual/state';
import { ACCENT, STATE_ACCENT } from '../visual/tokens';
import { visualEvents, visualFrame } from '../visual/events';
import { EvidenceMotes } from '../visual/Motes';
import { prefersReducedMotion } from '../visual/motion';
import { citedEvidenceIds, evidenceCard } from '../visual/evidence';
import { EvidenceInspector } from '../visual/EvidenceInspector';


/**
 * The seats' radius in the chamber's 0-100 square. Pulled in from `ringPoint`'s default so the core can
 * be a third of the chamber and the station plates can still sit outside the ring without collision.
 */
const RING_RADIUS = 28;

export function Label({ children }: { children: ReactNode }) {
  return <div className="font-mono text-2xs uppercase tracking-[0.18em] text-fg-mute">{children}</div>;
}

/**
 * ZONE 1 - THE COUNCIL CORE. Seven stations on a ring around the intelligence core, both layouts in the
 * markup and swapped by a media query.
 *
 * This component composes; it derives nothing. Station states come from `visual/station.ts`, the core's
 * state from `visual/state.ts`, and the geometry from `roster.ringPoint` - the same three sources a test
 * can call without mounting anything. The only thing decided here is where a mark goes.
 */
function CouncilCore({ events, cursor, onSelect, selected, participation, log, humanVerdict }: {
  events: DeliberationEvent[];
  cursor: number;
  selected: AgentId | null;
  onSelect: (id: AgentId | null) => void;
  participation: RunResult['participation'];
  log: RunResult['log'];
  humanVerdict: string | null;
}) {
  const standing = useMemo(() => seatStanding(participation), [participation]);
  const seats = useMemo(
    () => stations({ events, cursor, standing, log, order: COUNCIL_ORDER }),
    [events, cursor, standing, log],
  );
  const state = systemState({ running: false, phase: null }, { events, cursor, humanVerdict });

  const current = cursor >= 0 && events.length > 0 ? events[Math.min(cursor, events.length - 1)] : undefined;
  const speaker = current?.from_agent ?? null;
  const addressee = current?.to_agent ?? null;

  const points = useMemo(() => COUNCIL_ORDER.map((_, i) => ringPoint(i, COUNCIL_ORDER.length, RING_RADIUS)), []);
  const from = speaker === null ? null : points[COUNCIL_ORDER.indexOf(speaker)];
  const to = addressee === null ? null : points[COUNCIL_ORDER.indexOf(addressee)];
  // What may be drawn at this reading position, projected from the transcript and nothing else. An empty
  // frame draws an empty chamber; there is no idle animation standing in for one.
  const marks = useMemo(() => visualEvents(events), [events]);
  const frame = visualFrame(marks, current?.sequence ?? -1);
  const alert = frame.some((v) => v.type === 'RED_TEAM_ALERT');
  const cited = frame.find((v) => v.type === 'EVIDENCE_RECEIVED')?.evidence_ids.length ?? 0;
  const beam = current === undefined ? TONE_COLOR.state : alert ? ACCENT.block : TONE_COLOR[EVENT_TONE[current.type]];
  // A held seat re-tints the whole chamber to its own colour: the core, the beam it is on, the lit spokes.
  // The state's accent is what the chamber shows when no seat is held, which is most of the time.
  const accent = selected !== null ? COUNCIL_SEATS[selected].accent : alert ? ACCENT.block : STATE_ACCENT[state];
  const line = current === undefined
    ? null
    : `${current.type}${speaker === null ? '' : ` · ${AGENT_CODENAME[speaker]}`}${addressee === null ? '' : ` → ${AGENT_CODENAME[addressee]}`}`;

  const chrome = (id: AgentId): StationChrome => ({
    accent: COUNCIL_SEATS[id].accent,
    codename: AGENT_CODENAME[id],
    role: AGENT_LABEL[id],
  });

  return (
    <>
      <div className="sm:hidden">
        {seats.map((station) => (
          <StackStation
            key={station.agent}
            station={station}
            chrome={chrome(station.agent)}
            active={station.agent === speaker}
            addressed={station.agent === addressee}
            selected={selected === station.agent}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="rs-chamber hidden sm:block" style={{ ['--rs-accent' as string]: accent }}>
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {/* The living network: every pair of seats, faint, so the illuminated one reads as a choice. */}
          {points.map((a, i) =>
            points.slice(i + 1).map((b, j) => (
              <line
                key={`${i}-${j}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="rgba(120,140,180,0.07)"
                strokeWidth={0.12}
              />
            )),
          )}
          {from !== null && to !== null && (
            <>
              <line className="rs-beam" x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={beam} strokeWidth={0.55} />
              <circle
                className="rs-signal"
                r={0.9}
                fill={beam}
                style={{ offsetPath: `path("M ${from.x} ${from.y} L ${to.x} ${to.y}")` }}
              />
            </>
          )}
        </svg>

        {from !== null && <EvidenceMotes from={from} count={cited} accent={beam} />}

        <Core
          state={state}
          accent={selected !== null ? accent : null}
          lit={seats.map((seat) => seat.spoke > 0)}
          event={line}
          note={false}
          read={Math.max(0, Math.min(cursor + 1, events.length))}
          total={events.length}
          label={events.length === 0 ? 'no transcript' : 'exchanges read'}
        />

        {seats.map((station, i) => (
          <RingStation
            key={station.agent}
            station={station}
            chrome={chrome(station.agent)}
            point={points[i]}
            active={station.agent === speaker}
            addressed={station.agent === addressee}
            selected={selected === station.agent}
            onSelect={onSelect}
          />
        ))}
      </div>

      <p className="mt-4 text-center text-2xs leading-relaxed text-fg-mute">{SYSTEM_STATE_NOTE[state]}</p>
    </>
  );
}

/** ZONE 2 - LIVE DELIBERATION. The transcript, in `sequence` order, nothing inserted. */
function Deliberation({ events, cursor, onCursor, filter, onEvidence }: {
  events: DeliberationEvent[];
  cursor: number;
  onCursor: (n: number) => void;
  filter: AgentId | null;
  onEvidence: (id: string) => void;
}) {
  const shown = visible(events, cursor).filter((e) => filter === null || e.from_agent === filter || e.to_agent === filter);
  const focused = useRef<HTMLButtonElement | null>(null);

  // The transcript follows the cursor, so a replay does not leave the reader scrolling after it. Smooth
  // only when motion is wanted: a reduced-motion reader gets the jump, which is still the right row.
  useEffect(() => {
    focused.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [cursor]);

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
            <div
              key={e.id}
              style={{ ['--cn-tone' as string]: color }}
              className={`cn-event cn-enter ${focus ? 'cn-event-focus' : ''}`}
            >
            <button
              type="button"
              onClick={() => onCursor(e.sequence)}
              ref={focus ? focused : null}
              className="block w-full px-4 pb-2 pt-3 text-left"
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
                {e.claim_ids.length > 0 && <span className="num">{e.claim_ids.length} claim</span>}
                {e.requires_response && <span>awaiting response</span>}
              </div>
            </button>
            {e.evidence_ids.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
                {e.evidence_ids.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onEvidence(id)}
                    className="num border border-line px-1.5 py-0.5 text-2xs text-fg-mute transition-colors hover:border-line-bright hover:text-fg"
                  >
                    {id}
                  </button>
                ))}
              </div>
            )}
            {e.evidence_ids.length === 0 && <div className="pb-1" />}
            </div>
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

/**
 * ZONE 2b - TIMELINE. Every event as one tick, coloured by its type, in `sequence` order. Doubles as the
 * scrubber: a tick is the event, so clicking one cannot land anywhere the transcript does not go.
 */
function Timeline({ events, cursor, onCursor }: { events: DeliberationEvent[]; cursor: number; onCursor: (n: number) => void }) {
  const tally = useMemo(() => typeTally(events), [events]);
  if (events.length === 0) return null;

  return (
    <div className="px-4 py-3">
      <div className="flex items-end gap-px" role="group" aria-label="deliberation timeline">
        {events.map((e) => {
          const color = TONE_COLOR[EVENT_TONE[e.type]];
          const reached = e.sequence <= cursor;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onCursor(e.sequence)}
              title={`${String(e.sequence).padStart(2, '0')} · ${AGENT_CODENAME[e.from_agent]} · ${e.type}`}
              className="min-w-0 flex-1"
              style={{
                height: e.sequence === cursor ? 22 : e.requires_response ? 16 : 11,
                background: color,
                opacity: reached ? 0.9 : 0.22,
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {tally.map((t) => (
          <span key={t.type} className="font-mono text-2xs tracking-[0.1em]" style={{ color: TONE_COLOR[EVENT_TONE[t.type]] }}>
            {t.count} {t.type}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * ZONE 3 - AGENT INSPECTOR. What one seat actually is: its remit, what it structurally cannot do, the
 * position it recorded in the score's own `agent_positions`, and everything it said. Every number is
 * read off the agent's own published output - the inspector computes nothing.
 */
function AgentInspector({ result, seat, events, cursor }: {
  result: RunResult;
  seat: AgentId;
  events: DeliberationEvent[];
  cursor: number;
}) {
  const s = COUNCIL_SEATS[seat];
  const out = agentOutput(result, seat);
  const position = result.outputs.decision.scoring_input.agent_positions.find((p) => p.agent === seat) ?? null;
  const said = visible(events, cursor).filter((e) => e.from_agent === seat);
  const asked = visible(events, cursor).filter((e) => e.to_agent === seat);

  return (
    <div className="cn-hair p-5" style={{ ['--cn-accent' as string]: s.accent }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-lg tracking-[0.18em]" style={{ color: s.accent }}>{AGENT_CODENAME[seat]}</span>
        <span className="font-mono text-2xs uppercase tracking-[0.16em] text-fg-mute">{AGENT_LABEL[seat]}</span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-fg-dim">{AGENT_REMIT[seat]}</p>
      <p className="mt-2 text-xs leading-relaxed text-fg-mute">{s.trait}</p>
      <p className="mt-3 border-l-2 pl-3 text-xs leading-relaxed text-fg-dim" style={{ borderColor: s.accent }}>
        <span className="font-mono text-2xs uppercase tracking-[0.14em] text-fg-mute">cannot</span>
        <br />
        {s.cannot}
      </p>

      <div className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div>
          <Label>recorded position</Label>
          {position === null ? (
            <p className="mt-1.5 text-xs leading-relaxed text-fg-mute">
              This seat casts no position. The decision engine assembles the score; it does not vote in it.
            </p>
          ) : (
            <div className="num mt-1.5 text-sm text-fg">
              {position.reasoning_status.replace(/_/g, ' ')} · {position.confidence.toFixed(2)}
            </div>
          )}
        </div>
        <div>
          <Label>in the chamber</Label>
          <div className="num mt-1.5 text-sm text-fg">{said.length} said · {asked.length} addressed to it</div>
        </div>
        <div>
          <Label>own output</Label>
          <div className="num mt-1.5 text-sm text-fg">
            {out.findings.length} findings · {out.evidence_cited.length} evidence cited
          </div>
        </div>
        <div>
          <Label>self-reported status</Label>
          <div className="num mt-1.5 text-sm text-fg">
            {out.reasoning_status.replace(/_/g, ' ')} · {out.confidence.toFixed(2)}
          </div>
        </div>
      </div>

      {out.degraded_reason !== undefined && out.degraded_reason !== null && (
        <p className="mt-4 text-xs leading-relaxed text-caution">degraded: {out.degraded_reason}</p>
      )}

      {out.uncertainties.length > 0 && (
        <div className="mt-5">
          <Label>what it says it does not know</Label>
          <ul className="mt-2 space-y-1.5">
            {out.uncertainties.map((u) => (
              <li key={u} className="text-xs leading-relaxed text-fg-dim">{u}</li>
            ))}
          </ul>
        </div>
      )}

      {out.recommended_next_step !== null && (
        <div className="mt-5">
          <Label>what it asked for next</Label>
          <p className="mt-2 text-xs leading-relaxed text-fg-dim">{out.recommended_next_step}</p>
        </div>
      )}
    </div>
  );
}

/**
 * ZONE 4b - DECISION LINEAGE. The chain behind the recommendation - decision -> hypothesis ->
 * observation -> evidence - plus the two questions the chain raises: which single source is carrying
 * this run, and what nobody has looked at yet. All three come from `core/lineage/`, which recomputes
 * them from the stored graph rather than storing a second copy that could drift.
 *
 * `patterns` is optional on purpose: the indicator text lives in the pinned taxonomy, not in the run,
 * so the "what would change this" list appears once the shell has loaded it and honestly says so until
 * then. It is never filled in with a guess.
 */
function Lineage({ result, patterns, onEvidence }: { result: RunResult; patterns: Map<string, Pattern> | null; onEvidence: (id: string) => void }) {
  const decision = result.outputs.decision.decision;
  const lineage = useMemo(() => decisionLineage(result.graph, decision), [result.graph, decision]);
  const concentration = useMemo(
    () => sourceConcentration(lineage.hypotheses.flatMap((h) => h.evidence).concat(lineage.decision_evidence)),
    [lineage],
  );
  // Ranked across the whole run, not per finding: the six highest-leverage unassessed indicators are
  // the six that would move the band furthest, whichever hypothesis they happen to hang off. Concatenating
  // per-finding lists would bury a heavy indicator behind a lighter one just because its pattern matched
  // second. Ties break on the indicator id so the list is stable between renders.
  const gaps = useMemo(() => {
    if (patterns === null) return null;
    return result.outputs.analyst.findings
      .flatMap((f) => {
        const pattern = patterns.get(f.coverage.pattern_id);
        return pattern === undefined ? [] : evidenceNeeded(f.coverage, pattern).map((item) => ({ ...item, pattern: pattern.name }));
      })
      .sort((a, b) => b.weight - a.weight || a.indicator_id.localeCompare(b.indicator_id));
  }, [patterns, result.outputs.analyst.findings]);

  return (
    <div className="cn-hair">
      <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(120,140,180,0.18)' }}>
        <Label>decision lineage</Label>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Label>decision &#8592; hypothesis &#8592; observation &#8592; evidence</Label>
          {lineage.hypotheses.length === 0 ? (
            <p className="mt-3 text-xs leading-relaxed text-fg-mute">
              This decision rests on no hypothesis in the graph. Nothing is inferred to fill the gap.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {lineage.hypotheses.map((h) => (
                <div key={h.hypothesis.id} className="border-l-2 border-line-bright pl-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="num text-2xs text-fg-mute">{h.hypothesis.id}</span>
                    <span className="font-mono text-2xs uppercase tracking-[0.12em] text-hypo">{h.hypothesis.status.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-fg-dim">{h.hypothesis.statement}</p>
                  <p className="mt-1.5 text-2xs leading-relaxed text-fg-mute">
                    falsified by: {h.hypothesis.falsification_test}
                  </p>
                  <div className="num mt-2 text-2xs text-fg-mute">
                    {h.observations.length} observations · {h.evidence.length} evidence in the chain
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4">
            <Label>evidence the decision cites directly</Label>
            {lineage.decision_evidence.length === 0 ? (
              <p className="mt-2 text-2xs leading-relaxed text-fg-mute">
                The decision cites no evidence node directly. It rests on the hypotheses above, which is a
                weaker footing than direct citation, and is shown as such rather than summarised away.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lineage.decision_evidence.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => onEvidence(ev.id)}
                    title={ev.title}
                    className="num border border-line px-1.5 py-0.5 text-2xs text-fg-mute transition-colors hover:border-line-bright hover:text-fg"
                  >
                    {ev.id}
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="mt-4 text-2xs leading-relaxed text-fg-mute">
            The evidence count is the full transitive chain behind the hypothesis, not only what the analyst
            cited directly - a hypothesis is linked to every observation the run produced, so this is a
            superset by construction. It is labelled that way rather than reported as direct support.
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <Label>source concentration</Label>
            <div className="num mt-2 text-2xl font-light leading-none">
              {(concentration.top_source_share * 100).toFixed(0)}%
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-fg-mute">
              held by the largest single source, across {concentration.total_evidence} evidence nodes
            </p>
            <ul className="mt-3 space-y-1">
              {concentration.by_source.slice(0, 5).map((e) => (
                <li key={e.source_identity} className="flex items-baseline justify-between gap-3 text-2xs">
                  <span className="min-w-0 truncate text-fg-dim">{e.source_identity}</span>
                  <span className="num shrink-0 text-fg-mute">{e.count}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <Label>what would change this</Label>
            {gaps === null ? (
              <p className="mt-2 text-2xs leading-relaxed text-fg-mute">
                The indicator text lives in the pinned taxonomy, not in this run. Loading it.
              </p>
            ) : gaps.length === 0 ? (
              <p className="mt-2 text-2xs leading-relaxed text-fg-mute">
                Every indicator on the matched patterns has been assessed one way or the other.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {gaps.slice(0, 6).map((g) => (
                  <li key={`${g.pattern}-${g.indicator_id}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="num text-2xs text-fg-mute">{g.indicator_id}</span>
                      <span className="num shrink-0 text-2xs text-caution">w {g.weight}</span>
                    </div>
                    <p className="mt-0.5 text-2xs leading-relaxed text-fg-dim">{g.signal}</p>
                    <p className="text-2xs leading-relaxed text-fg-mute">observable in: {g.observable_in}</p>
                  </li>
                ))}
              </ul>
            )}
            {gaps !== null && gaps.length > 6 && (
              <p className="num mt-2 text-2xs text-fg-mute">{gaps.length - 6} more unassessed indicators</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ZONE 4c - THE EVIDENCE INSPECTOR. An index of every id the chamber actually cited, and the card for
 * whichever one the reader opened.
 *
 * The index is built from the transcript rather than from the graph on purpose: the graph holds evidence
 * no agent ever put on the record, and offering those first would suggest the run rested on them. A
 * reader who wants one of those still reaches it - it appears in the card's own `what it connects to`
 * list, from the node that does rest on it.
 */
function EvidenceZone({ result, selected, onSelect, onCursor }: {
  result: RunResult;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onCursor: (n: number) => void;
}) {
  const events = result.deliberation.events;
  const ids = useMemo(() => citedEvidenceIds(events), [events]);
  const card = useMemo(
    () => (selected === null ? null : evidenceCard(result.graph, selected, events)),
    [result.graph, selected, events],
  );

  return (
    <div className="cn-hair">
      <div className="flex items-baseline justify-between gap-4 px-4 py-3" style={{ borderBottom: '1px solid rgba(120,140,180,0.18)' }}>
        <Label>evidence inspector</Label>
        <div className="flex items-center gap-3">
          {selected !== null && (
            <button type="button" onClick={() => onSelect(null)} className="font-mono text-2xs uppercase tracking-[0.12em] text-fg-mute hover:text-fg">
              close
            </button>
          )}
          <span className="num text-2xs text-fg-mute">{ids.length} cited</span>
        </div>
      </div>

      {ids.length === 0 ? (
        <p className="px-4 py-6 text-sm leading-relaxed text-fg-mute">
          No exchange in this transcript cited an evidence id. The graph may still hold evidence; nothing in
          the chamber pointed at any of it, and that is what is shown.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 px-4 py-3" style={{ borderBottom: '1px solid rgba(120,140,180,0.12)' }}>
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id === selected ? null : id)}
              className={`num border px-1.5 py-0.5 text-2xs transition-colors ${
                id === selected ? 'border-signal text-fg' : 'border-line text-fg-mute hover:border-line-bright hover:text-fg'
              }`}
            >
              {id}
            </button>
          ))}
        </div>
      )}

      <div className="p-4">
        {card === null ? (
          <p className="text-sm leading-relaxed text-fg-mute">
            Open an id to read the source behind it - what it claims, how reliable and how relevant the run
            judged it, who used it, what rests on it, and which fields this node does not record at all.
          </p>
        ) : (
          <EvidenceInspector card={card} codename={(a) => AGENT_CODENAME[a]} onCursor={onCursor} />
        )}
      </div>
    </div>
  );
}

/**
 * ZONE 2a - TRANSPORT. Replay controls over the stored transcript. Playing advances the cursor on a
 * timer and nothing else: the engine is not re-run, the coordinator is not re-run, and the event shown
 * at each tick is the very object the run stored. Speed changes pacing only - it can never skip an
 * exchange. See `replay.ts`, which holds all of the logic as pure functions.
 */
function Transport({ events, cursor, setCursor }: {
  events: DeliberationEvent[];
  cursor: number;
  setCursor: (next: number | ((c: number) => number)) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [sound, setSound] = useState(false);
  const audio = useRef<CouncilAudio | null>(null);
  const atEnd = cursor >= events.length - 1;

  // The context is built on the first switch-on and closed on switch-off, rather than created up front
  // and muted: a page that has never been asked for sound should not be holding an audio device open.
  useEffect(() => {
    if (!sound) {
      audio.current?.dispose();
      audio.current = null;
      return;
    }
    audio.current ??= createCouncilAudio();
    return () => {
      audio.current?.dispose();
      audio.current = null;
    };
  }, [sound]);

  // One tone per exchange actually reached. Nothing sounds for a cursor reset to before the first event.
  useEffect(() => {
    if (!sound || cursor < 0 || cursor >= events.length) return;
    audio.current?.play(events[cursor]);
  }, [sound, cursor, events]);

  useEffect(() => {
    if (!playing || events.length === 0) return;
    if (atEnd) {
      setPlaying(false);
      return;
    }
    const timer = window.setInterval(() => setCursor((c) => advance(events, c)), frameIntervalMs(speed));
    return () => window.clearInterval(timer);
  }, [playing, speed, atEnd, events, setCursor]);

  const btn = 'font-mono text-2xs uppercase tracking-[0.12em] text-fg-mute transition-colors hover:text-fg';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2" style={{ borderBottom: '1px solid rgba(120,140,180,0.12)' }}>
      <button type="button" onClick={() => setCursor(-1)} className={btn}>start</button>
      <button type="button" onClick={() => setCursor((c) => rewind(c))} className={btn}>back</button>
      <button
        type="button"
        onClick={() => (atEnd ? (setCursor(-1), setPlaying(true)) : setPlaying((p) => !p))}
        className="border border-line-bright px-2 py-1 font-mono text-2xs uppercase tracking-[0.12em] text-fg-dim transition-colors hover:text-fg"
        disabled={events.length === 0}
      >
        {playing ? 'pause' : atEnd ? 'replay' : 'play'}
      </button>
      <button type="button" onClick={() => setCursor((c) => advance(events, c))} className={btn}>next</button>
      <div className="flex items-center gap-1">
        {REPLAY_SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSpeed(s)}
            className={`px-1.5 py-0.5 font-mono text-2xs tracking-[0.1em] transition-colors ${s === speed ? 'text-fg' : 'text-fg-mute hover:text-fg-dim'}`}
            aria-pressed={s === speed}
          >
            {s}x
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setSound((v) => !v)}
        aria-pressed={sound}
        title="Sound carries nothing that is not also written on screen."
        className={`ml-auto px-1.5 py-0.5 font-mono text-2xs uppercase tracking-[0.12em] transition-colors ${sound ? 'text-fg' : 'text-fg-mute hover:text-fg-dim'}`}
      >
        sound {sound ? 'on' : 'off'}
      </button>
      <button type="button" onClick={() => (setPlaying(false), setCursor(events.length - 1))} className={btn}>
        whole transcript
      </button>
    </div>
  );
}

/**
 * ZONE 2c - COMMAND BAR. Text in, a real read over this run's stored data out. Anything the router
 * cannot really do returns the literal words `Capability unavailable.` - there is no branch that
 * improvises an answer. See `capability.ts`.
 */
function CommandBar({ result, patterns, onCursor }: {
  result: RunResult;
  patterns: Map<string, Pattern> | null;
  onCursor: (n: number) => void;
}) {
  const [text, setText] = useState('');
  const [history, setHistory] = useState<Array<{ input: string; out: CommandResult }>>([]);
  const log = useRef<HTMLDivElement | null>(null);

  const submit = () => {
    const input = text.trim();
    if (input === '') return;
    const out = routeCommand(input, { result, patterns });
    if (out.kind === 'cursor') onCursor(out.cursor);
    setHistory((h) => [...h, { input, out }]);
    setText('');
  };

  useEffect(() => {
    const node = log.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [history]);

  return (
    <div>
      <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(120,140,180,0.18)' }}>
        <Label>command bar</Label>
      </div>
      {history.length > 0 && (
        <div ref={log} className="cn-scroll max-h-64 overflow-y-auto px-4 py-3">
          {history.map((h, i) => (
            <div key={`${i}-${h.input}`} className="mb-3">
              <div className="font-mono text-2xs tracking-[0.1em] text-fg-mute">&gt; {h.input}</div>
              {h.out.kind === 'unavailable' ? (
                <div className="mt-1 font-mono text-2xs text-caution">{h.out.message}</div>
              ) : (
                h.out.lines.map((line, j) => (
                  <div key={`${j}-${line}`} className="mt-1 whitespace-pre-wrap break-words font-mono text-2xs leading-relaxed text-fg-dim">
                    {line}
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
      <form
        className="flex items-center gap-2 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="font-mono text-2xs text-fg-mute">&gt;</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="try: outcome, band, who ares, find carrier, gaps, help"
          aria-label="council command"
          className="min-w-0 flex-1 bg-transparent font-mono text-2xs text-fg placeholder:text-fg-mute focus:outline-none"
        />
        <button type="submit" className="border border-line-bright px-2 py-1 font-mono text-2xs uppercase tracking-[0.12em] text-fg-dim transition-colors hover:text-fg">
          run
        </button>
      </form>
      <p className="px-4 pb-3 text-2xs leading-relaxed text-fg-mute">
        Every answer is a projection of this run's own stored output. Anything the router cannot really do
        answers <span className="text-caution">Capability unavailable.</span> rather than improvising.
      </p>
    </div>
  );
}

/**
 * What knowledge this session convened over. On screen because the same seven seats reach different
 * conclusions under different packs, and a reader who cannot see which pack was loaded cannot tell a
 * narrow answer from a wrong one.
 */
function PackBanner({ result }: { result: RunResult }) {
  const stood = result.participation.filter((d) => !d.participating);
  return (
    <div className="mb-5">
      <Label>knowledge pack</Label>
      <div className="mt-2 text-sm">{result.pack.label}</div>
      <p className="mt-1 text-2xs leading-relaxed text-fg-mute">{result.pack.summary}</p>
      {stood.length > 0 && (
        <p className="mt-2 text-2xs leading-relaxed text-caution">
          {stood.length} of {result.participation.length} seats stood down under this pack. Their remit is
          printed on the ring, unlit, rather than removed.
        </p>
      )}
    </div>
  );
}

/**
 * THE NETWORK. Who addressed whom, over the whole run: one edge per ordered pair of seats that really
 * exchanged something, its weight the number of exchanges. Edges that have been reached by the cursor are
 * lit; the rest stay faint. The counts are a `reduce` over `events` - there is no layout force, no random
 * jitter and nothing that could place an edge the transcript does not contain.
 */
function NetworkView({ events, cursor, selected, onSelect }: {
  events: DeliberationEvent[];
  cursor: number;
  selected: AgentId | null;
  onSelect: (id: AgentId | null) => void;
}) {
  const points = useMemo(() => COUNCIL_ORDER.map((_, i) => ringPoint(i, COUNCIL_ORDER.length, 36)), []);
  const edges = useMemo(() => {
    const map = new Map<string, { from: AgentId; to: AgentId; total: number; read: number }>();
    for (const e of events) {
      if (e.to_agent === null) continue;
      const key = `${e.from_agent}>${e.to_agent}`;
      const edge = map.get(key) ?? { from: e.from_agent, to: e.to_agent, total: 0, read: 0 };
      edge.total += 1;
      if (e.sequence <= cursor) edge.read += 1;
      map.set(key, edge);
    }
    return [...map.values()].sort((a, b) => a.total - b.total);
  }, [events, cursor]);
  const heaviest = Math.max(1, ...edges.map((e) => e.total));

  return (
    <div className="rs-chamber">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        {edges.map((edge) => {
          const a = points[COUNCIL_ORDER.indexOf(edge.from)];
          const b = points[COUNCIL_ORDER.indexOf(edge.to)];
          const held = selected === null || selected === edge.from || selected === edge.to;
          return (
            <line
              key={`${edge.from}>${edge.to}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={COUNCIL_SEATS[edge.from].accent}
              strokeWidth={0.18 + (edge.total / heaviest) * 1.1}
              opacity={(edge.read === 0 ? 0.14 : 0.34 + (edge.read / edge.total) * 0.4) * (held ? 1 : 0.25)}
            />
          );
        })}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.1} fill="#05070a" stroke={COUNCIL_SEATS[COUNCIL_ORDER[i]].accent} strokeWidth={0.5} />
        ))}
      </svg>
      {points.map((p, i) => {
        const id = COUNCIL_ORDER[i];
        const out = edges.filter((e) => e.from === id).reduce((n, e) => n + e.total, 0);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(selected === id ? null : id)}
            aria-pressed={selected === id}
            style={{ left: `${p.x}%`, top: `${p.y}%`, ['--rs-accent' as string]: COUNCIL_SEATS[id].accent }}
            className={`rs-station rs-card rs-card-${p.x > 56 ? 'right' : p.x < 44 ? 'left' : p.y < 50 ? 'top' : 'bottom'} ${selected === id ? 'rs-station-active' : 'rs-station-spoken'}`}
          >
            <span className="rs-card-hub" aria-hidden="true"><span className="rs-node" /></span>
            <span className="rs-card-body">
              <span className="rs-card-name" style={{ color: COUNCIL_SEATS[id].accent }}>{AGENT_CODENAME[id]}</span>
              <span className="num rs-card-count">{out} sent · {edges.filter((e) => e.to === id).reduce((n, e) => n + e.total, 0)} received</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

const MODES = ['COUNCIL', 'NETWORK', 'EVIDENCE', 'TIMELINE', 'DECISION'] as const;
type Mode = (typeof MODES)[number];

/** What each view is, in the fewest words that are still true. Printed under the switch. */
const MODE_NOTE: Record<Mode, string> = {
  COUNCIL: 'The radial chamber: seven seats around the core, lit by the exchange on the cursor.',
  NETWORK: 'Who addressed whom across the whole run. Edge weight is the number of exchanges.',
  EVIDENCE: 'Every evidence item this run cited, and which seat cited it.',
  TIMELINE: 'The whole chronology, one tick per stored event, in sequence order.',
  DECISION: 'What the recommendation was built from, back to the evidence.',
};

export function Chamber({ result, patterns = null, humanVerdict = null }: { result: RunResult; patterns?: Map<string, Pattern> | null; humanVerdict?: string | null }) {
  const events = result.deliberation.events;
  const [cursor, setCursor] = useState(events.length - 1);
  const [seat, setSeat] = useState<AgentId | null>(null);
  const [evidence, setEvidence] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('COUNCIL');

  return (
    <div className="px-4 pb-14 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="rs-tabs" role="tablist" aria-label="council view">
          {MODES.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={m === mode} className="rs-tab" onClick={() => setMode(m)}>
              {m}
            </button>
          ))}
        </div>
        <p className="text-2xs text-fg-mute">{MODE_NOTE[mode]}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <section className="cn-hair flex min-h-[36rem] flex-col justify-center p-4">
          {mode === 'COUNCIL' && (
            <CouncilCore
              events={events}
              cursor={cursor}
              selected={seat}
              onSelect={setSeat}
              participation={result.participation}
              log={result.log}
              humanVerdict={humanVerdict}
            />
          )}
          {mode === 'NETWORK' && <NetworkView events={events} cursor={cursor} selected={seat} onSelect={setSeat} />}
          {mode === 'EVIDENCE' && (
            <EvidenceZone result={result} selected={evidence} onSelect={setEvidence} onCursor={setCursor} />
          )}
          {mode === 'TIMELINE' && (
            <div className="w-full">
              <Timeline events={events} cursor={cursor} onCursor={setCursor} />
              <Deliberation events={events} cursor={cursor} onCursor={setCursor} filter={seat} onEvidence={setEvidence} />
            </div>
          )}
          {mode === 'DECISION' && (
            <div className="w-full space-y-4">
              <DecisionCore result={result} />
              <Lineage result={result} patterns={patterns} onEvidence={setEvidence} />
            </div>
          )}
        </section>

        <aside className="cn-hair flex max-h-[calc(100vh-9rem)] flex-col self-start overflow-hidden">
          <div className="flex items-baseline justify-between gap-4 px-4 py-3" style={{ borderBottom: '1px solid rgba(120,140,180,0.18)' }}>
            <Label>live deliberation</Label>
            <div className="flex items-center gap-3">
              {seat !== null && (
                <button type="button" onClick={() => setSeat(null)} className="font-mono text-2xs uppercase tracking-[0.12em] text-fg-mute hover:text-fg">
                  clear filter
                </button>
              )}
              <span className="num text-2xs text-fg-mute" title={transcriptDigest(events)}>{Math.max(0, cursor + 1)}/{events.length}</span>
            </div>
          </div>
          <Transport events={events} cursor={cursor} setCursor={setCursor} />
          <div style={{ borderBottom: '1px solid rgba(120,140,180,0.12)' }}>
            <Timeline events={events} cursor={cursor} onCursor={setCursor} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Deliberation events={events} cursor={cursor} onCursor={setCursor} filter={seat} onEvidence={setEvidence} />
          </div>
        </aside>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <DecisionCore result={result} />
        {seat === null ? (
          <div className="cn-hair p-5">
            <Label>agent inspector</Label>
            <p className="mt-3 text-sm leading-relaxed text-fg-mute">
              Select a seat on the ring to read its remit, the position it recorded in the score, and what it
              said. Seven seats, and the interesting half of each one is what it cannot do.
            </p>
            <div className="mt-5">
              <PackBanner result={result} />
            </div>
          </div>
        ) : (
          <AgentInspector result={result} seat={seat} events={events} cursor={cursor} />
        )}
      </div>

      <div className="mt-4 space-y-4">
        {mode !== 'EVIDENCE' && <EvidenceZone result={result} selected={evidence} onSelect={setEvidence} onCursor={setCursor} />}
        {mode !== 'DECISION' && <Lineage result={result} patterns={patterns} onEvidence={setEvidence} />}
        <div className="cn-hair">
          <CommandBar result={result} patterns={patterns} onCursor={setCursor} />
        </div>
      </div>
    </div>
  );
}
