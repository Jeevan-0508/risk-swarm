/**
 * SCREEN 09 - AGENT PERFORMANCE. Cost and output per agent, aggregated over the runs held on this
 * device. It deliberately does not present these as accuracy: without recorded outcomes, "performance"
 * is volume and spend, and calling it anything else would be the exact overclaim this system exists to
 * avoid.
 */
import { useState, type ReactNode } from 'react';
import { useSession } from '@app/store/session';
import { AGENT_CODENAME, AGENT_LABEL, AGENT_ORDER, AGENT_REMIT, agentOutput } from '@app/lib/agents';
import type { Outcome } from '@core/domain/model';
import { Bar, Button, Empty, Field, inputClass, Metric, Panel, Row, Tag } from '@app/ui/kit';

export function AgentPerformance() {
  const { runs } = useSession();
  const published = runs.filter((r) => r.result !== null);
  const outcomes = published.flatMap((r) => r.result!.graph.all().filter((n) => n.kind === 'outcome'));

  if (published.length === 0) {
    return (
      <Screen>
        <Panel title="performance"><Empty>No published run yet. Run an investigation from the Command Center.</Empty></Panel>
      </Screen>
    );
  }

  const rows = AGENT_ORDER.map((id) => {
    const outs = published.map((r) => agentOutput(r.result!, id)).filter((o) => o !== null);
    const calls = outs.reduce((n, o) => n + o!.cost.calls, 0);
    const ms = outs.reduce((n, o) => n + o!.cost.ms, 0);
    const findings = outs.reduce((n, o) => n + o!.findings.length, 0);
    const created = outs.reduce((n, o) => n + o!.evidence_created.length, 0);
    const cited = outs.reduce((n, o) => n + o!.evidence_cited.length, 0);
    const uncertainties = outs.reduce((n, o) => n + o!.uncertainties.length, 0);
    const degraded = outs.filter((o) => (o!.degraded_reason ?? null) !== null).length;
    const confidence = outs.length === 0 ? 0 : outs.reduce((n, o) => n + o!.confidence, 0) / outs.length;
    return { id, runs: outs.length, calls, ms, findings, created, cited, uncertainties, degraded, confidence };
  });
  const maxMs = Math.max(...rows.map((r) => r.ms), 1);
  const totalMs = rows.reduce((n, r) => n + r.ms, 0);

  return (
    <Screen>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Metric label="runs aggregated" value={published.length} />
        <Metric label="agent calls" value={rows.reduce((n, r) => n + r.calls, 0)} />
        <Metric label="engine time" value={`${totalMs} ms`} sub="deterministic path, no network" />
        <Metric label="outcomes recorded" value={outcomes.length} tone={outcomes.length === 0 ? 'caution' : 'support'}
          sub={outcomes.length === 0 ? 'no accuracy can be claimed without them' : 'accuracy can be assessed against these'} />
      </div>

      <Panel title="cost and output per agent" aside={<span className="text-2xs text-fg-mute">not accuracy — see the note below</span>} flush>
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="w-64 shrink-0 truncate text-sm text-fg">
                  <span className="font-mono">{AGENT_CODENAME[r.id]}</span>
                  <span className="text-fg-mute"> · {AGENT_LABEL[r.id]}</span>
                </span>
                <span className="num text-2xs text-fg-mute">{r.calls} call(s) · {r.ms} ms · {r.findings} finding(s)</span>
                {r.degraded > 0 && <Tag tone="caution">degraded in {r.degraded} run(s)</Tag>}
                <span className="num ml-auto text-xs text-fg-dim">mean confidence {r.confidence.toFixed(2)}</span>
              </div>
              <div className="mt-2"><Bar value={r.ms / maxMs} tone="signal" /></div>
              <p className="mt-1.5 text-xs leading-snug text-fg-mute">{AGENT_REMIT[r.id]}</p>
              <div className="mt-1.5 divide-y divide-line">
                <Row k="evidence created / cited" v={`${r.created} / ${r.cited}`} />
                <Row k="uncertainties declared" v={r.uncertainties} tone={r.uncertainties > 0 ? 'caution' : 'neutral'} />
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="why this is not a scoreboard">
        <p className="text-sm leading-relaxed text-fg-dim">
          An agent's usefulness is whether its conclusions turn out to be right, and that is only knowable
          once someone records what actually happened. Until an outcome is written back against a
          decision, the only honest measures are the ones above: how much each agent spent, how much it
          produced, and how often it admitted uncertainty. A run where every agent is confident and every
          agent is wrong would look excellent on this screen, which is precisely why it is labelled cost.
        </p>
        {outcomes.length > 0 && (
          <ul className="mt-4 divide-y divide-line">
            {outcomes.map((o) => o.kind === 'outcome' && (
              <li key={o.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="num text-2xs text-fg-mute">{o.id} → {o.decision_id}</span>
                  <Tag tone={o.verdict === 'correct' ? 'support' : o.verdict === 'partially_correct' ? 'caution' : 'objection'}>{o.verdict.replace(/_/g, ' ')}</Tag>
                </div>
                <p className="mt-1 text-sm leading-snug text-fg-dim">{o.what_happened}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(o.agent_scorecard).map(([agent, mark]) => (
                    <Tag key={agent} tone={mark === 'correct' ? 'support' : mark === 'wrong' ? 'objection' : 'neutral'}>
                      {agent} {mark.replace(/_/g, ' ')}
                    </Tag>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <OutcomeRecorder />
      <LessonLedger />
    </Screen>
  );
}

function OutcomeRecorder() {
  const { runs, recordOutcome } = useSession();
  const candidates = runs.filter((r) => r.result !== null && r.human !== null && !r.result.graph.all().some((n) => n.kind === 'outcome'));
  const [runId, setRunId] = useState<string>('');
  const [verdict, setVerdict] = useState<Outcome['verdict']>('false_positive');
  const [what, setWhat] = useState('');
  const selected = candidates.find((r) => r.id === runId) ?? candidates[0] ?? null;

  if (candidates.length === 0) {
    return (
      <Panel title="record what happened">
        <p className="text-sm leading-relaxed text-fg-dim">
          An outcome can only be recorded against a run a human has already ruled on, and only once. Rule
          on a run in the Decision Brief first.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="record what happened" aside={<span className="text-2xs text-fg-mute">a lesson may only tighten a gate, never loosen one</span>}>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="run">
          <select value={selected?.id ?? ''} onChange={(e) => setRunId(e.target.value)} className={inputClass}>
            {candidates.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.question.slice(0, 48)}</option>)}
          </select>
        </Field>
        <Field label="how it turned out">
          <select value={verdict} onChange={(e) => setVerdict(e.target.value as Outcome['verdict'])} className={inputClass}>
            <option value="correct">correct — the risk was real and the band was right</option>
            <option value="false_positive">false positive — there was nothing there</option>
            <option value="false_negative">false negative — the risk was real and we held back</option>
            <option value="partially_correct">partially correct</option>
          </select>
        </Field>
      </div>
      <div className="mt-4">
        <Field label="what happened" hint="Recorded verbatim on the run's graph as an outcome node.">
          <textarea value={what} onChange={(e) => setWhat(e.target.value)} rows={3} className={inputClass}
            placeholder="The carrier held a valid licence and the equipment checked out." />
        </Field>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button disabled={selected === null || what.trim().length < 4} onClick={() => {
          if (selected === null) return;
          recordOutcome(selected.id, { verdict, what_happened: what.trim() });
          setWhat('');
        }}>record outcome</Button>
        <span className="text-2xs text-fg-mute">
          A false negative produces no lesson: catching it would need a looser gate, and that is not available to the loop.
        </span>
      </div>
    </Panel>
  );
}

function LessonLedger() {
  const { lessons } = useSession();
  const accepted = lessons.filter((e) => e.accepted);

  return (
    <Panel title={`lesson ledger · ${lessons.length}`} aside={<span className="text-2xs text-fg-mute">{accepted.length} in force</span>} flush>
      {lessons.length === 0 ? (
        <Empty>No lesson yet. Lessons come only from recorded outcomes.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {lessons.map((e) => (
            <li key={e.lesson.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-2xs text-fg-mute">{e.lesson.id} → {e.lesson.outcome_id}</span>
                <Tag tone={e.accepted ? 'support' : 'block'}>{e.accepted ? 'in force' : 'rejected'}</Tag>
                <Tag>{e.lesson.pattern_key}</Tag>
                <span className="num ml-auto text-2xs text-fg-mute">applied in {e.lesson.runs_applied} run(s)</span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-dim">{e.lesson.rationale}</p>
              <div className="mt-1.5 divide-y divide-line">
                {e.lesson.rule.min_independent_sources !== undefined && <Row k="independent sources" v={`at least ${e.lesson.rule.min_independent_sources}`} />}
                {e.lesson.rule.fp_risk_multiplier !== undefined && <Row k="false-positive weighting" v={`x${e.lesson.rule.fp_risk_multiplier}`} />}
                {e.lesson.rule.required_min_tier !== undefined && <Row k="required source tier" v={`tier ${e.lesson.rule.required_min_tier} or stronger`} />}
                {e.lesson.rule.expires_after_runs !== undefined && <Row k="expires after" v={`${e.lesson.rule.expires_after_runs} run(s)`} />}
              </div>
              {e.rejected_reason !== null && (
                <p className="mt-1.5 border-l border-block/60 pl-3 text-xs leading-relaxed text-block">rejected: {e.rejected_reason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="hair-t px-4 py-2.5 text-xs leading-relaxed text-fg-mute">
        A rejected lesson is kept rather than dropped. A loop that silently discards attempts to loosen its
        own gates cannot tell the difference between a bug and an attack.
      </p>
    </Panel>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Agent Performance</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-dim">
          What each agent cost and produced across the runs held on this device, with the outcomes that
          would make an accuracy claim possible listed beside it — or their absence stated plainly.
        </p>
      </div>
      {children}
    </div>
  );
}
