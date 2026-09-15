import { describe, expect, it } from '../test/bdd';
import { Minter } from '../domain/build';
import type { ResearchDocument } from '../research/providers/types';
import { normalizeExternal, type NormalizeDeps } from '../research/normalize';
import { COUNCIL_EVIDENCE_MAX_ITEMS, COUNCIL_EVIDENCE_MIN_RELEVANCE, selectEvidenceForCouncil } from './evidence-selection';

/**
 * The live case reported for this fix: "which planet has largest diameter in solarsyatem mercury or
 * jupiter?" against a Crossref-style academic corpus that returns keyword-adjacent noise alongside the
 * two documents that actually answer the question.
 */
const QUESTION = 'which planet has largest diameter in solarsyatem mercury or jupiter?';
const NOW = '2026-09-15T00:00:00.000Z';

const deps = (question = QUESTION): NormalizeDeps => ({ minter: new Minter('RUN-E', () => NOW), now: NOW, question, hash: async (t: string) => `h${t.length}` });

const doc = (title: string, excerpt: string): ResearchDocument => ({
  provider: 'crossref',
  query: QUESTION,
  url: `https://doi.org/10.1/${title.replace(/\s+/g, '_')}`,
  published_at: '2024-01-01T00:00:00.000Z',
  date_kind: 'published',
  retrieved_at: NOW,
  source_identity: 'crossref.org',
  title,
  excerpt,
  value: null,
  via_proxy: false,
});

const CORPUS = [
  doc('Jupiter Diameter Measurements from Voyager Data', 'Jupiter has the largest diameter of any planet in the solar system.'),
  doc('Mercury vs Jupiter: A Planetary Size Comparison', 'Mercury and Jupiter represent the smallest and largest planet diameters in the solar system.'),
  doc('Cardiac Diameter in Paediatric Echocardiography', 'This study measures cardiac diameter using standard echocardiographic technique.'),
  doc('Translation Criticism and Comparative Literature', 'A survey of translation criticism methods across comparative literature.'),
  doc('Computational Geometry: Bounding Box and Minimum Diameter', 'An algorithm for the smallest bounding box and minimum diameter of a point set.'),
];

const IRRELEVANT_ONLY = [
  doc('Cardiac Diameter in Paediatric Echocardiography', 'This study measures cardiac diameter using standard echocardiographic technique.'),
  doc('Translation Criticism and Comparative Literature', 'A survey of translation criticism methods across comparative literature.'),
  doc('Feminist Criticism of the Modern Novel', 'An overview of feminist criticism as applied to twentieth-century fiction.'),
];

describe('Council evidence selection', () => {
  it('ranks the Jupiter-diameter document above the cardiac-diameter and geometry noise', async () => {
    const { items } = await normalizeExternal(CORPUS, deps());
    const jupiter = items.find((i) => i.evidence.title.includes('Jupiter Diameter Measurements'))!;
    const cardiac = items.find((i) => i.evidence.title.includes('Cardiac Diameter'))!;
    const geometry = items.find((i) => i.evidence.title.includes('Computational Geometry'))!;
    expect(jupiter.relevance).toBeGreaterThan(cardiac.relevance);
    expect(jupiter.relevance).toBeGreaterThan(geometry.relevance);
  });

  it('ranks the Mercury/Jupiter comparison document highly', async () => {
    const { items } = await normalizeExternal(CORPUS, deps());
    const comparison = items.find((i) => i.evidence.title.includes('Planetary Size Comparison'))!;
    const cardiac = items.find((i) => i.evidence.title.includes('Cardiac Diameter'))!;
    expect(comparison.relevance).toBeGreaterThan(cardiac.relevance);
    expect(comparison.relevance).toBeGreaterThanOrEqual(COUNCIL_EVIDENCE_MIN_RELEVANCE);
  });

  it('does not let translation criticism rank as if it were relevant', async () => {
    const { items } = await normalizeExternal(CORPUS, deps());
    const translation = items.find((i) => i.evidence.title.includes('Translation Criticism'))!;
    expect(translation.relevance).toBeLessThan(COUNCIL_EVIDENCE_MIN_RELEVANCE);
  });

  it('selects only the items that clear the relevance floor, best first, without mutating the full list', async () => {
    const { items } = await normalizeExternal(CORPUS, deps());
    const selected = selectEvidenceForCouncil(items);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThan(items.length);
    for (const item of selected) expect(item.relevance).toBeGreaterThanOrEqual(COUNCIL_EVIDENCE_MIN_RELEVANCE);
    for (let i = 1; i < selected.length; i++) expect(selected[i - 1].relevance).toBeGreaterThanOrEqual(selected[i].relevance);
    expect(items.length).toBe(CORPUS.length);
  });

  it('excludes a low-relevance item entirely from the Council selection rather than letting it dilute it', async () => {
    const { items } = await normalizeExternal(CORPUS, deps());
    const selected = selectEvidenceForCouncil(items);
    expect(selected.some((i) => i.evidence.title.includes('Cardiac Diameter'))).toBe(false);
    expect(selected.some((i) => i.evidence.title.includes('Translation Criticism'))).toBe(false);
  });

  it('preserves ids and provenance on every selected item: this ranks and filters, it does not rebuild', async () => {
    const { items } = await normalizeExternal(CORPUS, deps());
    const selected = selectEvidenceForCouncil(items);
    for (const item of selected) {
      const original = items.find((i) => i.evidence.id === item.evidence.id);
      expect(original).toBe(item);
    }
  });

  it('returns an empty array, not fabricated support, when nothing clears the floor', async () => {
    const { items } = await normalizeExternal(IRRELEVANT_ONLY, deps());
    expect(items.length).toBe(IRRELEVANT_ONLY.length);
    const selected = selectEvidenceForCouncil(items);
    expect(selected).toEqual([]);
  });

  it('caps the selection at the configured maximum, best items first', async () => {
    const many = Array.from({ length: 20 }, (_, i) => doc(`Jupiter Diameter Study ${i}`, 'Jupiter has the largest diameter of any planet in the solar system.'));
    const { items } = await normalizeExternal(many, deps());
    const selected = selectEvidenceForCouncil(items);
    expect(selected.length).toBe(COUNCIL_EVIDENCE_MAX_ITEMS);
  });

  it('respects an explicitly narrower floor or cap when passed', async () => {
    const { items } = await normalizeExternal(CORPUS, deps());
    const strict = selectEvidenceForCouncil(items, 1, 0.9);
    expect(strict.length).toBeLessThanOrEqual(1);
  });
});
describe('EVOLUTION 6.0 Phase 1.8: relevance ranking survives a sports-team/human-name keyword collision (tiger/lion contest)', () => {
  const TIGER_LION_QUESTION = 'who would win in a fight tiger or lion ?';
  const tlDeps = deps(TIGER_LION_QUESTION);

  const WHO_WOULD_WIN = 'Lion vs Tiger: Who Would Win in a Fight?';
  const STRENGTH_COMPARISON = 'Tiger vs Lion Size and Strength Comparison';

  const CONTEST_CORPUS = [
    doc(STRENGTH_COMPARISON, 'In a hypothetical fight between a tiger and a lion, the tiger is generally larger and has a strength advantage due to its size.'),
    doc(WHO_WOULD_WIN, 'Wildlife experts compare the lion and tiger, weighing size, strength and combat ability to assess who would win a fight.'),
    doc('Detroit Lions Sign New Quarterback in Free Agency Win', 'The Detroit Lions improved their roster this offseason, securing a big win in free agency before the new season.'),
    doc('Detroit Tigers Fight for Playoff Spot', 'The Detroit Tigers must fight for a playoff spot down the stretch of the season.'),
    doc('Boxer "Tiger" Malone Wins Title Fight', 'Boxer John "Tiger" Malone won his title fight this weekend with a dominant performance.'),
    doc('Wildlife Conservation Efforts for Big Cats', 'Conservation groups are working to protect tiger and lion populations from habitat loss.'),
  ];

  it('ranks both genuine tiger/lion comparison documents above the Detroit Lions and Detroit Tigers sports coverage', async () => {
    const { items } = await normalizeExternal(CONTEST_CORPUS, tlDeps);
    const genuine = [WHO_WOULD_WIN, STRENGTH_COMPARISON].map((t) => items.find((i) => i.evidence.title === t)!);
    const junk = ['Detroit Lions Sign New Quarterback in Free Agency Win', 'Detroit Tigers Fight for Playoff Spot'].map((t) => items.find((i) => i.evidence.title === t)!);
    for (const g of genuine) for (const j of junk) expect(g.relevance).toBeGreaterThan(j.relevance);
  });

  it('does not promote a human fighter nicknamed "Tiger", or an unrelated conservation article, above the genuine comparison documents merely because they share one keyword', async () => {
    const { items } = await normalizeExternal(CONTEST_CORPUS, tlDeps);
    const genuine = [WHO_WOULD_WIN, STRENGTH_COMPARISON].map((t) => items.find((i) => i.evidence.title === t)!);
    const boxer = items.find((i) => i.evidence.title.includes('Boxer'))!;
    const conservation = items.find((i) => i.evidence.title.includes('Conservation Efforts'))!;
    for (const g of genuine) {
      expect(g.relevance).toBeGreaterThan(boxer.relevance);
      expect(g.relevance).toBeGreaterThan(conservation.relevance);
    }
  });

  it('places both genuine comparison documents at the top of the Council-selected, relevance-sorted evidence', async () => {
    const { items } = await normalizeExternal(CONTEST_CORPUS, tlDeps);
    const selected = selectEvidenceForCouncil(items);
    const topTwoTitles = new Set(selected.slice(0, 2).map((i) => i.evidence.title));
    expect(topTwoTitles).toEqual(new Set([WHO_WOULD_WIN, STRENGTH_COMPARISON]));
  });

  it('does not delete the keyword-collision documents outright: relevance is measured and reported, never used to exclude', async () => {
    const { items } = await normalizeExternal(CONTEST_CORPUS, tlDeps);
    expect(items.length).toBe(CONTEST_CORPUS.length);
  });
});
