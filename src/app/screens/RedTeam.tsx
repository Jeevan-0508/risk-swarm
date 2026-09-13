/**
 * SCREEN 06 - RED TEAM. The adversarial pass, and the gates enforced elsewhere in the pipeline. Checks
 * that live in the challenger or the scorer are shown here by reference, never re-run: a second
 * implementation of a gate is a second answer, and the audit trail can only survive one.
 */
import type { ReactNode } from 'react';
import type { RedTeamFinding } from '@core/domain/model';
import { RED_TEAM_CHECKS } from '@core/agents/redteam';
import { useSession } from '@app/store/session';
import { Empty, Metric, Panel, Row, SEVERITY_TONE, Tag, type Tone } from '@app/ui/kit';

const VERDICT_TONE: Record<string, Tone> = { pass: 'support', pass_with_findings: 'caution', fail: 'block' };
const VERDICT_TEXT: Record<string, string> = {
  pass: 'No standing check matched. That is "no known defect", not "sound".',
  pass_with_findings: 'Findings raised but none blocking. Published with the objections attached.',
  fail: 'Blocking findings present. The orchestrator sent the run back rather than publish it.',
};

export function RedTeam() {
  const { active } = useSession();
  const run = active();
  const result = run?.result ?? null;

  if (result === null) {
    return (
      <Screen>
        <Panel title="adversarial review"><Empty>No investigation loaded. Run one from the Command Center.</Empty></Panel>
      </Screen>
    );
  }

  const rt = result.outputs.red_team;
  const score = result.outputs.decision.score;
  const challenger = result.outputs.challenger;
  const byClass = new Map<string, RedTeamFinding[]>();
  for (const f of rt.findings) byClass.set(f.finding_class, [...(byClass.get(f.finding_class) ?? []), f]);
  const blocking = rt.findings.filter((f) => f.severity === 'blocking');
  const fpGates = challenger.total_false_positive_gates;
  const fpUngated = challenger.ungated_false_positives;
  const minSources = score.policy.min_independent_sources;

  return (
    <Screen>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Metric label="verdict" value={rt.verdict.replace(/_/g, ' ')} tone={VERDICT_TONE[rt.verdict]} sub={VERDICT_TEXT[rt.verdict]} mono={false} />
        <Metric label="checks run" value={rt.checks_run} sub={`${RED_TEAM_CHECKS.length} standing checks, named below`} />
        <Metric label="findings" value={rt.findings.length} tone={rt.findings.length > 0 ? 'objection' : 'support'} />
        <Metric label="blocking" value={blocking.length} tone={blocking.length > 0 ? 'block' : 'support'} sub="each one forces rework or suppresses confidence" />
      </div>

      {rt.rework_reason !== null && (
        <div className="hair border-block/60 bg-block/5 p-4">
          <p className="label text-block">rework demanded</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-dim">{rt.rework_reason}</p>
          <p className="num mt-2 text-2xs text-fg-mute">
            attempts {result.attempts} · rework history {result.rework_history.length === 0 ? 'none recorded' : result.rework_history.length}
          </p>
        </div>
      )}

      <Panel title="the standing checks" aside={<span className="text-2xs text-fg-mute">every check runs on every investigation</span>} flush>
        <ul className="divide-y divide-line">
          {RED_TEAM_CHECKS.map((c) => {
            const hits = byClass.get(c.finding_class) ?? [];
            const worst = hits.some((f) => f.severity === 'blocking') ? 'block' : hits.length > 0 ? 'objection' : 'support';
            return (
              <li key={c.n} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="num text-2xs text-fg-mute">{String(c.n).padStart(2, '0')}</span>
                  <span className="text-sm text-fg">{c.name}</span>
                  <Tag tone={worst as Tone}>{hits.length === 0 ? 'nothing matched' : `${hits.length} finding${hits.length === 1 ? '' : 's'}`}</Tag>
                  <span className="num ml-auto text-2xs text-fg-mute">{c.finding_class}</span>
                </div>
                <p className="mt-1 text-xs leading-snug text-fg-mute">{c.looks_for}</p>
                {hits.map((f) => (
                  <div key={f.id} className={`mt-2 border-l pl-3 ${f.severity === 'blocking' ? 'border-block/60' : 'border-objection/50'}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-2xs text-fg-mute">{f.id}</span>
                      <Tag tone={SEVERITY_TONE[f.severity.toUpperCase()] ?? 'objection'}>{f.severity}</Tag>
                      <span className="num text-2xs text-fg-mute">against {f.target_id}</span>
                      <Tag tone={f.resolution === 'rebutted' ? 'support' : 'objection'}>{f.resolution}</Tag>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-fg-dim">{f.argument}</p>
                    <p className="mt-1.5 text-xs leading-snug text-fg-mute">clears when: {f.clears_when}</p>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="gates enforced elsewhere in the pipeline"
        aside={<span className="text-2xs text-fg-mute">shown by reference · not re-evaluated here</span>}>
        <div className="divide-y divide-line">
          <Row k="Evidence independence" tone={score.independent_evidence_count >= minSources ? 'support' : 'block'}
            v={`${score.independent_evidence_count} independent cluster(s) vs policy minimum ${minSources} — enforced by the challenger and the scorer`} />
          <Row k="False-positive risk" tone={fpUngated > 0 ? 'objection' : 'support'}
            v={`${fpUngated} of ${fpGates} documented false-positive gate(s) not ruled out — enforced by the challenger against the taxonomy`} />
          <Row k="Escalation validity" tone={score.gates_failed.length > 0 ? 'caution' : 'support'}
            v={`band ${score.action_band}; ${score.gates_failed.length} gate(s) failed, ${score.caps_applied.length} cap(s) applied — enforced by the scoring ladder`} />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-fg-mute">
          These three are checked where the data lives, not in the red team. Duplicating them here would
          produce a second answer to the same question, and an audit trail can only carry one.
        </p>
        {score.gates_failed.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs leading-snug text-fg-dim">
            {score.gates_failed.map((g, i) => <li key={i} className="border-l border-caution/50 pl-3">{g}</li>)}
          </ul>
        )}
        {score.caps_applied.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs leading-snug text-fg-dim">
            {score.caps_applied.map((c, i) => <li key={i} className="border-l border-objection/50 pl-3">{c}</li>)}
          </ul>
        )}
      </Panel>

      <Panel title="what the red team does not claim">
        <ul className="space-y-2 text-sm leading-relaxed text-fg-dim">
          {rt.uncertainties.map((u, i) => <li key={i} className="border-l border-line-bright pl-3">{u}</li>)}
        </ul>
      </Panel>
    </Screen>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Red Team</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-dim">
          A dedicated agent attacks the finding before anyone acts on it: fabricated citations, one event
          read as a trend, a single outlet supplying the picture, a conclusion drawn over data nobody
          measured. Blocking findings send the run back instead of appearing as a footnote.
        </p>
      </div>
      {children}
    </div>
  );
}
