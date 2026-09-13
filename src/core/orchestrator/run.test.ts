import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { investigate } from './run';
import { BudgetExceededError } from '../agents/harness';

const NOW = '2026-09-13T00:00:00.000Z';
const OPTIONS = {
  loader: createFileLoader('public/snapshots'),
  run_id: 'RUN-T',
  now: NOW,
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
};

const run = () => investigate({ ...OPTIONS });

describe('a full investigation over the pinned snapshots', () => {
  it('reaches the honest answer rather than the impressive one', async () => {
    const r = await run();
    const d = r.outputs.decision.decision;
    // 12 signals, 12 distinct events, 8 publishers, no operational data: the evidence supports
    // watching and investigating, and nothing here supports escalation.
    expect(d.action_band).toBe('MONITOR');
    expect(d.confidence).toBeNull();
    expect(d.confidence_blocked_reason).not.toBeNull();
    expect(d.gates_failed.length).toBeGreaterThan(0);
  });

  it('runs every agent exactly once when nothing needs rework', async () => {
    const r = await run();
    expect(r.log.map((l) => l.phase)).toEqual(['discover', 'deduplicate', 'analyse', 'govern', 'challenge', 'red_team', 'decide']);
    expect(r.attempts).toBe(1);
    expect(r.spent.agent_call).toBe(7);
  });

  it('produces a graph that is intact, acyclic and traceable from the decision back to evidence', async () => {
    const r = await run();
    const d = r.outputs.decision.decision;
    expect(r.graph.isIntact()).toBe(true);
    expect(r.graph.cycles()).toEqual([]);
    const chain = r.graph.evidenceChain(d.id);
    expect(chain.length).toBeGreaterThan(0);
    for (const e of chain) expect(e.url === null || e.url.startsWith('http')).toBe(true);
  });

  it('preserves disagreement instead of averaging it away', async () => {
    const r = await run();
    expect(r.outputs.challenger.findings.length).toBeGreaterThan(0);
    expect(r.outputs.red_team.verdict).toBe('fail');
    expect(r.outputs.decision.decision.unresolved_objections.length).toBeGreaterThan(0);
    expect(r.outputs.decision.score.disagreement_index.value).toBeGreaterThan(0);
  });

  it('does not loop on a defect that re-running cannot fix', async () => {
    const r = await run();
    // The red team fails this run on missing operational evidence. That is a fact about the world,
    // so the orchestrator publishes it rather than retrying until it goes away.
    expect(r.outputs.red_team.findings.some((f) => f.finding_class === 'missing_evidence')).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.rework_history).toEqual([]);
  });

  it('is byte-for-byte reproducible with no network and no key', async () => {
    const a = await run();
    const b = await run();
    expect(JSON.stringify(b.graph.toJSON())).toBe(JSON.stringify(a.graph.toJSON()));
    expect(b.outputs.decision.decision.severity_score).toBe(a.outputs.decision.decision.severity_score);
  });

  it('stops rather than overspending when the budget is too small for the work', async () => {
    await expect(investigate({ ...OPTIONS, budget: { retrieval: 5 } })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('escalates its governance duty when the caller says no human will review', async () => {
    const r = await investigate({ ...OPTIONS, automatedAction: true });
    expect(r.outputs.governance.implications.some((i) => i.requirement_id === 'GDPR-22' && i.applicability === 'established')).toBe(true);
  });

  it('finds no risk to report when the window contains nothing', async () => {
    const r = await investigate({ ...OPTIONS, scope: { ...OPTIONS.scope, from: '2019-01-01T00:00:00.000Z', to: '2019-02-01T00:00:00.000Z' } });
    expect(r.outputs.scout.findings).toHaveLength(0);
    expect(r.outputs.analyst.findings).toHaveLength(0);
    expect(r.outputs.decision.decision.action_band).toBe('NOTE');
    expect(r.outputs.decision.decision.rationale.join(' ')).toContain('no risk statement is made');
    expect(r.outputs.scout.uncertainties.join(' ')).toContain('absence of evidence must not be read as evidence of absence');
  });
});
