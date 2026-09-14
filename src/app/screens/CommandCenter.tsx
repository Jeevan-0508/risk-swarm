/**
 * SCREEN 01 - COMMAND CENTER. The operator's standing view: what the system is, what it has looked at,
 * and where the current exposure sits. Every figure is read from a published RunResult, never recomputed.
 */
import { useNavigate } from 'react-router-dom';
import { demoInput, useSession } from '@app/store/session';
import { AGENT_CODENAME, AGENT_LABEL, AGENT_ORDER, agentOutput } from '@app/lib/agents';
import { BAND_TONE, Bar, Button, Dot, Empty, Metric, Panel, SEVERITY_TONE, STATUS_TONE, Tag } from '@app/ui/kit';
import { IntegrityRing } from '../../visual/IntegrityRing';

export function CommandCenter() {
  const { runs, start, select, mode, running } = useSession();
  const navigate = useNavigate();
  const latest = runs.find((r) => r.result !== null) ?? null;
  const result = latest?.result ?? null;
  const decision = result?.outputs.decision.decision ?? null;

  const evidenceCount = result ? result.graph.all().filter((n) => n.kind === 'evidence').length : 0;
  const openChallenges = result ? result.outputs.challenger.findings.filter((c) => c.resolution === 'open').length : 0;
  const blocking = result ? result.outputs.red_team.findings.filter((f) => f.severity === 'blocking').length : 0;

  const runDemo = async () => {
    const id = await start(demoInput());
    select(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-light tracking-tight">Command Center</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-dim">
            Seven specialised agents examine one risk question independently, exchange evidence, challenge
            each other, submit to adversarial review, and hand a traceable recommendation to a human.
            The system recommends. It does not decide.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={runDemo} disabled={running}>run demo investigation</Button>
          <Button onClick={() => navigate('/new')}>new investigation</Button>
        </div>
      </div>

      <Panel title="system status" aside={<Tag tone={mode === 'LIVE' ? 'caution' : 'support'}>{mode}</Tag>}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="agents" value="7" sub="scout to decision engine" />
          <Metric label="investigations" value={runs.length} sub={`${runs.filter((r) => r.status === 'complete').length} complete`} />
          <Metric label="evidence items" value={evidenceCount} sub="latest investigation" />
          <Metric label="open challenges" value={openChallenges} tone={openChallenges > 0 ? 'objection' : 'neutral'} sub="unresolved benign explanations" />
          <Metric label="red team" value={result ? result.outputs.red_team.verdict.replace(/_/g, ' ') : '—'}
            tone={result?.outputs.red_team.verdict === 'fail' ? 'block' : result ? 'caution' : 'neutral'}
            sub={result ? `${blocking} blocking finding(s) · ${result.outputs.red_team.checks_run} checks run` : 'no run yet'} />
          <Metric label="risk exposure" value={decision ? decision.action_band.replace(/_/g, ' ') : '—'}
            tone={decision ? BAND_TONE[decision.action_band] : 'neutral'}
            sub={decision ? `severity ${decision.severity_band}` : 'run an investigation'} />
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="agent roster" className="lg:col-span-1" flush>
          <ul>
            {AGENT_ORDER.map((agent) => {
              const out = result ? agentOutput(result, agent) : null;
              return (
                <li key={agent} className="flex items-center justify-between gap-3 hair-b px-4 py-2.5 last:border-b-0">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Dot tone={out ? 'support' : 'neutral'} />
                    <span className="truncate text-sm">
                      <span className="font-mono tracking-[0.06em]">{AGENT_CODENAME[agent]}</span>
                      <span className="text-fg-mute"> · {AGENT_LABEL[agent]}</span>
                    </span>
                  </div>
                  <span className="num text-2xs text-fg-mute">{out ? `${out.findings.length} findings · ${out.cost.ms}ms` : 'idle'}</span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="recent investigations" className="lg:col-span-2" flush>
          {runs.length === 0 ? (
            <Empty>No investigation yet. Run the demo, or ask your own question.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="hair-b text-left">
                    {['question', 'status', 'severity', 'confidence', 'disagreement', 'evidence', 'decision', 'when'].map((h) => (
                      <th key={h} className="label whitespace-nowrap px-4 py-2 font-normal">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const d = r.result?.outputs.decision.decision ?? null;
                    const score = r.result?.outputs.decision.score ?? null;
                    return (
                      <tr key={r.id} onClick={() => { select(r.id); navigate('/brief'); }}
                        className="cursor-pointer hair-b transition-colors last:border-b-0 hover:bg-ink-700">
                        <td className="max-w-[22rem] truncate px-4 py-2.5">{r.question}</td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <Tag tone={r.status === 'complete' ? 'support' : r.status === 'running' ? 'signal' : r.status === 'stopped' ? 'caution' : 'block'}>{r.status}</Tag>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {d ? <span className="num text-xs">{d.severity_band} {d.severity_score.toFixed(3)}</span> : <span className="text-fg-mute">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {d === null ? <span className="text-fg-mute">—</span>
                            : d.confidence === null ? <Tag tone="block">withheld</Tag>
                            : <span className="num text-xs">{d.confidence.toFixed(2)}</span>}
                        </td>
                        <td className="w-28 px-4 py-2.5">
                          {score ? <div className="flex items-center gap-2"><span className="num text-xs">{score.disagreement_index.value.toFixed(1)}</span><Bar value={score.disagreement_index.value / 100} tone="objection" /></div> : <span className="text-fg-mute">—</span>}
                        </td>
                        <td className="num whitespace-nowrap px-4 py-2.5 text-xs">{r.result ? r.result.graph.all().filter((n) => n.kind === 'evidence').length : '—'}</td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {d ? <Tag tone={BAND_TONE[d.action_band]}>{d.action_band.replace(/_/g, ' ')}</Tag> : <span className="text-fg-mute">—</span>}
                        </td>
                        <td className="num whitespace-nowrap px-4 py-2.5 text-2xs text-fg-mute">{new Date(r.created_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {result !== null && (
        <Panel title="PULSE · at a glance">
          <IntegrityRing title="system health" checks={result.pulse.checks} status={result.pulse.status} />
        </Panel>
      )}

      {result !== null && (
        <Panel title="PULSE · system health" aside={<Tag tone={STATUS_TONE[result.pulse.status]}>{result.pulse.status}</Tag>} flush>
          <ul className="divide-y divide-line">
            {result.pulse.checks.map((c) => (
              <li key={c.key} className="flex flex-wrap items-baseline gap-2 px-4 py-2">
                <Tag tone={STATUS_TONE[c.status]}>{c.status}</Tag>
                <span className="text-sm text-fg">{c.label}</span>
                <span className="text-xs leading-snug text-fg-mute">{c.detail}</span>
              </li>
            ))}
          </ul>
          <p className="hair-t px-4 py-2.5 text-xs leading-relaxed text-fg-mute">
            PULSE reports on the investigation's own process - budget, coverage, source diversity,
            unresolved objections. It never re-scores the risk; a WARNING here can sit next to a
            confident, correct recommendation, and does.
          </p>
        </Panel>
      )}

      {decision !== null && (
        <Panel title="current exposure" aside={<Tag tone={SEVERITY_TONE[decision.severity_band]}>{decision.severity_band}</Tag>}>
          <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
            <div>
              <p className="text-lg font-light leading-snug">{decision.headline_risk}</p>
              <ul className="mt-4 space-y-2">
                {decision.gates_failed.map((g) => (
                  <li key={g} className="flex gap-2.5 text-sm leading-relaxed text-fg-dim"><Dot tone="objection" /><span>{g}</span></li>
                ))}
              </ul>
            </div>
            <div className="hair-l pl-6">
              <div className="label">recommendation</div>
              <div className={`mt-1 text-2xl font-light ${decision.confidence === null ? 'text-caution' : ''}`}>{decision.action_band.replace(/_/g, ' ')}</div>
              <div className="mt-4 space-y-1.5 text-xs text-fg-dim">
                <div>urgency <span className="num text-fg">{decision.urgency}</span></div>
                <div>owner <span className="text-fg">{decision.owner_role}</span></div>
                <div>review by <span className="num text-fg">{decision.review_by.slice(0, 10)}</span></div>
                <div>status <span className="text-caution">{decision.human_verdict ?? 'awaiting human verdict'}</span></div>
              </div>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
