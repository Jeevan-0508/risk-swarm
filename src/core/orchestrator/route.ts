/**
 * ROUTE. Which pipeline a question belongs in: an investigation against a pinned pack, or open research
 * against the live web.
 *
 * The signal is the pack itself, not a second classifier invented for this. `recommendPack()` already
 * says, honestly, when no pack's own vocabulary matched a question - that is the open pack,
 * `supports.taxonomy_matching: false` - and the scout only ever retrieves against a pinned pack's
 * freight/RSS feed templates (`core/sources/*`). Sending a question with no matching vocabulary through
 * that pipeline is the exact failure this module exists to stop: the scout finds no feed template for the
 * query, `fetchFeeds()` reports `not_configured`, and every downstream agent receives zero evidence for a
 * question the open research engine (`core/research/session.ts`) already knows how to answer.
 *
 * This is a routing decision, not a permission check: the operator can still override the pack back to
 * an expert one (the existing override in New Investigation), and an explicit choice to investigate
 * anyway is respected exactly as it already was.
 */
import type { KnowledgePack } from '../packs/types';

export type Route = 'investigation' | 'research';

export interface RouteDecision {
  route: Route;
  reason: string;
}

export function routeToPipeline(pack: KnowledgePack): RouteDecision {
  if (!pack.supports.taxonomy_matching) {
    return {
      route: 'research',
      reason: `The "${pack.label}" pack carries no pinned taxonomy for this question. An investigation would send the scout at freight-specific feeds it has no vocabulary to match, and report a false "not configured" retrieval failure instead of a real one. Open research retrieves from the live web instead.`,
    };
  }
  return {
    route: 'investigation',
    reason: `The "${pack.label}" pack's own vocabulary matched this question, so its pinned taxonomy and governance snapshots apply.`,
  };
}
