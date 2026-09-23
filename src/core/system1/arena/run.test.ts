import { describe, expect, it } from '../../test/bdd';
import { runSystem1Arena } from './run';
import type { LayaInferenceInput, LayaRuntimeResult } from '../laya/runtime';
import typedFixture from '../laya/__fixtures__/laya-typed-eu-carrier-dark-case.json';

const CASE = {
  case_id: 'C-001',
  question: 'Given this carrier behavior, what action should a fraud investigator take?',
  state: 'A carrier went dark for 6 hours then resumed with a route deviation.',
  candidate_stances: ['NOTE', 'MONITOR', 'TARGETED_INVESTIGATION', 'ESCALATE'],
  risk_hint: null,
};

describe('runSystem1Arena', () => {
  it('calls Laya and Jev independently over the same case and compares their real results', async () => {
    const runner = (_input: LayaInferenceInput) => typedFixture as LayaRuntimeResult;
    const result = await runSystem1Arena(CASE, {
      layaDeps: { runner },
      jevDeps: { apiKey: undefined },
    });

    expect(result.laya_result.status).toBe('SHADOW');
    expect(result.laya_result.decision).toBe('MONITOR');
    expect(result.jev_result?.status).toBe('UNAVAILABLE');
    expect(result.disagreement).toBeNull();
    expect(result.agreement).toBe(false);
  });

  it('neither model sees the other input object - Laya and Jev are called with the identical, independent case', async () => {
    const seenByLaya: unknown[] = [];
    const runner = (input: LayaInferenceInput) => { seenByLaya.push(input); return typedFixture as LayaRuntimeResult; };
    const seenByJev: unknown[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      seenByJev.push(init?.body);
      return new Response(JSON.stringify({ decision: 'ESCALATE', confidence: 0.6 }), { status: 200 });
    };

    await runSystem1Arena(CASE, {
      layaDeps: { runner },
      jevDeps: { apiKey: 'fake-key', fetchImpl },
    });

    expect(seenByLaya).toHaveLength(1);
    expect(seenByJev).toHaveLength(1);
    // Jev's request body is built purely from the shared case input (state/question/choices) - it
    // has no field carrying Laya's runtime output at all.
    const jevBody = JSON.parse(String(seenByJev[0]));
    expect(Object.keys(jevBody).sort()).toEqual(['choices', 'question', 'state']);
  });
});
