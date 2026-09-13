/**
 * The browser's entry into the engine. The UI never recomputes a number the engine already published -
 * it is a renderer over `RunResult`, which is what keeps the screens and the audit trail identical.
 */
import { createFetchLoader, type SnapshotLoader } from '@core/integrations/loader';
import { investigate, type InvestigateOptions, type RunResult } from '@core/orchestrator/run';

export type Mode = 'DEMO' | 'SNAPSHOT' | 'LIVE';

export const MODE_NOTE: Record<Mode, string> = {
  DEMO: 'Pinned snapshots, fixed clock, fixed run id. Byte-for-byte reproducible; no model, no key.',
  SNAPSHOT: 'Pinned snapshots against the real clock. Reproducible knowledge, live timing.',
  LIVE: 'External public sources may be retrieved. Every item is still sanitised, tiered and hashed.',
};

/** Fixed instant for DEMO mode. Changing it changes the demo's ids, so it is a constant, not a default. */
export const DEMO_NOW = '2026-09-13T00:00:00.000Z';

export function snapshotLoader(): SnapshotLoader {
  const base = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/snapshots`;
  return createFetchLoader(base);
}

export interface StartInput {
  question: string;
  geo: string[];
  mode: string[];
  from: string;
  to: string;
  limit: number;
  budget: { agent_call: number; retrieval: number; tokens: number };
  automatedAction: boolean;
  reversibility: 'reversible' | 'hard_to_reverse' | 'irreversible';
}

export const DEMO_INPUT: StartInput = {
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  geo: ['DE', 'AT', 'CH'],
  mode: ['road'],
  from: '2024-09-01T00:00:00.000Z',
  to: '2026-09-01T00:00:00.000Z',
  limit: 40,
  budget: { agent_call: 24, retrieval: 400, tokens: 120_000 },
  automatedAction: false,
  reversibility: 'hard_to_reverse',
};

export function runOptions(input: StartInput, mode: Mode, runId: string, hooks: Pick<InvestigateOptions, 'onPhase' | 'onStart'>): InvestigateOptions {
  return {
    loader: snapshotLoader(),
    run_id: mode === 'DEMO' ? 'RUN-DEMO' : runId,
    now: mode === 'DEMO' ? DEMO_NOW : new Date().toISOString(),
    question: input.question,
    scope: { geo: input.geo, mode: input.mode, from: input.from, to: input.to },
    limit: input.limit,
    budget: input.budget,
    automatedAction: input.automatedAction,
    reversibility: input.reversibility,
    ...hooks,
  };
}

export const startRun = (options: InvestigateOptions): Promise<RunResult> => investigate(options);
