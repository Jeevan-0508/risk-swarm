/**
 * Freight Risk Atlas / Freight Fraud Taxonomy adapter - the RISK ANALYST's pattern base.
 *
 * Upstream (github.com/Jeevan-0508/freight-risk-atlas) publishes 12 fraud patterns with weighted
 * phase-tagged indicators, documented false positives, countermeasures and regulatory hooks.
 *
 * Two disciplines are inherited from upstream and enforced here:
 *   - indicator coverage is coverage, never a probability of fraud;
 *   - `unknown` is an evidence gap and is never folded into `absent`.
 *
 * A lexical hit in a news headline says the topic was discussed. It never says the pattern occurred,
 * so matches are typed as `lexical_topic_match` and cannot on their own support a finding.
 */
import type { IndicatorState, Phase } from '../domain/model';
import type { SnapshotLoader, SnapshotSourceProvenance } from './loader';

const SNAPSHOT_PATH = 'freight-risk-atlas/taxonomy.json';

export interface UpstreamIndicator {
  phase: Phase;
  signal: string;
  observable_in: string;
  weight: number;
  notes?: string;
}

export interface UpstreamPattern {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  prevalence: string;
  modes: string[];
  geography: string[];
  summary: string;
  how_it_works: string[];
  indicators: UpstreamIndicator[];
  false_positives: Array<{ looks_like: string; actually: string; how_to_rule_out: string }>;
  countermeasures: { preventive?: string[]; detective?: string[]; responsive?: string[] };
  regulatory_hooks: Array<{ instrument: string; provision: string; relevance: string }>;
  related: string[];
  references: Array<{ title: string; publisher: string; url: string }>;
  version: string;
  last_reviewed: string;
}

export interface Indicator extends UpstreamIndicator {
  id: string;
  pattern_id: string;
}

export interface FalsePositiveGate {
  id: string;
  pattern_id: string;
  looks_like: string;
  actually: string;
  how_to_rule_out: string;
}

export interface Countermeasure {
  id: string;
  pattern_id: string;
  class: 'preventive' | 'detective' | 'responsive';
  text: string;
}

export interface Pattern extends Omit<UpstreamPattern, 'indicators' | 'false_positives' | 'countermeasures'> {
  indicators: Indicator[];
  false_positives: FalsePositiveGate[];
  countermeasures: Countermeasure[];
  total_indicator_weight: number;
}

/**
 * Adapter-owned synonym lexicon. Upstream is English; the signal feed is bilingual, so the German
 * and colloquial equivalents live here rather than being invented inside the upstream dataset.
 */
export const PATTERN_LEXICON: Record<string, string[]> = {
  'FFT-001': ['double broker', 'double-broker', 're-broker', 'rebroker', 're-tender', 'unterfrachtführer ohne', 'weitervergabe'],
  'FFT-002': ['phantom carrier', 'fake carrier', 'fictitious carrier', 'ghost carrier', 'fake-frachtführer', 'fake frachtführer', 'scheinfirma', 'scheinspedition', 'non-existent haulier'],
  'FFT-003': ['identity takeover', 'carrier impersonation', 'impersonat', 'identity theft', 'hijacked authority', 'dormant authority', 'identitätsdiebstahl', 'firmenidentität'],
  'FFT-004': ['fictitious pickup', 'fraudulent collection', 'theft by deception', 'collected the load and', 'never delivered', 'abholbetrug', 'ladung nie geliefert'],
  'FFT-005': ['pilferage', 'partial load theft', 'shortage', 'skimming', 'teilentnahme', 'schwund'],
  'FFT-006': ['truck stop theft', 'curtain slash', 'planenschlitzer', 'roadside cargo theft', 'unsecured parking', 'autohof', 'rastplatz'],
  'FFT-007': ['seal tamper', 'reseal', 'seal substitution', 'siegel', 'plombe'],
  'FFT-008': ['gps spoof', 'gnss spoof', 'jamming', 'telematics manipulation', 'tracker', 'positionsdaten manipul'],
  'FFT-009': ['insider', 'collusion', 'inside job', 'employee facilitat', 'mitarbeiter beteiligt', 'innentäter'],
  'FFT-010': ['document fraud', 'falsified consignment note', 'cmr fraud', 'forged proof of delivery', 'frachtbrief gefälscht', 'dokumentenbetrug'],
  'FFT-011': ['insurance certificate', 'certificate of insurance', 'lapsed cover', 'coi fraud', 'versicherungsnachweis', 'versicherungsschutz erloschen'],
  'FFT-012': ['undisclosed subcontract', 'subcontracting chain', 'hidden tier', 'chain opacity', 'unterbeauftragung', 'subunternehmerkette', 'nachunternehmerkette'],
};

export interface CoverageResult {
  pattern_id: string;
  /** Share of indicator weight recorded as present. Coverage, not probability. */
  coverage: number;
  present_weight: number;
  absent_weight: number;
  /** Weight of indicators nobody has looked at. An evidence gap, never an absence. */
  unknown_weight: number;
  total_weight: number;
  /** Share of indicator weight that has actually been assessed either way. */
  completeness: number;
  by_phase: Record<Phase, { present: number; absent: number; unknown: number }>;
  present_indicator_ids: string[];
  unknown_indicator_ids: string[];
}

export interface PatternMatch {
  pattern_id: string;
  pattern_name: string;
  severity: UpstreamPattern['severity'];
  category: string;
  /** What kind of claim the match can support. Lexical hits support a topic, never an occurrence. */
  basis: 'lexical_topic_match';
  matched_terms: string[];
  /** Ids of the input items that produced the match. */
  item_ids: string[];
  hits: number;
  caveat: string;
}

export interface PatternMatcher {
  meta(): Promise<{ taxonomy: string; version: string; pattern_count: number; indicator_count: number; countermeasure_count: number; categories: string[] }>;
  patterns(): Promise<Pattern[]>;
  pattern(id: string): Promise<Pattern>;
  matchLexical(items: Array<{ id: string; text: string }>): Promise<PatternMatch[]>;
  coverage(patternId: string, states: Record<string, IndicatorState>): Promise<CoverageResult>;
  falsePositiveGates(patternId: string): Promise<FalsePositiveGate[]>;
  countermeasures(patternId: string, cls?: Countermeasure['class']): Promise<Countermeasure[]>;
  regulatoryHooks(patternId: string): Promise<UpstreamPattern['regulatory_hooks']>;
  provenance(): Promise<SnapshotSourceProvenance>;
}

const CAVEAT =
  'Lexical topic match in reporting. It evidences that the pattern was discussed in the window, not that it occurred in this organisation.';

function hydrate(p: UpstreamPattern): Pattern {
  const indicators: Indicator[] = p.indicators.map((ind, i) => ({
    ...ind,
    id: `${p.id}-i${String(i + 1).padStart(2, '0')}`,
    pattern_id: p.id,
  }));
  const false_positives: FalsePositiveGate[] = p.false_positives.map((fp, i) => ({
    ...fp,
    id: `${p.id}-fp${i + 1}`,
    pattern_id: p.id,
  }));
  const countermeasures: Countermeasure[] = (['preventive', 'detective', 'responsive'] as const).flatMap((cls) =>
    (p.countermeasures?.[cls] ?? []).map((text, i) => ({ id: `${p.id}-cm-${cls}-${i + 1}`, pattern_id: p.id, class: cls, text })),
  );
  const { indicators: _i, false_positives: _f, countermeasures: _c, ...rest } = p;
  return {
    ...rest,
    indicators,
    false_positives,
    countermeasures,
    total_indicator_weight: indicators.reduce((n, ind) => n + ind.weight, 0),
  };
}

export function createAtlasMatcher(loader: SnapshotLoader): PatternMatcher {
  let cache: Pattern[] | null = null;
  let metaCache: Awaited<ReturnType<PatternMatcher['meta']>> | null = null;

  const load = async (): Promise<Pattern[]> => {
    if (!cache) {
      const raw = await loader.loadJson<{ meta: Record<string, unknown>; patterns: UpstreamPattern[] }>(SNAPSHOT_PATH);
      if (!Array.isArray(raw?.patterns)) throw new Error('SNAPSHOT_INVALID: taxonomy has no patterns array');
      cache = raw.patterns.map(hydrate);
      metaCache = raw.meta as never;
    }
    return cache;
  };

  const requirePattern = async (id: string): Promise<Pattern> => {
    const found = (await load()).find((p) => p.id === id);
    if (!found) throw new Error(`UNKNOWN_PATTERN: ${id}`);
    return found;
  };

  return {
    async meta() {
      await load();
      return metaCache as never;
    },
    patterns: load,
    pattern: requirePattern,

    async matchLexical(items) {
      const patterns = await load();
      const matches: PatternMatch[] = [];
      for (const p of patterns) {
        const terms = [p.name.toLowerCase(), ...p.aliases.map((a) => a.toLowerCase()), ...(PATTERN_LEXICON[p.id] ?? [])];
        const matched_terms = new Set<string>();
        const item_ids = new Set<string>();
        let hits = 0;
        for (const item of items) {
          const hay = item.text.toLowerCase();
          for (const term of terms) {
            if (term.length > 3 && hay.includes(term)) {
              matched_terms.add(term);
              item_ids.add(item.id);
              hits += 1;
            }
          }
        }
        if (item_ids.size > 0) {
          matches.push({
            pattern_id: p.id,
            pattern_name: p.name,
            severity: p.severity,
            category: p.category,
            basis: 'lexical_topic_match',
            matched_terms: [...matched_terms].sort(),
            item_ids: [...item_ids].sort(),
            hits,
            caveat: CAVEAT,
          });
        }
      }
      // Most corroborated first, then deterministic by id.
      matches.sort((a, b) => (b.item_ids.length - a.item_ids.length) || (b.hits - a.hits) || a.pattern_id.localeCompare(b.pattern_id));
      return matches;
    },

    async coverage(patternId, states) {
      const p = await requirePattern(patternId);
      const by_phase: CoverageResult['by_phase'] = {
        pre_award: { present: 0, absent: 0, unknown: 0 },
        in_transit: { present: 0, absent: 0, unknown: 0 },
        post_event: { present: 0, absent: 0, unknown: 0 },
      };
      let present_weight = 0;
      let absent_weight = 0;
      let unknown_weight = 0;
      const present_indicator_ids: string[] = [];
      const unknown_indicator_ids: string[] = [];

      for (const ind of p.indicators) {
        const state: IndicatorState = states[ind.id] ?? 'unknown';
        by_phase[ind.phase][state] += ind.weight;
        if (state === 'present') {
          present_weight += ind.weight;
          present_indicator_ids.push(ind.id);
        } else if (state === 'absent') {
          absent_weight += ind.weight;
        } else {
          unknown_weight += ind.weight;
          unknown_indicator_ids.push(ind.id);
        }
      }

      const total_weight = p.total_indicator_weight;
      return {
        pattern_id: p.id,
        coverage: total_weight === 0 ? 0 : Number((present_weight / total_weight).toFixed(4)),
        present_weight,
        absent_weight,
        unknown_weight,
        total_weight,
        completeness: total_weight === 0 ? 0 : Number(((present_weight + absent_weight) / total_weight).toFixed(4)),
        by_phase,
        present_indicator_ids,
        unknown_indicator_ids,
      };
    },

    async falsePositiveGates(patternId) {
      return (await requirePattern(patternId)).false_positives;
    },

    async countermeasures(patternId, cls) {
      const all = (await requirePattern(patternId)).countermeasures;
      return cls ? all.filter((c) => c.class === cls) : all;
    },

    async regulatoryHooks(patternId) {
      return (await requirePattern(patternId)).regulatory_hooks;
    },

    async provenance() {
      const prov = await loader.provenance();
      const entry = prov.sources.find((s) => s.key === 'freight-risk-atlas');
      if (!entry) throw new Error('SNAPSHOT_UNAVAILABLE: no freight-risk-atlas provenance entry');
      return entry;
    },
  };
}
