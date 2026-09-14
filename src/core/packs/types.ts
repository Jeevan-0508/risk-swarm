/**
 * Knowledge packs. A pack is what the swarm knows about a subject before it has retrieved anything:
 * a pinned taxonomy, a governance mapping, a topical vocabulary, and an honest statement of what it
 * cannot supply.
 *
 * The pack exists because the alternative was worse in both directions. Hard-coding freight into the
 * agents made the system a prison: an off-domain question could not produce a hypothesis, because the
 * analyst only forms one from a match against twelve pinned freight patterns. Deleting the freight
 * knowledge to make room for everything would have thrown away the only part that is actually expert.
 *
 * So a pack is a parameter, and `supports` is the important field: an agent whose input a pack cannot
 * supply does not improvise, it abstains, and the record says which pack was loaded and what it lacked.
 */
export interface PackSupport {
  /** Can a hypothesis be formed by matching a pinned taxonomy? False means the analyst has no pattern to name. */
  taxonomy_matching: boolean;
  /** Can obligations be mapped from a pinned control set? False means governance has nothing to map against. */
  governance_mapping: boolean;
  /** Does transport mode mean anything in this domain? */
  mode_analysis: boolean;
}

export interface KnowledgePack {
  id: string;
  label: string;
  /** What this pack is expert in, in one sentence. Shown whenever the pack is named in the record. */
  remit: string;
  /** Pinned snapshot path, or null when the pack brings no taxonomy of its own. */
  taxonomy_snapshot: string | null;
  governance_snapshot: string | null;
  /** Synonyms per taxonomy id. Empty when there is no taxonomy to give synonyms to. */
  lexicon: Record<string, string[]>;
  /** Topical vocabulary used to *measure* relevance. Empty means relevance cannot be measured this way. */
  relevance_terms: string[];
  /**
   * Retention floor for retrieved signals. Null means retain everything and report relevance instead of
   * gating on it: this is the difference between a domain pack and an open one, and it is a deliberate
   * choice per pack rather than a global switch.
   */
  min_relevance: number | null;
  category_rules: Array<[string, string[]]>;
  geo_rules: Array<[string, string[]]>;
  mode_rules: Array<[string, string[]]>;
  /** A category this domain treats as an ordinary background event rather than a risk signal. */
  benign_category: string | null;
  /**
   * Question domains this pack's governance mapping actually covers, as the router labels them. A
   * question outside them gets no governance analysis: an obligation invented for an astrophysics
   * question is not thoroughness, it is noise wearing the costume of rigour.
   */
  governance_domains: string[];
  supports: PackSupport;
}

/** Stated in the record so a reader can see which knowledge was loaded and what it could not do. */
export function packSummary(pack: KnowledgePack): string {
  const missing: string[] = [];
  if (!pack.supports.taxonomy_matching) missing.push('no pinned taxonomy to name a pattern from');
  if (!pack.supports.governance_mapping) missing.push('no pinned control set to map obligations against');
  if (!pack.supports.mode_analysis) missing.push('transport mode is not meaningful here');
  return missing.length === 0
    ? `Pack "${pack.label}": ${pack.remit}`
    : `Pack "${pack.label}": ${pack.remit} Limits: ${missing.join('; ')}.`;
}
