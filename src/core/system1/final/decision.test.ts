import { describe, expect, it } from '../../test/bdd';
import { runSystem1ThenSwarm } from './decision';
import { DEFAULT_REGISTRY_CONFIG } from '../../reasoner/registry';
import type { LayaRuntimeResult } from '../laya/runtime';

const CASE = {
  case_id: 'C-001',
  question: 'What action should a fraud investigator take?',
  state: 'A carrier went dark for 6 hours then resumed with a route deviation.',
  candidate_stances: ['NOTE', 'MONITOR', 'TARGETED_INVESTIGATION', 'ESCALATE'],
  risk_hint: null,
};

const confident = (): LayaRuntimeResult => ({
  ok: true, load_seconds: 1, infer_seconds: 0.1,
  result: { model: 'x', answers: { q: { type: 'choice', choice: 'MONITOR', confidence: 0.95, probabilities: { MONITOR: 0.95, NOTE: 0.05 } } }, usage: { input_tokens: 1, output_tokens: 0 } },
});

const unconfident = (): LayaRuntimeResult => ({
  ok: true, load_seconds: 1, infer_seconds: 0.1,
  result: { model: 'x', answers: { q: { type: 'choice', choice: 'NOTE', confidence: 0.1, probabilities: { NOTE: 0.4, ESCALATE: 0.3, MONITOR: 0.2, TARGETED_INVESTIGATION: 0.1 } } }, usage: { input_tokens: 1, output_tokens: 0 } },
});

describe('runSystem1ThenSwarm', () => {
  it('SYSTEM1 path: Laya confident + low-risk -> accepted with no SWARM call and no council result', async () => {
    const { final, council } = await runSystem1ThenSwarm({ ...CASE, risk_hint: 'low' }, {
      route: { layaDeps: { runner: () => confident() } },
    });

    expect(final.source).toBe('SYSTEM1');
    expect(final.escalation.escalated).toBe(false);
    expect(final.final).toBe('MONITOR');
    expect(final.replay).toBe('NOT_RUN');
    expect(council).toBeNull();
  });

  it('ABSTAINED path: Laya failure -> abstains honestly rather than guessing, with no SWARM call', async () => {
    const failingRunner = (): LayaRuntimeResult => ({ ok: false, error: 'torch not found' });
    const { final, council } = await runSystem1ThenSwarm(CASE, {
      route: { layaDeps: { runner: failingRunner } },
    });

    expect(final.source).toBe('ABSTAINED');
    expect(final.final).toBe('INSUFFICIENT_EVIDENCE');
    expect(council).toBeNull();
  });

  it('SWARM path: high-risk case escalates and returns a real CouncilResult with cited evidence', async () => {
    const { final, council } = await runSystem1ThenSwarm({ ...CASE, risk_hint: 'high' }, {
      route: { layaDeps: { runner: () => confident() } },
      swarm: { evidence: [], config: DEFAULT_REGISTRY_CONFIG, deps: { getApiKey: () => null } },
    });

    expect(final.source).toBe('SWARM');
    expect(final.escalation.escalated).toBe(true);
    expect(final.escalation.trigger).toBe('HIGH_RISK');
    expect(final.disagreement).toBeNull();
    expect(council).not.toBeNull();
    expect(final.evidence_ids).toEqual(council!.verdict.verdict.cited_evidence_ids);
  });

  it('SWARM path via disagreement: Laya and Jev split -> escalates with the real disagreement attached to the final decision', async () => {
    const { final, council } = await runSystem1ThenSwarm(CASE, {
      route: {
        layaDeps: { runner: () => unconfident() },
        jevDeps: { apiKey: 'k', fetchImpl: async () => new Response(JSON.stringify({ decision: 'ESCALATE', confidence: 0.9 }), { status: 200 }) },
      },
      swarm: { evidence: [], config: DEFAULT_REGISTRY_CONFIG, deps: { getApiKey: () => null } },
    });

    expect(final.source).toBe('SWARM');
    expect(final.escalation.trigger).toBe('DISAGREEMENT');
    expect(final.disagreement?.disagreement_type).toBe('RISK');
    expect(council).not.toBeNull();
  });

  it('throws a clear error rather than silently answering when escalation is required but no swarm deps were supplied', async () => {
    await expect(runSystem1ThenSwarm({ ...CASE, risk_hint: 'high' }, {
      route: { layaDeps: { runner: () => confident() } },
    })).rejects.toThrow(/no swarm dependencies/);
  });
});
