/**
 * EVOLUTION 5.0 Phase H - the browser wiring for a research pass. The composition itself lives in
 * `core/research/session.ts`, which is testable with stub providers; this file supplies the real
 * dependencies and nothing else, so the only thing that can differ between a test and production is the
 * providers and the clock.
 *
 * This is the only module in the app that reaches the public internet.
 */
import { contentHash } from '@core/sources/hash';
import { allProviders } from '@core/research/providers/registry';
import { createInternalKnowledge } from '@core/knowledge/internal';
import { research, type ResearchDeps, type ResearchInput, type ResearchOutcome } from '@core/research/session';
import type { ResearchEvent } from '@core/research/execute';
import { snapshotLoader } from '@app/lib/engine';

export type { ResearchInput, ResearchOutcome };

/**
 * The reader proxy, named here rather than hidden inside a provider. It is a third party that fetches a url
 * and returns its text, which is exactly why it is opt-in: enabling it means a stranger sits between this
 * system and the source and could in principle alter what is read. Every document that arrives this way
 * carries `via_proxy: true` on its provenance, permanently, so a reader can weigh that themselves.
 */
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

export const runResearch = (input: ResearchInput, onEvent?: (e: ResearchEvent) => void): Promise<ResearchOutcome> =>
  research(input, browserDeps(), onEvent);
