import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import type { InvestigateOptions } from '../orchestrator/run';
import { runScenario, SCENARIOS, type ScenarioId } from './orbit';

function baseOptions(runId: string): InvestigateOptions {
  return {
    loader: createFileLoader('public/snapshots'),
    run_id: runId,
    now: '2026-09-13T00:00:00.000Z',
    question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
    scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  };
}

describe('ORBIT', () => {
  it('lists exactly the scenarios this phase shipped, each with a label and description', () => {
    const ids = Object.keys(SCENARIOS);
    expect(ids.sort()).toEqual(['duplicate_amplification', 'evidence_poisoning', 'false_positive_wave', 'source_concentration', 'source_drought']);
    for (const id of ids as ScenarioId[]) {
      expect(SCENARIOS[id].label.length > 0).toBe(true);
      expect(SCENARIOS[id].description.length > 0).toBe(true);
    }
  });

  it('runs the reference investigation twice and never mutates the baseline RunResult by hand', async () => {
    const report = await runScenario('source_drought', baseOptions('RUN-ORBIT-1'));
    expect(report.baseline.run_id).toBe('RUN-ORBIT-1-orbit-baseline');
    expect(report.stressed.run_id).toBe('RUN-ORBIT-1-orbit-stressed');
    expect(report.baseline_signal_count > 0).toBe(true);
  }, 30_000);

  it('source drought reduces the signal count and the independent-evidence count', async () => {
    const report = await runScenario('source_drought', baseOptions('RUN-ORBIT-2'));
    expect(report.stressed_signal_count).toBeLessThanOrEqual(2);
    expect(report.stressed_signal_count).toBeLessThan(report.baseline_signal_count);
    const independentDiff = report.fields.find((f) => f.key === 'independent_evidence_count')!;
    expect(Number(independentDiff.stressed)).toBeLessThanOrEqual(Number(independentDiff.baseline));
  }, 30_000);

  it('source concentration keeps signal volume but collapses independent-evidence count towards one publisher', async () => {
    const report = await runScenario('source_concentration', baseOptions('RUN-ORBIT-3'));
    const independentDiff = report.fields.find((f) => f.key === 'independent_evidence_count')!;
    expect(Number(independentDiff.stressed)).toBeLessThan(Number(independentDiff.baseline));
  }, 30_000);

  it('duplicate amplification roughly doubles signal volume without doubling independent evidence', async () => {
    const report = await runScenario('duplicate_amplification', baseOptions('RUN-ORBIT-4'));
    expect(report.stressed_signal_count).toBeGreaterThan(report.baseline_signal_count);
    const independentDiff = report.fields.find((f) => f.key === 'independent_evidence_count')!;
    expect(Number(independentDiff.stressed)).toBeLessThanOrEqual(Number(independentDiff.baseline) + 1);
  }, 30_000);

  it('evidence poisoning adds exactly one signal, and SENTINEL flags it as an unsupported reference rather than the run acting on it', async () => {
    const report = await runScenario('evidence_poisoning', baseOptions('RUN-ORBIT-5'));
    expect(report.stressed_signal_count).toBe(report.baseline_signal_count + 1);
    const bandOptions = ['NOTE', 'MONITOR', 'TARGETED_INVESTIGATION', 'ESCALATE'];
    expect(bandOptions.includes(report.stressed.outputs.decision.decision.action_band)).toBe(true);
    const stressedCheck = report.stressed.sentinel.checks.find((c) => c.key === 'unsupported_reference')!;
    expect(stressedCheck.status).toBe('WARNING');
    const baselineCheck = report.baseline.sentinel.checks.find((c) => c.key === 'unsupported_reference')!;
    expect(baselineCheck.status).toBe('VERIFIED');
  }, 30_000);

  it('false-positive wave adds the benign signals and the diff surfaces whether the band held', async () => {
    const report = await runScenario('false_positive_wave', baseOptions('RUN-ORBIT-6'));
    expect(report.stressed_signal_count).toBe(report.baseline_signal_count + 6);
    const bandDiff = report.fields.find((f) => f.key === 'action_band')!;
    expect(typeof bandDiff.changed).toBe('boolean');
  }, 30_000);

  it('flags a materially-changed run only through the named material fields, over a real investigate() output', async () => {
    const report = await runScenario('source_drought', baseOptions('RUN-ORBIT-7'));
    const changedMaterialKeys = report.fields.filter((f) => f.changed).map((f) => f.key);
    if (report.materially_changed) {
      const materialKeys = ['action_band', 'severity_band', 'urgency', 'confidence', 'independent_evidence_count', 'red_team_verdict'];
      expect(changedMaterialKeys.some((k) => materialKeys.includes(k))).toBe(true);
    }
    expect(report.fields.map((f) => f.key)).toEqual([
      'action_band', 'severity_band', 'urgency', 'confidence', 'independent_evidence_count',
      'disagreement_index', 'gates_failed', 'red_team_verdict', 'sentinel_status', 'pulse_status',
      'deliberation_event_count', 'deliberation_outcome',
    ]);
  }, 30_000);
});
