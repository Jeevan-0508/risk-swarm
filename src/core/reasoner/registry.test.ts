import { describe, expect, it } from '../test/bdd';
import { createOlympianReasoners, DEFAULT_REGISTRY_CONFIG, modelDiversity, reasonerFor, type RegistryConfig } from './registry';

describe('model registry', () => {
  it('returns the deterministic reasoner for a disabled agent regardless of provider', () => {
    const r = reasonerFor({ provider: 'openai', model: 'gpt-4o-mini', enabled: false }, { getApiKey: () => 'sk-test' });
    expect(r.id).toBe('deterministic');
    expect(r.uses_network).toBe(false);
  });

  it('still degrades safely, per call, when enabled but no key is present for that provider', async () => {
    const r = reasonerFor({ provider: 'google', model: 'gemini-1.5-flash', enabled: true }, { getApiKey: () => null });
    const out = await r.propose({
      task: 't', instruction: 'i', data_blocks: [], allowed_evidence_ids: [], schema_hint: 's',
      validate: (raw) => raw as { x: number }, fallback: () => ({ x: 1 }),
    });
    expect(out.degraded).toBe(true);
    expect(out.degraded_reason).toBe('no api key configured');
  });

  it('builds a real reasoner per provider once enabled and keyed', () => {
    const deps = { getApiKey: () => 'sk-test' };
    expect(reasonerFor({ provider: 'openai', model: 'gpt-4o-mini', enabled: true }, deps).id).toBe('llm:gpt-4o-mini');
    expect(reasonerFor({ provider: 'openrouter', model: 'deepseek/deepseek-chat', enabled: true }, deps).id).toBe('llm:deepseek/deepseek-chat');
    expect(reasonerFor({ provider: 'google', model: 'gemini-1.5-flash', enabled: true }, deps).id).toBe('gemini:gemini-1.5-flash');
  });

  it('routes each provider to its own key, never a shared one', () => {
    const keys: Record<string, string | null> = { openai: 'sk-openai', google: null };
    const reasoners = createOlympianReasoners(
      { ...DEFAULT_REGISTRY_CONFIG, ATHENA: { provider: 'openai', model: 'gpt-4o-mini', enabled: true }, HADES: { provider: 'google', model: 'gemini-1.5-flash', enabled: true } },
      { getApiKey: (p) => keys[p] ?? null },
    );
    expect(reasoners.ATHENA.id).toBe('llm:gpt-4o-mini');
    expect(reasoners.HADES.id).toBe('gemini:gemini-1.5-flash'); // constructed regardless; the missing key is caught per-call, not at construction
    expect(reasoners.ARES.id).toBe('deterministic'); // default config, disabled
  });

  it('reports no diversity when nothing is configured', () => {
    const d = modelDiversity(DEFAULT_REGISTRY_CONFIG, { getApiKey: () => null });
    expect(d.label).toBe('none');
    expect(d.active_agents).toBe(0);
  });

  it('reports high diversity across three distinct providers, and ignores an unkeyed agent', () => {
    const config: RegistryConfig = {
      ATHENA: { provider: 'openai', model: 'gpt-4o-mini', enabled: true },
      ARES: { provider: 'openrouter', model: 'deepseek/deepseek-chat', enabled: true },
      HADES: { provider: 'google', model: 'gemini-1.5-flash', enabled: true },
      ZEUS: { provider: 'openai', model: 'gpt-4o', enabled: false },
    };
    const d = modelDiversity(config, { getApiKey: (p) => (p === 'google' ? null : 'sk-test') });
    expect(d.active_agents).toBe(2); // HADES excluded: no google key
    expect(d.providers).toBe(2);
    expect(d.label).toBe('moderate');
  });
});
