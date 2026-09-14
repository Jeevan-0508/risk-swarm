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
    const p = plan('What are the major emerging risks in European freight?', { budget: { max_queries: 2 } });
    expect(p.external.query_count <= 2).toBe(true);
    expect(p.notes.some((n) => n.includes('Plan trimmed'))).toBe(true);
  });

  it('scales the budget with the depth the router read from the question', () => {
    expect(plan('What is the capital of Germany?').budget.max_queries).toBe(3);
    expect(plan('What are the major emerging risks in European freight?').budget.max_queries).toBe(10);
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
});
