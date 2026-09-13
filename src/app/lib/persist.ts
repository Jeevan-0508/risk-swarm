/**
 * Browser persistence. localStorage is unavailable in some privacy modes and can be full, so every call
 * is guarded and a failure degrades to an in-memory store: history is a convenience, and losing it must
 * never take the running investigation down with it.
 */
import { deserializeRun, memoryStore, serializeRun, webStorageStore, type RunStore, type StoredRunRecord } from '@core/persistence/serialize';
import type { RunResult } from '@core/orchestrator/run';
import type { StoredRun } from '@app/store/session';
import type { Mode, StartInput } from '@app/lib/engine';

function pick(): { store: RunStore; durable: boolean } {
  try {
    const probe = 'risk-swarm:probe';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return { store: webStorageStore(window.localStorage), durable: true };
  } catch {
    return { store: memoryStore(), durable: false };
  }
}

const picked = pick();
export const historyIsDurable = picked.durable;
const store = picked.store;

export function persist(run: StoredRun): void {
  if (run.result === null) return;
  try {
    store.save(
      serializeRun(run.result, {
        mode: run.mode,
        created_at: run.created_at,
        completed_at: run.completed_at,
        status: run.status,
        request: run.input as unknown as Record<string, unknown>,
        human: run.human,
      }),
    );
  } catch {
    // A full or hostile storage is not a reason to interrupt the operator.
  }
}

export function forget(id: string): void {
  try {
    store.remove(id);
  } catch { /* nothing to do */ }
}

export function forgetAll(): void {
  try {
    store.clear();
  } catch { /* nothing to do */ }
}

/** Records that no longer parse are dropped by the store itself, so this only returns usable runs. */
export function restore(): StoredRun[] {
  let rows: StoredRunRecord[] = [];
  try {
    rows = store.list();
  } catch {
    return [];
  }
  const out: StoredRun[] = [];
  for (const row of rows) {
    const back = deserializeRun(row);
    if (back === null) continue;
    out.push({
      id: row.run_id,
      mode: row.mode as Mode,
      question: row.question,
      input: (row.request ?? {}) as unknown as StartInput,
      created_at: row.created_at,
      completed_at: row.completed_at,
      status: 'complete',
      result: back.result as RunResult,
      error: null,
      human: row.human === null ? null : { ...row.human, verdict: row.human.verdict as 'accepted' | 'overridden' | 'rejected' },
    });
  }
  return out;
}

const LESSON_KEY = 'risk-swarm:lessons';

/** The lesson ledger, including rejected entries: an invisible rejection hides an attempted attack. */
export function persistLessons(ledger: unknown): void {
  try {
    window.localStorage.setItem(LESSON_KEY, JSON.stringify(ledger));
  } catch { /* history is a convenience, never a blocker */ }
}

export function restoreLessons<T>(validate: (raw: unknown) => T[]): T[] {
  try {
    const raw = window.localStorage.getItem(LESSON_KEY);
    if (raw === null) return [];
    return validate(JSON.parse(raw));
  } catch {
    return [];
  }
}
