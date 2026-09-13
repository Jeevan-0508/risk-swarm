/**
 * Brief renderer. Turns a finished run into markdown a human can paste into a ticket. It is a pure
 * projection: every figure is copied from the run, nothing is recomputed, and where the engine withheld
 * a number the brief says so rather than filling the gap.
 */
import type { RunResult } from '../orchestrator/run';

export interface BriefOptions {
  /** Recorded verbatim when a human has ruled on the recommendation. */
  human?: { verdict: string; band: string; note: string; at: string } | null;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function renderBrief(result: RunResult, options: BriefOptions = {}): string {
  const d = result.outputs.decision.decision;
  const score = result.outputs.decision.score;
  const rt = result.outputs.red_team;
  const challenger = result.outputs.challenger;
  const evidence = result.graph.all().filter((n) => n.kind === 'evidence');
  const incident = evidence.filter((e) => e.kind === 'evidence' && e.incident_claim);
  const L: string[] = [];

  L.push(`# ${d.headline_risk}`);
  L.push('');
  L.push(`**Recommendation:** ${d.action_band}  `);
  L.push(`**Severity:** ${d.severity_band} (${d.severity_score.toFixed(3)})  `);
  L.push(`**Confidence:** ${d.confidence === null ? `withheld — ${d.confidence_blocked_reason ?? 'reason not recorded'}` : d.confidence.toFixed(2)}  `);
  L.push(`**Urgency:** ${d.urgency}  `);
  L.push(`**Owner role:** ${d.owner_role}  `);
  L.push(`**Review by:** ${d.review_by}  `);
  L.push(`**Decided by:** ${d.decided_by}`);
  L.push('');
  L.push(`> ${result.question}`);
  L.push('');

  L.push('## What the record supports');
  for (const r of d.rationale) L.push(`- ${r}`);
  L.push('');

  L.push('## What it does not support');
  if (d.unresolved_objections.length === 0) L.push('- No objection was left unresolved.');
  for (const o of d.unresolved_objections) L.push(`- ${o}`);
  L.push('');

  L.push('## Gates and caps');
  if (score.gates_failed.length === 0 && score.caps_applied.length === 0) {
    L.push('- No gate reduced this recommendation.');
  }
  for (const g of score.gates_failed) L.push(`- Gate failed: ${g}`);
  for (const c of score.caps_applied) L.push(`- Cap applied: ${c}`);
  L.push('');

  L.push('## Adversarial review');
  L.push(`- Verdict: **${rt.verdict}** after ${rt.checks_run} standing checks.`);
  L.push(`- ${rt.findings.length} finding(s), ${rt.findings.filter((f) => f.severity === 'blocking').length} blocking.`);
  for (const f of rt.findings) L.push(`  - [${f.severity}] ${f.finding_class}: ${f.argument} _Clears when: ${f.clears_when}_`);
  L.push('');

  L.push('## Disagreement');
  L.push(`- Index ${score.disagreement_index.value.toFixed(1)} / 100.`);
  for (const t of score.disagreement_index.terms) {
    L.push(`  - ${t.key}: ${t.contribution.toFixed(2)} of ${t.weight.toFixed(2)} — ${t.explanation}`);
  }
  L.push(`- ${challenger.findings.filter((c) => c.resolution === 'open').length} open challenge(s) of ${challenger.findings.length} raised.`);
  L.push(`- ${challenger.ungated_false_positives} of ${challenger.total_false_positive_gates} documented false-positive gate(s) not ruled out.`);
  L.push('');

  L.push('## Recommended actions');
  if (result.outputs.decision.actions.length === 0) L.push('- None. The band does not authorise action.');
  for (const a of result.outputs.decision.actions) {
    L.push(`- **${a.class}** — ${a.text} _(owner: ${a.owner_role}, due ${a.due}${a.countermeasure_id === null ? '' : `, countermeasure ${a.countermeasure_id}`})_`);
  }
  L.push('');

  if (d.regulatory_implications.length > 0) {
    L.push('## Regulatory implications');
    for (const r of d.regulatory_implications) {
      L.push(`- **${r.framework} ${r.ref}** (${r.applicability}) — ${r.title}`);
      L.push(`  - ${r.reasoning}`);
      L.push(`  - Citation: ${r.citation}${r.url === null ? '' : ` <${r.url}>`}`);
    }
    L.push('');
  }

  L.push('## Evidence base');
  L.push(`- ${evidence.length} evidence object(s): ${incident.length} incident claim(s), ${evidence.length - incident.length} structural or regulatory citation(s).`);
  L.push(`- ${score.independent_evidence_count} independent cluster(s) against a policy minimum of ${score.policy.min_independent_sources}.`);
  L.push(`- ${pct(result.benign_category_share)} of surviving signals re-derive to the benign insolvency category.`);
  L.push('');
  for (const e of evidence) {
    if (e.kind !== 'evidence') continue;
    L.push(`- \`${e.id}\` T${e.tier} ${e.source} — ${e.title}${e.url === null ? '' : ` <${e.url}>`}`);
  }
  L.push('');

  L.push('## Provenance');
  L.push(`- Run \`${result.run_id}\`, ${result.attempts} attempt(s), ${result.log.length} phase(s).`);
  L.push(`- Graph: ${result.graph.all().length} node(s), ${result.graph.edges().length} edge(s), ${result.graph.cycles().length} cycle(s).`);
  L.push(`- Budget spent: ${result.spent.agent_call} agent call(s), ${result.spent.retrieval} retrieval(s), ${result.spent.tokens} model token(s).`);
  L.push('');

  if (options.human != null) {
    L.push('## Human ruling');
    L.push(`- Verdict: **${options.human.verdict}** at ${options.human.at}.`);
    L.push(`- Band the human settled on: **${options.human.band}** (system recommended **${d.action_band}**).`);
    L.push(`- Note: ${options.human.note.trim().length === 0 ? 'none recorded' : options.human.note}`);
    L.push('');
  } else {
    L.push('## Human ruling');
    L.push('- None recorded. This is a recommendation, not a decision.');
    L.push('');
  }

  return L.join('\n');
}
