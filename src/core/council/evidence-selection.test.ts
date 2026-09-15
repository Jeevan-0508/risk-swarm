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
