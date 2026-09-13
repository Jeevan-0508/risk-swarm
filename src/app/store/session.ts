/**
 * Session state. Deliberately thin: it holds runs and the human's verdicts, and it delegates every
 * judgement to the engine. Nothing here derives a severity, a confidence or a band.
 */
import { create } from 'zustand';
import type { PhaseLogEntry, RunResult } from '@core/orchestrator/run';
import type { Budget } from '@core/agents/harness';
import { DEMO_INPUT, runOptions, startRun, type Mode, type StartInput } from '@app/lib/engine';
import { forget, forgetAll, persist, restore } from '@app/lib/persist';

export type RunStatus = 'running' | 'complete' | 'stopped' | 'failed';

export interface HumanVerdict {
  verdict: 'accepted' | 'overridden' | 'rejected';
  note: string;
  at: string;
  /** The band the human settled on. Recorded separately from the system's recommendation, always. */
  band: string;
}

export interface StoredRun {
  id: string;
  mode: Mode;
  question: string;
  input: StartInput;
  created_at: string;
  status: RunStatus;
  result: RunResult | null;
  error: string | null;
  human: HumanVerdict | null;
}

interface SessionState {
  mode: Mode;
  runs: StoredRun[];
  activeId: string | null;
  /** Phases of the run in flight, appended as each one really completes. */
  live: PhaseLogEntry[];
  spent: Budget | null;
  control: { abort: (reason: string) => void } | null;
  setMode: (mode: Mode) => void;
  select: (id: string | null) => void;
  start: (input: StartInput) => Promise<string>;
  stop: (reason: string) => void;
  recordVerdict: (id: string, verdict: HumanVerdict) => void;
  /** Reads finished runs back out of browser storage. Called once, from the app shell. */
  hydrate: () => void;
  discard: (id: string) => void;
  discardAll: () => void;
  active: () => StoredRun | null;
}

const nextId = () => `RUN-${Date.now().toString(36).toUpperCase()}`;
/** Paces the reveal on real phase completions. The engine finishes in about a second. */
const PHASE_PACE_MS = 420;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const useSession = create<SessionState>()((set, get) => ({
  mode: 'DEMO',
  runs: [],
  activeId: null,
  live: [],
  spent: null,
  control: null,

  setMode: (mode) => set({ mode }),
  select: (activeId) => set({ activeId }),
  active: () => get().runs.find((r) => r.id === get().activeId) ?? null,

  start: async (input) => {
    const id = nextId();
    const mode = get().mode;
    const run: StoredRun = {
      id, mode, question: input.question, input, created_at: new Date().toISOString(),
      status: 'running', result: null, error: null, human: null,
    };
    set((s) => ({ runs: [run, ...s.runs], activeId: id, live: [], spent: null, control: null }));

    const patch = (changes: Partial<StoredRun>) =>
      set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...changes } : r)) }));

    try {
      const result = await startRun(
        runOptions(input, mode, id, {
          onStart: (control) => set({ control }),
          onPhase: async (entry, spent) => {
            set((s) => ({ live: [...s.live, entry], spent }));
            await sleep(PHASE_PACE_MS);
          },
        }),
      );
      patch({ status: 'complete', result });
      const stored = get().runs.find((r) => r.id === id);
      if (stored !== undefined) persist(stored);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      patch({ status: message.startsWith('RunAbortedError') ? 'stopped' : 'failed', error: message });
    } finally {
      set({ control: null });
    }
    return id;
  },

  stop: (reason) => {
    get().control?.abort(reason);
  },

  recordVerdict: (id, human) => {
    set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, human } : r)) }));
    const stored = get().runs.find((r) => r.id === id);
    if (stored !== undefined) persist(stored);
  },

  hydrate: () => {
    const restored = restore();
    if (restored.length === 0) return;
    set((s) => {
      const known = new Set(s.runs.map((r) => r.id));
      const merged = [...s.runs, ...restored.filter((r) => !known.has(r.id))];
      merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { runs: merged, activeId: s.activeId ?? merged[0]?.id ?? null };
    });
  },

  discard: (id) => {
    forget(id);
    set((s) => ({ runs: s.runs.filter((r) => r.id !== id), activeId: s.activeId === id ? null : s.activeId }));
  },

  discardAll: () => {
    forgetAll();
    set({ runs: [], activeId: null });
  },
}));

export const demoInput = (): StartInput => ({ ...DEMO_INPUT });
