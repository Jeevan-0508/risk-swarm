/**
 * SCREEN 08a - CASE FILE. One stored run opened in full: when it was asked, when it answered, what it did,
 * what each agent said in turn, who disagreed with whom, and what was recommended. A detail view of History
 * rather than a screen of its own, so it has no nav entry.
 *
 * Every download is generated here from the same case-file model the page renders, so a file on disk and the
 * page it came from can never drift apart.
 */
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '@app/store/session';
import { AGENT_CODENAME, AGENT_LABEL, AGENT_ORDER, AGENT_REMIT } from '@app/lib/agents';
import { agentLines, agentUncertainties } from '@app/lib/summary';
import { buildCaseFile, caseFileHtml, type RosterEntry } from '@core/casefile/casefile';
import { BAND_TONE, Button, Empty, Metric, Panel, Row, SEVERITY_TONE, Tag, type Tone } from '@app/ui/kit';
import type { RunResult } from '@core/orchestrator/run';

const STATUS_TONE: Record<string, Tone> = { complete: 'support', running: 'signal', stopped: 'caution', failed: 'block' };
const SEV_TONE: Record<string, Tone> = { blocking: 'block', material: 'objection', minor: 'caution' };

const stamp = (iso: string | null) => (iso === null ? 'not recorded' : iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC'));

function roster(result: RunResult): RosterEntry[] {
  return AGENT_ORDER.map((id) => ({
    id,
    label: AGENT_LABEL[id],
    codename: AGENT_CODENAME[id],
    remit: AGENT_REMIT[id],
    statements: agentLines(result, id).map((l) => l.text),
    uncertainties: agentUncertainties(result, id),
  }));
}

function save(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * PDF goes through the browser's own print pipeline rather than a bundled renderer: a print dialogue with
 * "save as PDF" is already on every machine, and a PDF library would cost more than the whole app weighs.
 */
function printDoc(html: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 1000);
  };
  document.body.append(frame);
}

export function CaseFile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const run = useSession((s) => s.runs.find((r) => r.id === id) ?? null);

  if (run === null || run.result === null) {
    return (
      <Screen id={id ?? 'unknown'}>
        <Panel title="case file">
          <Empty>{run === null ? 'No run with that id is held on this device.' : 'That run never reached a recommendation, so there is no case file to open.'}</Empty>
          <div className="flex justify-center"><Button onClick={() => navigate('/history')}>back to history</Button></div>
        </Panel>
      </Screen>
    );
  }

  const result = run.result;
  const file = buildCaseFile(result, {
    mode: run.mode,
    status: run.status,
    asked_at: run.created_at,
    completed_at: run.completed_at,
    scope: { geo: run.input.geo ?? [], mode: run.input.mode ?? [], from: run.input.from ?? '', to: run.input.to ?? '' },
    human: run.human,
    roster: roster(result),
  });
  const html = () => caseFileHtml(file);

  return (
    <Screen id={run.id}>
      <div className="flex flex-wrap items-center gap-2">
        <Tag>{file.mode}</Tag>
        <Tag tone={STATUS_TONE[file.status] ?? 'neutral'}>{file.status}</Tag>
        <Tag tone={BAND_TONE[file.final.action_band] ?? 'neutral'}>{file.final.action_band.replace(/_/g, ' ')}</Tag>
        <Tag tone={SEVERITY_TONE[file.final.severity_band] ?? 'neutral'}>{file.final.severity_band} {file.final.severity_score.toFixed(3)}</Tag>
        <Link to="/history" className="ml-auto text-2xs uppercase tracking-[0.14em] text-fg-mute transition-colors hover:text-fg">&#8592; history</Link>
      </div>

      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Metric label="asked" value={stamp(file.asked_at).slice(0, 16)} mono sub={file.asked_at.slice(0, 10)} />
        <Metric label="result" value={file.completed_at === null ? 'not recorded' : stamp(file.completed_at).slice(0, 16)} mono={file.completed_at !== null}
          sub={file.completed_at === null ? 'stored before completion was tracked' : 'when the run settled'} />
        <Metric label="elapsed" value={file.elapsed_ms === null ? '—' : `${(file.elapsed_ms / 1000).toFixed(1)}s`} sub={`${file.engine_ms} ms of engine time`} />
        <Metric label="phases" value={`${file.timeline.length}/7`} sub={`${file.problem.attempts} attempt(s)`} />
      </div>

      <Panel title="export" aside={<span className="text-2xs text-fg-mute">generated from this record, nothing uploaded</span>}>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => printDoc(html())}>print / save as pdf</Button>
          <Button variant="ghost" onClick={() => save(`${file.run_id}-case-file.html`, html(), 'text/html')}>download .html</Button>
          <Button variant="ghost" onClick={() => save(`${file.run_id}-case-file.doc`, html(), 'application/msword')}>download .doc</Button>
          <Button variant="ghost" onClick={() => save(`${file.run_id}-brief.md`, file.brief, 'text/markdown')}>download .md</Button>
          <Button variant="ghost" onClick={() => save(`${file.run_id}-case-file.json`, JSON.stringify(file, null, 2), 'application/json')}>download .json</Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-fg-mute">
          The .doc is the same document Word opens directly — no converter and no upload. The .json is the
          whole case-file model, so a figure in any of these can be traced back to the run that produced it.
        </p>
      </Panel>

      <Panel title="problem statement">
        <h2 className="text-xl font-light leading-snug tracking-tight text-fg">{file.problem.headline_risk}</h2>
        <p className="mt-3 border-l border-line-bright pl-3 text-sm leading-relaxed text-fg-dim">{file.question}</p>
        <div className="mt-4 divide-y divide-line">
          {file.scope !== null && <Row k="scope" v={`${file.scope.geo.join(', ')} · ${file.scope.mode.join(', ')} · ${file.scope.from.slice(0, 10)} to ${file.scope.to.slice(0, 10)}`} />}
          <Row k="attempts" v={String(file.problem.attempts)} />
          <Row k="rework" v={file.problem.rework_history.length === 0 ? 'no phase was sent back' : file.problem.rework_history.join(' · ')} />
        </div>
      </Panel>

      <Panel title={`what it did · ${file.timeline.length} phases`} flush>
        <ul className="divide-y divide-line">
          {file.timeline.map((s) => (
            <li key={`${s.n}-${s.phase}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <span className="num w-6 shrink-0 text-2xs text-fg-mute">{String(s.n).padStart(2, '0')}</span>
              <span className="w-40 shrink-0 truncate text-sm text-fg"><span className="font-mono">{s.codename}</span></span>
              <span className="w-28 shrink-0 truncate text-xs text-fg-mute">{s.phase}</span>
              <Tag>{s.reasoning_status.replace(/_/g, ' ')}</Tag>
              <span className="num text-2xs text-fg-mute">{s.findings} finding(s)</span>
              <span className="num ml-auto text-2xs text-fg-mute">{s.ms} ms{s.attempt > 1 ? ` · attempt ${s.attempt}` : ''}</span>
              {s.note !== null && <p className="w-full text-xs leading-snug text-caution">{s.note}</p>}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="what each agent said" aside={<span className="text-2xs text-fg-mute">published findings, in the order they ran</span>} flush>
        <ul className="divide-y divide-line">
          {file.agents.map((a) => (
            <li key={a.agent} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-fg">{a.codename}</span>
                <span className="text-2xs uppercase tracking-[0.12em] text-fg-mute">{a.label}</span>
                {a.stance !== null && <Tag>{a.stance.reasoning_status.replace(/_/g, ' ')} · {a.stance.confidence.toFixed(2)}</Tag>}
                <span className="num ml-auto text-2xs text-fg-mute">{a.ms} ms</span>
              </div>
              <p className="mt-1 text-xs leading-snug text-fg-mute">{a.remit}</p>
              <ul className="mt-2 space-y-1 text-sm leading-snug text-fg-dim">
                {a.statements.map((t, i) => <li key={i} className="border-l border-line-bright pl-3">{t}</li>)}
              </ul>
              {a.uncertainties.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs leading-snug text-caution">
                  {a.uncertainties.map((u, i) => <li key={i} className="border-l border-caution/50 pl-3">{u}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={`disagreements · ${file.disagreements.length}`}
        aside={<span className="num text-2xs text-fg-mute">index {file.disagreement_index.value.toFixed(1)} / 100</span>} flush>
        {file.disagreements.length === 0 ? <Empty>Nothing was contested on this run.</Empty> : (
          <ul className="divide-y divide-line">
            {file.disagreements.map((g, i) => (
              <li key={i} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-fg">{g.by_codename}</span>
                  <span className="text-2xs uppercase tracking-[0.12em] text-fg-mute">{g.by}</span>
                  <Tag tone={SEV_TONE[g.severity] ?? 'caution'}>{g.severity}</Tag>
                  <Tag>{g.kind.replace(/_/g, ' ')}</Tag>
                  <Tag tone={g.resolution === 'rebutted' ? 'support' : 'objection'}>{g.resolution}</Tag>
                  <span className="num ml-auto text-2xs text-fg-mute">against {g.target_id}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-fg-dim">{g.argument}</p>
                {g.settles_when !== null && <p className="mt-1.5 text-xs leading-relaxed text-fg-mute">settles when: {g.settles_when}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="final result">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          <Metric label="recommendation" value={file.final.action_band.replace(/_/g, ' ')} tone={BAND_TONE[file.final.action_band] ?? 'neutral'} mono={false} />
          <Metric label="confidence" value={file.final.confidence === null ? 'withheld' : file.final.confidence.toFixed(2)}
            tone={file.final.confidence === null ? 'block' : 'support'} mono={file.final.confidence !== null}
            sub={file.final.confidence === null ? file.final.confidence_blocked_reason ?? 'reason not recorded' : undefined} />
          <Metric label="urgency" value={file.final.urgency} mono={false} sub={`review by ${file.final.review_by.slice(0, 10)}`} />
          <Metric label="owner role" value={file.final.owner_role} mono={false} sub={`decided by ${file.final.decided_by.replace(/_/g, ' ')}`} />
        </div>
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Section title="what the record supports" items={file.final.rationale} empty="Nothing was asserted." />
          <Section title="what it does not support" items={file.final.unresolved_objections} empty="No objection was left unresolved." tone="objection" />
          <Section title="gates and caps"
            items={[...file.final.gates_failed.map((g) => `gate failed: ${g}`), ...file.final.caps_applied.map((c) => `cap applied: ${c}`)]}
            empty="No gate reduced this recommendation." tone="caution" />
          <Section title="recommended actions"
            items={file.final.actions.map((a) => `${a.class} — ${a.text} (owner: ${a.owner_role}, due ${a.due.slice(0, 10)})`)}
            empty="None. The band does not authorise action." tone="support" />
        </div>
      </Panel>

      <Panel title="human ruling">
        {file.human === null ? (
          <Empty>None recorded. This is a recommendation, not a decision.</Empty>
        ) : (
          <div className="divide-y divide-line">
            <Row k="verdict" v={`${file.human.verdict} at ${stamp(file.human.at)}`} />
            <Row k="band settled on" v={`${file.human.band} (system recommended ${file.final.action_band})`} />
            <Row k="note" v={file.human.note.trim().length === 0 ? 'none recorded' : file.human.note} />
          </div>
        )}
      </Panel>
    </Screen>
  );
}

function Section({ title, items, empty, tone = 'neutral' }: { title: string; items: string[]; empty: string; tone?: Tone }) {
  const border = tone === 'objection' ? 'border-objection/50' : tone === 'caution' ? 'border-caution/50' : tone === 'support' ? 'border-support/50' : 'border-line-bright';
  return (
    <div>
      <div className="label">{title}</div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs italic leading-relaxed text-fg-mute">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-fg-dim">
          {items.map((t, i) => <li key={i} className={`border-l pl-3 ${border}`}>{t}</li>)}
        </ul>
      )}
    </div>
  );
}

function Screen({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="kicker">case file · {id}</div>
        <h1 className="mt-1 text-3xl font-light tracking-tight">Case File</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-dim">
          The whole record of one investigation, in the order it happened. This is the document a human would
          be asked to defend later, so it is downloadable as it stands rather than summarised on the way out.
        </p>
      </div>
      {children}
    </div>
  );
}
