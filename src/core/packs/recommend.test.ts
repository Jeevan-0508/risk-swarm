/**
 * The recommender, tested for the two failures that would matter: recommending an expert pack for a
 * question it has no expertise in, and recommending it on a word the question never actually used.
 */
import { describe, expect, it } from '../test/bdd';
import { FALLBACK_PACK_ID, recommendPack, scorePack } from './recommend';
import { freightPack, openPack, PACKS } from './registry';

describe('pack recommendation', () => {
  it('opens the freight pack for a freight question, and says which words earned it', () => {
    const r = recommendPack('Are we exposed to phantom-carrier fraud in the DACH road network?');
    expect(r.pack_id).toBe('freight-risk');
    expect(r.reason.includes('carrier')).toBe(true);
  });

  it('falls back to the open pack for a question no pack claims, rather than forcing freight on it', () => {
    for (const q of [
      'What is the boiling point of water at altitude?',
      'How did the Byzantine empire finance its army?',
      'What changed in the EU AI Act this year?',
    ]) {
      const r = recommendPack(q);
      expect(r.pack_id).toBe(FALLBACK_PACK_ID);
      expect(r.reason.includes('abstain')).toBe(true);
    }
  });

  it('will not score a pack on a word inside a longer word', () => {
    // "carrierless" contains "carrier"; a substring test would recommend the freight pack for this.
    expect(scorePack(freightPack(), 'Is a carrierless network viable?').matched_terms).toEqual([]);
    expect(scorePack(freightPack(), 'Is a carrier network viable?').matched_terms).toEqual(['carrier']);
  });

  it('matches a multi-word term as a phrase', () => {
    expect(scorePack(freightPack(), 'What is our supply chain exposure?').matched_terms).toEqual(['supply chain']);
  });

  it('marks a pack with no vocabulary as unscorable instead of scoring it zero and implying a judgement', () => {
    const s = scorePack(openPack(), 'Are we exposed to phantom-carrier fraud?');
    expect(s.unscorable).toBe(true);
    expect(s.matched_terms).toEqual([]);
  });

  it('scores every registered pack, so the recommendation is a comparison and not a single guess', () => {
    const r = recommendPack('freight fraud in Germany');
    expect(r.scores.length).toBe(Object.keys(PACKS).length);
    expect(r.scores.map((s) => s.pack_id).sort()).toEqual(Object.keys(PACKS).sort());
    // Best first.
    const counts = r.scores.map((s) => s.matched_terms.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it('is deterministic and case-insensitive', () => {
    const a = recommendPack('FREIGHT fraud in Germany');
    const b = recommendPack('freight fraud in germany');
    expect(a.pack_id).toBe(b.pack_id);
    expect(JSON.stringify(a.scores)).toBe(JSON.stringify(b.scores));
  });

  it('recommends a real registered pack id, always', () => {
    for (const q of ['', 'x', 'lorry theft', 'quantum computing']) {
      expect(Object.keys(PACKS).includes(recommendPack(q).pack_id)).toBe(true);
    }
  });
});
