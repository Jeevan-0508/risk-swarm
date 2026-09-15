/**
 * EVOLUTION 6.0 — model configuration state. Thin, like `session.ts`: it holds what the user configured
 * and delegates every judgement (which reasoner to build, what counts as "diverse") to `core/reasoner`.
 */
import { create } from 'zustand';
import { modelDiversity, type OlympianAgent, type ProviderId, type RegistryConfig } from '@core/reasoner/registry';
import { clearApiKeys, persistApiKeys, persistAssignments, restoreApiKeys, restoreAssignments, type ApiKeys } from '@app/lib/models';

interface ModelStoreState {
  keys: ApiKeys;
  assignments: RegistryConfig;
  hydrated: boolean;
  hydrate: () => void;
  setKey: (provider: ProviderId, key: string) => void;
  clearKeys: () => void;
  setAssignment: (agent: OlympianAgent, patch: Partial<RegistryConfig[OlympianAgent]>) => void;
  getApiKey: (provider: ProviderId) => string | null;
  diversity: () => ReturnType<typeof modelDiversity>;
}

export const useModelStore = create<ModelStoreState>((set, get) => ({
  keys: {},
  assignments: restoreAssignments(),
  hydrated: false,
  hydrate: () => set({ keys: restoreApiKeys(), assignments: restoreAssignments(), hydrated: true }),
  setKey: (provider, key) => set((s) => {
    const keys = { ...s.keys, [provider]: key };
    persistApiKeys(keys);
    return { keys };
  }),
  clearKeys: () => {
    clearApiKeys();
    set({ keys: {} });
  },
  setAssignment: (agent, patch) => set((s) => {
    const assignments = { ...s.assignments, [agent]: { ...s.assignments[agent], ...patch } };
    persistAssignments(assignments);
    return { assignments };
  }),
  getApiKey: (provider) => get().keys[provider]?.trim() || null,
  diversity: () => modelDiversity(get().assignments, { getApiKey: get().getApiKey }),
}));
