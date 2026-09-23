import { describe, expect, it } from '../../test/bdd';
import { callLaya } from './client';
import type { LayaInferenceInput, LayaRuntimeResult } from './runtime';
import typedFixture from './__fixtures__/laya-typed-eu-carrier-dark-case.json';

const CASE = {
  case_id: 'C-001',
  question: 'Given this carrier behavior, what action should a fraud investigator take?',
  state: 'A carrier went dark for 6 hours then resumed with a route deviation.',
  candidate_stances: ['NOTE', 'MONITOR', 'TARGETED_INVESTIGATION', 'ESCALATE'],
  risk_hint: null,
};

const fixtureRunner = (result: LayaRuntimeResult) => (_input: LayaInferenceInput) => result;

describe('callLaya', () => {
  it('returns a SHADOW result built from a real captured fixture, via the injected runner', async () => {
    const runner = fixtureRunner(typedFixture as LayaRuntimeResult);
    const result = await callLaya('laya-typed', CASE, { runner });

    expect(result.status).toBe('SHADOW');
    expect(result.decision).toBe('MONITOR');
    expect(result.confidence).toBeCloseTo(0.0418, 4);
    expect(result.model_version).toBe('convaiinnovations/laya-typed-decisions');
    expect(result.evidence_ids).toEqual([]);
    expect(result.raw).not.toBeNull();
  });

  it('fails closed to ERROR for an unknown checkpoint id, without calling the runner', async () => {
    let called = false;
    const runner = () => {
      called = true;
      return { ok: true, load_seconds: 0, infer_seconds: 0, result: { model: 'x', answers: {}, usage: { input_tokens: 0, output_tokens: 0 } } } as LayaRuntimeResult;
    };
    const result = await callLaya('laya-nonexistent', CASE, { runner });

    expect(result.status).toBe('ERROR');
    expect(called).toBe(false);
  });

  it('fails closed to ERROR when the runtime itself reports failure, without fabricating a result', async () => {
    const runner = fixtureRunner({ ok: false, error: 'laya_infer.py exited 1: torch not found' });
    const result = await callLaya('laya-typed', CASE, { runner });

    expect(result.status).toBe('ERROR');
    expect(result.rationale).toContain('torch not found');
    expect(result.decision).toBe('ERROR');
  });

  it('fails closed to ERROR when the runtime returns no answer for the submitted question id', async () => {
    const runner = fixtureRunner({ ok: true, load_seconds: 1, infer_seconds: 1, result: { model: 'x', answers: {}, usage: { input_tokens: 0, output_tokens: 0 } } });
    const result = await callLaya('laya-typed', CASE, { runner });

    expect(result.status).toBe('ERROR');
    expect(result.rationale).toContain('no answer');
  });
});
