/**
 * SCREEN 02 - NEW INVESTIGATION. The operator states a question and the bounds of the work.
 * Budgets are set here, before the run, because a limit you can raise mid-flight is not a limit.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@app/store/session';
import { DEMO_INPUT, MODE_NOTE, type StartInput } from '@app/lib/engine';
import { Button, Field, Panel, Row, Tag, inputClass } from '@app/ui/kit';

const EXAMPLES = [
  'Are we exposed to phantom-carrier fraud in Germany?',
  'Is there an emerging logistics risk in the DACH region?',
  'Is this AI use case creating a material governance exposure?',
];

const GEOS = [
  { id: 'DE', label: 'Germany' }, { id: 'AT', label: 'Austria' }, { id: 'CH', label: 'Switzerland' },
  { id: 'NL', label: 'Netherlands' }, { id: 'FR', label: 'France' }, { id: 'PL', label: 'Poland' },
  { id: 'IT', label: 'Italy' }, { id: 'BE', label: 'Belgium' }, { id: 'GB', label: 'United Kingdom' }, { id: 'ES', label: 'Spain' },
];
const MODES = ['road', 'rail', 'sea', 'air'];
const DEPTHS = [
  { limit: 15, label: 'shallow', note: 'fast, may miss corroboration' },
  { limit: 40, label: 'standard', note: 'the demo depth' },
  { limit: 120, label: 'deep', note: 'more coverage, more duplicates to resolve' },
];
const BUDGETS = [
  { label: 'tight', budget: { agent_call: 12, retrieval: 120, tokens: 30_000 } },
  { label: 'standard', budget: { agent_call: 24, retrieval: 400, tokens: 120_000 } },
  { label: 'generous', budget: { agent_call: 40, retrieval: 1_200, tokens: 400_000 } },
];

const iso = (d: string) => new Date(`${d}T00:00:00.000Z`).toISOString();

/** One entry per line. Empty lines are dropped rather than sent as a blank query. */
const lines = (text: string) => text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
const asText = (values: string[]) => values.join('\n');

export function NewInvestigation() {
  const { start, select, mode, control } = useSession();
  const navigate = useNavigate();
  const [form, setForm] = useState<StartInput>({ ...DEMO_INPUT });
  const [fromDate, setFromDate] = useState(DEMO_INPUT.from.slice(0, 10));
  const [toDate, setToDate] = useState(DEMO_INPUT.to.slice(0, 10));

  const toggle = (key: 'geo' | 'mode', value: string) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));

  const submit = async () => {
    const input: StartInput = { ...form, from: iso(fromDate), to: iso(toDate) };
    navigate('/console');
    const id = await start(input);
    select(id);
  };

  const ready = form.question.trim().length > 12 && form.geo.length > 0 && form.mode.length > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">New Investigation</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
          State the question, the bounds and the budget. The system will retrieve, deduplicate, hypothesise,
          challenge, red-team and recommend. It will not act.
        </p>
      </div>

      <Panel title="what should I investigate?">
        <textarea value={form.question} rows={2} onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
          placeholder="Are we exposed to phantom-carrier fraud in the DACH road network?"
          className={`${inputClass} resize-none text-base leading-snug`} />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setForm((f) => ({ ...f, question: ex }))}
              className="hair px-2.5 py-1 text-left text-xs text-fg-dim transition-colors hover:border-line-bright hover:text-fg">
              {ex}
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="scope">
          <Field label="geography">
            <div className="mt-2 flex flex-wrap gap-1.5">
              {GEOS.map((g) => (
                <button key={g.id} onClick={() => toggle('geo', g.id)} title={g.label}
                  className={`num border px-2 py-1 text-xs transition-colors ${
                    form.geo.includes(g.id) ? 'border-signal/60 bg-signal/10 text-signal' : 'border-line text-fg-mute hover:text-fg'}`}>
                  {g.id}
                </button>
              ))}
            </div>
          </Field>
          <div className="mt-4">
            <Field label="domain / transport mode">
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MODES.map((m) => (
                  <button key={m} onClick={() => toggle('mode', m)}
                    className={`border px-2 py-1 font-mono text-2xs uppercase tracking-[0.1em] transition-colors ${
                      form.mode.includes(m) ? 'border-signal/60 bg-signal/10 text-signal' : 'border-line text-fg-mute hover:text-fg'}`}>
                    {m}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Field label="window from"><input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${inputClass} num`} /></Field>
            <Field label="window to"><input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${inputClass} num`} /></Field>
          </div>
        </Panel>

        <Panel title="limits">
          <Field label="evidence depth" hint="How many signals the scout may retrieve before it stops and says so.">
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {DEPTHS.map((d) => (
                <button key={d.limit} onClick={() => setForm((f) => ({ ...f, limit: d.limit }))}
                  className={`border px-2 py-2 text-left transition-colors ${form.limit === d.limit ? 'border-signal/60 bg-signal/10' : 'border-line hover:border-line-bright'}`}>
                  <div className={`font-mono text-2xs uppercase tracking-[0.1em] ${form.limit === d.limit ? 'text-signal' : 'text-fg-dim'}`}>{d.label}</div>
                  <div className="num mt-1 text-sm">{d.limit}</div>
                  <div className="mt-1 text-2xs leading-tight text-fg-mute">{d.note}</div>
                </button>
              ))}
            </div>
          </Field>
          <div className="mt-4">
            <Field label="investigation budget" hint="Reaching a limit stops the run. It does not silently continue.">
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {BUDGETS.map((b) => (
                  <button key={b.label} onClick={() => setForm((f) => ({ ...f, budget: b.budget }))}
                    className={`border px-2 py-2 text-left transition-colors ${form.budget.agent_call === b.budget.agent_call ? 'border-signal/60 bg-signal/10' : 'border-line hover:border-line-bright'}`}>
                    <div className={`font-mono text-2xs uppercase tracking-[0.1em] ${form.budget.agent_call === b.budget.agent_call ? 'text-signal' : 'text-fg-dim'}`}>{b.label}</div>
                    <div className="num mt-1 text-2xs text-fg-mute">{b.budget.agent_call} calls</div>
                    <div className="num text-2xs text-fg-mute">{b.budget.retrieval} retrievals</div>
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="mt-5 hair-t pt-3">
            <Row k="mode" v={<Tag tone={mode === 'LIVE' ? 'caution' : 'support'}>{mode}</Tag>} />
            <p className="mt-1 text-xs leading-relaxed text-fg-mute">{MODE_NOTE[mode]}</p>
          </div>
        </Panel>
      </div>

      {mode === 'LIVE' && (
        <Panel title="live retrieval" aside={<span className="text-2xs text-fg-mute">operator-configured</span>}>
          <p className="text-xs leading-relaxed text-fg-dim">
            In LIVE mode the scout retrieves from public feeds instead of the pinned snapshot. The taxonomy and
            governance snapshots stay pinned in every mode, and tier still follows source type — a live item can add
            evidence, never promote it.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Field label="news search terms" hint="One per line. Sent verbatim to the news feed; nothing is inferred from the question.">
              <textarea rows={4} value={asText(form.live.terms)}
                onChange={(e) => setForm((f) => ({ ...f, live: { ...f.live, terms: lines(e.target.value) } }))}
                className={`${inputClass} resize-none font-mono text-2xs leading-relaxed`} />
            </Field>
            <Field label="regulatory feed urls" hint="Tier 1. Left empty by default: no endpoint is invented for you.">
              <textarea rows={4} value={asText(form.live.regulatory)}
                onChange={(e) => setForm((f) => ({ ...f, live: { ...f.live, regulatory: lines(e.target.value) } }))}
                placeholder="https://…/rss"
                className={`${inputClass} resize-none font-mono text-2xs leading-relaxed`} />
            </Field>
            <Field label="industry feed urls" hint="Tier 2.">
              <textarea rows={3} value={asText(form.live.industry)}
                onChange={(e) => setForm((f) => ({ ...f, live: { ...f.live, industry: lines(e.target.value) } }))}
                className={`${inputClass} resize-none font-mono text-2xs leading-relaxed`} />
            </Field>
            <Field label="other web feed urls" hint="Tier 3.">
              <textarea rows={3} value={asText(form.live.web)}
                onChange={(e) => setForm((f) => ({ ...f, live: { ...f.live, web: lines(e.target.value) } }))}
                className={`${inputClass} resize-none font-mono text-2xs leading-relaxed`} />
            </Field>
          </div>
          <p className="mt-4 hair-t pt-3 text-xs leading-relaxed text-caution">
            A browser cannot read a feed that forbids cross-origin access. Every blocked, failed or unparseable feed is
            listed on the provenance screen with its reason. None of them is substituted, guessed or filled in.
          </p>
        </Panel>
      )}

      <div className="flex items-center justify-between gap-6 hair bg-ink-800 px-4 py-3">
        <p className="text-xs leading-relaxed text-fg-mute">
          {mode === 'LIVE'
            ? 'Public feeds are read. Nothing is written anywhere, no email, no external system, no consequential action — the run ends at a recommendation awaiting your verdict.'
            : 'Nothing is sent anywhere. No email, no external system, no consequential action — the run ends at a recommendation awaiting your verdict.'}
        </p>
        <Button onClick={submit} disabled={!ready || control !== null}>start investigation</Button>
      </div>
    </div>
  );
}
