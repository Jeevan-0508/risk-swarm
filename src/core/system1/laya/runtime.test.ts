import { describe, expect, it } from '../../test/bdd';
import { mapLayaAnswer, shannonUncertainty, type LayaRawResult } from './runtime';
import typedFixture from './__fixtures__/laya-typed-eu-carrier-dark-case.json';
import englishFixture from './__fixtures__/laya-english-eu-carrier-dark-case.json';

describe('shannonUncertainty', () => {
  it('is 0 for a single-outcome distribution', () => {
    expect(shannonUncertainty({ A: 1 })).toBe(0);
  });

  it('is null when no distribution is given', () => {
    expect(shannonUncertainty(undefined)).toBeNull();
    expect(shannonUncertainty(null)).toBeNull();
  });

  it('is close to 1 for a uniform distribution over many outcomes', () => {
    const u = shannonUncertainty({ A: 0.25, B: 0.25, C: 0.25, D: 0.25 });
    expect(u).not.toBeNull();
    expect(u as number).toBeGreaterThan(0.99);
  });

  it('computes a real, non-trivial value from the genuinely captured laya-typed fixture', () => {
    const answer = (typedFixture.result as LayaRawResult).answers.q;
    const u = shannonUncertainty(answer.probabilities);
    expect(u).not.toBeNull();
    expect(u as number).toBeGreaterThan(0);
    expect(u as number).toBeLessThan(1);
  });
});

describe('mapLayaAnswer', () => {
  it('maps the real laya-typed fixture (live captured 2026-09-23) to decision/confidence/uncertainty', () => {
    const answer = (typedFixture.result as LayaRawResult).answers.q;
    const mapped = mapLayaAnswer(answer);
    expect(mapped.decision).toBe('MONITOR');
    expect(mapped.confidence).toBeCloseTo(0.0418, 4);
    expect(mapped.uncertainty).not.toBeNull();
    expect(mapped.raw).toBe(answer);
  });

  it('maps the real laya-english fixture (live captured 2026-09-23) on the same case independently', () => {
    const answer = (englishFixture.result as LayaRawResult).answers.q;
    const mapped = mapLayaAnswer(answer);
    expect(mapped.decision).toBe('MONITOR');
    expect(mapped.confidence).toBeCloseTo(0.1846, 4);
  });

  it('maps a score-type answer to a stringified score', () => {
    const mapped = mapLayaAnswer({ type: 'score', score: 0.73, confidence: 0.5 });
    expect(mapped.decision).toBe('0.73');
  });

  it('maps a noul-type answer to a stringified noul', () => {
    const mapped = mapLayaAnswer({ type: 'noul', noul: 2, confidence: 0.5 });
    expect(mapped.decision).toBe('2');
  });
});
