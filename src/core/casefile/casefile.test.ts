import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { investigate, type RunResult } from '../orchestrator/run';
import { buildCaseFile, caseFileHtml, type CaseFileMeta, type RosterEntry } from './casefile';

const ASKED = '2026-09-13T00:00:00.000Z';
const DONE = '2026-09-13T00:00:04.500Z';

const run = () =>
  investigate({
    loader: createFileLoader('public/snapshots'),
    run_id: 'RUN-CASE',
    now: ASKED,
    question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
    scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  });

/** Mirrors what the app passes in. Naming lives with the caller, so the roster is part of the contract. */
const roster = (result: RunResult): RosterEntry[] => [
  { id: 'scout', label: 'SCOUT', codename: 'HERMES', remit: 'Retrieves signals.', statements: [`${result.outputs.scout.stats.returned} signal(s)`], uncertainties: result.outputs.scout.uncertainties },
  { id: 'intelligence', label: 'INTELLIGENCE', codename: 'ATHENA', remit: 'Deduplicates.', statements: [`${result.outputs.intelligence.clusters.length} cluster(s)`], uncertainties: result.outputs.intelligence.uncertainties },
  { id: 'risk_analyst', label: 'RISK ANALYST', codename: 'APOLLO', remit: 'Forms hypotheses.', statements: [`${result.outputs.analyst.findings.length} hypothesis/es`], uncertainties: result.outputs.analyst.uncertainties },
  { id: 'governance_officer', label: 'GOVERNANCE OFFICER', codename: 'ZEUS', remit: 'Maps obligations.', statements: [`${result.outputs.governance.implications.length} obligation(s)`], uncertainties: result.outputs.governance.uncertainties },
  { id: 'challenger', label: 'CHALLENGER', codename: 'ARES', remit: 'Argues the benign case.', statements: [`${result.outputs.challenger.findings.length} challenge(s)`], uncertainties: result.outputs.challenger.uncertainties },
  { id: 'red_team', label: 'RED TEAM', codename: 'HADES', remit: 'Attacks the investigation.', statements: [`verdict ${result.outputs.red_team.verdict}`], uncertainties: result.outputs.red_team.uncertainties },
  { id: 'decision_engine', label: 'DECISION ENGINE', codename: 'HEPHAESTUS', remit: 'Assembles the recommendation.', statements: [result.outputs.decision.decision.action_band], uncertainties: result.outputs.decision.uncertainties },
];

const meta = (result: RunResult, over: Partial<CaseFileMeta> = {}): CaseFileMeta => ({
  mode: 'DEMO',
  status: 'complete',
  asked_at: ASKED,
  completed_at: DONE,
  scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01', to: '2026-09-01' },
  human: null,
  roster: roster(result),
  ...over,
});

describe('case file', () => {
  it('stamps both times and the wait between them', async () => {
    const r = await run();
    const file = buildCaseFile(r, meta(r));
    expect(file.asked_at).toBe(ASKED);
    expect(file.completed_at).toBe(DONE);
    expect(file.elapsed_ms).toBe(4500);
  });

  it('leaves elapsed null rather than guessing when no completion was recorded', async () => {
    const r = await run();
    const file = buildCaseFile(r, meta(r, { completed_at: null }));
    expect(file.elapsed_ms).toBe(null);
  });

  it('walks the run log in order, one step per phase the run really recorded', async () => {
    const r = await run();
    const file = buildCaseFile(r, meta(r));
    expect(file.timeline.length).toBe(r.log.length);
    expect(file.engine_ms).toBe(r.log.reduce((a, l) => a + l.ms, 0));
    for (let i = 0; i < r.log.length; i += 1) {
      expect(file.timeline[i]!.phase).toBe(r.log[i]!.phase);
      expect(file.timeline[i]!.n).toBe(i + 1);
    }
  });

  it('gives every agent a turn, in roster order, with the stance the scorer recorded', async () => {
    const r = await run();
    const file = buildCaseFile(r, meta(r));
    expect(file.agents.length).toBe(7);
    expect(file.agents[0]!.codename).toBe('HERMES');
    expect(file.agents[6]!.codename).toBe('HEPHAESTUS');
    const positions = r.outputs.decision.scoring_input.agent_positions;
    for (const p of positions) {
      const turn = file.agents.find((a) => a.agent === p.agent);
      expect(turn?.stance?.confidence).toBe(p.confidence);
    }
  });

  it('attributes every disagreement to the agent that raised it', async () => {
    const r = await run();
    const file = buildCaseFile(r, meta(r));
    expect(file.disagreements.length).toBe(r.outputs.challenger.findings.length + r.outputs.red_team.findings.length);
    const raisers = new Set(file.disagreements.map((d) => d.by_codename));
    if (r.outputs.challenger.findings.length > 0) expect(raisers.has('ARES')).toBe(true);
    if (r.outputs.red_team.findings.length > 0) expect(raisers.has('HADES')).toBe(true);
    for (const f of r.outputs.red_team.findings) {
      expect(file.disagreements.some((d) => d.argument === f.argument && d.settles_when === f.clears_when)).toBe(true);
    }
  });

  it('copies the recommendation instead of re-deriving it', async () => {
    const r = await run();
    const d = r.outputs.decision.decision;
    const file = buildCaseFile(r, meta(r));
    expect(file.final.action_band).toBe(d.action_band);
    expect(file.final.severity_score).toBe(d.severity_score);
    expect(file.final.confidence).toBe(d.confidence);
    expect(file.disagreement_index.value).toBe(r.outputs.decision.score.disagreement_index.value);
    expect(file.brief).toContain(d.headline_risk);
  });

  it('renders one self-contained document with no unresolved value in it', async () => {
    const r = await run();
    const html = caseFileHtml(buildCaseFile(r, meta(r)));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('Problem statement');
    expect(html).toContain('What each agent said');
    expect(html).toContain('Disagreements');
    expect(html).toContain('Final result');
    expect(html).toContain(r.run_id);
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
    // Nothing to fetch: a document that reaches out is not an archive.
    expect(html).not.toContain('<script');
    expect(html).not.toContain('http://');
  });

  it('escapes a hostile string rather than letting it become markup', async () => {
    const r = await run();
    const hostile = '<img src=x onerror="alert(1)">';
    const html = caseFileHtml(buildCaseFile(r, meta(r, { human: { verdict: 'overridden', band: 'ESCALATE', note: hostile, at: DONE } })));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('records a human ruling beside the system band, never in place of it', async () => {
    const r = await run();
    const file = buildCaseFile(r, meta(r, { human: { verdict: 'overridden', band: 'ESCALATE', note: 'known offender', at: DONE } }));
    expect(file.human?.band).toBe('ESCALATE');
    expect(file.final.action_band).toBe(r.outputs.decision.decision.action_band);
    expect(caseFileHtml(file)).toContain('known offender');
  });
});
