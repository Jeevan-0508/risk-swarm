/**
 * SCREEN 02 - NEW INVESTIGATION. The operator states a question and the bounds of the work.
 * Budgets are set here, before the run, because a limit you can raise mid-flight is not a limit.
 *
 * EVOLUTION 5.0 Phase F: the question is no longer freight-shaped. Geography and transport mode were
 * required fields, which meant an off-domain question could not be submitted at all - the engine has
 * supported open questions since EVOLUTION 4.0, and the form was the thing preventing them. Both are now
 * optional (an empty list is "no filter", which is what `fomo.ts` has always done with one), and the
 * pack the run opens is recommended from the question and overridable.
 *
 * Everything shown before the run is a real derivation, computed here by the same functions the engine
 * will use: `routeQuestion()` for the reading, `recommendPack()` for the pack, `decideParticipation()`
 * for who will be in the room. None of it is a preview of a guess - it is the decision itself, shown
 * early enough to disagree with.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@app/store/session';
import { DEMO_INPUT, MODE_NOTE, type StartInput } from '@app/lib/engine';
import { Button, Field, Panel, Row, Tag, inputClass } from '@app/ui/kit';
import { routeQuestion } from '@core/question/model';
import { recommendPack } from '@core/packs/recommend';
import { packById } from '@core/packs/registry';
import { decideParticipation } from '@core/orchestrator/participation';
import { AGENT_CODENAME } from '@app/lib/agents';

/** Deliberately spread across domains: the form has to visibly accept a question freight knows nothing about. */
const EXAMPLES = [
  'Are we exposed to phantom-carrier fraud in Germany?',
  'Is this AI use case creating a material governance exposure?',
  'What changed in the EU AI Act this year?',
  'How does a quantum error-correcting code actually work?',
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
  /**
   * Null means "follow the recommendation as the question changes". Once the operator picks a pack the
   * choice sticks, because a selection that silently moved under a retyped word would be worse than no
   * recommendation at all.
   */
  const [packOverride, setPackOverride] = useState<string | null>(null);

  const question = form.question.trim();
  const routed = useMemo(() => routeQuestion(question), [question]);
  const advice = useMemo(() => recommendPack(question), [question]);
  const packId = packOverride ?? advice.pack_id;
  const pack = useMemo(() => packById(packId), [packId]);
  const seats = useMemo(() => decideParticipation(routed, pack), [routed, pack]);
  const standDown = seats.filter((d) => !d.participating);

  const toggle = (key: 'geo' | 'mode', value: string) =>
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));

  const submit = async () => {
    const input: StartInput = { ...form, pack_id: packId, from: iso(fromDate), to: iso(toDate) };
    navigate('/console');
    const id = await start(input);
    select(id);
  };

  /** The question is the only requirement. Scope is a filter, and a filter nobody set is not an error. */
  const ready = question.length > 12;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">New Investigation</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
          State the question. The system will read it, choose what knowledge to open, retrieve, deduplicate,
          hypothesise, challenge, red-team and recommend. It will not act.
        </p>
      </div>

      <Panel title="what should I investigate?">
        <textarea value={form.question} rows={2} onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
          placeholder="Ask anything. A question outside freight opens the open pack instead of forcing a freight taxonomy onto it."
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

      <Panel title="how the question was read" aside={<span className="text-2xs text-fg-mute">rules, not a model</span>}>
        {question.length === 0 ? (
          <p className="text-xs leading-relaxed text-fg-mute">Nothing typed yet, so nothing has been read.</p>
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              <Row k="intent" v={<span className="num text-xs">{routed.intent.replace(/_/g, ' ')}</span>} />
              <Row k="domain" v={<span className="num text-xs">{routed.domain}</span>} />
              <Row k="freshness needed" v={<span className="num text-xs">{routed.freshness}</span>} />
              <Row k="depth" v={<span className="num text-xs">{routed.depth}</span>} />
              <Row k="geography named" v={<span className="num text-xs">{routed.geo.length === 0 ? 'none' : routed.geo.join(', ')}</span>} />
              <Row
                k="retrieval needed"
                v={
                  <span className="num text-xs">
                    {routed.requires_external ? 'external' : 'no external'}
                    {routed.requires_internal ? ' + internal' : ''}
                  </span>
                }
              />
            </div>
            {routed.subdomains.length > 0 && (
              <p className="mt-3 text-2xs leading-relaxed text-fg-mute">
                also touches: {routed.subdomains.join(', ')}
              </p>
            )}
            {routed.geo.length > 0 && routed.geo.some((g) => !form.geo.includes(g)) && (
              <button
                onClick={() => setForm((f) => ({ ...f, geo: [...new Set([...f.geo, ...routed.geo])] }))}
                className="mt-3 hair px-2.5 py-1 text-xs text-fg-dim transition-colors hover:border-line-bright hover:text-fg"
              >
                apply {routed.geo.join(', ')} to the scope filter
              </button>
            )}
            <p className="mt-3 text-2xs leading-relaxed text-fg-mute">
              This is `routeQuestion()`, the same rule-based reading the engine will use. It is keyword and
              pattern matching over your text - no model, no inference about what you meant.
            </p>
          </>
        )}
      </Panel>

      <Panel title="knowledge pack" aside={<span className="text-2xs text-fg-mute">{packOverride === null ? 'recommended' : 'your choice'}</span>}>
        <p className="text-xs leading-relaxed text-fg-dim">{advice.reason}</p>
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {advice.scores.map((s) => {
            const p = packById(s.pack_id);
            const chosen = s.pack_id === packId;
            return (
              <button
                key={s.pack_id}
                onClick={() => setPackOverride(s.pack_id)}
                className={`border p-3 text-left transition-colors ${chosen ? 'border-signal/60 bg-signal/5' : 'border-line hover:border-line-bright'}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`text-sm ${chosen ? 'text-signal' : 'text-fg-dim'}`}>{p.label}</span>
                  {s.pack_id === advice.pack_id && <span className="font-mono text-2xs uppercase tracking-[0.12em] text-fg-mute">recommended</span>}
                </div>
                <p className="mt-1.5 text-2xs leading-relaxed text-fg-mute">{p.remit}</p>
                <p className="mt-1.5 text-2xs leading-relaxed text-fg-mute">
                  {s.unscorable
                    ? 'Publishes no vocabulary, so it cannot be scored for or against this question.'
                    : s.matched_terms.length === 0
                      ? 'None of its own vocabulary appears in this question.'
                      : `matched: ${s.matched_terms.join(', ')}`}
                </p>
              </button>
            );
          })}
        </div>
        <div className="mt-4 hair-t pt-3">
          <Field label="what this pack cannot do">
            <ul className="mt-1.5 space-y-1">
              {!pack.supports.taxonomy_matching && <li className="text-2xs leading-relaxed text-caution">No pinned taxonomy: no pattern can be named, so none will be.</li>}
              {!pack.supports.governance_mapping && <li className="text-2xs leading-relaxed text-caution">No pinned control set: no obligation can be mapped.</li>}
              {!pack.supports.mode_analysis && <li className="text-2xs leading-relaxed text-caution">Transport mode is not meaningful here.</li>}
              {pack.supports.taxonomy_matching && pack.supports.governance_mapping && pack.supports.mode_analysis && (
                <li className="text-2xs leading-relaxed text-fg-mute">
                  This pack supplies every input the seven agents need. Whether the question is inside its
                  remit is still your call.
                </li>
              )}
            </ul>
          </Field>
          <p className="mt-3 text-2xs leading-relaxed text-fg-mute">
            {standDown.length === 0
              ? `All ${seats.length} agents will take part in this run.`
              : `${standDown.length} of ${seats.length} agents will stand down: ${standDown.map((d) => AGENT_CODENAME[d.agent]).join(', ')}. They abstain with a reason on the record rather than answering from nothing.`}
          </p>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="scope" aside={<span className="text-2xs text-fg-mute">optional filters</span>}>
          <Field label="geography" hint="Optional. Nothing selected means no geographic filter, not an empty result.">
            <div className="mt-2 flex flex-wrap gap-1.5">
              {GEOS.map((g) => (
                <button key={g.id} onClick={() => toggle('geo', g.id)} title={g.label}
                  className={`num border px-2 py-1 text-xs transition-colors ${
                    form.geo.includes(g.id) ? 'border-signal/60 bg-signal/10 text-signal' : 'border-line text-fg-mute hover:text-fg'}`}>
                  {g.id}
                </button>
              ))}
            </div>
            {form.geo.length > 0 && (
              <button onClick={() => setForm((f) => ({ ...f, geo: [] }))} className="mt-2 font-mono text-2xs uppercase tracking-[0.12em] text-fg-mute hover:text-fg">
                clear
              </button>
            )}
          </Field>
          <div className="mt-4">
            <Field
              label="transport mode"
              hint={pack.supports.mode_analysis
                ? 'Optional. Nothing selected means no mode filter.'
                : `The "${pack.label}" pack does not treat transport mode as meaningful, so a selection here would not be used.`}
            >
              <div className="mt-2 flex flex-wrap gap-1.5">
                {MODES.map((m) => (
                  <button key={m} onClick={() => toggle('mode', m)} disabled={!pack.supports.mode_analysis}
                    className={`border px-2 py-1 font-mono text-2xs uppercase tracking-[0.1em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
            governance snapshots stay pinned in every mode, and tier still follows source type &mdash; a live item can add
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
