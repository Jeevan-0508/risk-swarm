import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { investigate } from '../orchestrator/run';
import { renderBrief } from './render';

const NOW = '2026-09-13T00:00:00.000Z';

const run = () =>
  investigate({
    loader: createFileLoader('public/snapshots'),
    run_id: 'RUN-BRIEF',
    now: NOW,
    question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
    scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  });

describe('brief renderer', () => {
  it('prints the withheld confidence and its reason rather than a number', async () => {
    const r = await run();
    const md = renderBrief(r);
    expect(md).toContain('**Confidence:** withheld');
    expect(md).toContain(r.outputs.decision.decision.confidence_blocked_reason!);
  });

  it('carries every gate, cap and blocking finding into the document', async () => {
    const r = await run();
    const md = renderBrief(r);
    for (const g of r.outputs.decision.score.gates_failed) expect(md).toContain(g);
    for (const c of r.outputs.decision.score.caps_applied) expect(md).toContain(c);
    for (const f of r.outputs.red_team.findings) expect(md).toContain(f.clears_when);
  });

  it('lists every evidence id, so no citation in the brief is unresolvable', async () => {
    const r = await run();
    const md = renderBrief(r);
    for (const e of r.graph.all()) if (e.kind === 'evidence') expect(md).toContain(`\`${e.id}\``);
  });

  it('says plainly when no human has ruled, and records the ruling when one has', async () => {
    const r = await run();
    expect(renderBrief(r)).toContain('None recorded. This is a recommendation, not a decision.');
    const withHuman = renderBrief(r, { human: { verdict: 'overridden', band: 'ESCALATE', note: 'known offender', at: NOW } });
    expect(withHuman).toContain('Verdict: **overridden**');
    expect(withHuman).toContain('system recommended **MONITOR**');
    expect(withHuman).toContain('known offender');
  });

  it('invents no figure the run did not publish', async () => {
    const r = await run();
    const md = renderBrief(r);
    expect(md).toContain(`${r.graph.all().length} node(s)`);
    expect(md).toContain(`${r.spent.agent_call} agent call(s)`);
    expect(md).not.toContain('undefined');
    expect(md).not.toContain('NaN');
  });
});
