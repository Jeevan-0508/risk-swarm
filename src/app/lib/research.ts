/**
 * Browser wiring for open research. This is the only application module that reaches the public internet.
 */
import { contentHash } from '@core/sources/hash';
import { allProviders } from '@core/research/providers/registry';
import { createInternalKnowledge } from '@core/knowledge/internal';
import { research, type ResearchDeps, type ResearchInput, type ResearchOutcome } from '@core/research/session';
import type { ResearchEvent } from '@core/research/execute';
import { snapshotLoader } from '@app/lib/engine';
import { routeQuestion } from '@core/question/model';

export type { ResearchInput, ResearchOutcome };

export const READER_PROXY_HOST = 'https://r.jina.ai/';
export const readerProxy = (url: string): string => `${READER_PROXY_HOST}${url}`;

function browserDeps(): ResearchDeps {
  return {
    providers: allProviders(),
    knowledge: createInternalKnowledge(snapshotLoader()),
    fetchImpl: globalThis.fetch.bind(globalThis),
    now: new Date().toISOString(),
    hash: contentHash,
    proxy: readerProxy,
  };
}

/**
 * Comparison questions keep the operator's exact wording as the first research seed. The planner still
 * creates additional evidence dimensions, but the system never replaces "which is better tiger or lion"
 * with a guessed subject phrase before retrieval starts.
 */
export const runResearch = (input: ResearchInput, onEvent?: (e: ResearchEvent) => void): Promise<ResearchOutcome> => {
  const routed = routeQuestion(input.question);
  const exactSeed = routed.intent === 'comparison' ? `"${input.question.trim()}"` : input.question;
  return research({ ...input, question: exactSeed }, browserDeps(), onEvent);
};
