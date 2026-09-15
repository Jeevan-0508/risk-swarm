import type { ResearchOutcome } from './session';

export type OpenAgentId = 'scout' | 'intelligence' | 'analyst' | 'challenger' | 'decision';

export interface OpenAgentStep {
  id: OpenAgentId;
  codename: string;
  role: string;
  status: 'complete' | 'insufficient_evidence';
  findings: string[];
  evidence_ids: string[];
}

export interface OpenAnswer {
  headline: string;
  answer: string;
  caveat: string;
  dimensions: Array<{ label: string; winner: string; reason: string }>;
  agents: OpenAgentStep[];
  evidence_count: number;
  source_count: number;
}

const AGENTS: Array<[OpenAgentId, string, string]> = [
  ['scout', 'HERMES', 'SCOUT'],
  ['intelligence', 'ATHENA', 'INTELLIGENCE'],
  ['analyst', 'APOLLO', 'ANALYST'],
  ['challenger', 'ARES', 'CHALLENGER + RED TEAM'],
  ['decision', 'HEPHAESTUS', 'DECISION'],
];

function textFor(outcome: ResearchOutcome): string {
  return outcome.merged.items.map((i) => `${i.evidence.title}. ${i.evidence.excerpt_or_summary}`).join(' ');
}

/**
 * Three attempts, each covering a shape the other two do not:
 *   1. An adjective right before the connective ("which is better tiger or lion") - the connective
 *      can be "or", so this has to run before anything that treats "or" as ambiguous.
 *   2. "X vs/versus/compared to/with Y", start to end of the question - the connective itself
 *      brackets the two sides, whatever the rest of the sentence says.
 *   3. A bare "A or B" with no adjective and no vs/versus ("tiger or lion", "Germany or France for
 *      GDP"): unlike attempt 2, "or" is common enough in ordinary English that it cannot bracket a
 *      whole sentence in half, so this only accepts it where the two sides read as two bare names -
 *      immediately followed by end of sentence, punctuation, or a preposition starting a new phrase.
 *      "should I email John or call him instead" has no such boundary after "call" and is correctly
 *      left unmatched.
 */
export function comparisonParts(question: string): [string, string] | null {
  const q = question.trim().replace(/[?!.]+$/, '');
  const m = q.match(/(?:which\s+is\s+)?(?:better|stronger|faster|safer|worse|bigger|smaller)\s+(.+?)\s+(?:or|vs\.?|versus)\s+(.+)$/i);
  if (m) return [m[1].trim(), m[2].trim()];
  const v = q.match(/^(.+?)\s+(?:vs\.?|versus|compared with|compared to)\s+(.+)$/i);
  if (v) return [v[1].trim(), v[2].trim()];
  const bare = question.match(
    /\b([A-Za-z][\w-]*)\s+or\s+([A-Za-z][\w-]*)\b(?=\s*(?:[?.!]|$|\s+(?:for|in|on|at|about|regarding|concerning|by|with|during|since|under|over|per|from)\b))/i,
  );
  return bare ? [bare[1].trim(), bare[2].trim()] : null;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Tolerates a plural ('tigers') without matching an unrelated word that merely starts with the side name. */
const sideRegExp = (side: string): RegExp => new RegExp(`\\b${escapeRegExp(side)}s?\\b`, 'i');

const splitSentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);

/** "Lions live in prides while tigers are solitary" names both sides but states one fact per side; splitting on the contrast conjunction turns it back into two single-side clauses instead of one ambiguous sentence. */
const splitClauses = (sentence: string): string[] => sentence.split(/\s+(?:while|whereas|although|though)\s+/i).filter((c) => c.trim().length > 0);

const COMPARATIVE = '(?:more|bigger|larger|stronger|heavier|faster|greater|better)';

/**
 * A comparison article routinely names both sides in the same clause ("tigers outweigh lions"), so
 * "does this item mention side X and match the terms" is true for both sides on almost every real
 * article and never resolves anything. This scores clause-by-clause instead: a clause naming only one
 * side counts for it (for `forTerms`) or for the *other* side (for `againstTerms` - "tigers are
 * solitary" is evidence against tiger's social score, not for it). A clause naming both sides only
 * counts if it states an explicit direction ("X ... than Y" or "X outweighs Y"); left ambiguous otherwise.
 */
function sideAdvantage(
  evidence: ResearchOutcome['merged']['items'],
  a: string,
  b: string,
  forTerms: RegExp,
  againstTerms: RegExp | null = null,
): 'a' | 'b' | 'context-dependent' {
  const aRe = sideRegExp(a);
  const bRe = sideRegExp(b);
  const direction = (x: RegExp, y: RegExp) =>
    new RegExp(`${x.source}[^.!?]{0,60}?\\b(?:${COMPARATIVE}\\b[^.!?]{0,30}?\\bthan|outweighs?)\\b[^.!?]{0,30}?${y.source}`, 'i');
  const aOverB = direction(aRe, bRe);
  const bOverA = direction(bRe, aRe);
  let scoreA = 0;
  let scoreB = 0;
  for (const item of evidence) {
    // The title alone (e.g. "Tiger Vs. Lion Size Comparison") is a label, not a claim - and its own
    // abbreviation period ('Vs.') fools the sentence splitter into orphaning a fragment that can name
    // one side next to an unrelated word ('Lion Size'), crediting a side for nothing it actually said.
    for (const sentence of splitSentences(item.evidence.excerpt_or_summary)) {
      for (const clause of splitClauses(sentence)) {
        const matchesFor = forTerms.test(clause);
        const matchesAgainst = againstTerms !== null && againstTerms.test(clause);
        if (!matchesFor && !matchesAgainst) continue;
        const hasA = aRe.test(clause);
        const hasB = bRe.test(clause);
        if (hasA && !hasB) {
          if (matchesFor) scoreA += 1;
          if (matchesAgainst) scoreB += 1;
        } else if (hasB && !hasA) {
          if (matchesFor) scoreB += 1;
          if (matchesAgainst) scoreA += 1;
        } else if (hasA && hasB && matchesFor) {
          if (aOverB.test(clause)) scoreA += 1;
          else if (bOverA.test(clause)) scoreB += 1;
        }
      }
    }
  }
  if (scoreA > scoreB) return 'a';
  if (scoreB > scoreA) return 'b';
  return 'context-dependent';
}

const winnerOf = (advantage: 'a' | 'b' | 'context-dependent', a: string, b: string): string =>
  advantage === 'a' ? a : advantage === 'b' ? b : 'context-dependent';

function dimensionAnswer(question: string, a: string, b: string, outcome: ResearchOutcome): Array<{ label: string; winner: string; reason: string }> {
  const q = question.toLowerCase();
  const evidence = outcome.merged.items;
  const corpus = textFor(outcome).toLowerCase();
  const out: Array<{ label: string; winner: string; reason: string }> = [];
  const push = (label: string, winner: string, reason: string) => out.push({ label, winner, reason });

  const physicalFor = /(larg|heavier|weight|size|strength|power|muscl|forelimb|speed|agility|armor|weapon|performance|outweigh)/i;
  const physicalAgainst = /(smaller|weaker|slower|lighter|frailer)/i;
  const socialFor = /(social|pride|pack|group|coalition|team|cooperat|community)/i;
  const socialAgainst = /(solitary|alone|loner)/i;

  if (/(combat|fight|fighting|one[- ]on[- ]one|strength|power)/i.test(q)) {
    push('Combat / physical capability', winnerOf(sideAdvantage(evidence, a, b, physicalFor, physicalAgainst), a, b), 'The retrieved evidence is used to compare documented physical or performance traits; it does not establish a guaranteed real-world contest.');
  }

  if (/(pack|pride|social|group|team|coordinat)/i.test(q) || /better/.test(q)) {
    push('Social / group behaviour', winnerOf(sideAdvantage(evidence, a, b, socialFor, socialAgainst), a, b), 'The retrieved evidence is used to compare the social/group traits explicitly associated with each side.');
  }

  if (/better/.test(q) && sideRegExp(a).test(corpus) && sideRegExp(b).test(corpus) && out.every((d) => d.label !== 'Combat / physical capability')) {
    push('Combat / physical capability', winnerOf(sideAdvantage(evidence, a, b, physicalFor, physicalAgainst), a, b), 'The comparison was broad, so the system added a relevant physical-capability dimension from the retrieved evidence rather than pretending that “better” has one universal meaning.');
  }

  if (out.length === 0) push('Overall', 'context-dependent', 'The evidence does not establish a single objective winner for this wording.');
  return out;
}

export function deliberateOpenResearch(question: string, outcome: ResearchOutcome): OpenAnswer {
  const evidence = outcome.merged.items;
  const sources = new Set(evidence.map((i) => i.provenance.source_identity));
  const ids = evidence.map((i) => i.evidence.id);
  const steps: OpenAgentStep[] = [];
  const push = (id: OpenAgentId, findings: string[]) => {
    const meta = AGENTS.find((a) => a[0] === id)!;
    steps.push({ id, codename: meta[1], role: meta[2], status: evidence.length ? 'complete' : 'insufficient_evidence', findings, evidence_ids: ids });
  };

  push('scout', evidence.slice(0, 8).map((i) => `${i.evidence.title} — ${i.provenance.source_identity}`));
  push('intelligence', [
    `${evidence.length} evidence item(s) retained from ${sources.size} source identity/identities.`,
    `Retrieval status: ${outcome.execution.status}.`,
  ]);

  const sides = comparisonParts(question);
  const noEvidence = outcome.execution.status === 'search_failed' || evidence.length === 0;
  const dimensions = noEvidence
    ? [{ label: 'Answer', winner: 'evidence-dependent', reason: 'Retrieval failed or returned no evidence, so no winner is invented.' }]
    : sides
      ? dimensionAnswer(question, sides[0], sides[1], outcome)
      : [{ label: 'Answer', winner: 'evidence-dependent', reason: 'The question is not a supported comparison shape; no winner is invented.' }];
  push('analyst', dimensions.map((d) => `${d.label}: ${d.winner} — ${d.reason}`));
  push('challenger', [
    'Challenge the strongest apparent conclusion and require an opposing explanation.',
    outcome.execution.status === 'search_failed' ? 'RED TEAM BLOCK: retrieval failed, so no evidence-backed conclusion is allowed.' : 'RED TEAM CHECK: repeated reporting is not independent corroboration.',
  ]);

  const first = dimensions[0];
  const headline = first.winner === 'evidence-dependent' ? 'Evidence-dependent answer' : `${first.winner} is stronger for ${first.label.toLowerCase()}`;
  const answer = dimensions.map((d) => `${d.winner} — ${d.label}: ${d.reason}`).join(' ');
  const caveat = outcome.execution.status === 'search_failed' || evidence.length === 0
    ? 'I could not establish this from live retrieved evidence, so I will not manufacture an answer.'
    : `Based on ${evidence.length} retained evidence item(s) from ${sources.size} source identity/identities. This is contextual analysis, not a universal ranking.`;
  push('decision', [headline, answer]);

  return { headline, answer, caveat, dimensions, agents: steps, evidence_count: evidence.length, source_count: sources.size };
}
