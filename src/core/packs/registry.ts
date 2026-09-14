/**
 * The packs that ship. Both are declarations over knowledge that already exists in the repository:
 * nothing here is a copy of a vocabulary that lives elsewhere, because two copies of a lexicon
 * diverge and the divergence is invisible.
 */
import { CATEGORY_RULES, FREIGHT_TERMS, GEO_RULES, MODE_RULES } from '../integrations/fomo';
import { PATTERN_LEXICON } from '../integrations/atlas';
import type { KnowledgePack } from './types';

/**
 * The original pack, and still the only expert one. Its values are the constants the freight pipeline
 * has always used, referenced rather than restated, so this pack cannot drift away from the code that
 * reads them.
 */
export function freightPack(): KnowledgePack {
  return {
    id: 'freight-risk',
    label: 'European freight risk',
    remit: 'Carrier and cargo fraud, theft, insolvency and regulatory exposure across European road, rail, sea and air freight.',
    taxonomy_snapshot: 'freight-risk-atlas/taxonomy.json',
    governance_snapshot: 'ai-governance-control-room/controls.json',
    lexicon: PATTERN_LEXICON,
    relevance_terms: FREIGHT_TERMS,
    // The historical default. It is a real gate and it is the right one here: a freight investigation
    // that admits cooking articles is not more open, it is worse.
    min_relevance: 0.34,
    category_rules: CATEGORY_RULES,
    geo_rules: GEO_RULES,
    mode_rules: MODE_RULES,
    benign_category: 'insolven',
    governance_domains: ['freight risk', 'regulation', 'ai governance', 'cybersecurity'],
    supports: { taxonomy_matching: true, governance_mapping: true, mode_analysis: true },
  };
}

/**
 * The open pack. It carries no taxonomy and no control set, and it says so: an agent that needs one
 * abstains instead of producing a shape with nothing in it. It keeps the geography vocabulary, which
 * is about places rather than about freight, and drops the mode vocabulary, which is not.
 *
 * Its relevance floor is null on purpose. A question about quantum computing has no term list that
 * could gate it honestly, and inventing one would rebuild the prison with a different vocabulary.
 */
export function openPack(): KnowledgePack {
  return {
    id: 'open',
    label: 'Open research',
    remit: 'Any subject. Knowledge comes from retrieval in this run, not from a pinned taxonomy.',
    taxonomy_snapshot: null,
    governance_snapshot: null,
    lexicon: {},
    relevance_terms: [],
    min_relevance: null,
    category_rules: [],
    geo_rules: GEO_RULES,
    mode_rules: [],
    benign_category: null,
    governance_domains: [],
    supports: { taxonomy_matching: false, governance_mapping: false, mode_analysis: false },
  };
}

export const PACKS: Record<string, () => KnowledgePack> = {
  'freight-risk': freightPack,
  open: openPack,
};

export function packById(id: string): KnowledgePack {
  const make = PACKS[id];
  if (make === undefined) throw new Error(`Unknown knowledge pack "${id}". Available: ${Object.keys(PACKS).join(', ')}.`);
  return make();
}
