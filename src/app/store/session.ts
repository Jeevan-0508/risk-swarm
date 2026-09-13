/**
 * Session state. Deliberately thin: it holds runs and the human's verdicts, and it delegates every
 * judgement to the engine. Nothing here derives a severity, a confidence or a band.
 */
import { create } from 'zustand';
import type { PhaseLogEntry, RunResult } from '@core/orchestrator/run';
import type { Budget } from '@core/agents/harness';
import { DEMO_INPUT, liveSignalSource, runOptions, startRun, type Mode, type StartInput } from '@app/lib/engine';
import { forget, forgetAll, persist, persistLessons, restore, restoreLessons } from '@app/lib/persist';
import { Lesson, Outcome } from '@core/domain/model';
import { Minter, fixedClock } from '@core/domain/build';
import { activeLessons, buildLesson, buildOutcome, proposeLesson, vetLesson, type LessonLedgerEntry } from '@core/learning/lessons';
import type { LiveFetchResult } from '@core/sources/types';

export type RunStatus = 'running' | 'complete' | 'stopped' | 'failed';

export interface HumanVerdict {
  verdict: 'accepted' | 'overridden' | 'rejected';
  note: string;
  at: string;
  /** The band the human settled on. Recorded separately from the system's recommendation, always. */
  band: string;
}

export interface OutcomeInput {
  verdict: Outcome['verdict'];
  what_happened: string;
}

export interface StoredRun {
  id: string;
  mode: Mode;
  question: string;
  input: StartInput;
  created_at: string;
  /** When the run settled, however it settled. Null while it is still in flight. */
  completed_at: string | null;
  status: RunStatus;
  result: RunResult | null;
  error: string | null;
  human: HumanVerdict | null;
}

interface SessionState {
  mode: Mode;
  runs: StoredRun[];
  /** Accepted and rejected lessons alike. A rejected lesson stays visible on purpose. */
  lessons: LessonLedgerEntry[];
  activeId: string | null;
  /** Phases of the run in flight, appended as each one really completes. */
  live: PhaseLogEntry[];
  /** True only between start and settle. `live` keeps the last run's phases, so it cannot stand in for this. */
  running: boolean;
  /** What LIVE retrieval actually fetched, per run. Session-only: a hash is worth nothing once refetched. */
  retrieval: Record<string, LiveFetchResult>;
  spent: Budget | null;
  control: { abort: (reason: string) => void } | null;
  setMode: (mode: Mode) => void;
  select: (id: string | null) => void;
  start: (input: StartInput) => Promise<string>;
  stop: (reason: string) => void;
  recordVerdict: (id: string, verdict: HumanVerdict) => void;
  /** Writes what actually happened, then derives a lesson that may only tighten a gate. */
  recordOutcome: (id: string, input: OutcomeInput) => void;
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
  lessons: [],
  activeId: null,
  live: [],
  running: false,
  retrieval: {},
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
      completed_at: null, status: 'running', result: null, error: null, human: null,
    };
    set((s) => ({ runs: [run, ...s.runs], activeId: id, live: [], running: true, spent: null, control: null }));

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
        }, mode === 'DEMO' ? [] : activeLessonNodes(get().lessons),
          mode === 'LIVE'
            ? liveSignalSource(input, new Date().toISOString(), (r) => set((s) => ({ retrieval: { ...s.retrieval, [id]: r } })))
            : undefined),
      );
      patch({ status: 'complete', result, completed_at: new Date().toISOString() });
      const stored = get().runs.find((r) => r.id === id);
      if (stored !== undefined) persist(stored);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      patch({ status: message.startsWith('RunAbortedError') ? 'stopped' : 'failed', error: message, completed_at: new Date().toISOString() });
    } finally {
      set({ control: null, running: false });
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

  recordOutcome: (id, input) => {
    const run = get().runs.find((r) => r.id === id);
    if (run === undefined || run.result === null) return;
    const graph = run.result.graph;
    if (graph.all().some((n) => n.kind === 'outcome')) return;

    const decision = run.result.outputs.decision.decision;
    const minter = new Minter(run.result.run_id, fixedClock(new Date().toISOString()));
    const pattern_key = run.result.outputs.analyst.findings[0]?.match.pattern_id ?? null;

    const outcome = buildOutcome(minter, { decision, pattern_key, verdict: input.verdict, what_happened: input.what_happened });
    graph.add(outcome);
    graph.link({ from: outcome.id, to: decision.id, kind: 'derived_from', weight: 1, created_by: 'human' });

    const proposal = proposeLesson(outcome, { pattern_key, policy: run.result.policy });
    const lesson = buildLesson(minter, outcome, proposal);
    let ledger = get().lessons;
    if (lesson !== null) {
      graph.add(lesson);
      graph.link({ from: lesson.id, to: outcome.id, kind: 'derived_from', weight: 1, created_by: 'human' });
      ledger = [vetLesson(lesson, run.result.policy), ...ledger];
      persistLessons(ledger);
    }

    set((s) => ({ lessons: ledger, runs: s.runs.map((r) => (r.id === id ? { ...r } : r)) }));
    const updated = get().runs.find((r) => r.id === id);
    if (updated !== undefined) persist(updated);
  },

  hydrate: () => {
    set({ lessons: restoreLessons(parseLedger) });
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

/** Lessons in force, as nodes the engine accepts. Expired and rejected entries are excluded. */
export function activeLessonNodes(ledger: LessonLedgerEntry[]): Lesson[] {
  const live = new Set(activeLessons(ledger).map((l) => l.pattern_key));
  return ledger.filter((e) => e.accepted && live.has(e.lesson.pattern_key)).map((e) => e.lesson);
}

/** A stored ledger is validated node by node; anything that no longer parses is dropped. */
function parseLedger(raw: unknown): LessonLedgerEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LessonLedgerEntry[] = [];
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    const candidate = row as { lesson?: unknown; accepted?: unknown; rejected_reason?: unknown };
    const lesson = Lesson.safeParse(candidate.lesson);
    if (!lesson.success) continue;
    out.push({
      lesson: lesson.data,
      accepted: candidate.accepted === true,
      rejected_reason: typeof candidate.rejected_reason === 'string' ? candidate.rejected_reason : null,
    });
  }
  return out;
}
