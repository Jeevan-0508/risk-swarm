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
import { routeQuestion, type QuestionModel } from '../question/model';
import type { KnowledgePack } from '../packs/types';

export type Route = 'investigation' | 'research';

export interface RouteDecision {
  route: Route;
  reason: string;
}

export interface RouteOptions {
  /** An operator-selected pack is an explicit request to run that pack's pipeline. */
  explicitPackOverride?: boolean;
  /** Low-level diagnostic callers may explicitly force the freight stages; never inferred by the UI. */
  forceFreight?: boolean;
}

/**
 * The one pipeline boundary. A pack alone is not enough: the question and the pack's own vocabulary
 * must agree before freight retrieval is allowed. An explicit operator override is retained as an
 * intentional escape hatch, but it is carried by the call rather than inferred from UI state.
 */
export function routeToPipeline(question: string | QuestionModel, pack: KnowledgePack, options: RouteOptions = {}): RouteDecision {
  const routed = typeof question === 'string' ? routeQuestion(question) : question;

  if (options.forceFreight) {
    return {
      route: 'investigation',
      reason: 'The caller explicitly selected the freight pipeline. This override is recorded at the core boundary.',
    };
  }

  if (options.explicitPackOverride) {
    return {
      route: pack.supports.taxonomy_matching ? 'investigation' : 'research',
      reason: `The operator explicitly selected the "${pack.label}" pack. That choice is recorded and is the only override of automatic routing.`,
    };
  }

  if (!pack.supports.taxonomy_matching) {
    return {
      route: 'research',
      reason: `The "${pack.label}" pack carries no pinned taxonomy for this question. An investigation would send the scout at freight-specific feeds it has no vocabulary to match, and report a false "not configured" retrieval failure instead of a real one. Open research retrieves from the live web instead.`,
    };
  }

  if (routed.domain === 'general') {
    return {
      route: 'research',
      reason: 'The question has no expert-pack domain match, so the freight pipeline is not allowed to retrieve it as freight. Open research retrieves the full question instead.',
    };
  }

  return {
    route: 'investigation',
    reason: `The "${pack.label}" pack's own vocabulary matched this question, so its pinned taxonomy and governance snapshots apply.`,
  };
}
