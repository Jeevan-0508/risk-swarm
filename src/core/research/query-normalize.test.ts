import { describe, expect, it } from '../test/bdd';
import { normalizeQueryText, TYPO_CORRECTIONS } from './query-normalize';

describe('query text normalization', () => {
  it('rewrites a known typo for retrieval', () => {
    expect(normalizeQueryText('planet largest diameter solarsyatem')).toBe('planet largest diameter solar system');
  });

  it('leaves an unknown word exactly as written, typo or not', () => {
    expect(normalizeQueryText('a made-up wrod like blorpfizzle')).toBe('a made-up wrod like blorpfizzle');
  });

  it('is a pure word-substitution: it never touches words the dictionary does not list', () => {
    const text = 'mercury jupiter diameter planet';
    expect(normalizeQueryText(text)).toBe(text);
  });

  it('preserves capitalisation on the corrected word', () => {
    expect(normalizeQueryText('Solarsyatem exploration')).toBe('Solar system exploration');
  });

  it('covers every dictionary entry round-trip', () => {
    for (const [typo, fix] of Object.entries(TYPO_CORRECTIONS)) {
      expect(normalizeQueryText(typo)).toBe(fix);
    }
  });

  it('is deterministic', () => {
    const text = 'which planet has largest diameter in solarsyatem mercury or jupiter';
    expect(normalizeQueryText(text)).toBe(normalizeQueryText(text));
  });
});
