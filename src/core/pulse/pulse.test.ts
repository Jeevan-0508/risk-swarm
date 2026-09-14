import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { investigate } from '../orchestrator/run';
import { runPulse, type PulseInput } from './pulse';
import type { IntelligenceOutput } from '../agents/intelligence';
import type { GovernanceOutput } from '../agents/governance';
import type { ChallengerOutput } from '../agents/challenger';
import type { RedTeamOutput } from '../agents/redteam';
import type { DecisionOutput } from '../agents/decision';
import type { ScoringPolicy } from '../scoring/policy';
import type { SentinelReport } from '../sentinel/sentinel';

/**
 * PULSE only ever reads a handful of named fields off each agent output (see the module doc), so a
 * fixture only needs to fill those - the rest is cast rather than fully built, the same way a
 * hand-rolled `RunResult` fixture would be if PULSE touched the graph directly.
 */
function baseInput(over: Partial<PulseInput> = {}): PulseInput {
  const intelligence = { clusters: [{}, {}] } as unknown as IntelligenceOutput;
  const governance = { implications: [{ applicability: 'established' }] } as unknown as GovernanceOutput;
  const challenger = { findings: [] } as unknown as ChallengerOutput;
  const red_team = { verdict: 'pass', checks_run: 8, findings: [] } as unknown as RedTeamOutput;
  const decision = {
    score: { independent_evidence_count: 5, disagreement_index: { value: 10 } },
    decision: { unresolved_objections: [] },
  } as unknown as DecisionOutput;
  const policy = { escalate_min_independent_sources: 3 } as unknown as ScoringPolicy;
  const sentinel = { status: 'VERIFIED', checks: [] } as unknown as SentinelReport;
  return {
    intelligence, governance, challenger, red_team, decision, policy, sentinel,
    spent: { agent_call: 7, retrieval: 12, tokens: 4000 },
    budget: { agent_call: 24, retrieval: 400, tokens: 120_000 },
    ...over,
  };
}

describe('PULSE', () => {
  it('reports VERIFIED on every check except the outcome-history gap, over a healthy input', () => {
    const report = runPulse(baseInput());
    const notOutcome = report.checks.filter((c) => c.key !== 'outcome_history');
    expect(notOutcome.every((c) => c.status === 'VERIFIED')).toBe(true);
    expect(report.checks.find((c) => c.key === 'outcome_history')?.status).toBe('WARNING');
    expect(report.status).toBe('WARNING');
  });

  it('warns on source diversity when independent evidence sits below the policy floor', () => {
    const report = runPulse(baseInput({
      decision: {
        score: { independent_evidence_count: 1, disagreement_index: { value: 60 } },
        decision: { unresolved_objections: [] },
      } as unknown as DecisionOutput,
    }));
    const check = report.checks.find((c) => c.key === 'source_diversity')!;
    expect(check.status).toBe('WARNING');
  });

  it('names the specific failure mode when agreement rests on too few sources', () => {
    const report = runPulse(baseInput({
      decision: {
        score: { independent_evidence_count: 1, disagreement_index: { value: 5 } },
        decision: { unresolved_objections: [] },
      } as unknown as DecisionOutput,
    }));
    const check = report.checks.find((c) => c.key === 'source_diversity')!;
    expect(check.detail).toContain('is not corroboration');
  });

  it('warns on governance coverage when no implication was ever established', () => {
    const report = runPulse(baseInput({ governance: { implications: [] } as unknown as GovernanceOutput }));
    expect(report.checks.find((c) => c.key === 'governance_coverage')?.status).toBe('WARNING');
  });

  it('warns on red-team outcome for anything short of a clean pass', () => {
    const report = runPulse(baseInput({
      red_team: { verdict: 'fail', checks_run: 8, findings: [{}] } as unknown as RedTeamOutput,
    }));
    expect(report.checks.find((c) => c.key === 'red_team_outcome')?.status).toBe('WARNING');
  });

  it('warns on unresolved objections without calling them a defect', () => {
    const report = runPulse(baseInput({
      decision: {
        score: { independent_evidence_count: 5, disagreement_index: { value: 10 } },
        decision: { unresolved_objections: ['C-1', 'C-2'] },
      } as unknown as DecisionOutput,
    }));
    const check = report.checks.find((c) => c.key === 'unresolved_blockers')!;
    expect(check.status).toBe('WARNING');
    expect(check.status).not.toBe('BLOCKED');
  });

  it('warns on budget utilization when no cap was supplied to check against', () => {
    const report = runPulse(baseInput({ budget: undefined }));
    expect(report.checks.find((c) => c.key === 'budget_utilization')?.status).toBe('WARNING');
  });

  it('warns on budget utilization when a dimension is close to its cap, though the run still fit', () => {
    const report = runPulse(baseInput({ spent: { agent_call: 23, retrieval: 12, tokens: 4000 } }));
    expect(report.checks.find((c) => c.key === 'budget_utilization')?.status).toBe('WARNING');
  });

  it('treats no live retrieval as the expected shape of DEMO/SNAPSHOT, not a gap', () => {
    const report = runPulse(baseInput());
    expect(report.checks.find((c) => c.key === 'retrieval_health')?.status).toBe('VERIFIED');
  });

  it('warns on retrieval health when a live feed failed rather than substituting for it', () => {
    const report = runPulse(baseInput({
      liveRetrieval: { feeds: [{}], failures: [{}] } as unknown as PulseInput['liveRetrieval'],
    }));
    expect(report.checks.find((c) => c.key === 'retrieval_health')?.status).toBe('WARNING');
  });

  it('folds SENTINEL\'s status in rather than calling the run healthy over an unsound record', () => {
    const report = runPulse(baseInput({ sentinel: { status: 'BLOCKED', checks: [] } as unknown as SentinelReport }));
    expect(report.checks.find((c) => c.key === 'record_integrity')?.status).toBe('BLOCKED');
    expect(report.status).toBe('BLOCKED');
  });

  it('is bookkeeping-sound over the real investigate() output: no check reads as fabricated', async () => {
    const r = await investigate({
      loader: createFileLoader('public/snapshots'),
      run_id: 'RUN-PULSE',
      now: '2026-09-13T00:00:00.000Z',
      question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
      scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
    });
    expect(r.pulse.checks.some((c) => c.status === 'BLOCKED')).toBe(false);
    expect(r.pulse.checks.map((c) => c.key)).toEqual([
      'record_integrity', 'source_diversity', 'evidence_volume', 'governance_coverage',
      'red_team_outcome', 'unresolved_blockers', 'budget_utilization', 'retrieval_health', 'outcome_history',
      'deliberation_health',
    ]);
  });
});
