/**
 * SCREEN 13 - RESEARCH. The only screen in this app that reaches the public internet.
 *
 * EVOLUTION 5.0 Phase H. It shows the plan before it runs it, the attempts while they run, and every
 * outcome afterwards including the ones that failed. The design rule: a reader must be able to tell the
 * difference between "the world is quiet", "the provider had nothing", "the provider broke" and "a browser
 * cannot reach this provider at all" - four facts a single empty result set would flatten into one lie.
 *
 * Nothing here re-ranks, re-scores or summarises. Every number is a counter the executor incremented and
 * every reason string is the provider's own.
 */
import { useMemo, useState } from 'react';
import { Button, Empty, Field, Panel, Row, Tag, inputClass } from '@app/ui/kit';
import { routeQuestion } from '@core/question/model';
import { planResearch } from '@core/research/plan';
import type { ResearchEvent } from '@core/research/execute';
import type { Attempt } from '@core/research/execute';
import { PROVIDERS } from '@core/research/providers/types';
import { READER_PROXY_HOST, runResearch, type ResearchOutcome } from '@app/lib/research';

const ATTEMPT_TONE: Record<Attempt['status'], 'support' | 'caution' | 'objection' | 'neutral'> = {
  ok: 'support',
  empty: 'neutral',
  search_failed: 'objection',
  unavailable: 'caution',
  skipped_budget: 'neutral',
};

const STATUS_NOTE: Record<ResearchOutcome['execution']['status'], string> = {
  ok: 'Every attempt answered. Coverage is as planned.',
  partial: 'Some providers failed or were unreachable. Coverage is incomplete, and the attempts below say where.',
  search_failed: 'No provider answered. This result says nothing about the world; it says retrieval did not happen.',
  limit_reached: 'A budget stopped the plan early. A short result set here is a budget, not a quiet world.',
};

function EventLine({ event }: { event: ResearchEvent }) {
  const text =
    event.kind === 'plan_started' ? `plan started - ${event.queries} call(s) across ${event.providers.length} provider(s)`
    : event.kind === 'query_issued' ? `${event.provider} \u2190 "${event.query}"`
    : event.kind === 'provider_answered' ? `${event.provider} answered with ${event.returned}`
    : event.kind === 'provider_empty' ? `${event.provider} empty - ${event.reason}`
    : event.kind === 'provider_failed' ? `${event.provider} ${event.status} - ${event.reason}`
    : event.kind === 'document_retained' ? `retained: ${event.title} (${event.source_identity})`
    : event.kind === 'duplicate_dropped' ? `duplicate dropped: ${event.dropped} (${event.reason})`
    : event.kind === 'limit_reached' ? event.limit
    : `plan finished - ${event.retained} retained in ${event.ms}ms`;
  const tone =
    event.kind === 'provider_failed' ? 'text-objection'
    : event.kind === 'limit_reached' ? 'text-caution'
    : event.kind === 'provider_answered' || event.kind === 'plan_finished' ? 'text-support'
    : 'text-fg-mute';
  return <div className={`num text-2xs leading-relaxed ${tone}`}>{text}</div>;
}

export function Research() {
  const [question, setQuestion] = useState('How does a quantum error-correcting code actually work?');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<ResearchEvent[]>([]);
  const [outcome, setOutcome] = useState<ResearchOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const text = question.trim();
  const preview = useMemo(
    () => (text.length <= 12 ? null : planResearch(routeQuestion(text), { proxyEnabled })),
    [text, proxyEnabled],
  );

  const run = async () => {
    setRunning(true);
    setError(null);
    setEvents([]);
    setOutcome(null);
    try {
      const result = await runResearch({ question: text, proxyEnabled }, (e) => setEvents((all) => [...all, e]));
      setOutcome(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const proxyOnly = PROVIDERS.filter((p) => p.requires_proxy);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Research</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
          Live retrieval from eight keyless public providers. This is the only screen that reaches the
          internet, and it is a separate act from an investigation on purpose: a run whose inputs came off
          the live web cannot be byte-for-byte reproducible, and the engine's reproducibility is not
          negotiable.
        </p>
      </div>

      <Panel title="the question">
        <Field label="question" hint="Routed by the same rules the engine uses. The plan below is the real plan, not a preview of one.">
          <textarea value={question} rows={2} onChange={(e) => setQuestion(e.target.value)} className={`${inputClass} resize-none text-base leading-snug`} />
        </Field>
        <div className="mt-4 hair-t pt-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={proxyEnabled} onChange={(e) => setProxyEnabled(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="label">enable the reader proxy</span>
              <span className="mt-1 block text-xs leading-relaxed text-fg-mute">
                {proxyOnly.length} of {PROVIDERS.length} providers cannot be reached from a browser at all,
                because they send no CORS header. A proxy fixes that by putting a third party
                (<span className="num">{READER_PROXY_HOST}</span>) between this system and the source, which
                can in principle alter what is read. Off by default. Every document that comes through it is
                flagged <span className="num">via_proxy</span> on its own provenance, permanently.
              </span>
            </span>
          </label>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4 hair-t pt-3">
          <p className="text-2xs leading-relaxed text-fg-mute">
            Nothing is written anywhere. Requests are GETs to public endpoints, no key, no account.
          </p>
          <Button onClick={() => void run()} disabled={text.length <= 12 || running}>
            {running ? 'retrieving' : 'run research'}
          </Button>
        </div>
      </Panel>

      {preview !== null && (
        <Panel title="the plan" aside={<span className="num text-2xs text-fg-mute">{preview.external.call_count} calls · {preview.budget.max_ms}ms ceiling</span>}>
          {!preview.external.required ? (
            <p className="text-xs leading-relaxed text-fg-dim">
              This question was not read as needing external retrieval. Nothing will be fetched.
            </p>
          ) : !preview.external.reachable ? (
            <p className="text-xs leading-relaxed text-caution">
              Every provider this plan needs is proxy-only, and the proxy is off. Nothing will be fetched,
              and nothing will be substituted for it.
            </p>
          ) : null}
          <div className="mt-3 space-y-3">
            {preview.dimensions.map((d) => (
              <div key={d.key} className="border-l-2 border-line-bright pl-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm text-fg-dim">{d.label}</span>
                  <span className="num text-2xs text-fg-mute">{d.providers.join(', ')}</span>
                </div>
                <p className="mt-1 text-2xs leading-relaxed text-fg-mute">{d.rationale}</p>
                <ul className="mt-1.5 space-y-0.5">
                  {d.queries.map((q) => (
                    <li key={q} className="num text-2xs text-fg-mute">&ldquo;{q}&rdquo;</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-4 hair-t pt-3">
            <Row k="internal search" v={<span className="text-xs">{preview.internal.search ? 'yes' : 'no'}</span>} />
            <p className="mt-1 text-2xs leading-relaxed text-fg-mute">{preview.internal.rationale}</p>
          </div>
          {preview.notes.length > 0 && (
            <ul className="mt-3 space-y-1 hair-t pt-3">
              {preview.notes.map((n) => (
                <li key={n} className="text-2xs leading-relaxed text-fg-mute">{n}</li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {events.length > 0 && (
        <Panel title="retrieval log" aside={<span className="num text-2xs text-fg-mute">{events.length} events</span>}>
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {events.map((e, i) => (
              <EventLine key={i} event={e} />
            ))}
          </div>
        </Panel>
      )}

      {error !== null && (
        <Panel title="the call itself failed">
          <p className="text-xs leading-relaxed text-objection">{error}</p>
          <p className="mt-2 text-2xs leading-relaxed text-fg-mute">
            This is the caller failing, not a provider reporting a failure. No partial result is shown,
            because there is no honest partial result to show.
          </p>
        </Panel>
      )}

      {outcome !== null && (
        <>
          <Panel title="what retrieval actually did" aside={<Tag tone={outcome.execution.status === 'ok' ? 'support' : outcome.execution.status === 'search_failed' ? 'objection' : 'caution'}>{outcome.execution.status}</Tag>}>
            <p className="text-xs leading-relaxed text-fg-dim">{STATUS_NOTE[outcome.execution.status]}</p>
            <div className="mt-4 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(outcome.execution.counters).map(([k, v]) => (
                <Row key={k} k={k.replace(/_/g, ' ')} v={<span className="num text-sm">{v}</span>} />
              ))}
            </div>
            {outcome.execution.limit_reached !== null && (
              <p className="mt-3 text-xs leading-relaxed text-caution">{outcome.execution.limit_reached}</p>
            )}
            {outcome.execution.notes.length > 0 && (
              <ul className="mt-3 space-y-1 hair-t pt-3">
                {outcome.execution.notes.map((n) => (
                  <li key={n} className="text-2xs leading-relaxed text-fg-mute">{n}</li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="every attempt, including the ones that failed" flush>
            <ul>
              {outcome.execution.attempts.map((a, i) => (
                <li key={`${a.provider}-${a.query}-${i}`} className="hair-b px-4 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Tag tone={ATTEMPT_TONE[a.status]}>{a.status}</Tag>
                    <span className="num text-2xs text-fg-dim">{a.provider}</span>
                    <span className="num text-2xs text-fg-mute">&ldquo;{a.query}&rdquo;</span>
                    <span className="num ml-auto text-2xs text-fg-mute">{a.returned} returned · {a.retained} retained · {a.ms}ms</span>
                  </div>
                  {a.reason !== null && <p className="mt-1 text-2xs leading-relaxed text-fg-mute">{a.reason}</p>}
                </li>
              ))}
            </ul>
          </Panel>

          {outcome.execution.source_concentration.length > 0 && (
            <Panel title="source concentration" aside={<span className="text-2xs text-fg-mute">repetition is not corroboration</span>}>
              <ul className="space-y-1">
                {outcome.execution.source_concentration.map((s) => (
                  <li key={s.source_identity} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-fg-dim">{s.source_identity}</span>
                    <span className="num shrink-0 text-fg-mute">{s.count} · {(s.share * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="internal knowledge">
            {outcome.internal_outcome === null ? (
              <p className="text-xs leading-relaxed text-fg-mute">
                The plan did not ask for an internal search, so none was run. That is not the same as
                searching and finding nothing, and it is not reported as such.
              </p>
            ) : outcome.internal_outcome.status === 'unavailable' ? (
              <p className="text-xs leading-relaxed text-caution">{outcome.internal_outcome.reason}</p>
            ) : outcome.internal_outcome.status === 'empty' ? (
              <p className="text-xs leading-relaxed text-fg-dim">{outcome.internal_outcome.reason}</p>
            ) : (
              <>
                <p className="num text-xs text-fg-dim">{outcome.internal_outcome.hits.length} record(s) matched</p>
                <ul className="mt-2 space-y-1.5">
                  {outcome.internal_outcome.hits.map((h) => (
                    <li key={h.record.id} className="text-2xs leading-relaxed">
                      <span className="text-fg-dim">{h.record.title}</span>{' '}
                      <span className="num text-fg-mute">{h.record.path}#{h.record.ref} · {h.score.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>

          <Panel
            title="evidence, with provenance"
            aside={<span className="num text-2xs text-fg-mute">{outcome.merged.counters.external} external · {outcome.merged.counters.internal} internal</span>}
            flush
          >
            {outcome.merged.items.length === 0 ? (
              <Empty>Nothing was retained, so there is no evidence to show. The attempts above say why.</Empty>
            ) : (
              <ul>
                {outcome.merged.items.map((item) => (
                  <li key={item.evidence.id} className="hair-b px-4 py-3 last:border-b-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Tag tone={item.provenance.origin === 'internal' ? 'support' : 'signal'}>{item.provenance.provider}</Tag>
                      <span className="text-sm text-fg">{item.evidence.title}</span>
                      <span className="num ml-auto text-2xs text-fg-mute">tier {item.quality.tier} · rel {item.relevance.toFixed(2)} · {item.freshness}</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-fg-dim">{item.evidence.excerpt_or_summary}</p>
                    <div className="num mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-fg-mute">
                      <span title={item.provenance.location}>{item.provenance.source_identity}</span>
                      <span title={item.provenance.content_hash}>sha256 {item.provenance.content_hash.slice(0, 12)}</span>
                      <span>{item.provenance.stated_date ?? 'undated'} ({item.provenance.date_kind})</span>
                      {item.provenance.via_proxy && <span className="text-caution">via proxy</span>}
                      {item.evidence.injection_suspected && <span className="text-block">injection suspected</span>}
                    </div>
                    {item.quality.caveats.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {item.quality.caveats.map((c) => (
                          <li key={c} className="text-2xs leading-relaxed text-fg-mute">{c}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {outcome.merged.corroboration.length > 0 && (
            <Panel title="corroboration">
              <ul className="space-y-2">
                {outcome.merged.corroboration.map((c) => (
                  <li key={c.claim}>
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="text-xs text-fg-dim">{c.claim}</span>
                      <span className="num ml-auto text-2xs text-fg-mute">
                        {c.documents} docs · {c.distinct_sources} sources · {c.distinct_providers} providers
                      </span>
                    </div>
                    <p className={`mt-0.5 text-2xs leading-relaxed ${c.repetition_only ? 'text-caution' : 'text-fg-mute'}`}>{c.note}</p>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {outcome.merged.dropped.length > 0 && (
            <Panel title="dropped before it became evidence">
              <ul className="space-y-1">
                {outcome.merged.dropped.map((d, i) => (
                  <li key={`${d.title}-${i}`} className="text-2xs leading-relaxed text-fg-mute">
                    <span className="num">{d.reason}</span> &mdash; {d.title}: {d.detail}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
