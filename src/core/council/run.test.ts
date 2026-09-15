import { describe, expect, it } from '../test/bdd';
import { runCouncil, MAX_OLYMPIAN_CALLS } from './run';
import { DEFAULT_REGISTRY_CONFIG, type RegistryConfig } from '../reasoner/registry';
import { fixtureEvidence } from './fixtures.test-helpers';

const evidence = fixtureEvidence([
  { id: 'EV-001', title: 'Tiger', excerpt: 'Tigers can outweigh lions by over a hundred pounds and are generally more powerful in a fight.' },
  { id: 'EV-002', title: 'Lion', excerpt: 'Lions live in prides while tigers are typically solitary.' },
]);

/** One fake provider standing in for all three: routes on the model name embedded in the request body/url so each Olympian gets a distinct, deterministic canned answer — proving the plumbing without a real network. */
function fakeFetch(answers: Record<string, unknown>): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const isGemini = url.includes('generativelanguage');
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const model = isGemini ? decodeURIComponent(url.split('/models/')[1]!.split(':')[0]!) : (body.model as string);
    const answer = answers[model];
    if (answer === undefined) return { ok: true, status: 200, json: async () => ({}) };
    const payload = JSON.stringify(answer);
    return { ok: true, status: 200, json: async () => (isGemini ? { candidates: [{ content: { parts: [{ text: payload }] } }] } : { choices: [{ message: { content: payload } }] }) };
  }) as unknown as typeof fetch;
}

const enabledConfig: RegistryConfig = {
  ATHENA: { provider: 'openai', model: 'athena-model', enabled: true },
  ARES: { provider: 'openrouter', model: 'ares-model', enabled: true },
  HADES: { provider: 'google', model: 'hades-model', enabled: true },
  ZEUS: { provider: 'openai', model: 'zeus-model', enabled: true },
};

describe('Council orchestration', () => {
  it('makes at most MAX_OLYMPIAN_CALLS model calls and every Olympian answers independently', async () => {
    let calls = 0;
    const countingFetch = fakeFetch({
      'athena-model': { stance: 'tiger', confidence: 0.8, reasoning_summary: 'a', claims: [], evidence_ids: ['EV-001'], evidence_requests: [], assumptions: [] },
      'ares-model': { stance: 'tiger', confidence: 0.75, reasoning_summary: 'a', claims: [], evidence_ids: ['EV-001'], evidence_requests: [], assumptions: [] },
      'hades-model': { stance: 'tiger', confidence: 0.6, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
      'zeus-model': { verdict_type: 'CONSENSUS', answer: 'tiger', confidence: 0.75, rationale: ['all three agree'], minority_view: null, unresolved: [], cited_evidence_ids: ['EV-001'] },
    });
    const wrapped: typeof fetch = (async (...args: Parameters<typeof fetch>) => { calls += 1; return countingFetch(...args); }) as typeof fetch;

    const result = await runCouncil('lion vs tiger?', evidence, enabledConfig, { getApiKey: () => 'sk-test', fetchImpl: wrapped });

    expect(calls).toBeLessThanOrEqual(MAX_OLYMPIAN_CALLS);
    expect(calls).toBe(4);
    expect(result.positions.ATHENA.position.stance).toBe('tiger');
    expect(result.positions.ARES.position.stance).toBe('tiger');
    expect(result.positions.HADES.position.stance).toBe('tiger');
    expect(result.verdict.verdict.verdict_type).toBe('CONSENSUS');
    expect(result.model_diversity.providers).toBe(3);
  });

  it('preserves genuine disagreement rather than manufacturing agreement', async () => {
    const fetchImpl = fakeFetch({
      'athena-model': { stance: 'tiger', confidence: 0.8, reasoning_summary: 'evidence favors tiger', claims: [], evidence_ids: ['EV-001'], evidence_requests: [], assumptions: [] },
      'ares-model': { stance: 'tiger', confidence: 0.7, reasoning_summary: 'tiger wins the contest', claims: [], evidence_ids: ['EV-001'], evidence_requests: [], assumptions: [] },
      'hades-model': { stance: 'lion', confidence: 0.55, reasoning_summary: 'pride support changes the outcome', claims: [], evidence_ids: ['EV-002'], evidence_requests: [], assumptions: [] },
      'zeus-model': { verdict_type: 'MAJORITY', answer: 'tiger', confidence: 0.6, rationale: ['two of three favor tiger'], minority_view: 'HADES argues pride support favors lion', unresolved: [], cited_evidence_ids: ['EV-001', 'EV-002'] },
    });
    const result = await runCouncil('lion vs tiger?', evidence, enabledConfig, { getApiKey: () => 'sk-test', fetchImpl });

    expect(result.disagreement.agreement).toBe('majority');
    expect(result.disagreement.distinct_stances.sort()).toEqual(['lion', 'tiger']);
    expect(result.verdict.verdict.verdict_type).toBe('MAJORITY');
    expect(result.verdict.verdict.minority_view).toContain('HADES');
  });

  it('isolates one Olympian\'s provider failure: the Council still reaches a verdict, honestly marked degraded', async () => {
    const flaky: typeof fetch = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.model === 'ares-model') return { ok: false, status: 429, json: async () => ({}) };
      return fakeFetch({
        'athena-model': { stance: 'tiger', confidence: 0.8, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
        'hades-model': { stance: 'tiger', confidence: 0.65, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
        'zeus-model': { verdict_type: 'CONSENSUS', answer: 'tiger', confidence: 0.7, rationale: ['two independent agents agree; the third was unreachable'], minority_view: null, unresolved: [], cited_evidence_ids: [] },
      })(url, init);
    }) as unknown as typeof fetch;

    const result = await runCouncil('lion vs tiger?', evidence, enabledConfig, { getApiKey: () => 'sk-test', fetchImpl: flaky });

    expect(result.positions.ARES.degraded).toBe(true);
    expect(result.positions.ARES.degraded_reason).toBe('provider returned HTTP 429');
    expect(result.positions.ATHENA.degraded).toBe(false);
    expect(result.verdict.verdict.verdict_type).toBe('CONSENSUS');
    expect(result.trace.some((e) => e.kind === 'agent_degraded' && e.agent === 'ARES')).toBe(true);
  });

  it('never leaks the api key into the trace or the result', async () => {
    const fetchImpl = fakeFetch({
      'athena-model': { stance: 'tiger', confidence: 0.8, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
      'ares-model': { stance: 'tiger', confidence: 0.7, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
      'hades-model': { stance: 'tiger', confidence: 0.6, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
      'zeus-model': { verdict_type: 'CONSENSUS', answer: 'tiger', confidence: 0.7, rationale: [], minority_view: null, unresolved: [], cited_evidence_ids: [] },
    });
    const result = await runCouncil('lion vs tiger?', evidence, enabledConfig, { getApiKey: () => 'sk-live-do-not-leak', fetchImpl });
    expect(JSON.stringify(result)).not.toContain('sk-live-do-not-leak');
  });

  it('falls back cleanly, with zero network calls, when every agent is disabled', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (async () => { calls += 1; return { ok: true, status: 200, json: async () => ({}) }; }) as unknown as typeof fetch;
    const result = await runCouncil('lion vs tiger?', evidence, DEFAULT_REGISTRY_CONFIG, { getApiKey: () => null, fetchImpl });
    expect(calls).toBe(0);
    expect(result.positions.ATHENA.position.stance).toBe('insufficient_evidence');
    expect(result.model_diversity.label).toBe('none');
  });
});
