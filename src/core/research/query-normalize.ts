/**
 * QUERY TEXT NORMALIZATION.
 *
 * A retrieval-only correction of common English typos. It is applied to the text sent to a search
 * provider, never to the question the user asked: `QuestionModel.query` and everything derived from
 * it for display keeps the user's exact words, typos included. Only the string a provider will
 * search on passes through here, and only for the small set of misspellings below - this is a
 * dictionary lookup, not a spell-checker, so an unknown word is left exactly as written.
 */

/** Deliberately modest: common, unambiguous English typos only. Never a real-word collision (no "wether"). */
export const TYPO_CORRECTIONS: Record<string, string> = {
  solarsyatem: 'solar system',
  recieve: 'receive',
  seperate: 'separate',
  definately: 'definitely',
  occured: 'occurred',
  goverment: 'government',
  enviroment: 'environment',
  adress: 'address',
  begining: 'beginning',
  acheive: 'achieve',
  arguement: 'argument',
  calender: 'calendar',
  existance: 'existence',
  immediatly: 'immediately',
  independant: 'independent',
  occassion: 'occasion',
  recomend: 'recommend',
  untill: 'until',
};

/** Best-effort case match: an all-caps word stays all-caps, a capitalised word stays capitalised. */
function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase()) return replacement.toUpperCase();
  if (source[0] !== undefined && source[0] === source[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/**
 * Rewrites known typos word-by-word for retrieval. A one-word-to-two-words correction
 * ("solarsyatem" -> "solar system") is still a query fragment, not a claim about the world, so it is
 * in scope here in a way it would not be if this touched the question itself.
 */
export function normalizeQueryText(text: string): string {
  return text.replace(/[A-Za-z]+/g, (word) => {
    const fixed = TYPO_CORRECTIONS[word.toLowerCase()];
    return fixed === undefined ? word : matchCase(word, fixed);
  });
}
