/**
 * SCREEN 07 - DECISION BRIEF. What a human is actually asked to read. The recommendation, what it rests
 * on, what it does not support, and the gates that held it down — followed by the markdown export that
 * goes into a ticket.
 */
import { useState, type ReactNode } from 'react';
import { renderBrief } from '@core/brief/render';
import { useSession } from '@app/store/session';
import { BAND_TONE, Bar, Button, Empty, Metric, Panel, Row, SEVERITY_TONE, Tag, type Tone } from '@app/ui/kit';

const APPLICABILITY_TONE: Record<string, Tone> = { established: 'support', possible: 'caution', not_established: 'neutral' };

export function DecisionBrief() {
  const { active } = useSession();
  const run = active();
  const result = run?.result ?? null;
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [copied, setCopied] = useState(false);

  if (result === null) {
    return (
      <Screen>
        <Panel title="brief"><Empty>No investigation loaded. Run one from the Command Center.</Empty></Panel>
      </Screen>
    );
  }

  const d = result.outputs.decision.decision;
  const score = result.outputs.decision.score;
  const actions = result.outputs.decision.actions;
  const human = run?.human ?? null;
  const markdown = renderBrief(result, { human });

  const copy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.run_id}-brief.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Screen>
      <Panel title="recommendation" aside={<Tag tone={BAND_TONE[d.action_band] ?? 'neutral'}>{d.action_band.replace(/_/g, ' ')}</Tag>}>
        <h2 className="text-2xl font-light leading-snug tracking-tight text-fg">{d.headline_risk}</h2>
        <p className="mt-2 text-sm leading-relaxed text-fg-mute">{result.question}</p>
        <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
          <Metric label="severity" value={d.severity_band} tone={SEVERITY_TONE[d.severity_band] ?? 'neutral'} sub={d.severity_score.toFixed(3)} mono={false} />
          <Metric label="confidence" value={d.confidence === null ? 'withheld' : d.confidence.toFixed(2)}
            tone={d.confidence === null ? 'block' : 'support'} mono={d.confidence !== null}
            sub={d.confidence === null ? d.confidence_blocked_reason ?? 'reason not recorded' : 'published because nothing blocking stands'} />
          <Metric label="urgency" value={d.urgency} mono={false} sub={`review by ${d.review_by.slice(0, 10)}`} />
          <Metric label="owner" value={d.owner_role} mono={false} sub="a role, never a person — this system has no org data" />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="what the record supports">
          <ul className="space-y-2 text-sm leading-relaxed text-fg-dim">
            {d.rationale.map((r, i) => <li key={i} className="border-l border-support/50 pl-3">{r}</li>)}
          </ul>
        </Panel>
        <Panel title={`what it does not support · ${d.unresolved_objections.length}`}>
          {d.unresolved_objections.length === 0 ? (
            <Empty>No objection was left unresolved.</Empty>
          ) : (
            <ul className="space-y-2 text-sm leading-relaxed text-fg-dim">
              {d.unresolved_objections.map((o, i) => <li key={i} className="border-l border-objection/50 pl-3">{o}</li>)}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="the factors behind the severity figure" aside={<span className="text-2xs text-fg-mute">each one printed with its own arithmetic</span>} flush>
        <ul className="divide-y divide-line">
          {Object.values(score.factors).map((f) => (
            <li key={f.key} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-fg">{f.label}</span>
                <span className="num text-sm text-fg-dim">{f.value.toFixed(3)}</span>
              </div>
              <div className="mt-1.5"><Bar value={f.value} tone={f.key === 'false_positive_risk' || f.key === 'agent_disagreement' || f.key === 'uncertainty' ? 'objection' : 'signal'} /></div>
              <p className="mt-1.5 text-xs leading-snug text-fg-mute">{f.explanation}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={`recommended actions · ${actions.length}`} flush>
        {actions.length === 0 ? <Empty>None. The band does not authorise action.</Empty> : (
          <ul className="divide-y divide-line">
            {actions.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag>{a.class}</Tag>
                  <span className="num text-2xs text-fg-mute">{a.owner_role} · due {a.due.slice(0, 10)}</span>
                  {a.countermeasure_id !== null && <span className="num text-2xs text-fg-mute">countermeasure {a.countermeasure_id}</span>}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-dim">{a.text}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {d.regulatory_implications.length > 0 && (
        <Panel title={`regulatory implications · ${d.regulatory_implications.length}`} flush>
          <ul className="divide-y divide-line">
            {d.regulatory_implications.map((r) => (
              <li key={r.requirement_id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-fg">{r.framework} {r.ref}</span>
                  <Tag tone={APPLICABILITY_TONE[r.applicability] ?? 'neutral'}>{r.applicability.replace(/_/g, ' ')}</Tag>
                </div>
                <p className="mt-1 text-sm text-fg-dim">{r.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-mute">{r.reasoning}</p>
                <p className="mt-1.5 text-xs italic leading-relaxed text-fg-dim">“{r.citation}”</p>
                {r.url !== null && <a href={r.url} target="_blank" rel="noreferrer" className="num mt-1 block text-2xs text-signal hover:underline">{r.url}</a>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="export" aside={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowMarkdown((v) => !v)}>{showMarkdown ? 'hide markdown' : 'show markdown'}</Button>
          <Button variant="ghost" onClick={copy}>{copied ? 'copied' : 'copy'}</Button>
          <Button onClick={download}>download .md</Button>
        </div>
      }>
        <div className="divide-y divide-line">
          <Row k="Run" v={result.run_id} />
          <Row k="Attempts" v={`${result.attempts} · ${result.rework_history.length} rework cycle(s)`} />
          <Row k="Budget spent" v={`${result.spent.agent_call} agent calls · ${result.spent.retrieval} retrievals · ${result.spent.tokens} tokens`} />
          <Row k="Human ruling" v={human === null ? 'none recorded — this is a recommendation, not a decision' : `${human.verdict} → ${human.band}`}
            tone={human === null ? 'caution' : 'support'} />
        </div>
        {showMarkdown && (
          <pre className="mt-4 max-h-96 overflow-auto bg-ink-900 p-4 text-2xs leading-relaxed text-fg-dim">{markdown}</pre>
        )}
      </Panel>
    </Screen>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Decision Brief</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-dim">
          One page a human can act on. It states the recommendation, the reasoning that survived
          challenge, the objections that did not get resolved, and every gate that held the band down —
          in that order, because that is the order a reviewer needs them.
        </p>
      </div>
      {children}
    </div>
  );
}
