/**
 * EVOLUTION 6.0 — the model registry. Maps each Olympian to a provider and a model, and builds the
 * real `Reasoner` for it. An agent with no key or `enabled: false` gets the deterministic reasoner —
 * never a broken one, never a silently-skipped one.
 *
 * This is the seam the follow-up brief calls "the model must be changeable without rewriting agent
 * logic": `positions.ts`/`deliberate.ts` depend only on `Reasoner`, never on a provider name.
 */
import { createDeterministicReasoner } from './deterministic';
import { createGeminiReasoner } from './gemini';
import { createLlmReasoner } from './llm';
import type { Reasoner } from './types';

export type ProviderId = 'openai' | 'openrouter' | 'google';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  family: string;
  /** Whether a real browser `fetch` can reach this provider directly with a user-supplied key. */
  browser_access: 'direct' | 'requires_beta_header' | 'blocked';
  key_help_url: string;
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  openai: { id: 'openai', label: 'OpenAI', family: 'gpt', browser_access: 'direct', key_help_url: 'https://platform.openai.com/api-keys' },
  openrouter: { id: 'openrouter', label: 'OpenRouter', family: 'varies (gateway to many open-weight and proprietary models)', browser_access: 'direct', key_help_url: 'https://openrouter.ai/keys' },
  google: { id: 'google', label: 'Google Gemini', family: 'gemini', browser_access: 'direct', key_help_url: 'https://aistudio.google.com/apikey' },
};

export const OLYMPIAN_AGENTS = ['ATHENA', 'ARES', 'HADES', 'ZEUS'] as const;
export type OlympianAgent = typeof OLYMPIAN_AGENTS[number];

export interface ModelAssignment {
  provider: ProviderId;
  model: string;
  enabled: boolean;
}

export type RegistryConfig = Record<OlympianAgent, ModelAssignment>;

/**
 * Deliberately disabled out of the box: Council Mode must be an explicit opt-in, never a surprise
 * network call the first time a user opens the Research screen. Model names are starting suggestions,
 * not a hard-coded dependency — the registry accepts whatever model string the user types.
 *
 * ARES's suggestion (EVOLUTION 6.0 Phase 1.7b live-debug brief): a live run against `openrouter/free`
 * came back HTTP 200, `finish_reason: "length"`, no final content. `openrouter/free` is not itself a
 * model — it is OpenRouter's own dynamic router over a pool of free models, and can land on one whose
 * reasoning mode defaults on, which spends the whole shared output-token budget on reasoning tokens
 * before it ever emits an answer. `google/gemma-4-31b-it:free` is a specific, currently-listed $0
 * model, verified live against OpenRouter's own `/api/v1/models` rather than guessed: its `reasoning`
 * capability reports `{ mandatory: false, default_enabled: false }`, so it will not spend budget on
 * reasoning unless a caller opts in, which this adapter never does, and it supports `response_format`
 * — well suited to the short, single-JSON-value analytical positions Council agents produce, without
 * paying a deep-reasoning tax on every proposal. `openrouter/free` remains fully valid to type into
 * this same field; this only changes the suggestion a fresh, unopened Model Config screen starts with.
 *
 * HADES's suggestion (EVOLUTION 6.0 Phase 1.10 live-debug brief): a live run against `gemini-1.5-flash`
 * came back HTTP 404 - checked against Google's own model list (ai.google.dev/gemini-api/docs/models,
 * live on the day this was diagnosed), the 1.5 generation is gone entirely and even 2.0 is now marked
 * "Shut down". `gemini-2.5-flash` is the oldest generation still listed as stable and is Google's own
 * description of the price-performance choice for "low-latency, high-volume tasks that require
 * reasoning" - closer to this Council's actual call shape than reaching for whatever is newest, which
 * on this lineup's release cadence is also the soonest to be retired next. Every generation from 2.5
 * onward defaults its "thinking" mode on, which is the exact same failure this comment already
 * describes for ARES's free-model router - the whole output budget spent on invisible reasoning
 * tokens before any visible answer - so `gemini.ts` explicitly sends `thinkingConfig.thinkingBudget: 0`
 * on every call, the same "never opt in to reasoning" discipline already applied to the ARES adapter.
 */
export const DEFAULT_REGISTRY_CONFIG: RegistryConfig = {
  ATHENA: { provider: 'openai', model: 'gpt-4o-mini', enabled: false },
  ARES: { provider: 'openrouter', model: 'google/gemma-4-31b-it:free', enabled: false },
  HADES: { provider: 'google', model: 'gemini-2.5-flash', enabled: false },
  ZEUS: { provider: 'openai', model: 'gpt-4o-mini', enabled: false },
};

const PROVIDER_ENDPOINT: Record<'openai' | 'openrouter', string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
};

export interface RegistryDeps {
  getApiKey: (provider: ProviderId) => string | null;
  fetchImpl?: typeof fetch;
  maxOutputTokens?: number;
}

export function reasonerFor(assignment: ModelAssignment, deps: RegistryDeps): Reasoner {
  if (!assignment.enabled) return createDeterministicReasoner();
  const getApiKey = () => deps.getApiKey(assignment.provider);
  if (assignment.provider === 'google') {
    return createGeminiReasoner({ model: assignment.model, getApiKey, fetchImpl: deps.fetchImpl, maxOutputTokens: deps.maxOutputTokens });
  }
  return createLlmReasoner({ endpoint: PROVIDER_ENDPOINT[assignment.provider], model: assignment.model, getApiKey, fetchImpl: deps.fetchImpl, maxOutputTokens: deps.maxOutputTokens });
}

export function createOlympianReasoners(config: RegistryConfig, deps: RegistryDeps): Record<OlympianAgent, Reasoner> {
  const out = {} as Record<OlympianAgent, Reasoner>;
  for (const agent of OLYMPIAN_AGENTS) out[agent] = reasonerFor(config[agent], deps);
  return out;
}

export type DiversityLabel = 'none' | 'low' | 'moderate' | 'high';

/**
 * A real count over the actual configuration, not a vanity metric: how many distinct providers and
 * model families the *enabled, keyed* agents are actually spread across right now.
 */
export function modelDiversity(config: RegistryConfig, deps: RegistryDeps): { active_agents: number; providers: number; families: string[]; label: DiversityLabel } {
  const active = OLYMPIAN_AGENTS.filter((a) => config[a].enabled && deps.getApiKey(config[a].provider) !== null);
  const providers = new Set(active.map((a) => config[a].provider));
  const families = [...new Set(active.map((a) => PROVIDERS[config[a].provider].family))];
  const label: DiversityLabel = active.length === 0 ? 'none' : providers.size >= 3 ? 'high' : providers.size === 2 ? 'moderate' : 'low';
  return { active_agents: active.length, providers: providers.size, families, label };
}
