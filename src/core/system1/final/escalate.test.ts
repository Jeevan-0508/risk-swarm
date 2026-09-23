import { describe, expect, it } from '../../test/bdd';
import { buildDiagnosticQuestion, escalateToSwarm } from './escalate';
import { DEFAULT_REGISTRY_CONFIG } from '../../reasoner/registry';
import { routeSystem1Case } from '../router/route';
import type { LayaRuntimeResult } from '../laya/runtime';

const CASE = {
  case_id: 'C-001',
  question: 'What action should a fraud investigator take?',
  state: 'A carrier went dark for 6 hours then resumed with a route deviation.',
  candidate_stances: ['NOTE', 'MONITOR', 'TARGETED_INVESTIGATION', 'ESCALATE'],
  risk_hint: null,
};

const unconfidentLaya = (): LayaRuntimeResult => ({
  ok: true, load_seconds: 1, infer_seconds: 0.1,
  result: { model: 'x', answers: { q: { type: 'choice', choice: 'NOTE', confidence: 0.1, probabilities: { NOTE: 0.4, ESCALATE: 0.3, MONITOR: 0.2, TARGETED_INVESTIGATION: 0.1 } } }, usage: { input_tokens: 1, output_tokens: 0 } },
});

describe('buildDiagnosticQuestion', () => {
  it('includes the original question, both real stances/confidences, and the disagreement type — not the original question alone', async () => {
    const route = await routeSystem1Case(CASE, {
      layaDeps: { runner: () => unconfidentLaya() },
      jevDeps: { apiKey: 'k', fetchImpl: async () => new Response(JSON.stringify({ decision: 'ESCALATE', confidence: 0.9 }), { status: 200 }) },
    });
    const question = buildDiagnosticQuestion(CASE, route);

    expect(question).toContain(CASE.question);
    expect(question).toContain('NOTE');
    expect(question).toContain('ESCALATE');
    expect(question).toContain('RISK');
  });

  it('states plainly when Jev was never called, rather than implying it agreed or was silent', async () => {
    const route = await routeSystem1Case({ ...CASE, risk_hint: 'high' }, {
      layaDeps: { runner: () => unconfidentLaya() },
    });
    const question = buildDiagnosticQuestion(CASE, route);
    expect(question).toContain('Jev: not called for this case.');
  });
});

describe('escalateToSwarm', () => {
  it('really calls the Council (deterministic fallback, no network) and returns a genuine CouncilResult', async () => {
    const route = await routeSystem1Case({ ...CASE, risk_hint: 'high' }, {
      layaDeps: { runner: () => unconfidentLaya() },
    });

    const council = await escalateToSwarm({
      case: CASE,
      route,
      evidence: [],
      config: DEFAULT_REGISTRY_CONFIG,
      deps: { getApiKey: () => null },
    });

    expect(council.question).toContain(CASE.question);
    expect(council.verdict).toBeDefined();
    // No API key configured anywhere -> every Olympian and Zeus used their deterministic fallback,
    // never a fabricated network response.
    Object.values(council.positions).forEach((p) => expect(p.provider).toBe('deterministic'));
  });
});
