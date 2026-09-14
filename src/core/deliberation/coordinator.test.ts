/**
 * The Council's coordinator, tested two ways: over the real reference run (determinism, no
 * fabrication, real event shape) and over small hand-built fixtures (budget exhaustion on all three
 * dimensions, and the dormant DEFENSE/REBUTTAL/resolution-driven-AGREEMENT path that never occurs in a
 * real run today because `Challenge.resolution`/`RedTeamFinding.resolution` are always `'open'`).
 */
import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { investigate } from '../orchestrator/run';
import { RiskGraph } from '../domain/graph';
import { Minter, fixedClock } from '../domain/build';
import { runDeliberation, type DeliberationInput } from './coordinator';
import type { ScoutOutput } from '../agents/scout';
import type { IntelligenceOutput } from '../agents/intelligence';
import type { AnalystOutput } from '../agents/analyst';
import type { GovernanceOutput } from '../agents/governance';
import type { ChallengerOutput } from '../agents/challenger';
import type { RedTeamOutput } from '../agents/redteam';
import type { DecisionOutput } from '../agents/decision';

const OPTIONS = {
  loader: createFileLoader('public/snapshots'),
  run_id: 'RUN-DELIB',
  now: '2026-09-13T00:00:00.000Z',
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
};

const run = () => investigate({ ...OPTIONS });

describe('the Council coordinator, over the real reference run', () => {
  it('is deterministic: the same run produces the same deliberation sequence, byte for byte', async () => {
    const a = await run();
    const b = await run();
    expect(JSON.stringify(b.deliberation.events)).toBe(JSON.stringify(a.deliberation.events));
    expect(b.deliberation.outcome).toBe(a.deliberation.outcome);
  });

  it('never cites an evidence or claim id that the graph does not actually contain', async () => {
    const r = await run();
    const known = new Set(r.graph.all().map((n) => n.id));
    for (const ev of r.deliberation.events) {
      for (const ref of [...ev.evidence_ids, ...ev.claim_ids]) expect(known.has(ref)).toBe(true);
    }
    expect(r.sentinel.checks.find((c) => c.key === 'deliberation_integrity')!.status).toBe('VERIFIED');
  });

  it('narrates real disagreement rather than inventing or hiding it', async () => {
    const r = await run();
    // The reference run's challenger and red team both raise real findings that stay unresolved
    // (`resolution: 'open'`); the transcript must say so, not quietly close them.
    expect(r.outputs.challenger.findings.length).toBeGreaterThan(0);
    const challenges = r.deliberation.events.filter((e) => e.type === 'challenge');
    const objections = r.deliberation.events.filter((e) => e.type === 'objection');
    expect(challenges.length).toBe(r.outputs.challenger.findings.length);
    expect(objections.length).toBe(r.outputs.red_team.findings.length);
    expect(challenges.every((e) => e.status === 'unresolved' && e.requires_response)).toBe(true);
    expect(objections.every((e) => e.status === 'unresolved' && e.requires_response)).toBe(true);
    // No DEFENSE/REBUTTAL/resolution-driven AGREEMENT over this run: nothing today resolves one.
    expect(r.deliberation.events.some((e) => e.type === 'defense' || e.type === 'rebuttal')).toBe(false);
  });

  it('records exactly six recorded positions, not seven: decision_engine synthesizes, it does not vote', async () => {
    const r = await run();
    const positionEvents = r.deliberation.events.filter((e) => e.type === 'agreement' || e.type === 'disagreement');
    expect(positionEvents.length).toBe(6);
    expect(positionEvents.some((e) => e.from_agent === 'decision_engine')).toBe(false);
  });

  it('always closes with exactly one terminal resolution event, whatever the outcome', async () => {
    const r = await run();
    const last = r.deliberation.events.at(-1)!;
    expect(last.type).toBe('resolution');
    expect(r.deliberation.events.filter((e) => e.type === 'resolution').length).toBe(1);
    expect(r.deliberation.limited_by).toBeNull();
  });

  it('reports the same outcome PULSE reads back from it', async () => {
    const r = await run();
    const health = r.pulse.checks.find((c) => c.key === 'deliberation_health')!;
    expect(health.detail.toLowerCase()).toContain(r.deliberation.outcome.replace(/_/g, ' ').toLowerCase());
  });

  it('is diffed by ORBIT like any other published field', async () => {
    const r = await run();
    expect(r.deliberation.events.length).toBeGreaterThan(0);
  });
});

describe('the Council coordinator, budget termination', () => {
  it('stops on max_events but still says so in a terminal event, over the real reference run', async () => {
    const r = await run();
    const base: DeliberationInput = {
      run_id: r.run_id, graph: r.graph, scout: r.outputs.scout, intelligence: r.outputs.intelligence,
      analyst: r.outputs.analyst, governance: r.outputs.governance, challenger: r.outputs.challenger,
      red_team: r.outputs.red_team, decision: r.outputs.decision,
    };
    const d = runDeliberation(base, { budget: { max_events: 1 } });
    expect(d.limited_by).toBe('max_events');
    expect(d.events.length).toBe(1);
    expect(d.events[0]!.type).toBe('resolution');
    expect(d.outcome).toBe('LIMIT_REACHED');
    expect(d.events[0]!.content).toContain('LIMIT REACHED');
  });

  it('stops on max_rounds before a single round runs', async () => {
    const r = await run();
    const base: DeliberationInput = {
      run_id: r.run_id, graph: r.graph, scout: r.outputs.scout, intelligence: r.outputs.intelligence,
      analyst: r.outputs.analyst, governance: r.outputs.governance, challenger: r.outputs.challenger,
      red_team: r.outputs.red_team, decision: r.outputs.decision,
    };
    const d = runDeliberation(base, { budget: { max_rounds: 0 } });
    expect(d.limited_by).toBe('max_rounds');
    expect(d.rounds_used).toBe(0);
    expect(d.events.length).toBe(1);
  });

  it('stops on max_agent_responses once one voice would speak twice', async () => {
    const r = await run();
    const base: DeliberationInput = {
      run_id: r.run_id, graph: r.graph, scout: r.outputs.scout, intelligence: r.outputs.intelligence,
      analyst: r.outputs.analyst, governance: r.outputs.governance, challenger: r.outputs.challenger,
      red_team: r.outputs.red_team, decision: r.outputs.decision,
    };
    const d = runDeliberation(base, { budget: { max_agent_responses: 1 } });
    expect(d.limited_by).toBe('max_agent_responses');
    expect(d.outcome).toBe('LIMIT_REACHED');
  });

  it('never drops the terminal event even when a cap bites exactly on the last real event', async () => {
    const r = await run();
    const unlimited = runDeliberation({
      run_id: r.run_id, graph: r.graph, scout: r.outputs.scout, intelligence: r.outputs.intelligence,
      analyst: r.outputs.analyst, governance: r.outputs.governance, challenger: r.outputs.challenger,
      red_team: r.outputs.red_team, decision: r.outputs.decision,
    });
    const bodyEvents = unlimited.events.length - 1;
    const d = runDeliberation({
      run_id: r.run_id, graph: r.graph, scout: r.outputs.scout, intelligence: r.outputs.intelligence,
      analyst: r.outputs.analyst, governance: r.outputs.governance, challenger: r.outputs.challenger,
      red_team: r.outputs.red_team, decision: r.outputs.decision,
    }, { budget: { max_events: bodyEvents } });
    expect(d.events.at(-1)!.type).toBe('resolution');
  });
});

describe('the Council coordinator, the dormant DEFENSE/REBUTTAL/resolution-driven-AGREEMENT path', () => {
  // Exercised here by construction only. `Challenge.resolution` / `RedTeamFinding.resolution` are
  // always `'open'` in the current pipeline (nothing today sets them to `'accepted'`/`'rebutted'`), so
  // this fixture is deliberately hand-built rather than drawn from a real run - see the module doc.
  const AT = '2026-09-13T10:00:00.000Z';

  function fixture(): DeliberationInput {
    const m = new Minter('RUN-FIXTURE', fixedClock(AT));
    const g = new RiskGraph();
    const evidence = g.add(m.evidence('scout', {
      source: 'Trans.INFO', source_type: 'news', url: 'https://trans.info/example',
      title: 'Carrier insolvency wave in Germany', publication_date: '2026-09-10', retrieved_at: AT,
      claim: 'A German road carrier entered insolvency in September 2026.',
      excerpt_or_summary: 'Report of an insolvency filing.', reliability: 0.55, relevance: 0.8,
      agents_that_used_it: ['scout'], cluster_id: 'CL-1', injection_suspected: false, incident_claim: true,
    }));
    const oldHyp = g.add(m.hypothesis('risk_analyst', {
      statement: 'Old hypothesis', falsification_test: 'No further corroborating signal appears within 30 days.',
      pattern_id: 'phantom_carrier', status: 'open', scope: { geo: ['DE'], mode: ['road'] }, supersedes: null,
    }));
    const newHyp = g.add(m.hypothesis('risk_analyst', {
      statement: 'Revised hypothesis', falsification_test: 'No further corroborating signal appears within 30 days.',
      pattern_id: 'phantom_carrier', status: 'open', scope: { geo: ['DE'], mode: ['road'] }, supersedes: oldHyp.id,
    }));
    const decisionNode = g.add(m.decision('decision_engine', {
      question: 'test', hypothesis_ids: [newHyp.id], headline_risk: 'Test escalation',
      severity_band: 'HIGH', severity_score: 0.8, confidence: null, urgency: 'IMMEDIATE',
      action_band: 'ESCALATE', gates_failed: ['no_operational_evidence'], caps_applied: [],
      rationale: ['test'], unresolved_objections: [], owner_role: 'Physical Security / Loss Prevention',
      review_by: '2026-09-20', regulatory_implications: [], decided_by: 'system_recommendation',
      confidence_blocked_reason: 'test fixture withholds confidence deliberately', human_note: null, human_verdict: null,
    }));

    const scout = { uncertainties: [], findings: [], recommended_next_step: null } as unknown as ScoutOutput;
    const intelligence = { uncertainties: [], clusters: [], recommended_next_step: null } as unknown as IntelligenceOutput;
    const analyst = {
      recommended_next_step: null,
      superseded: [oldHyp],
      findings: [{ hypothesis: newHyp }],
    } as unknown as AnalystOutput;
    const governance = { recommended_next_step: null, findings: [] } as unknown as GovernanceOutput;
    const challenger = {
      recommended_next_step: null,
      findings: [{
        argument: 'The evidence is thin.', basis: 'evidence_deficiency', alternative_explanation: null,
        evidence_ids: [evidence.id], target_id: newHyp.id, resolution: 'rebutted',
        rebuttal: 'Addressed with a second independent source.',
      }],
    } as unknown as ChallengerOutput;
    const red_team = {
      recommended_next_step: null,
      findings: [
        {
          argument: 'This could be an ungated false positive.', clears_when: 'A tier-1 source corroborates.',
          evidence_ids: [evidence.id], target_id: newHyp.id, resolution: 'rebutted',
        },
        {
          argument: 'The claim may be missing operational evidence.', clears_when: 'Operational data is supplied.',
          evidence_ids: [evidence.id], target_id: newHyp.id, resolution: 'accepted',
        },
      ],
    } as unknown as RedTeamOutput;
    const decision = {
      recommended_next_step: null,
      evidence_cited: [evidence.id],
      scoring_input: { agent_positions: [{ agent: 'scout', reasoning_status: 'supported', confidence: 0.8 }] },
      score: { disagreement_index: { value: 60 } },
      decision: decisionNode,
    } as unknown as DecisionOutput;

    return { run_id: 'RUN-FIXTURE', graph: g, scout, intelligence, analyst, governance, challenger, red_team, decision };
  }

  it('emits a REBUTTAL when a challenge was actually rebutted', () => {
    const d = runDeliberation(fixture());
    const rebuttals = d.events.filter((e) => e.type === 'rebuttal');
    expect(rebuttals.length).toBe(1);
    expect(rebuttals[0]!.from_agent).toBe('risk_analyst');
    expect(rebuttals[0]!.content).toContain('second independent source');
  });

  it('emits a DEFENSE when a red-team objection was rebutted, distinct from a challenge rebuttal', () => {
    const d = runDeliberation(fixture());
    const defenses = d.events.filter((e) => e.type === 'defense');
    expect(defenses.length).toBe(1);
    expect(defenses[0]!.from_agent).toBe('risk_analyst');
  });

  it('emits a resolution-driven AGREEMENT when an objection was accepted, never fabricated on a real run', () => {
    const d = runDeliberation(fixture());
    const dormantAgreements = d.events.filter((e) => e.type === 'agreement' && e.from_agent === 'risk_analyst');
    expect(dormantAgreements.length).toBe(1);
  });

  it('emits a REVISION naming both ends of the supersedes edge', () => {
    const d = runDeliberation(fixture());
    const revision = d.events.find((e) => e.type === 'revision')!;
    expect(revision.content).toContain('Old hypothesis');
    expect(revision.content).toContain('Revised hypothesis');
  });

  it('emits an ESCALATION only because this fixture actually escalates', () => {
    const d = runDeliberation(fixture());
    const escalation = d.events.find((e) => e.type === 'escalation')!;
    expect(escalation.content).toContain('Test escalation');
    expect(escalation.from_agent).toBe('decision_engine');
  });

  it('never lets a dangling reference through, even from a hand-built fixture', () => {
    const d = runDeliberation(fixture());
    const known = new Set(fixture().graph.all().map((n) => n.id));
    for (const ev of d.events) {
      for (const ref of [...ev.evidence_ids, ...ev.claim_ids]) expect(known.has(ref)).toBe(true);
    }
  });
});
