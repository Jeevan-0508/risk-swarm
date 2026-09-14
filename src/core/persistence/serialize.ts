/**
 * Run persistence. A stored run is a fact about what the system published at a point in time, so it is
 * written whole — graph, outputs, policy, budget, log — and rehydrated through the same schema
 * validation a live run passes. A stored run that no longer parses is discarded rather than repaired:
 * a silently patched audit trail is worse than a missing one.
 */
import { z } from 'zod';
import { Edge, GraphNode } from '../domain/model';
import { RiskGraph } from '../domain/graph';
import type { RunResult } from '../orchestrator/run';

export const STORE_VERSION = 5;

const GraphJSON = z.object({ nodes: z.array(GraphNode), edges: z.array(Edge) });

/** Only the envelope is schema-checked. The outputs are the engine's own product, stored verbatim. */
const StoredRunSchema = z.object({
  store_version: z.literal(STORE_VERSION),
  run_id: z.string().min(1),
  question: z.string(),
  mode: z.string(),
  created_at: z.string().min(4),
  /** When the run settled. Nullable and defaulted like `request`, so a v3 record written before this field existed still parses with the stamp left null instead of being thrown away. A genuinely older record still fails on `store_version`, as it always did. */
  completed_at: z.string().nullable().default(null),
  status: z.string(),
  graph: GraphJSON,
  outputs: z.record(z.string(), z.unknown()),
  policy: z.record(z.string(), z.unknown()),
  attempts: z.number(),
  rework_history: z.array(z.string()),
  log: z.array(z.unknown()),
  spent: z.object({ agent_call: z.number(), retrieval: z.number(), tokens: z.number() }),
  benign_category_share: z.number(),
  /** SENTINEL's own report, stored verbatim like outputs and policy. Its absence is why STORE_VERSION bumped to 2: an older record has no way to satisfy this and is dropped, not backfilled. */
  sentinel: z.record(z.string(), z.unknown()),
  /** PULSE's own report, stored verbatim for the same reason - STORE_VERSION bumped to 3 for this one. */
  pulse: z.record(z.string(), z.unknown()),
  /** The Council's own transcript, stored verbatim like sentinel and pulse - STORE_VERSION bumped to 4 for this one. */
  deliberation: z.record(z.string(), z.unknown()),
  /**
   * Which knowledge the run convened over, and which seats it stood down. STORE_VERSION bumped to 5
   * for these two: a v4 record cannot satisfy them and is dropped, because a rehydrated run whose
   * participation defaulted to "everybody spoke" would put words in the mouth of a seat that abstained.
   */
  pack: z.object({ id: z.string().min(1), label: z.string().min(1), summary: z.string() }),
  participation: z.array(z.object({ agent: z.string().min(1), participating: z.boolean(), reason: z.string().min(1) })),
  /** The request that produced the run, stored opaquely: provenance, never re-interpreted here. */
  request: z.record(z.string(), z.unknown()).nullable().default(null),
  human: z
    .object({ verdict: z.string(), band: z.string(), note: z.string(), at: z.string() })
    .nullable()
    .default(null),
});

export type StoredRunRecord = z.infer<typeof StoredRunSchema>;

export interface RunEnvelope {
  mode: string;
  created_at: string;
  completed_at: string | null;
  status: string;
  request: Record<string, unknown> | null;
  human: StoredRunRecord['human'];
}

export function serializeRun(result: RunResult, envelope: RunEnvelope): StoredRunRecord {
  return {
    store_version: STORE_VERSION,
    run_id: result.run_id,
    question: result.question,
    mode: envelope.mode,
    created_at: envelope.created_at,
    completed_at: envelope.completed_at,
    status: envelope.status,
    graph: result.graph.toJSON(),
    outputs: result.outputs as unknown as Record<string, unknown>,
    policy: result.policy as unknown as Record<string, unknown>,
    attempts: result.attempts,
    rework_history: result.rework_history,
    log: result.log,
    spent: result.spent,
    benign_category_share: result.benign_category_share,
    sentinel: result.sentinel as unknown as Record<string, unknown>,
    pulse: result.pulse as unknown as Record<string, unknown>,
    deliberation: result.deliberation as unknown as Record<string, unknown>,
    pack: result.pack,
    participation: result.participation,
    request: envelope.request,
    human: envelope.human,
  };
}

export interface RehydratedRun {
  record: StoredRunRecord;
  result: RunResult;
}

/** Returns null for anything that does not parse. Callers drop it; nothing is inferred or defaulted. */
export function deserializeRun(raw: unknown): RehydratedRun | null {
  const parsed = StoredRunSchema.safeParse(raw);
  if (!parsed.success) return null;
  const record = parsed.data;
  let graph: RiskGraph;
  try {
    graph = RiskGraph.fromJSON(record.graph);
  } catch {
    return null;
  }
  const result = {
    run_id: record.run_id,
    question: record.question,
    graph,
    outputs: record.outputs,
    policy: record.policy,
    attempts: record.attempts,
    rework_history: record.rework_history,
    log: record.log,
    spent: record.spent,
    benign_category_share: record.benign_category_share,
    sentinel: record.sentinel,
    pulse: record.pulse,
    deliberation: record.deliberation,
    pack: record.pack,
    participation: record.participation,
  } as unknown as RunResult;
  return { record, result };
}

/** Where a run is kept. Deliberately tiny so the browser, a file and a test can all satisfy it. */
export interface RunStore {
  list(): StoredRunRecord[];
  save(record: StoredRunRecord): void;
  remove(run_id: string): void;
  clear(): void;
}

export function memoryStore(seed: StoredRunRecord[] = []): RunStore {
  let rows = [...seed];
  return {
    list: () => [...rows],
    save: (record) => {
      rows = [record, ...rows.filter((r) => r.run_id !== record.run_id)];
    },
    remove: (run_id) => {
      rows = rows.filter((r) => r.run_id !== run_id);
    },
    clear: () => {
      rows = [];
    },
  };
}

/**
 * A store over any Web Storage implementation. Runs are kept one key each so a single corrupt record
 * cannot take the rest of the history with it.
 */
export function webStorageStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>, prefix = 'risk-swarm:run:'): RunStore {
  const keys = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k !== null && k.startsWith(prefix)) out.push(k);
    }
    return out;
  };
  return {
    list: () => {
      const rows: StoredRunRecord[] = [];
      for (const k of keys()) {
        const raw = storage.getItem(k);
        if (raw === null) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          storage.removeItem(k);
          continue;
        }
        const ok = StoredRunSchema.safeParse(parsed);
        if (ok.success) rows.push(ok.data);
        else storage.removeItem(k);
      }
      return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    save: (record) => storage.setItem(`${prefix}${record.run_id}`, JSON.stringify(record)),
    remove: (run_id) => storage.removeItem(`${prefix}${run_id}`),
    clear: () => {
      for (const k of keys()) storage.removeItem(k);
    },
  };
}
