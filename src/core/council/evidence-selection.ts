/**
 * EVIDENCE SELECTION FOR THE COUNCIL.
 *
 * The research pass keeps every retrieved item, on purpose: `normalize.ts` never drops anything for
 * scoring low, because relevance is a metric, not a filter (see its own header comment). That
 * invariant is about the evidence store, not about what a Council prompt should be built from - a
 * search on "solar system diameter" that also turns up a cardiac-diameter paper is not evidence the
 * Council should have to read past. This is the one place that gap is closed: a ranking-and-floor
 * stage applied only at the Council hand-off, reading the relevance the research pass already
 * computed, never rescoring anything, and never touching the underlying evidence list itself.
 *
 * Relevance is not agreement: this never looks at what a document concludes, only at whether its
 * words overlap with the question's. Filtering on agreement would be evidence laundering; filtering
 * on wording overlap is what "relevant" means here.
 */
import type { NormalizedEvidence } from '../research/normalize';

/** Matches `normalize.ts`'s own `lowRelevanceThreshold` default, so this adds a floor, not a new one. */
export const COUNCIL_EVIDENCE_MIN_RELEVANCE = 0.2;

/** A generous top-K: enough for independent corroboration, not so many the prompt drowns in repeats. */
export const COUNCIL_EVIDENCE_MAX_ITEMS = 12;

/**
 * The evidence a Council prompt is built from: the subset of the full, untouched evidence list that
 * clears the relevance floor, best first. An empty result is not an error - it means nothing
 * retrieved was actually about the question, and the Council (and its deterministic fallback) already
 * know what to do with an empty evidence list: say so, not fabricate support from what was rejected.
 */
export function selectEvidenceForCouncil(
  evidence: NormalizedEvidence[],
  maxItems: number = COUNCIL_EVIDENCE_MAX_ITEMS,
  minRelevance: number = COUNCIL_EVIDENCE_MIN_RELEVANCE,
): NormalizedEvidence[] {
  return evidence
    .filter((item) => item.relevance >= minRelevance)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, maxItems);
}
