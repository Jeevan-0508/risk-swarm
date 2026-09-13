/**
 * The browser's entry into the engine. The UI never recomputes a number the engine already published -
 * it is a renderer over `RunResult`, which is what keeps the screens and the audit trail identical.
 */
import { createFetchLoader, type SnapshotLoader } from '@core/integrations/loader';
import { investigate, type InvestigateOptions, type RunResult } from '@core/orchestrator/run';
import type { Lesson } from '@core/domain/model';
import { createLiveSource } from '@core/sources/live';
import { contentHash } from '@core/sources/hash';
import { industrySource, newsSource, regulatorySource, webSource } from '@core/sources/registry';
import type { FeedFailure, FetchedFeed, LiveSource } from '@core/sources/types';

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

export interface LiveConfig {
  /** Search terms sent to the news feed. Nothing is inferred from the question text. */
  terms: string[];
  regulatory: string[];
  industry: string[];
  web: string[];
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
  live: LiveConfig;
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
  live: {
    terms: ['freight fraud Germany', 'Frachtbetrug Spedition', 'phantom carrier haulage'],
    regulatory: [],
    industry: [],
    web: [],
  },
};

/** Built only for LIVE mode. The taxonomy and governance snapshots stay pinned in every mode. */
export function liveSignalSource(input: StartInput, now: string, onResult: (r: { feeds: FetchedFeed[]; failures: FeedFailure[] }) => void) {
  const sources: LiveSource[] = [newsSource()];
  if (input.live.regulatory.length > 0) sources.push(regulatorySource(input.live.regulatory));
  if (input.live.industry.length > 0) sources.push(industrySource(input.live.industry));
  if (input.live.web.length > 0) sources.push(webSource(input.live.web));
  return createLiveSource({
    sources,
    query: { terms: input.live.terms, geo: input.geo },
    deps: { fetchImpl: globalThis.fetch.bind(globalThis), hash: contentHash },
    now,
    onResult,
  });
}

export function runOptions(
  input: StartInput,
  mode: Mode,
  runId: string,
  hooks: Pick<InvestigateOptions, 'onPhase' | 'onStart'>,
  lessons: Lesson[] = [],
  signals?: InvestigateOptions['signals'],
): InvestigateOptions {
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
    lessons,
    signals,
    ...hooks,
  };
}

export const startRun = (options: InvestigateOptions): Promise<RunResult> => investigate(options);
