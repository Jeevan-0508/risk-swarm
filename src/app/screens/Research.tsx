import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Field, Panel, Row, Tag, inputClass } from '@app/ui/kit';
import { routeQuestion } from '@core/question/model';
import { planResearch } from '@core/research/plan';
import type { ResearchEvent } from '@core/research/execute';
import { READER_PROXY_HOST, runResearch, type ResearchOutcome } from '@app/lib/research';
import { deliberateOpenResearch, type OpenAnswer } from '@core/research/open-deliberation';
import { runCouncil } from '@core/council/run';
import { selectEvidenceForCouncil } from '@core/council/evidence-selection';
import { NO_INDEPENDENT_POSITIONS_MESSAGE } from '@core/council/deliberate';
import type { CouncilResult, CouncilTraceEvent } from '@core/council/types';
import { useModelStore } from '@app/store/models';
import { swarmDecisionPanelTitle } from '@app/lib/research-ownership';
import { Link } from 'react-router-dom';

const toneFor = (status: ResearchOutcome['execution']['status']): 'support' | 'caution' | 'objection' =>
  status === 'ok' ? 'support' : status === 'search_failed' ? 'objection' : 'caution';

function EventLine({ event }: { event: ResearchEvent }) {
  const text =
    event.kind === 'plan_started' ? `research started · ${event.queries} calls · ${event.providers.length} providers`
    : event.kind === 'query_issued' ? `${event.provider} ← "${event.query}"`
    : event.kind === 'provider_answered' ? `${event.provider} returned ${event.returned} document(s)`
    : event.kind === 'provider_empty' ? `${event.provider} empty · ${event.reason}`
    : event.kind === 'provider_failed' ? `${event.provider} ${event.status} · ${event.reason}`
    : event.kind === 'document_retained' ? `evidence retained · ${event.title} · ${event.source_identity}`
    : event.kind === 'duplicate_dropped' ? `duplicate removed · ${event.dropped}`
    : event.kind === 'limit_reached' ? event.limit
    : `research finished · ${event.retained} retained · ${event.ms}ms`;
  return <div className="num text-2xs leading-relaxed text-fg-mute">{text}</div>;
}

export function Research() {
  const [params] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [question, setQuestion] = useState(initial);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [outcome, setOutcome] = useState<ResearchOutcome | null>(null);
  const [answer, setAnswer] = useState<OpenAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [councilMode, setCouncilMode] = useState(false);
  const [council, setCouncil] = useState<CouncilResult | null>(null);
  const [councilTrace, setCouncilTrace] = useState<CouncilTraceEvent[]>([]);
  const autoStarted = useRef(false);

  const assignments = useModelStore((s) => s.assignments);
  const keys = useModelStore((s) => s.keys);
  const getApiKey = useModelStore((s) => s.getApiKey);
  const diversityFn = useModelStore((s) => s.diversity);
  /*
   * Same fix as ModelConfig.tsx: `diversity()` allocates a fresh object every call, so selecting
   * `(s) => s.diversity()` directly breaks `useSyncExternalStore`'s snapshot-consistency check and
   * throws "Maximum update depth exceeded" (React error #185) the moment this screen mounts - with no
   * error boundary in the tree, that blanks the whole app, not just this screen. This is what made
   * New Investigation -> Research go blank on its own, before Council Mode or any provider call ran.
   */
  const diversity = useMemo(() => diversityFn(), [assignments, keys, diversityFn]);
  const councilAvailable = diversity.active_agents > 0;

  const text = question.trim();
  const routed = useMemo(() => text.length > 12 ? routeQuestion(text) : null, [text]);
  const preview = useMemo(() => routed === null ? null : planResearch(routed, { proxyEnabled }), [routed, proxyEnabled]);

  const run = async () => {
    if (text.length <= 12 || running) return;
    setRunning(true);
    setError(null);
    setEvents([]);
    setOutcome(null);
    setAnswer(null);
    setCouncil(null);
    setCouncilTrace([]);
    try {
      const result = await runResearch({ question: text, proxyEnabled }, (event) => setEvents((all) => [...all, event]));
      setOutcome(result);
      setAnswer(deliberateOpenResearch(text, result));
      if (councilMode && councilAvailable && result.merged.items.length > 0) {
        const councilResult = await runCouncil(text, selectEvidenceForCouncil(result.merged.items), assignments, { getApiKey }, (event) => setCouncilTrace((all) => [...all, event]));
        setCouncil(councilResult);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (initial.trim().length > 12 && !autoStarted.current) {
      autoStarted.current = true;
      void run();
    }
    // The URL is the explicit hand-off from New Investigation; it should run exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div className="kicker">OPEN INVESTIGATION · LIVE RESEARCH</div>
        <h1 className="mt-2 text-3xl font-light tracking-tight">Ask the Swarm</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-dim">
          One question enters a real research pass. HERMES retrieves public evidence, ATHENA organizes it,
          APOLLO analyzes it, ARES challenges it and HEPHAESTUS delivers the answer. No freight taxonomy is
          required for an open-domain question.
        </p>
      </div>

      <Panel title="question">
        <Field label="ask anything" hint="The exact question is preserved and used as the research seed.">
          <textarea value={question} rows={3} onChange={(e) => setQuestion(e.target.value)} className={`${inputClass} resize-none text-base leading-snug`} placeholder="Which is better, tiger or lion?" />
        </Field>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 hair-t pt-3">
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-2xs text-fg-mute">
              <input type="checkbox" checked={proxyEnabled} onChange={(e) => setProxyEnabled(e.target.checked)} className="mt-0.5" />
              allow the reader proxy for providers that cannot be reached directly
            </label>
            <label className="flex items-start gap-2 text-2xs text-fg-mute">
              <input type="checkbox" checked={councilMode} disabled={!councilAvailable} onChange={(e) => setCouncilMode(e.target.checked)} className="mt-0.5" />
              {councilAvailable
                ? <span>Council Mode — real independent LLM reasoning ({diversity.active_agents} agent(s), {diversity.label} model diversity)</span>
                : <span>Council Mode unavailable — <Link to="/models" className="text-signal underline">configure a provider and key</Link> to enable real LLM reasoning</span>}
            </label>
          </div>
          <Button onClick={() => void run()} disabled={text.length <= 12 || running}>{running ? 'swarm researching…' : 'run the swarm'}</Button>
        </div>
      </Panel>

      {preview !== null && (
        <Panel title="research plan" aside={<span className="num text-2xs text-fg-mute">{preview.external.call_count} calls · {preview.external.providers.length} providers</span>}>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Row k="intent" v={<span className="num text-xs">{routed?.intent.replace(/_/g, ' ')}</span>} />
            <Row k="domain" v={<span className="num text-xs">{routed?.domain}</span>} />
            <Row k="freshness" v={<span className="num text-xs">{routed?.freshness}</span>} />
            <Row k="internal knowledge" v={<span className="num text-xs">{preview.internal.search ? 'searched' : 'not required'}</span>} />
            <Row k="external evidence" v={<span className="num text-xs">{preview.external.required ? 'required' : 'not required'}</span>} />
            <Row k="providers" v={<span className="num text-xs">{preview.external.providers.join(', ')}</span>} />
          </div>
          <div className="mt-4 space-y-2 hair-t pt-3">
            {preview.dimensions.map((d) => (
              <div key={d.key} className="border-l-2 border-line-bright pl-3">
                <div className="text-xs text-fg-dim">{d.label}</div>
                {d.queries.map((q) => <div key={q} className="num mt-1 text-2xs text-fg-mute">“{q}”</div>)}
              </div>
            ))}
          </div>
        </Panel>
      )}

      {running && (
        <Panel title="the swarm is working" aside={<Tag tone="signal">LIVE</Tag>}>
          <div className="grid gap-2 sm:grid-cols-5">
            {[
              ['HERMES', 'SCOUT', 'retrieving'],
              ['ATHENA', 'INTELLIGENCE', 'organizing'],
              ['APOLLO', 'ANALYST', 'reasoning'],
              ['ARES', 'CHALLENGER + RED TEAM', 'challenging'],
              ['HEPHAESTUS', 'DECISION', 'assembling'],
            ].map(([name, role, state]) => <div key={name} className="border border-line p-3"><div className="text-xs text-fg">{name}</div><div className="mt-1 label">{role}</div><div className="mt-3 num text-2xs text-signal">{state}</div></div>)}
          </div>
        </Panel>
      )}

      {events.length > 0 && (
        <Panel title="live research trace" aside={<span className="num text-2xs text-fg-mute">{events.length} events</span>}>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">{events.map((e, i) => <EventLine key={i} event={e} />)}</div>
        </Panel>
      )}

      {error !== null && <Panel title="research failed"><p className="text-sm leading-relaxed text-objection">{error}</p></Panel>}

      {answer !== null && outcome !== null && (
        <>
          <Panel title={swarmDecisionPanelTitle(council)} aside={<Tag tone={toneFor(outcome.execution.status)}>{outcome.execution.status}</Tag>}>
            <div className="text-2xl font-light tracking-tight text-fg">{answer.headline}</div>
            <p className="mt-4 max-w-4xl text-base leading-relaxed text-fg-dim">{answer.answer}</p>
            <p className="mt-4 border-l-2 border-signal pl-3 text-xs leading-relaxed text-fg-mute">{answer.caveat}</p>
          </Panel>

          {council !== null && (
            <>
              <p className="text-2xs leading-relaxed text-fg-mute">
                The Council below is a separate system from the research pass above, despite sharing two
                names: HERMES/ATHENA/APOLLO/ARES/HEPHAESTUS (above) are this app's original deterministic
                open-research agents — no model required, byte-for-byte reproducible. ATHENA/ARES/HADES/ZEUS
                (below) are EVOLUTION 6.0's Olympian Council — real, independent, bring-your-own-key model
                calls over the same evidence, synthesized by Zeus. The name overlap (ATHENA, ARES) is
                coincidental, not the same agent twice. With Council Mode on, the Council's verdict below is
                the authoritative final decision; the panel above is the legacy pipeline's own analysis of
                the same evidence, kept for context and provenance, not a competing answer.
              </p>
              <Panel title="OLYMPIAN COUNCIL VERDICT" aside={<Tag tone={council.verdict.verdict.verdict_type === 'CONSENSUS' ? 'support' : council.verdict.verdict.verdict_type === 'UNRESOLVED' ? 'objection' : 'signal'}>{council.verdict.verdict.verdict_type}</Tag>}>
                <div className="flex items-baseline justify-between gap-4">
                  <div className="text-2xl font-light tracking-tight text-fg">{council.verdict.verdict.answer}</div>
                  <div className="num text-sm text-fg-mute">{Math.round(council.verdict.verdict.confidence * 100)}% confidence</div>
                </div>
                <ul className="mt-3 space-y-1">{council.verdict.verdict.rationale.map((r, i) => <li key={i} className="text-xs leading-relaxed text-fg-dim">— {r}</li>)}</ul>
                {council.verdict.verdict.minority_view !== null && (
                  <p className="mt-4 border-l-2 border-signal pl-3 text-xs leading-relaxed text-fg-mute"><span className="label">minority view</span><br />{council.verdict.verdict.minority_view}</p>
                )}
                {council.verdict.verdict.unresolved.length > 0 && (
                  <p className="mt-3 border-l-2 border-objection pl-3 text-xs leading-relaxed text-fg-mute"><span className="label">unresolved</span><br />{council.verdict.verdict.unresolved.join(' ')}</p>
                )}
                <p className="mt-4 text-2xs text-fg-mute">
                  {council.verdict.provider === 'deterministic'
                    ? 'ZEUS / DETERMINISTIC FALLBACK — LLM synthesis unavailable — deterministic fallback used.'
                    : `Zeus · ${council.verdict.provider}${council.verdict.degraded ? ` · degraded: ${council.verdict.degraded_reason}` : ''}`}
                </p>
              </Panel>

              <Panel title="independent positions" aside={<Tag tone="signal">model diversity: {council.model_diversity.label}</Tag>}>
                <div className="grid gap-3 md:grid-cols-3">
                  {(['ATHENA', 'ARES', 'HADES'] as const).map((agent) => {
                    const p = council.positions[agent];
                    return (
                      <div key={agent} className="border border-line bg-ink-800 p-4">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm text-fg">{agent}</span>
                          <Tag tone={p.degraded ? 'caution' : p.provider === 'deterministic' ? 'neutral' : 'support'}>{p.degraded ? 'degraded' : p.provider === 'deterministic' ? 'DETERMINISTIC FALLBACK' : 'INDEPENDENT · LLM'}</Tag>
                        </div>
                        <div className="mt-1 label">{p.provider}</div>
                        <div className="mt-3 text-lg text-fg">{p.position.stance}</div>
                        <div className="num mt-1 text-2xs text-fg-mute">{Math.round(p.position.confidence * 100)}% confidence</div>
                        <p className="mt-2 text-2xs leading-relaxed text-fg-dim">{p.position.reasoning_summary}</p>
                        {p.degraded && <p className="mt-2 text-2xs text-objection">degraded: {p.degraded_reason}</p>}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-4 text-2xs leading-relaxed text-fg-mute">
                  {council.disagreement.independent_count === 0
                    ? NO_INDEPENDENT_POSITIONS_MESSAGE
                    : <>disagreement: {council.disagreement.agreement} across {council.disagreement.independent_count} independent position(s)
                  {council.disagreement.distinct_stances.length > 0 && ` — ${council.disagreement.distinct_stances.join(', ')}`}</>}
                </p>
              </Panel>

              {councilTrace.length > 0 && (
                <Panel title="council trace" aside={<span className="num text-2xs text-fg-mute">{councilTrace.length} events</span>}>
                  <div className="max-h-56 space-y-0.5 overflow-y-auto">
                    {councilTrace.map((e, i) => <div key={i} className="num text-2xs leading-relaxed text-fg-mute">{e.at.slice(11, 19)} · {e.kind}{e.agent ? ` · ${e.agent}` : ''} · {e.detail}</div>)}
                  </div>
                </Panel>
              )}
            </>
          )}

          <Panel title="agent deliberation" aside={<span className="num text-2xs text-fg-mute">{answer.agents.length} active agents</span>}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              {answer.agents.map((agent) => (
                <div key={agent.id} className="border border-line bg-ink-800 p-4">
                  <div className="flex items-baseline justify-between gap-2"><span className="text-sm text-fg">{agent.codename}</span><Tag tone={agent.status === 'complete' ? 'support' : 'objection'}>{agent.status}</Tag></div>
                  <div className="mt-1 label">{agent.role}</div>
                  <ul className="mt-3 space-y-2">{agent.findings.map((finding, i) => <li key={i} className="text-2xs leading-relaxed text-fg-dim">{finding}</li>)}</ul>
                </div>
              ))}
            </div>
          </Panel>

          {answer.dimensions.length > 0 && (
            <Panel title="comparison / answer dimensions">
              <div className="grid gap-3 md:grid-cols-2">{answer.dimensions.map((d) => <div key={d.label} className="border-l-2 border-line-bright pl-4"><div className="label">{d.label}</div><div className="mt-1 text-lg text-fg">{d.winner}</div><p className="mt-1 text-xs leading-relaxed text-fg-dim">{d.reason}</p></div>)}</div>
            </Panel>
          )}

          <Panel title="evidence actually used" aside={<span className="num text-2xs text-fg-mute">{answer.evidence_count} retained · {answer.source_count} source identities</span>} flush>
            <ul>{outcome.merged.items.map((item) => <li key={item.evidence.id} className="hair-b px-4 py-3 last:border-b-0"><div className="flex flex-wrap items-baseline gap-3"><Tag tone="signal">{item.provenance.provider}</Tag><span className="text-sm text-fg-dim">{item.evidence.title}</span><span className="num text-2xs text-fg-mute">{item.provenance.source_identity}</span></div><p className="mt-1 text-2xs leading-relaxed text-fg-mute">{item.evidence.excerpt_or_summary}</p>{item.evidence.url && <a className="mt-1 block text-2xs text-signal underline" href={item.evidence.url} target="_blank" rel="noreferrer">source</a>}</li>)}</ul>
          </Panel>
        </>
      )}

      <p className="text-2xs leading-relaxed text-fg-mute">
        Open research currently uses the shipped keyless public providers. A direct Google Search API is not
        available without Google's credentials, so the system does not pretend that it is calling Google.
        Providers that need the reader proxy use <span className="num">{READER_PROXY_HOST}</span> and are marked in provenance.
      </p>
    </div>
  );
}
