import { describe, expect, it } from '../test/bdd';
import { entitiesOf, keywordsOf, routeQuestion } from './model';

/** The five demonstration scenarios, plus the questions this system used to refuse outright. */
const SCENARIOS = {
  freight: 'What are the major emerging risks in European freight?',
  gdpr: 'Explain GDPR and how it differs from the EU AI Act.',
  delta: 'What changed recently in EU AI regulation?',
  quantum: 'Explain quantum computing.',
  nvidia: 'What is the current NVIDIA market capitalization?',
  capital: 'What is the capital of Germany?',
  share: 'What percentage of freight fraud happened this year in Germany?',
  history: 'Why did the Roman Empire collapse?',
  protein: 'which has more protein eggs or chicken',
  nonsense: 'blorp',
};

describe('the question router', () => {
  it('never refuses a question, whatever the subject', () => {
    for (const [name, q] of Object.entries(SCENARIOS)) {
      const m = routeQuestion(q);
      expect(m.query.length > 0).toBe(true);
      expect(typeof m.domain).toBe('string');
      expect(m.domain.length > 0).toBe(true);
      // The old system's failure mode was a refusal. There is no code path to one.
      expect(JSON.stringify(m).toLowerCase().includes('unsupported')).toBe(false);
      expect(name.length > 0).toBe(true);
    }
  });

  it('resolves an unrecognised subject to general rather than rejecting it', () => {
    const m = routeQuestion(SCENARIOS.nonsense);
    expect(m.domain).toBe('general');
    expect(m.intent).toBe('open');
    expect(m.notes.some((n) => n.includes('not a rejection'))).toBe(true);
  });

  it('still recognises the freight domain it was built for', () => {
    const m = routeQuestion(SCENARIOS.freight);
    expect(m.domain).toBe('freight risk');
    expect(m.intent).toBe('risk_assessment');
    expect(m.geo).toContain('EU');
  });

  it('routes a regulatory comparison to comparison intent with both subjects present', () => {
    const m = routeQuestion(SCENARIOS.gdpr);
    expect(m.intent).toBe('comparison');
    expect(m.entities.some((e) => e.text === 'GDPR')).toBe(true);
    expect(m.entities.some((e) => e.text === 'EU')).toBe(true);
    expect(m.depth).toBe('deep');
  });

  it('reads a comparative "which X or Y" question as comparison, not open, with no freight taxonomy involved', () => {
    const m = routeQuestion(SCENARIOS.protein);
    expect(m.intent).toBe('comparison');
    expect(m.domain).toBe('science');
    expect(m.domain).not.toBe('freight risk');
    expect(m.requires_external).toBe(true);
  });

  it('reads a change question as needing current evidence', () => {
    const m = routeQuestion(SCENARIOS.delta);
    expect(m.intent).toBe('temporal_delta');
    expect(m.freshness === 'high' || m.freshness === 'critical').toBe(true);
    expect(m.requires_external).toBe(true);
    expect(m.evidence_requirements.some((r) => r.includes('retrieved during this run'))).toBe(true);
  });

  it('treats an explanation of an off-domain subject as shallow-to-standard and timeless', () => {
    const m = routeQuestion(SCENARIOS.quantum);
    expect(m.intent).toBe('explanation');
    expect(m.domain).toBe('technology');
    expect(m.freshness).toBe('timeless');
    expect(m.quantitative).toBe(false);
  });

  it('marks a current-value question critical and quantitative', () => {
    const m = routeQuestion(SCENARIOS.nvidia);
    expect(m.intent).toBe('current_value');
    expect(m.freshness).toBe('critical');
    expect(m.quantitative).toBe(true);
  });

  it('warns that a percentage question needs a denominator', () => {
    const m = routeQuestion(SCENARIOS.share);
    expect(m.intent).toBe('quantification');
    expect(m.quantitative).toBe(true);
    expect(m.evidence_requirements.some((r) => r.includes('denominator'))).toBe(true);
    expect(m.notes.some((n) => n.includes('refused rather than estimated'))).toBe(true);
  });

  it('leaves a timeless fact timeless', () => {
    const m = routeQuestion(SCENARIOS.capital);
    expect(m.intent).toBe('definition');
    expect(m.freshness).toBe('timeless');
    expect(m.geo).toContain('DE');
  });

  it('is deterministic: the same question routes identically twice', () => {
    for (const q of Object.values(SCENARIOS)) {
      expect(JSON.stringify(routeQuestion(q))).toBe(JSON.stringify(routeQuestion(q)));
    }
  });

  it('accepts package-supplied hints without losing the built-in ones', () => {
    const m = routeQuestion('What is the state of gravitational wave detection?', {
      domainHints: [['astrophysics', ['gravitational wave', 'interferometer']]],
    });
    expect(m.domain).toBe('astrophysics');
    const freight = routeQuestion(SCENARIOS.freight, { domainHints: [['astrophysics', ['pulsar']]] });
    expect(freight.domain).toBe('freight risk');
  });
});

describe('question decomposition', () => {
  it('drops stopwords, keeps content words in order and deduplicates', () => {
    const k = keywordsOf('What are the risks of the risks in freight?');
    expect(k).toEqual(['risks', 'freight']);
  });

  it('reads acronyms, quoted spans and years off the surface only', () => {
    const e = entitiesOf('Did the "Digital Services Act" change in 2024 for GDPR?');
    expect(e.some((x) => x.kind === 'quoted' && x.text === 'Digital Services Act')).toBe(true);
    expect(e.some((x) => x.kind === 'acronym' && x.text === 'GDPR')).toBe(true);
    expect(e.some((x) => x.kind === 'numeric_year' && x.text === '2024')).toBe(true);
  });

  it('does not treat the sentence-initial word as a proper noun', () => {
    const e = entitiesOf('Germany exports freight');
    expect(e.some((x) => x.kind === 'proper_noun' && x.text === 'Germany')).toBe(false);
  });
});
