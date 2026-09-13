/**
 * SCREEN 09 - AGENT PERFORMANCE. Cost and output per agent, aggregated over the runs held on this
 * device. It deliberately does not present these as accuracy: without recorded outcomes, "performance"
 * is volume and spend, and calling it anything else would be the exact overclaim this system exists to
 * avoid.
 */
import type { ReactNode } from 'react';
import { useSession } from '@app/store/session';
import { AGENT_LABEL, AGENT_ORDER, AGENT_REMIT, agentOutput } from '@app/lib/agents';
import { Bar, Empty, Metric, Panel, Row, Tag } from '@app/ui/kit';

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
                <span className="w-44 shrink-0 text-sm text-fg">{AGENT_LABEL[r.id]}</span>
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
    </Screen>
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
