import { describe, expect, it } from '../core/test/bdd';
import { investigate } from '../core/orchestrator/run';
import { createFileLoader } from '../core/integrations/loader.node';
import { sealFrom, type SealSourceRun } from './seal';

function run(over: Partial<SealSourceRun> = {}): SealSourceRun {
  return {
    id: 'RUN-1',
    mode: 'DEMO',
    status: 'complete',
    created_at: '2026-09-13T00:00:00.000Z',
    question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
    result: { outputs: { decision: { decision: { action_band: 'MONITOR', severity_band: 'HIGH', confidence: null } } } },
    ...over,
  };
}

describe('showcase seal', () => {
  it('stamps the band a completed run actually published', () => {
    const seal = sealFrom([run()]);
    expect(seal.kind).toBe('real');
    if (seal.kind !== 'real') return;
    expect(seal.action_band).toBe('MONITOR');
    expect(seal.severity_band).toBe('HIGH');
    expect(seal.run_id).toBe('RUN-1');
  });

  it('carries a withheld confidence through as withheld, not as zero', () => {
    const seal = sealFrom([run()]);
    if (seal.kind !== 'real') throw new Error('expected a real seal');
    expect(seal.confidence).toBe(null);
  });

  it('stamps nothing at all when no run has ever completed here', () => {
    const seal = sealFrom([]);
    expect(seal.kind).toBe('none');
  });

  it('refuses a running run rather than stamping a half-formed band', () => {
    const seal = sealFrom([run({ status: 'running', result: null })]);
    expect(seal.kind).toBe('none');
  });

  it('refuses a failed or stopped run even when a partial result object survived', () => {
    expect(sealFrom([run({ status: 'failed' })]).kind).toBe('none');
    expect(sealFrom([run({ status: 'stopped' })]).kind).toBe('none');
  });

  it('takes the most recent completed run, not the first one stored', () => {
    const seal = sealFrom([
      run({ id: 'RUN-OLD', created_at: '2026-09-01T00:00:00.000Z' }),
      run({
        id: 'RUN-NEW',
        created_at: '2026-09-12T00:00:00.000Z',
        result: { outputs: { decision: { decision: { action_band: 'ESCALATE', severity_band: 'CRITICAL', confidence: 0.71 } } } },
      }),
    ]);
    if (seal.kind !== 'real') throw new Error('expected a real seal');
    expect(seal.run_id).toBe('RUN-NEW');
    expect(seal.action_band).toBe('ESCALATE');
    expect(seal.confidence).toBe(0.71);
  });

  it('names the mode, so a LIVE-mode band is never read as the reproducible demo band', () => {
    const seal = sealFrom([run({ mode: 'LIVE' })]);
    if (seal.kind !== 'real') throw new Error('expected a real seal');
    expect(seal.mode).toBe('LIVE');
  });

  /**
   * Every test above builds its own fixture, which proves sealFrom's selection logic and nothing about
   * whether `SealSourceRun` still describes a real run. That is the gap this closes: the field path
   * outputs.decision.decision.{action_band,severity_band,confidence} is asserted against an actual
   * investigate() result, so a rename anywhere along it fails here instead of silently stamping
   * undefined onto the showcase page.
   */
  it('reads the band off a real investigate() result, not just a hand-built fixture', async () => {
    const result = await investigate({
      loader: createFileLoader('public/snapshots'),
      run_id: 'RUN-SEAL',
      now: '2026-09-13T00:00:00.000Z',
      question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
      scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
    });

    // Shaped exactly as the session store persists a finished run.
    const stored: SealSourceRun = {
      id: result.run_id,
      mode: 'DEMO',
      status: 'complete',
      created_at: '2026-09-13T00:00:00.000Z',
      question: result.question,
      result,
    };

    const seal = sealFrom([stored]);
    if (seal.kind !== 'real') throw new Error('a completed real run must produce a real seal');

    const published = result.outputs.decision.decision;
    expect(seal.action_band).toBe(published.action_band);
    expect(seal.severity_band).toBe(published.severity_band);
    expect(seal.confidence).toBe(published.confidence);
    expect(seal.run_id).toBe('RUN-SEAL');

    // The band must be a real published value, never an empty string or undefined leaking through.
    expect(typeof seal.action_band).toBe('string');
    expect(seal.action_band.length > 0).toBe(true);
  });
});
