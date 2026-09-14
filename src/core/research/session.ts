/**
 * EVOLUTION 5.0 Phase H - ONE RESEARCH PASS, COMPOSED.
 *
 * `plan` decides what to look for, `execute` fetches it, `internal` searches what we already hold and
 * `normalize` turns documents into evidence with provenance. Each has been tested since EVOLUTION 4.0 and
 * none of them had a caller. This is the caller, and it lives in core rather than in the app so it can be
 * tested with injected providers instead of only against the live internet.
 *
 * Every dependency is passed in - providers, the knowledge index, `fetch`, the clock, the hash. The app's
 * `runResearch()` supplies the real ones; a test supplies stubs and gets the same code path.
 *
 * The composition rule this module defends: **it never invents a state to make the shape uniform.** When
 * the plan does not ask for an internal search, `internal_outcome` is null rather than a synthetic "empty"
 * carrying a fabricated index hash, because "we did not look" and "we looked and found nothing" are
 * different facts and a reader is entitled to both.
 */
import { Minter } from '../domain/build';
import type { InternalKnowledge, InternalOutcome } from '../knowledge/internal';
import { routeQuestion, type QuestionModel } from '../question/model';
import { executeResearch, type ResearchEvent, type ResearchExecution } from './execute';
import { mergeNormalization, normalizeExternal, normalizeInternal, type NormalizationReport } from './normalize';
import { planResearch, type ResearchPlan } from './plan';
import type { ResearchProvider } from './providers/types';

export interface ResearchInput {
  question: string;
  /** Off by default everywhere. Turning it on inserts a third party into the evidence chain. */
  proxyEnabled: boolean;
  /** Lowers the depth-derived call budget. Never raises it. */
  maxProviderCalls?: number;
}

export interface ResearchDeps {
  providers: ResearchProvider[];
  knowledge: InternalKnowledge;
  fetchImpl: typeof fetch;
  /** Read once by the caller and used for every timestamp in the pass, so one pass has one clock. */
  now: string;
  hash: (text: string) => Promise<string>;
  /** Builds the proxied url. Required when `proxyEnabled` is true; unused otherwise. */
  proxy?: ((url: string) => string) | null;
  timeoutMs?: number;
  clock?: () => number;
}

export interface ResearchOutcome {
  run_id: string;
  now: string;
  routed: QuestionModel;
  plan: ResearchPlan;
  execution: ResearchExecution;
  /** Null when retrieval retained no document at all. There is nothing to normalise, and none is invented. */
  external: NormalizationReport | null;
  /**
   * The internal search's own outcome, with its honest `empty` and `unavailable` states intact. Null when
   * the plan did not ask for an internal search - not the same as searching and finding nothing.
   */
  internal_outcome: InternalOutcome | null;
  internal: NormalizationReport | null;
  /** External and internal together. This is what a reader should judge an answer on. */
  merged: NormalizationReport;
}

export const researchRunId = (now: string): string => `RES-${now.replace(/[^0-9]/g, '').slice(0, 14)}`;

export async function research(
  input: ResearchInput,
  deps: ResearchDeps,
  onEvent?: (event: ResearchEvent) => void,
): Promise<ResearchOutcome> {
  const { now } = deps;
  const run_id = researchRunId(now);
  const routed = routeQuestion(input.question);

  const plan = planResearch(routed, {
    proxyEnabled: input.proxyEnabled,
    budget: input.maxProviderCalls === undefined ? undefined : { max_provider_calls: input.maxProviderCalls },
  });

  const execution = await executeResearch(plan, {
    providers: deps.providers,
    fetchImpl: deps.fetchImpl,
    now,
    // A provider must not reach for a proxy the operator did not enable, so this is null unless both the
    // switch is on and a builder was supplied.
    proxy: input.proxyEnabled ? (deps.proxy ?? null) : null,
    timeoutMs: deps.timeoutMs,
    onEvent,
    clock: deps.clock,
  });

  const internal_outcome = plan.internal.search ? await deps.knowledge.search(plan.internal.queries, { limit: 8 }) : null;

  const normalizeDeps = { minter: new Minter(run_id, () => now), now, question: input.question, hash: deps.hash };
  const external = execution.documents.length === 0 ? null : await normalizeExternal(execution.documents, normalizeDeps);
  const internal =
    internal_outcome !== null && internal_outcome.status === 'ok' && internal_outcome.hits.length > 0
      ? await normalizeInternal(internal_outcome.hits, normalizeDeps)
      : null;

  const parts = [external, internal].filter((r): r is NormalizationReport => r !== null);
  return { run_id, now, routed, plan, execution, external, internal_outcome, internal, merged: mergeNormalization(...parts) };
}
