import { describe, expect, it } from '../../test/bdd';
import { routeSystem1Case } from './route';
import type { LayaInferenceInput, LayaRuntimeResult } from '../laya/runtime';
import typedFixture from '../laya/__fixtures__/laya-typed-eu-carrier-dark-case.json';

const CASE = {
  case_id: 'C-001',
  question: 'Given this carrier behavior, what action should a fraud investigator take?',
  state: 'A carrier went dark for 6 hours then resumed with a route deviation.',
  candidate_stances: ['NOTE', 'MONITOR', 'TARGETED_INVESTIGATION', 'ESCALATE'],
  risk_hint: null,
};

const confidentFixture = (): LayaRuntimeResult => ({
  ok: true,
  load_seconds: 1,
  infer_seconds: 0.1,
  result: { model: 'x', answers: { q: { type: 'choice', choice: 'MONITOR', confidence: 0.95, probabilities: { MONITOR: 0.95, NOTE: 0.05 } } }, usage: { input_tokens: 1, output_tokens: 0 } },
});

describe('routeSystem1Case (lazy production cascade)', () => {
  it('accepts System-1 without ever calling Jev when Laya is confident on a low-risk case (directive Step 23: no unnecessary cost)', async () => {
    let jevCalled = false;
    const runner = (_i: LayaInferenceInput) => confidentFixture();
    const fetchImpl = async () => { jevCalled = true; return new Response('{}', { status: 200 }); };

    const result = await routeSystem1Case({ ...CASE, risk_hint: 'low' }, {
      layaDeps: { runner }, jevDeps: { apiKey: 'k', fetchImpl },
    });

    expect(result.jev_called).toBe(false);
    expect(jevCalled).toBe(false);
    expect(result.decision.action).toBe('ACCEPT_SYSTEM1');
  });

  it('calls Jev when Laya is uncertain, and accepts System-1 when they then agree', async () => {
    const runner = (_i: LayaInferenceInput) => typedFixture as LayaRuntimeResult; // MONITOR, confidence 0.0418, well under threshold
    // Same stance, close confidence -> a real agreement, not just a same-label coincidence with a
    // large confidence gap (which compare.ts correctly treats as a CONFIDENCE disagreement instead).
    const fetchImpl = async () => new Response(JSON.stringify({ decision: 'MONITOR', confidence: 0.1 }), { status: 200 });

    const result = await routeSystem1Case(CASE, {
      layaDeps: { runner }, jevDeps: { apiKey: 'k', fetchImpl },
    });

    expect(result.jev_called).toBe(true);
    expect(result.decision.action).toBe('ACCEPT_SYSTEM1');
    expect(result.arena.agreement).toBe(true);
  });

  it('escalates to SWARM when Laya is uncertain and Jev then disagrees', async () => {
    const runner = (_i: LayaInferenceInput) => typedFixture as LayaRuntimeResult;
    const fetchImpl = async () => new Response(JSON.stringify({ decision: 'ESCALATE', confidence: 0.9 }), { status: 200 });

    const result = await routeSystem1Case(CASE, {
      layaDeps: { runner }, jevDeps: { apiKey: 'k', fetchImpl },
    });

    expect(result.jev_called).toBe(true);
    expect(result.decision.action).toBe('ESCALATE_SWARM');
    expect(result.decision.escalation_trigger).toBe('DISAGREEMENT');
  });

  it('escalates a high-risk case immediately, without ever calling Jev', async () => {
    let jevCalled = false;
    const runner = (_i: LayaInferenceInput) => confidentFixture();
    const fetchImpl = async () => { jevCalled = true; return new Response('{}', { status: 200 }); };

    const result = await routeSystem1Case({ ...CASE, risk_hint: 'high' }, {
      layaDeps: { runner }, jevDeps: { apiKey: 'k', fetchImpl },
    });

    expect(result.jev_called).toBe(false);
    expect(jevCalled).toBe(false);
    expect(result.decision.action).toBe('ESCALATE_SWARM');
    expect(result.decision.escalation_trigger).toBe('HIGH_RISK');
  });

  it('escalates when Laya is uncertain and Jev is genuinely unavailable (real state today, no API key)', async () => {
    const runner = (_i: LayaInferenceInput) => typedFixture as LayaRuntimeResult;

    const result = await routeSystem1Case(CASE, {
      layaDeps: { runner }, jevDeps: { apiKey: undefined },
    });

    expect(result.jev_called).toBe(true);
    expect(result.arena.jev_result?.status).toBe('UNAVAILABLE');
    expect(result.decision.action).toBe('ESCALATE_SWARM');
    expect(result.decision.escalation_trigger).toBe('LOW_CONFIDENCE_NO_JEV');
  });
});
