/**
 * Which pack to open for a question the operator just typed.
 *
 * The rule: a pack is recommended because its **own declared vocabulary** appears in the question, not
 * because a table somewhere maps a subject to a pack id. Every pack already publishes `relevance_terms`
 * - the vocabulary it measures topical relevance with - so scoring a question against that list uses the
 * pack's own claim about what it is expert in, and a pack added later is scored by the same rule with no
 * edit here.
 *
 * A pack with no vocabulary can never win on score, which is correct: the open pack is not expert in
 * anything, it is the honest answer when no expert pack matched. It is therefore named explicitly as the
 * fallback rather than arrived at by accident.
 *
 * This is a recommendation, never a decision. The operator can open any pack over any question, and the
 * run records which one was loaded and what it lacked. A wrong recommendation costs a click; a hidden
 * one would cost the reader their ability to see that a freight taxonomy was applied to a physics
 * question.
 */
import { PACKS, packById } from './registry';
import type { KnowledgePack } from './types';

/** The pack that is right when nothing else matched, by name, because a fallback has to be named. */
export const FALLBACK_PACK_ID = 'open';

export interface PackScore {
  pack_id: string;
  label: string;
  /** Terms from this pack's own `relevance_terms` that appear in the question. */
  matched_terms: string[];
  /** True when the pack publishes no vocabulary, so it could not be scored either way. */
  unscorable: boolean;
}

export interface PackRecommendation {
  pack_id: string;
  reason: string;
  /** Every registered pack, best first. On screen, so the recommendation reads as a comparison. */
  scores: PackScore[];
}

/**
 * Whole-word containment. A substring test would match "carrier" inside "carrierless" and score a pack
 * on a word the question never used; splitting on a token boundary instead keeps multi-word terms like
 * "supply chain" working, which a keyword-array intersection would not.
 */
function mentions(haystack: string, term: string): boolean {
  const at = haystack.indexOf(term);
  if (at < 0) return false;
  const before = at === 0 ? ' ' : haystack[at - 1];
  const after = at + term.length >= haystack.length ? ' ' : haystack[at + term.length];
  const boundary = (c: string) => !/[\p{L}\p{N}]/u.test(c);
  return boundary(before) && boundary(after);
}

export function scorePack(pack: KnowledgePack, question: string): PackScore {
  const haystack = question.toLowerCase();
  return {
    pack_id: pack.id,
    label: pack.label,
    matched_terms: pack.relevance_terms.filter((t) => mentions(haystack, t.toLowerCase())),
    unscorable: pack.relevance_terms.length === 0,
  };
}

export function recommendPack(question: string): PackRecommendation {
  const scores = Object.keys(PACKS)
    .map((id) => scorePack(packById(id), question))
    .sort((a, b) => b.matched_terms.length - a.matched_terms.length || a.pack_id.localeCompare(b.pack_id));

  const best = scores.find((s) => s.matched_terms.length > 0) ?? null;
  if (best === null) {
    return {
      pack_id: FALLBACK_PACK_ID,
      reason:
        'No pack recognised a term from its own vocabulary in this question, so the open pack is loaded. Knowledge will come from what this run retrieves, and the agents that need a pinned taxonomy will abstain rather than name a pattern that does not exist.',
      scores,
    };
  }

  return {
    pack_id: best.pack_id,
    reason: `The "${best.label}" pack recognises ${best.matched_terms.length} term(s) from its own vocabulary in this question: ${best.matched_terms.join(', ')}.`,
    scores,
  };
}
