/**
 * Test and demo harness. Builds a real AgentContext over the pinned snapshots with a fixed clock,
 * so every run in tests and in demo mode is byte-for-byte reproducible.
 */
import { Minter, fixedClock } from '../domain/build';
import { createAtlasMatcher } from '../integrations/atlas';
import { createFomoSource, type SignalSource } from '../integrations/fomo';
import { createGovernanceMapper } from '../integrations/governance';
import { createDeterministicReasoner } from '../reasoner/deterministic';
import type { SnapshotLoader } from '../integrations/loader';
import type { Reasoner } from '../reasoner/types';
import type { AgentContext } from './types';

export class BudgetExceededError extends Error {
  constructor(readonly kind: string, readonly limit: number) {
    super(`BUDGET_EXCEEDED: ${kind} limit of ${limit} reached`);
    this.name = 'BudgetExceededError';
  }
}

export class RunAbortedError extends Error {
  constructor(reason: string) {
    super(`RUN_ABORTED: ${reason}`);
    this.name = 'RunAbortedError';
  }
}

export interface Budget {
  agent_call: number;
  retrieval: number;
  tokens: number;
}

export const DEFAULT_BUDGET: Budget = { agent_call: 24, retrieval: 400, tokens: 120_000 };

export interface Harness {
  ctx: AgentContext;
  spent: Budget;
  /** The resolved cap this run is metered against (defaults merged with whatever the caller supplied). */
  budget: Budget;
  abort: (reason: string) => void;
}

export function createHarness(options: {
  loader: SnapshotLoader;
  run_id: string;
  now: string;
  reasoner?: Reasoner;
  budget?: Partial<Budget>;
  /** LIVE mode supplies its own signal source. The taxonomy and governance snapshots stay pinned. */
  signals?: SignalSource;
}): Harness {
  const budget = { ...DEFAULT_BUDGET, ...options.budget };
  const spent: Budget = { agent_call: 0, retrieval: 0, tokens: 0 };
  let aborted: string | null = null;

  const ctx: AgentContext = {
    run_id: options.run_id,
    minter: new Minter(options.run_id, fixedClock(options.now)),
    now: options.now,
    reasoner: options.reasoner ?? createDeterministicReasoner(),
    tools: {
      // A live source may be supplied in place of the pinned snapshot. Nothing downstream branches on it.
      signals: options.signals ?? createFomoSource(options.loader),
      atlas: createAtlasMatcher(options.loader),
      governance: createGovernanceMapper(options.loader),
    },
    spend: (kind, amount = 1) => {
      spent[kind] += amount;
      if (spent[kind] > budget[kind]) throw new BudgetExceededError(kind, budget[kind]);
    },
    assertAlive: () => {
      if (aborted !== null) throw new RunAbortedError(aborted);
    },
  };

  return { ctx, spent, budget, abort: (reason) => { aborted = reason; } };
}
