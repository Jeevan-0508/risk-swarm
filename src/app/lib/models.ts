/**
 * EVOLUTION 6.0 — client-side key + model-assignment storage. Same guarded-localStorage discipline as
 * `persist.ts`'s lesson ledger: every call is wrapped, a full or hostile storage degrades to doing
 * nothing rather than crashing the screen, and nothing here is durable by promise, only by best effort.
 *
 * Keys and assignments are stored under separate keys so a "clear keys" action can wipe credentials
 * without discarding which provider/model the user picked for each Olympian.
 */
import { DEFAULT_REGISTRY_CONFIG, OLYMPIAN_AGENTS, PROVIDERS, type OlympianAgent, type ProviderId, type RegistryConfig } from '@core/reasoner/registry';

const KEYS_STORAGE_KEY = 'risk-swarm:model-keys';
const ASSIGNMENTS_STORAGE_KEY = 'risk-swarm:model-assignments';

export type ApiKeys = Partial<Record<ProviderId, string>>;

export function restoreApiKeys(): ApiKeys {
  try {
    const raw = window.localStorage.getItem(KEYS_STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: ApiKeys = {};
    for (const p of Object.keys(PROVIDERS) as ProviderId[]) if (typeof parsed[p] === 'string' && parsed[p]) out[p] = parsed[p] as string;
    return out;
  } catch {
    return {};
  }
}

export function persistApiKeys(keys: ApiKeys): void {
  try {
    window.localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch { /* a key that cannot be saved is a convenience lost, not a reason to fail the screen */ }
}

export function clearApiKeys(): void {
  try {
    window.localStorage.removeItem(KEYS_STORAGE_KEY);
  } catch { /* nothing to do */ }
}

export function restoreAssignments(): RegistryConfig {
  try {
    const raw = window.localStorage.getItem(ASSIGNMENTS_STORAGE_KEY);
    if (raw === null) return DEFAULT_REGISTRY_CONFIG;
    const parsed = JSON.parse(raw) as Partial<RegistryConfig>;
    const out = { ...DEFAULT_REGISTRY_CONFIG };
    for (const agent of OLYMPIAN_AGENTS) {
      const a = parsed[agent];
      if (a && typeof a.model === 'string' && typeof a.enabled === 'boolean' && a.provider in PROVIDERS) out[agent] = { provider: a.provider as ProviderId, model: a.model, enabled: a.enabled };
    }
    return out;
  } catch {
    return DEFAULT_REGISTRY_CONFIG;
  }
}

export function persistAssignments(config: RegistryConfig): void {
  try {
    window.localStorage.setItem(ASSIGNMENTS_STORAGE_KEY, JSON.stringify(config));
  } catch { /* history is a convenience, never a blocker */ }
}

export function agentLabel(agent: OlympianAgent): string {
  return agent === 'ZEUS' ? 'ZEUS — judge / synthesis' : agent === 'ATHENA' ? 'ATHENA — evidence / analysis' : agent === 'ARES' ? 'ARES — adversarial / competitive' : 'HADES — devil\'s advocate';
}
