/**
 * Case file. One finished run, assembled into the record a human would be asked to defend later: what was
 * asked and when, what the swarm actually did, what each agent said in turn, who disagreed with whom, and
 * what was recommended in the end.
 *
 * It is a projection, not a second opinion. Every judgement - band, severity, confidence, disagreement
 * index - is copied from the run, never recomputed. The only arithmetic here is over the run's own clock:
 * the wall-clock wait, the total of the per-phase timings, and the per-agent rollup of a log that can hold
 * more than one row per agent after rework. Agent naming is passed in as a roster rather than known here,
 * because a codename is a presentation concern and this module is not allowed to hold one.
 */
import type { RunResult } from '../orchestrator/run';
import { renderBrief } from '../brief/render';

export interface RosterEntry {
  id: string;
  label: string;
  codename: string;
  remit: string;
  /** What the agent published, already summarised by the caller. Never a narration of reasoning. */
  statements: string[];
  uncertainties: string[];
}

export interface HumanRuling {
  verdict: string;
  band: string;
  note: string;
  at: string;
}

export interface CaseFileMeta {
  mode: string;
  status: string;
  /** When the human asked. */
  asked_at: string;
  /** When the run settled. Null for a record written before this was tracked. */
  completed_at: string | null;
  scope: { geo: string[]; mode: string[]; from: string; to: string } | null;
  human: HumanRuling | null;
  roster: RosterEntry[];
}

export interface TimelineStep {
  n: number;
  phase: string;
  agent: string;
  label: string;
  codename: string;
  attempt: number;
  ms: number;
  findings: number;
  reasoning_status: string;
  note: string | null;
}

export interface AgentTurn {
  agent: string;
  label: string;
  codename: string;
  remit: string;
  statements: string[];
  uncertainties: string[];
  /** The stance the scorer recorded before reconciliation, when this agent declared one. */
  stance: { reasoning_status: string; confidence: number } | null;
  ms: number;
  findings: number;
}

export interface Disagreement {
  by: string;
  by_codename: string;
  kind: string;
  severity: string;
  target_id: string;
  argument: string;
  resolution: string;
  /** What would settle it: a red-team finding's clears_when, or the challenger's benign reading. */
  settles_when: string | null;
}

export interface CaseFile {
  run_id: string;
  question: string;
  mode: string;
  status: string;
  asked_at: string;
  completed_at: string | null;
  /** Wall-clock wait, when both stamps exist. Distinct from engine_ms, which excludes the paced reveal. */
  elapsed_ms: number | null;
  engine_ms: number;
  scope: CaseFileMeta['scope'];
  problem: {
    question: string;
    headline_risk: string;
    attempts: number;
    rework_history: string[];
  };
  timeline: TimelineStep[];
  agents: AgentTurn[];
  disagreements: Disagreement[];
  disagreement_index: { value: number; terms: Array<{ key: string; weight: number; normalised: number; contribution: number; explanation: string }> };
  final: {
    action_band: string;
    severity_band: string;
    severity_score: number;
    confidence: number | null;
    confidence_blocked_reason: string | null;
    urgency: string;
    owner_role: string;
    review_by: string;
    decided_by: string;
    rationale: string[];
    unresolved_objections: string[];
    gates_failed: string[];
    caps_applied: string[];
    actions: Array<{ class: string; text: string; owner_role: string; due: string }>;
  };
  human: HumanRuling | null;
  /** The ticket-ready brief, verbatim from the one renderer that produces it. */
  brief: string;
}

export function buildCaseFile(result: RunResult, meta: CaseFileMeta): CaseFile {
  const d = result.outputs.decision.decision;
  const score = result.outputs.decision.score;
  const byId = new Map(meta.roster.map((r) => [r.id, r]));
  const name = (agent: string) => byId.get(agent) ?? { id: agent, label: agent, codename: agent, remit: '', statements: [], uncertainties: [] };
  const positions = new Map(result.outputs.decision.scoring_input.agent_positions.map((p) => [String(p.agent), p]));
  const phaseOf = new Map<string, { ms: number; findings: number }>();
  for (const l of result.log) {
    const prev = phaseOf.get(l.agent);
    phaseOf.set(l.agent, { ms: (prev?.ms ?? 0) + l.ms, findings: l.findings });
  }

  const timeline: TimelineStep[] = result.log.map((l, i) => ({
    n: i + 1,
    phase: l.phase,
    agent: l.agent,
    label: name(l.agent).label,
    codename: name(l.agent).codename,
    attempt: l.attempt,
    ms: l.ms,
    findings: l.findings,
    reasoning_status: l.reasoning_status,
    note: l.note,
  }));

  const agents: AgentTurn[] = meta.roster.map((r) => {
    const p = positions.get(r.id);
    return {
      agent: r.id,
      label: r.label,
      codename: r.codename,
      remit: r.remit,
      statements: r.statements,
      uncertainties: r.uncertainties,
      stance: p === undefined ? null : { reasoning_status: String(p.reasoning_status), confidence: p.confidence },
      ms: phaseOf.get(r.id)?.ms ?? 0,
      findings: phaseOf.get(r.id)?.findings ?? 0,
    };
  });

  const disagreements: Disagreement[] = [
    ...result.outputs.challenger.findings.map((c) => ({
      by: name('challenger').label,
      by_codename: name('challenger').codename,
      kind: c.basis,
      severity: c.severity,
      target_id: c.target_id,
      argument: c.argument,
      resolution: c.resolution,
      settles_when: c.alternative_explanation,
    })),
    ...result.outputs.red_team.findings.map((f) => ({
      by: name('red_team').label,
      by_codename: name('red_team').codename,
      kind: f.finding_class,
      severity: f.severity,
      target_id: f.target_id,
      argument: f.argument,
      resolution: f.resolution,
      settles_when: f.clears_when,
    })),
  ];

  return {
    run_id: result.run_id,
    question: result.question,
    mode: meta.mode,
    status: meta.status,
    asked_at: meta.asked_at,
    completed_at: meta.completed_at,
    elapsed_ms: elapsedMs(meta.asked_at, meta.completed_at),
    engine_ms: result.log.reduce((a, l) => a + l.ms, 0),
    scope: meta.scope,
    problem: {
      question: result.question,
      headline_risk: d.headline_risk,
      attempts: result.attempts,
      rework_history: result.rework_history,
    },
    timeline,
    agents,
    disagreements,
    disagreement_index: score.disagreement_index,
    final: {
      action_band: d.action_band,
      severity_band: d.severity_band,
      severity_score: d.severity_score,
      confidence: d.confidence,
      confidence_blocked_reason: d.confidence_blocked_reason,
      urgency: d.urgency,
      owner_role: d.owner_role,
      review_by: d.review_by,
      decided_by: d.decided_by,
      rationale: d.rationale,
      unresolved_objections: d.unresolved_objections,
      gates_failed: score.gates_failed,
      caps_applied: score.caps_applied,
      actions: result.outputs.decision.actions.map((a) => ({ class: a.class, text: a.text, owner_role: a.owner_role, due: a.due })),
    },
    human: meta.human,
    brief: renderBrief(result, { human: meta.human }),
  };
}

/**
 * The wait between asking and answering. Null rather than zero when it cannot be known: a record with no
 * completion stamp, or one whose stamps run backwards, has no duration to report and inventing one would be
 * worse than leaving the field blank. Exported so the history list and the case file cannot disagree.
 */
export function elapsedMs(asked: string, completed: string | null): number | null {
  if (completed === null) return null;
  const ms = Date.parse(completed) - Date.parse(asked);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const stamp = (iso: string | null) => (iso === null ? 'not recorded' : iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z'));

const secs = (ms: number | null) => (ms === null ? 'not recorded' : `${(ms / 1000).toFixed(1)}s`);

/**
 * One self-contained document: no stylesheet, no script, no font to fetch. That is what makes it usable
 * as an .html download, as a Word-openable .doc, and as a print-to-PDF source without a print pipeline.
 */
export function caseFileHtml(file: CaseFile): string {
  const H: string[] = [];
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const list = (items: string[], empty: string) =>
    items.length === 0 ? `<p class="empty">${esc(empty)}</p>` : `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

  H.push('<!doctype html><html lang="en"><head><meta charset="utf-8">');
  H.push(`<title>${esc(file.run_id)} case file</title>`);
  H.push(`<style>
    body { font-family: Georgia, 'Times New Roman', serif; color: #14171c; max-width: 46em; margin: 2.5em auto; padding: 0 1.5em; line-height: 1.55; }
    h1 { font-size: 1.7em; font-weight: normal; margin: 0 0 .2em; }
    h2 { font-size: 1.15em; font-weight: normal; text-transform: uppercase; letter-spacing: .14em; border-bottom: 1px solid #14171c; padding-bottom: .3em; margin: 2.2em 0 .9em; }
    h3 { font-size: 1em; margin: 1.6em 0 .3em; }
    .kicker { font-family: monospace; font-size: .72em; letter-spacing: .16em; text-transform: uppercase; color: #5c6470; }
    .lede { color: #3d444e; font-style: italic; }
    table { border-collapse: collapse; width: 100%; font-size: .88em; margin: .6em 0; }
    th, td { border: 1px solid #d3d7dd; padding: .4em .6em; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: normal; white-space: nowrap; }
    ul { margin: .4em 0 .9em; padding-left: 1.3em; }
    li { margin: .2em 0; }
    .empty { color: #5c6470; font-style: italic; }
    .mono { font-family: monospace; font-size: .85em; }
    .turn { border-left: 2px solid #14171c; padding-left: .9em; margin: 1.4em 0; }
    pre { white-space: pre-wrap; font-family: monospace; font-size: .78em; background: #f7f8f9; border: 1px solid #d3d7dd; padding: 1em; }
    footer { margin-top: 3em; border-top: 1px solid #d3d7dd; padding-top: .8em; font-size: .78em; color: #5c6470; }
    @media print { body { margin: 0; max-width: none; } h2 { page-break-after: avoid; } .turn, table { page-break-inside: avoid; } }
  </style></head><body>`);

  H.push(`<div class="kicker">RISK//SWARM case file · run ${esc(file.run_id)}</div>`);
  H.push(`<h1>${esc(file.problem.headline_risk)}</h1>`);
  H.push(`<p class="lede">${esc(file.question)}</p>`);
  H.push('<table>');
  H.push(row('asked at', stamp(file.asked_at)));
  H.push(row('result at', stamp(file.completed_at)));
  H.push(row('elapsed', secs(file.elapsed_ms)));
  H.push(row('engine time', `${file.engine_ms} ms across ${file.timeline.length} phase(s)`));
  H.push(row('mode', file.mode));
  H.push(row('status', file.status));
  if (file.scope !== null) {
    H.push(row('scope', `${file.scope.geo.join(', ')} · ${file.scope.mode.join(', ')} · ${file.scope.from} to ${file.scope.to}`));
  }
  H.push('</table>');

  H.push('<h2>Problem statement</h2>');
  H.push(`<p>${esc(file.problem.question)}</p>`);
  H.push(`<p>The swarm ran ${file.problem.attempts} attempt(s).</p>`);
  H.push(list(file.problem.rework_history, 'No phase was sent back for rework.'));

  H.push('<h2>What it did</h2>');
  H.push('<table><tr><th>#</th><th>phase</th><th>agent</th><th>attempt</th><th>ms</th><th>findings</th><th>status</th></tr>');
  for (const s of file.timeline) {
    H.push(
      `<tr><td>${s.n}</td><td>${esc(s.phase)}</td><td>${esc(s.codename)} · ${esc(s.label)}</td><td>${s.attempt}</td><td>${s.ms}</td><td>${s.findings}</td><td>${esc(s.reasoning_status)}${s.note === null ? '' : ` — ${esc(s.note)}`}</td></tr>`,
    );
  }
  H.push('</table>');

  H.push('<h2>What each agent said</h2>');
  for (const a of file.agents) {
    H.push('<div class="turn">');
    H.push(`<h3>${esc(a.codename)} <span class="mono">${esc(a.label)}</span></h3>`);
    H.push(`<p class="empty">${esc(a.remit)}</p>`);
    H.push(list(a.statements, 'Published nothing on this run.'));
    if (a.stance !== null) {
      H.push(`<p class="mono">stance: ${esc(a.stance.reasoning_status)} · confidence ${a.stance.confidence.toFixed(2)}</p>`);
    }
    if (a.uncertainties.length > 0) {
      H.push('<p class="mono">declared uncertainties</p>');
      H.push(list(a.uncertainties, ''));
    }
    H.push('</div>');
  }

  H.push('<h2>Disagreements</h2>');
  H.push(`<p>Disagreement index ${file.disagreement_index.value.toFixed(1)} of 100.</p>`);
  H.push('<table><tr><th>term</th><th>weight</th><th>contribution</th><th>why</th></tr>');
  for (const t of file.disagreement_index.terms) {
    H.push(`<tr><td class="mono">${esc(t.key)}</td><td>${t.weight.toFixed(2)}</td><td>${t.contribution.toFixed(2)}</td><td>${esc(t.explanation)}</td></tr>`);
  }
  H.push('</table>');
  if (file.disagreements.length === 0) {
    H.push('<p class="empty">Nothing was contested on this run.</p>');
  }
  for (const g of file.disagreements) {
    H.push('<div class="turn">');
    H.push(`<h3>${esc(g.by_codename)} · ${esc(g.by)}</h3>`);
    H.push(`<p class="mono">${esc(g.kind)} · ${esc(g.severity)} · against ${esc(g.target_id)} · ${esc(g.resolution)}</p>`);
    H.push(`<p>${esc(g.argument)}</p>`);
    if (g.settles_when !== null) H.push(`<p class="empty">Settles when: ${esc(g.settles_when)}</p>`);
    H.push('</div>');
  }

  H.push('<h2>Final result</h2>');
  H.push('<table>');
  H.push(row('recommendation', file.final.action_band));
  H.push(row('severity', `${file.final.severity_band} (${file.final.severity_score.toFixed(3)})`));
  H.push(row('confidence', file.final.confidence === null ? `withheld — ${file.final.confidence_blocked_reason ?? 'reason not recorded'}` : file.final.confidence.toFixed(2)));
  H.push(row('urgency', file.final.urgency));
  H.push(row('owner role', file.final.owner_role));
  H.push(row('review by', file.final.review_by));
  H.push(row('decided by', file.final.decided_by));
  H.push('</table>');
  H.push('<h3>What the record supports</h3>');
  H.push(list(file.final.rationale, 'Nothing was asserted.'));
  H.push('<h3>What it does not support</h3>');
  H.push(list(file.final.unresolved_objections, 'No objection was left unresolved.'));
  H.push('<h3>Gates and caps</h3>');
  H.push(list([...file.final.gates_failed.map((g) => `Gate failed: ${g}`), ...file.final.caps_applied.map((c) => `Cap applied: ${c}`)], 'No gate reduced this recommendation.'));
  H.push('<h3>Recommended actions</h3>');
  H.push(list(file.final.actions.map((a) => `${a.class} — ${a.text} (owner: ${a.owner_role}, due ${a.due.slice(0, 10)})`), 'None. The band does not authorise action.'));

  H.push('<h2>Human ruling</h2>');
  if (file.human === null) {
    H.push('<p class="empty">None recorded. This is a recommendation, not a decision.</p>');
  } else {
    H.push('<table>');
    H.push(row('verdict', `${file.human.verdict} at ${stamp(file.human.at)}`));
    H.push(row('band settled on', `${file.human.band} (system recommended ${file.final.action_band})`));
    H.push(row('note', file.human.note.trim().length === 0 ? 'none recorded' : file.human.note));
    H.push('</table>');
  }

  H.push('<h2>Appendix — decision brief</h2>');
  H.push(`<pre>${esc(file.brief)}</pre>`);

  H.push('<footer>Generated by RISK//SWARM from the stored run record. Every figure is copied from the run; none is recomputed here.</footer>');
  H.push('</body></html>');
  return H.join('\n');
}
