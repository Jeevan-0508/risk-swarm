import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Field, Panel, Row, Tag, inputClass } from '@app/ui/kit';
import { routeQuestion } from '@core/question/model';
import { planResearch } from '@core/research/plan';
import type { ResearchEvent } from '@core/research/execute';
import { PROVIDERS } from '@core/research/providers/types';
import { READER_PROXY_HOST, runResearch, type ResearchOutcome } from '@app/lib/research';
import { deliberateOpenResearch, type OpenAnswer } from '@core/research/open-deliberation';

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
  const [proxyEnabled, setProxyEnabled] = useState(true);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [outcome, setOutcome] = useState<ResearchOutcome | null>(null);
  const [answer, setAnswer] = useState<OpenAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

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
    try {
      const result = await runResearch({ question: text, proxyEnabled }, (event) => setEvents((all) => [...all, event]));
      setOutcome(result);
      setAnswer(deliberateOpenResearch(text, result));
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
          <label className="flex items-start gap-2 text-2xs text-fg-mute">
            <input type="checkbox" checked={proxyEnabled} onChange={(e) => setProxyEnabled(e.target.checked)} className="mt-0.5" />
            allow the reader proxy for providers that cannot be reached directly
          </label>
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
              ['ARES', 'CHALLENGER', 'attacking'],
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
          <Panel title="SWARM DECISION" aside={<Tag tone={toneFor(outcome.execution.status)}>{outcome.execution.status}</Tag>}>
            <div className="text-2xl font-light tracking-tight text-fg">{answer.headline}</div>
            <p className="mt-4 max-w-4xl text-base leading-relaxed text-fg-dim">{answer.answer}</p>
            <p className="mt-4 border-l-2 border-signal pl-3 text-xs leading-relaxed text-fg-mute">{answer.caveat}</p>
          </Panel>

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
            <ul>{outcome.merged.items.map((item) => <li key={item.evidence.id} className="hair-b px-4 py-3 last:border-b-0"><div className="flex flex-wrap items-baseline gap-3"><Tag tone="signal">{item.provenance.provider}</Tag><span className="text-sm text-fg-dim">{item.evidence.title}</span><span className="num text-2xs text-fg-mute">{item.provenance.source_identity}</span></div><p className="mt-1 text-2xs leading-relaxed text-fg-mute">{item.evidence.excerpt}</p>{item.provenance.url && <a className="mt-1 block text-2xs text-signal underline" href={item.provenance.url} target="_blank" rel="noreferrer">source</a>}</li>)}</ul>
          </Panel>
        </>
      )}

      <p className="text-2xs leading-relaxed text-fg-mute">
        Open research currently uses the shipped keyless public providers (including Wikipedia/Wikidata and
        academic/structured sources). A direct Google Search API is not available without Google's credentials,
        so the system does not pretend that it is calling Google. Providers that need the reader proxy use
        <span className="num"> {READER_PROXY_HOST}</span> and are marked in provenance.
      </p>
    </div>
  );
}
