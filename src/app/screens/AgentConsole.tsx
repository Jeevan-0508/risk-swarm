/**
 * SCREEN 03 - LIVE AGENT CONSOLE. Agents appear as each phase genuinely completes; the timings shown are
 * the measured `ms` from the run, not an animation. There is no chain-of-thought here by design - what is
 * shown is each agent's structured findings, its declared uncertainties and what it cost.
 */
import { useSession } from '@app/store/session';
import { AGENT_CODENAME, AGENT_LABEL, AGENT_ORDER, AGENT_TAGLINE, PHASE_AGENT, agentOutput } from '@app/lib/agents';
import { agentLines, agentUncertainties } from '@app/lib/summary';
import { Bar, Button, Dot, Empty, Panel, Row, Tag, type Tone } from '@app/ui/kit';
import type { AgentId } from '@core/domain/model';
import { useNavigate } from 'react-router-dom';

const STATUS_ICON: Record<string, string> = { supported: '✓', partially_supported: '~', hypothesis_only: '~', insufficient_evidence: '!' };

export function AgentConsole() {
  const { active, live, running, spent, control, stop } = useSession();
  const navigate = useNavigate();
  const run = active();
  const result = run?.result ?? null;
  // While a run is in flight the reveal follows `live`; once it settles the run's own log is the record.
  const phases = running ? live : result?.log ?? [];
  const done = new Set(phases.map((l) => PHASE_AGENT[l.phase]));

  if (!run) {
    return (
      <div className="mx-auto max-w-xl">
        <Panel title="agent console">
          <Empty>No investigation selected. Start one and the agents will report here as they finish.</Empty>
          <div className="flex justify-center"><Button onClick={() => navigate('/new')}>new investigation</Button></div>
        </Panel>
      </div>
    );
  }

  const budget = run.input.budget;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="kicker">investigation {run.id}</div>
          <h1 className="mt-1 max-w-3xl text-2xl font-light leading-snug">{run.question}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Tag tone={run.status === 'complete' ? 'support' : run.status === 'running' ? 'signal' : run.status === 'stopped' ? 'caution' : 'block'}>
            {run.status === 'running' && <Dot tone="signal" pulse />} {run.status}
          </Tag>
          {control !== null && <Button variant="danger" onClick={() => stop('stopped by the operator from the console')}>kill switch</Button>}
        </div>
      </div>

      {run.error !== null && (
        <div className="border border-block/60 bg-block/5 px-4 py-3 text-sm text-block">
          {run.error}
          <span className="mt-1 block text-xs text-fg-dim">The run stopped rather than continuing past its limit. Nothing partial was published as a recommendation.</span>
        </div>
      )}

      <Panel title="budget ledger" aside={<span className="label">{phases.length}/7 phases</span>}>
        <div className="grid gap-6 sm:grid-cols-3">
          {([
            ['agent calls', spent?.agent_call ?? 0, budget.agent_call],
            ['retrievals', spent?.retrieval ?? 0, budget.retrieval],
            ['tokens', spent?.tokens ?? 0, budget.tokens],
          ] as Array<[string, number, number]>).map(([label, used, cap]) => (
            <div key={label}>
              <div className="flex items-baseline justify-between">
                <span className="label">{label}</span>
                <span className="num text-sm">{used}<span className="text-fg-mute"> / {cap}</span></span>
              </div>
              <div className="mt-2"><Bar value={cap === 0 ? 0 : used / cap} tone={used / cap > 0.85 ? 'objection' : 'signal'} /></div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="space-y-3">
        {AGENT_ORDER.map((agent, index) => (
          <AgentCard key={agent} agent={agent} index={index} state={done.has(agent) ? (result ? 'done' : 'running') : phases.length === index ? 'active' : 'pending'} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent, index, state }: { agent: AgentId; index: number; state: 'pending' | 'active' | 'running' | 'done' }) {
  const { active, live, running } = useSession();
  const run = active();
  const result = run?.result ?? null;
  const entry = (running ? live : result?.log ?? []).find((l) => PHASE_AGENT[l.phase] === agent) ?? null;
  const out = result ? agentOutput(result, agent) : null;
  const lines = result ? agentLines(result, agent) : [];
  const uncertainties = result ? agentUncertainties(result, agent) : [];

  const tone: Tone = state === 'done' ? 'support' : state === 'active' ? 'signal' : 'neutral';

  return (
    <section className={`hair bg-ink-800 transition-opacity ${state === 'pending' ? 'opacity-40' : 'reveal opacity-100'}`}>
      <header className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="num text-2xs text-fg-mute">{String(index + 1).padStart(2, '0')}</span>
          <Dot tone={tone} pulse={state === 'active'} />
          <span className="font-mono text-sm tracking-[0.08em]">{AGENT_CODENAME[agent]}</span>
          <span className="hidden text-2xs uppercase tracking-[0.1em] text-fg-mute sm:inline">{AGENT_LABEL[agent]}</span>
          <span className="hidden truncate text-xs italic text-fg-mute md:inline">“{AGENT_TAGLINE[agent]}”</span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {entry !== null && <span className="num text-2xs text-fg-mute">{entry.ms}ms</span>}
          {out !== null && <Tag tone={out.reasoning_status === 'supported' ? 'support' : out.reasoning_status === 'insufficient_evidence' ? 'block' : 'caution'}>
            {STATUS_ICON[out.reasoning_status]} {out.reasoning_status.replace(/_/g, ' ')}
          </Tag>}
          {state === 'active' && <span className="label">working</span>}
          {state === 'pending' && <span className="label">queued</span>}
        </div>
      </header>

      {state !== 'pending' && (
        <div className="grid gap-6 hair-t px-4 py-3 lg:grid-cols-[1fr_18rem]">
          <div>
            <div className="label">findings</div>
            <ul className="mt-2 space-y-1.5">
              {lines.length === 0 && entry !== null && <li className="text-sm text-fg-mute">{entry.findings} finding(s) recorded</li>}
              {lines.map((l, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                  <Dot tone={l.tone} />
                  <span className={l.tone === 'block' ? 'text-block' : l.tone === 'objection' ? 'text-objection' : l.tone === 'caution' ? 'text-caution' : 'text-fg'}>{l.text}</span>
                </li>
              ))}
            </ul>
            {uncertainties.length > 0 && (
              <>
                <div className="label mt-4">declared uncertainties</div>
                <ul className="mt-2 space-y-1.5">
                  {uncertainties.map((u, i) => (
                    <li key={i} className="border-l border-caution/40 pl-2.5 text-xs leading-relaxed text-fg-dim">{u}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="hair-t pt-3 lg:border-l lg:border-t-0 lg:border-line lg:pl-6 lg:pt-0">
            {out !== null ? (
              <>
                <Row k="confidence" v={<span className="num">{out.confidence.toFixed(2)}</span>} />
                <Row k="evidence created" v={<span className="num">{out.evidence_created.length}</span>} />
                <Row k="evidence cited" v={<span className="num">{out.evidence_cited.length}</span>} />
                <Row k="agent calls" v={<span className="num">{out.cost.calls}</span>} />
                <Row k="duration" v={<span className="num">{out.cost.ms}ms</span>} />
                {out.degraded_reason != null && <Row k="model" v={<span className="text-caution">degraded to deterministic</span>} tone="caution" />}
                {out.recommended_next_step !== null && (
                  <p className="mt-3 hair-t pt-3 text-xs leading-relaxed text-fg-dim">{out.recommended_next_step}</p>
                )}
              </>
            ) : (
              <p className="text-xs text-fg-mute">Detail appears when the run completes.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
