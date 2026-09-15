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
    // Three deterministic fallbacks that happen to agree are not a genuine consensus (TASK 4).
    expect(result.disagreement.independent_count).toBe(0);
    expect(result.disagreement.agreement).toBe('inconclusive');
    expect(result.trace.some((e) => e.kind === 'disagreement_assessed' && e.detail.includes('No independent LLM positions available'))).toBe(true);
  });

  /**
   * The exact shape of a real tester's first run: one Olympian (ARES) enabled and keyed against
   * OpenRouter, the other three left at their out-of-the-box disabled default. The Council must not
   * assume all four are available, must not crash for the missing three, and must not silently
   * upgrade to a fuller roster on its own.
   */
  it('runs correctly with exactly one Olympian enabled (ARES/OpenRouter) and the rest at their disabled default', async () => {
    const oneAgentConfig: RegistryConfig = {
      ...DEFAULT_REGISTRY_CONFIG,
      ARES: { provider: 'openrouter', model: 'openrouter/free', enabled: true },
    };
    let calls = 0;
    const fetchImpl: typeof fetch = (async (...args: Parameters<typeof fetch>) => {
      calls += 1;
      return fakeFetch({
        'openrouter/free': { stance: 'tiger', confidence: 0.72, reasoning_summary: 'tiger wins a straight contest', claims: [], evidence_ids: ['EV-001'], evidence_requests: [], assumptions: [] },
      })(...args);
    }) as unknown as typeof fetch;

    const result = await runCouncil('which is better in combat: a tiger or a lion?', evidence, oneAgentConfig, { getApiKey: (p) => (p === 'openrouter' ? 'sk-test' : null), fetchImpl });

    expect(calls).toBe(1);
    expect(result.model_diversity.active_agents).toBe(1);
    expect(result.positions.ARES.provider).toBe('llm:openrouter/free');
    expect(result.positions.ARES.position.stance).toBe('tiger');
    expect(result.positions.ARES.degraded).toBe(false);
    expect(result.positions.ATHENA.provider).toBe('deterministic');
    expect(result.positions.ATHENA.position.stance).toBe('insufficient_evidence');
    expect(result.positions.HADES.provider).toBe('deterministic');
    expect(result.verdict.provider).toBe('deterministic');
    expect(result.verdict.verdict.verdict_type).not.toBe(undefined);
    expect(result.trace.some((e) => e.kind === 'agent_called' && e.agent === 'ARES' && e.detail.includes('openrouter/free'))).toBe(true);
    expect(result.trace.some((e) => e.kind === 'agent_called' && e.agent === 'ATHENA' && e.detail.includes('deterministic fallback'))).toBe(true);
    expect(result.trace.some((e) => e.kind === 'zeus_called' && e.detail.includes('mechanically'))).toBe(true);
    // Exactly one genuine LLM position (ARES); ATHENA/HADES are deterministic fallback and must not
    // inflate the independent count or be counted toward a "consensus" (TASK 4).
    expect(result.disagreement.independent_count).toBe(1);
    expect(result.disagreement.agreement).toBe('inconclusive');
  });

  /**
   * Reproduces the live-debug report verbatim: ARES/OpenRouter/openrouter-free enabled, the provider
   * answers HTTP 200 with a `choices` array whose `message.content` is empty. This must never surface
   * as the old bare "empty response" — it must say plainly that the call succeeded but returned nothing
   * usable, and it must never be silently treated as a real independent position.
   */
  it('ARES/OpenRouter empty-content response degrades with a precise reason, not a silent "empty response"', async () => {
    const oneAgentConfig: RegistryConfig = {
      ...DEFAULT_REGISTRY_CONFIG,
      ARES: { provider: 'openrouter', model: 'openrouter/free', enabled: true },
    };
    const fetchImpl: typeof fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }),
    })) as unknown as typeof fetch;

    const result = await runCouncil('which is better in combat: a tiger or a lion?', evidence, oneAgentConfig, { getApiKey: (p) => (p === 'openrouter' ? 'sk-test' : null), fetchImpl });

    expect(result.positions.ARES.degraded).toBe(true);
    expect(result.positions.ARES.degraded_reason).toBe('provider returned HTTP 200 — no usable assistant content');
    expect(result.positions.ARES.provider).toBe('llm:openrouter/free');
    expect(result.disagreement.independent_count).toBe(0);
    expect(result.verdict.provider).toBe('deterministic');
    expect(result.verdict.verdict.unresolved.some((u) => u.includes('No independent LLM positions available'))).toBe(true);
  });

  /**
   * TASK 3 of the live-timeout brief: the trace must show when a real request started and how long it
   * actually took, without inventing a number for a deterministic fallback that never made a call.
   */
  it('records request-started and response-latency observability in the trace for a real model call', async () => {
    const fetchImpl = fakeFetch({
      'athena-model': { stance: 'tiger', confidence: 0.8, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
      'ares-model': { stance: 'tiger', confidence: 0.7, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
      'hades-model': { stance: 'tiger', confidence: 0.6, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
      'zeus-model': { verdict_type: 'CONSENSUS', answer: 'tiger', confidence: 0.7, rationale: [], minority_view: null, unresolved: [], cited_evidence_ids: [] },
    });
    const result = await runCouncil('lion vs tiger?', evidence, enabledConfig, { getApiKey: () => 'sk-test', fetchImpl });

    expect(result.trace.some((e) => e.kind === 'agent_called' && e.agent === 'ARES' && e.detail.includes('request started'))).toBe(true);
    expect(result.trace.some((e) => e.kind === 'position_ready' && e.agent === 'ARES' && e.detail.includes('provider response received in'))).toBe(true);
    // A disabled agent's deterministic fallback trace line must not claim a fabricated latency measurement.
    const oneAgentConfig: RegistryConfig = { ...DEFAULT_REGISTRY_CONFIG, ARES: { provider: 'openrouter', model: 'openrouter/free', enabled: true } };
    const partial = await runCouncil('lion vs tiger?', evidence, oneAgentConfig, {
      getApiKey: (p) => (p === 'openrouter' ? 'sk-test' : null),
      fetchImpl: fakeFetch({ 'openrouter/free': { stance: 'tiger', confidence: 0.7, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] } }),
    });
    expect(partial.trace.some((e) => e.kind === 'position_ready' && e.agent === 'ATHENA' && e.detail.includes('provider response received in'))).toBe(false);
  });

  /**
   * EVOLUTION 6.0 Phase 1.7: the second real Olympian coming online. ATHENA on OpenAI, ARES on
   * OpenRouter — deliberately different providers, mirroring the live setup this brief describes —
   * with HADES/ZEUS left at their disabled default, exactly as a real tester adding a second key
   * would leave them. Both must reason independently in the same run, and the run must record each
   * one's actual provider/model identity distinctly rather than a shared or generic label.
   */
  it('runs correctly with ATHENA (OpenAI) and ARES (OpenRouter) both enabled as real, independent Olympians', async () => {
    const twoAgentConfig: RegistryConfig = {
      ...DEFAULT_REGISTRY_CONFIG,
      ATHENA: { provider: 'openai', model: 'gpt-4o-mini', enabled: true },
      ARES: { provider: 'openrouter', model: 'openrouter/free', enabled: true },
    };
    const sentBodies: Array<{ model: string; raw: string }> = [];
    const fetchImpl: typeof fetch = (async (url: string, init?: RequestInit) => {
      const raw = init?.body as string;
      sentBodies.push({ model: (JSON.parse(raw) as { model: string }).model, raw });
      return fakeFetch({
        'gpt-4o-mini': { stance: 'jupiter', confidence: 0.85, reasoning_summary: 'evidence favors jupiter by diameter', claims: ['Jupiter is the largest planet'], evidence_ids: ['EV-001'], evidence_requests: [], assumptions: [] },
        'openrouter/free': { stance: 'jupiter', confidence: 0.72, reasoning_summary: 'contest goes to jupiter on raw size', claims: ['Jupiter wins on diameter'], evidence_ids: ['EV-001'], evidence_requests: [], assumptions: [] },
      })(url, init);
    }) as unknown as typeof fetch;

    const result = await runCouncil(
      'which is bigger: mercury or jupiter?',
      evidence,
      twoAgentConfig,
      { getApiKey: (p) => (p === 'openai' || p === 'openrouter' ? 'sk-test' : null), fetchImpl },
    );

    expect(sentBodies).toHaveLength(2);
    expect(result.positions.ATHENA.provider).toBe('llm:gpt-4o-mini');
    expect(result.positions.ARES.provider).toBe('llm:openrouter/free');
    expect(result.positions.ATHENA.degraded).toBe(false);
    expect(result.positions.ARES.degraded).toBe(false);
    expect(result.positions.HADES.provider).toBe('deterministic');
    expect(result.verdict.provider).toBe('deterministic'); // ZEUS untouched — still no LLM per TASK scope
    expect(result.model_diversity.active_agents).toBe(2);
    expect(result.model_diversity.providers).toBe(2);
    expect(result.disagreement.independent_count).toBe(2);
    expect(result.trace.some((e) => e.kind === 'agent_called' && e.agent === 'ATHENA' && e.detail.includes('openai/gpt-4o-mini'))).toBe(true);
    expect(result.trace.some((e) => e.kind === 'agent_called' && e.agent === 'ARES' && e.detail.includes('openrouter/openrouter/free'))).toBe(true);

    // Independence: each outbound request body was built and sent before either response existed,
    // so neither can carry the other's model name or persona — pinned explicitly, not just assumed.
    const athenaBody = sentBodies.find((b) => b.model === 'gpt-4o-mini')!.raw;
    const aresBody = sentBodies.find((b) => b.model === 'openrouter/free')!.raw;
    expect(athenaBody).not.toContain('openrouter/free');
    expect(athenaBody).not.toContain('ARES');
    expect(aresBody).not.toContain('gpt-4o-mini');
    expect(aresBody).not.toContain('ATHENA');
  });

  /**
   * Fault isolation has to hold in both directions. The existing test above this one proves ARES
   * failing does not break ATHENA/HADES; this proves the same when ATHENA is the one that fails —
   * ARES must still return its own real, non-degraded position from the same run.
   */
  it('isolates ATHENA\'s provider failure too: ARES still reaches a real, non-degraded position', async () => {
    const twoAgentConfig: RegistryConfig = {
      ...DEFAULT_REGISTRY_CONFIG,
      ATHENA: { provider: 'openai', model: 'gpt-4o-mini', enabled: true },
      ARES: { provider: 'openrouter', model: 'openrouter/free', enabled: true },
    };
    const flaky: typeof fetch = (async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      if (body.model === 'gpt-4o-mini') return { ok: false, status: 500, json: async () => ({ error: { message: 'internal error' } }) };
      return fakeFetch({
        'openrouter/free': { stance: 'jupiter', confidence: 0.7, reasoning_summary: 'a', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
      })(url, init);
    }) as unknown as typeof fetch;

    const result = await runCouncil('which is bigger: mercury or jupiter?', evidence, twoAgentConfig, { getApiKey: () => 'sk-test', fetchImpl: flaky });

    expect(result.positions.ATHENA.degraded).toBe(true);
    expect(result.positions.ATHENA.degraded_reason).toContain('HTTP 500');
    expect(result.positions.ARES.degraded).toBe(false);
    expect(result.positions.ARES.position.stance).toBe('jupiter');
    expect(result.trace.some((e) => e.kind === 'agent_degraded' && e.agent === 'ATHENA')).toBe(true);
  });

  /**
   * Mirror of the existing "ARES only" test above: with ATHENA the one real, keyed Olympian and
   * everything else left at the disabled default, the Council must not assume ARES/HADES are
   * available, and ARES's deterministic fallback must not be mistaken for an independent opinion.
   */
  it('runs correctly with exactly one Olympian enabled (ATHENA/OpenAI) and the rest at their disabled default', async () => {
    const oneAgentConfig: RegistryConfig = { ...DEFAULT_REGISTRY_CONFIG, ATHENA: { provider: 'openai', model: 'gpt-4o-mini', enabled: true } };
    const result = await runCouncil(
      'which planet has the largest diameter, mercury or jupiter?',
      evidence,
      oneAgentConfig,
      { getApiKey: (p) => (p === 'openai' ? 'sk-test' : null), fetchImpl: fakeFetch({ 'gpt-4o-mini': { stance: 'jupiter', confidence: 0.8, reasoning_summary: 'a', claims: [], evidence_ids: ['EV-001'], evidence_requests: [], assumptions: [] } }) },
    );

    expect(result.model_diversity.active_agents).toBe(1);
    expect(result.positions.ATHENA.provider).toBe('llm:gpt-4o-mini');
    expect(result.positions.ATHENA.degraded).toBe(false);
    expect(result.positions.ARES.provider).toBe('deterministic');
    expect(result.positions.ARES.position.stance).toBe('insufficient_evidence');
    expect(result.verdict.provider).toBe('deterministic');
    expect(result.disagreement.independent_count).toBe(1);
  });

});
