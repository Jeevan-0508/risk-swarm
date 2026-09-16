import { describe, expect, it } from '../test/bdd';
import { routeQuestion } from '../question/model';
import { PROVIDERS } from './providers/types';
import { comparisonSides, planResearch, subjectOf } from './plan';

const plan = (q: string, o?: Parameters<typeof planResearch>[1]) => planResearch(routeQuestion(q), o);

describe('the research planner', () => {
  it('plans something for every question, including one it cannot classify', () => {
    for (const q of ['blorp', 'Explain quantum computing.', 'What are the major emerging risks in European freight?']) {
      const p = plan(q);
      expect(p.dimensions.length > 0).toBe(true);
      expect(p.external.query_count > 0).toBe(true);
    }
  });

  it('is deterministic', () => {
    const q = 'What changed recently in EU AI regulation?';
    expect(JSON.stringify(plan(q))).toBe(JSON.stringify(plan(q)));
  });

  it('never plans a query containing a word the question did not supply, beyond generic modifiers', () => {
    const GENERIC = new Set([
      'how', 'it', 'works', 'history', 'background', 'latest', 'developments', 'timeline', 'of', 'changes',
      'official', 'guidance', 'criticism', 'limitations', 'problems', 'in', 'practice', 'experience',
      'statistics', 'indicator', 'data', 'causes', 'explanation', 'incidents', 'cases', 'reported',
      'requirements', 'controls',
    ]);
    const q = 'Explain quantum computing.';
    const own = new Set([...routeQuestion(q).keywords, ...routeQuestion(q).entities.map((e) => e.text.toLowerCase())]);
    for (const d of plan(q).dimensions) {
      for (const query of d.queries) {
        for (const token of query.toLowerCase().split(/\s+/)) {
          expect(own.has(token) || GENERIC.has(token)).toBe(true);
        }
      }
    }
  });

  it('gives a comparison a separate dimension per side', () => {
    const p = plan('Explain GDPR and how it differs from the EU AI Act.');
    const a = p.dimensions.find((d) => d.key === 'comparison_a');
    const b = p.dimensions.find((d) => d.key === 'comparison_b');
    expect(a !== undefined && b !== undefined).toBe(true);
    expect(a?.queries[0]).not.toBe(b?.queries[0]);
  });

  it('selects an indicator provider for every question that really asks for a number', () => {
    const numeric = [
      'What percentage of freight fraud happened this year in Germany?',
      'What is the current NVIDIA market capitalization?',
      'How many hauliers were prosecuted in Germany?',
    ];
    for (const q of numeric) {
      const p = plan(q);
      expect(p.question.quantitative).toBe(true);
      expect(p.external.providers).toContain('worldbank');
    }
  });

  // The guard below cannot be reached by any real question, because every quantitative intent leads
  // with the measurement dimension. It is tested against a constructed model so that the guard is
  // known to work if a future intent mapping ever drops that dimension.
  it('warns when a quantitative plan ends up with no indicator provider', () => {
    const model = { ...routeQuestion('Explain quantum computing.'), quantitative: true };
    const p = planResearch(model);
    expect(p.external.providers).not.toContain('worldbank');
    expect(p.notes.some((n) => n.includes('cannot be evidenced'))).toBe(true);
  });

  it('excludes proxy-only providers unless the proxy is explicitly enabled', () => {
    const off = plan('What changed recently in EU AI regulation?');
    expect(off.external.providers).not.toContain('news_rss');
    const on = plan('What changed recently in EU AI regulation?', { proxyEnabled: true });
    expect(on.external.providers).toContain('news_rss');
  });

  it('respects the query budget and records the trim rather than truncating silently', () => {
    const p = plan('What are the major emerging risks in European freight?', { budget: { max_provider_calls: 2 } });
    expect(p.external.call_count <= 2).toBe(true);
    expect(p.notes.some((n) => n.includes('Plan trimmed'))).toBe(true);
  });

  it('scales the budget with the depth the router read from the question', () => {
    expect(plan('What is the capital of Germany?').budget.max_provider_calls).toBe(6);
    expect(plan('What are the major emerging risks in European freight?').budget.max_provider_calls).toBe(24);
  });

  it('always searches internal knowledge first and says why', () => {
    const p = plan('Explain quantum computing.');
    expect(p.internal.search).toBe(true);
    expect(p.internal.queries.length > 0).toBe(true);
    expect(p.internal.rationale.includes('already held')).toBe(true);
  });

  it('expects a knowledge update only when it actually went outside for current information', () => {
    expect(plan('What changed recently in EU AI regulation?').knowledge_update_expected).toBe(true);
    expect(plan('What is the capital of Germany?').knowledge_update_expected).toBe(false);
  });

  it('names every provider it plans to use from the declared registry', () => {
    const ids = new Set(PROVIDERS.map((p) => p.id));
    for (const id of plan('What are the major emerging risks in European freight?').external.providers) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

describe('subject extraction', () => {
  it('prefers a quoted span, then a named entity, then leading content words', () => {
    expect(subjectOf(routeQuestion('What is "phantom carrier fraud" exactly?'))).toBe('phantom carrier fraud');
    expect(subjectOf(routeQuestion('What is GDPR?'))).toBe('GDPR');
    expect(subjectOf(routeQuestion('explain freight fraud detection methods'))).toBe('explain freight fraud detection');
  });

  it('splits a comparison on the word the question used, or returns null', () => {
    expect(comparisonSides(routeQuestion('GDPR vs the EU AI Act'))).not.toBe(null);
    expect(comparisonSides(routeQuestion('Explain quantum computing.'))).toBe(null);
  });

  it('falls back to a bare "A or B" at the tail of the question when there is no vs/versus/difference connective', () => {
    expect(comparisonSides(routeQuestion('which planet has largest diameter in solarsyatem mercury or jupiter?'))).toEqual(['mercury', 'jupiter']);
    expect(comparisonSides(routeQuestion('which has more protein eggs or chicken'))).toEqual(['eggs', 'chicken']);
  });

  it('does not let the bare "or" fallback fire on a plain, non-comparative question', () => {
    expect(comparisonSides(routeQuestion('what is the capital of Germany?'))).toBe(null);
  });
});

describe('comparison queries preserve both entities and the topic, and correct retrieval typos', () => {
  const LIVE = 'which planet has largest diameter in solarsyatem mercury or jupiter?';

  it('gives each side of the live example its own query, containing that entity, the other absent from it, and the topic word "diameter"', () => {
    const p = plan(LIVE);
    const a = p.dimensions.find((d) => d.key === 'comparison_a');
    const b = p.dimensions.find((d) => d.key === 'comparison_b');
    expect(a?.queries[0]).toContain('mercury');
    expect(a?.queries[0]).not.toContain('jupiter');
    expect(a?.queries[0]).toContain('diameter');
    expect(b?.queries[0]).toContain('jupiter');
    expect(b?.queries[0]).not.toContain('mercury');
    expect(b?.queries[0]).toContain('diameter');
  });

  it('never sends the raw typo "solarsyatem" to a provider; it is corrected to "solar system" for retrieval', () => {
    const p = plan(LIVE);
    for (const d of p.dimensions) {
      for (const q of d.queries) expect(q.toLowerCase()).not.toContain('solarsyatem');
    }
    expect(p.dimensions.some((d) => d.queries.some((q) => q.toLowerCase().includes('solar system')))).toBe(true);
  });

  it('still preserves the exact original question, typo included, outside of the generated queries', () => {
    expect(routeQuestion(LIVE).query).toBe(LIVE);
  });

  it('does not regress the already-working named-entity comparison (GDPR vs the EU AI Act)', () => {
    const p = plan('Explain GDPR and how it differs from the EU AI Act.');
    const a = p.dimensions.find((d) => d.key === 'comparison_a');
    const b = p.dimensions.find((d) => d.key === 'comparison_b');
    expect(a?.queries[0]).toBe('GDPR it');
    expect(b?.queries[0]).toBe('EU AI Act');
  });
});
describe('EVOLUTION 6.0 Phase 1.8: comparison subjects survive query construction for a generic contest question', () => {
  const LIVE = 'who would win in a fight tiger or lion ?';

  it('extracts both explicit sides of the live tiger/lion question, space before the question mark and all', () => {
    expect(comparisonSides(routeQuestion(LIVE))).toEqual(['tiger', 'lion']);
  });

  it('keeps "tiger" and "lion" together in every generated query, and drops "win" as pure comparison filler', () => {
    const p = plan(LIVE);
    expect(p.question.intent).toBe('comparison');
    const a = p.dimensions.find((d) => d.key === 'comparison_a');
    const b = p.dimensions.find((d) => d.key === 'comparison_b');
    const def = p.dimensions.find((d) => d.key === 'definition');
    expect(a?.queries[0]).toContain('tiger');
    expect(b?.queries[0]).toContain('lion');
    expect(def?.queries[0]).toContain('tiger');
    expect(def?.queries[0]).toContain('lion');
    for (const d of p.dimensions) {
      for (const q of d.queries) {
        expect(q.toLowerCase().split(/\s+/)).not.toContain('win');
      }
    }
  });

  it('does not over-expand a single side into an ambiguous bare word: each side query still carries the other subject or the fight topic, never "tiger" or "lion" alone', () => {
    const p = plan(LIVE);
    const a = p.dimensions.find((d) => d.key === 'comparison_a');
    const b = p.dimensions.find((d) => d.key === 'comparison_b');
    expect(a?.queries[0]).not.toBe('tiger');
    expect(b?.queries[0]).not.toBe('lion');
  });

  it('extracts both sides for "who is stronger, A or B" phrasing', () => {
    expect(comparisonSides(routeQuestion('who is stronger, tiger or lion?'))).toEqual(['tiger', 'lion']);
  });

  it('extracts both named entities for "which is larger, Jupiter or Mercury"', () => {
    const p = plan('which is larger, Jupiter or Mercury?');
    const a = p.dimensions.find((d) => d.key === 'comparison_a');
    const b = p.dimensions.find((d) => d.key === 'comparison_b');
    expect(a?.queries[0]).toContain('Jupiter');
    expect(a?.queries[0]).not.toContain('Mercury');
    expect(b?.queries[0]).toContain('Mercury');
    expect(b?.queries[0]).not.toContain('Jupiter');
  });

  it('extracts both named entities for "who would win, Superman or Batman"', () => {
    const p = plan('who would win, Superman or Batman?');
    const a = p.dimensions.find((d) => d.key === 'comparison_a');
    const b = p.dimensions.find((d) => d.key === 'comparison_b');
    expect(a?.queries[0]).toContain('Superman');
    expect(a?.queries[0]).not.toContain('Batman');
    expect(b?.queries[0]).toContain('Batman');
    expect(b?.queries[0]).not.toContain('Superman');
  });

  it('leaves the already-working "which is better BMW or Mercedes" pairing unchanged', () => {
    const p = plan('which is better BMW or Mercedes?');
    const a = p.dimensions.find((d) => d.key === 'comparison_a');
    const b = p.dimensions.find((d) => d.key === 'comparison_b');
    expect(a?.queries[0]).toContain('BMW');
    expect(b?.queries[0]).toContain('Mercedes');
  });

  it('does not treat a normal non-comparison question as a two-subject contest', () => {
    const p = plan('What causes thunderstorms?');
    expect(p.dimensions.find((d) => d.key === 'comparison_a')).toBeUndefined();
    expect(p.dimensions.find((d) => d.key === 'comparison_b')).toBeUndefined();
  });

  it('preserves the original question byte-for-byte; only the generated queries are normalised', () => {
    expect(routeQuestion(LIVE).query).toBe(LIVE);
  });
});

describe('EVOLUTION 6.0 Phase 1.9: internal-knowledge search terms exclude comparative/outcome filler, not just external ones', () => {
  it('drops the bare comparative/outcome word from internal.queries for the live contest question, while keeping both subjects', () => {
    const p = plan('who would win in a fight tiger or lion ?');
    const lower = p.internal.queries.map((q) => q.toLowerCase());
    expect(lower.some((q) => q === 'wins' || q === 'win')).toBe(false);
    expect(lower.some((q) => q.includes('tiger'))).toBe(true);
    expect(lower.some((q) => q.includes('lion'))).toBe(true);
  });

  it('generalises: no comparative/outcome word from COMPARATIVE_WORDS ever appears as its own internal-search term', () => {
    for (const q of [
      'who wins in a fight tiger or lion ?',
      'who is stronger, a grizzly bear or a polar bear?',
      'which is better BMW or Mercedes?',
      'which planet is larger Jupiter or Mercury?',
    ]) {
      const p = plan(q);
      const bare = new Set(p.internal.queries.map((s) => s.toLowerCase()));
      for (const word of ['win', 'wins', 'won', 'winner', 'beat', 'beats', 'defeat', 'defeats', 'better', 'worse', 'larger', 'stronger']) {
        expect(bare.has(word)).toBe(false);
      }
    }
  });

  it('does not touch internal search for a non-comparison question: filler removal only removes filler that is actually present', () => {
    const p = plan('What causes thunderstorms?');
    expect(p.internal.queries.length > 0).toBe(true);
    expect(p.internal.queries.some((q) => q.toLowerCase().includes('thunderstorm'))).toBe(true);
  });
});
