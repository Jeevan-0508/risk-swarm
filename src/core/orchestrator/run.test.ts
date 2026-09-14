import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { investigate } from './run';
import { BudgetExceededError } from '../agents/harness';
import { openPack, freightPack } from '../packs/registry';

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

  it('is byte-for-byte reproducible under an open pack too - parameterizing the engine cost no determinism', async () => {
    const open = () => investigate({ ...OPTIONS, run_id: 'RUN-T-OPEN', pack: openPack() });
    const a = await open();
    const b = await open();
    expect(JSON.stringify(b.graph.toJSON())).toBe(JSON.stringify(a.graph.toJSON()));
    expect(JSON.stringify(b.participation)).toBe(JSON.stringify(a.participation));
    expect(JSON.stringify(b.pack)).toBe(JSON.stringify(a.pack));
    expect(JSON.stringify(b.deliberation.events)).toBe(JSON.stringify(a.deliberation.events));
  });

  it('does not let one run\'s pack leak into the next, which is what a shared registry object would do', async () => {
    await investigate({ ...OPTIONS, run_id: 'RUN-T-OPEN-2', pack: openPack() });
    const back = await run();
    expect(back.pack.id).toBe(freightPack().id);
    expect(back.participation.every((d) => d.participating)).toBe(true);
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

  it('is bookkeeping-sound: SENTINEL finds no dangling citation or broken chain over what the agents actually produced', async () => {
    const r = await run();
    const blocked = r.sentinel.checks.filter((c) => c.status === 'BLOCKED');
    expect(blocked.map((c) => `${c.key}: ${c.detail}`)).toEqual([]);
    // The only known WARNING on this canonical run: two governance citations share a framework-level
    // eur-lex URL because AI Act and GDPR requirements are cited at the regulation, not the article -
    // a real, honestly-reported characteristic of the record, not a defect. Pinned so a *new*,
    // unexplained WARNING on a future change gets noticed rather than waved through.
    const warnings = r.sentinel.checks.filter((c) => c.status === 'WARNING');
    expect(warnings.map((c) => c.key)).toEqual(['duplicate_integrity']);
  });
});

describe('the knowledge pack a run loads decides what its agents can do, not what they conclude', () => {
  it('defaults to the freight pack, so every existing caller sees the same run it always saw', async () => {
    const r = await run();
    expect(r.pack.id).toBe('freight-risk');
    expect(r.participation.every((d) => d.participating)).toBe(true);
  });

  it('stands the analyst and the governance officer down for a question the open pack cannot cover, without touching the other five', async () => {
    const r = await investigate({
      ...OPTIONS,
      question: 'What is the mass of the black hole at the centre of the Milky Way?',
      pack: openPack(),
    });
    expect(r.pack.id).toBe('open');
    expect(r.outputs.analyst.reasoning_status).toBe('abstained');
    expect(r.outputs.analyst.confidence).toBe(0);
    expect(r.outputs.governance.reasoning_status).toBe('abstained');
    expect(r.log.find((l) => l.phase === 'analyse')!.note).toBe('abstained');
    expect(r.log.find((l) => l.phase === 'govern')!.note).toBe('abstained');
    expect(r.outputs.scout.agent).toBe('scout');
    expect(r.outputs.decision.decision.hypothesis_ids).toEqual([]);
    expect(r.graph.isIntact()).toBe(true);
  });

  it('retains signals the freight floor would have excluded, when the open pack sets no floor at all', async () => {
    const freight = await run();
    const open = await investigate({ ...OPTIONS, pack: openPack() });
    expect(open.outputs.scout.findings.length).toBeGreaterThanOrEqual(freight.outputs.scout.findings.length);
  });

  it('reads the benign baseline from the pack, and shares a category count of zero when the pack names no baseline', async () => {
    const r = await investigate({ ...OPTIONS, pack: openPack() });
    expect(r.benign_category_share).toBe(0);
  });

  it('keeps the graph acyclic and every citation resolvable even when two agents abstained', async () => {
    const r = await investigate({ ...OPTIONS, question: 'Explain quantum computing.', pack: openPack() });
    expect(r.graph.cycles()).toEqual([]);
    const blocked = r.sentinel.checks.filter((c) => c.status === 'BLOCKED');
    expect(blocked).toEqual([]);
  });

  it('names an explicit pack the same way regardless of which one it is', () => {
    expect(freightPack().id).not.toBe(openPack().id);
  });
});
