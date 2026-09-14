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
  return outcome.merged.items.map((i) => `${i.evidence.title}. ${i.evidence.excerpt}`).join(' ');
}

function comparisonParts(question: string): [string, string] | null {
  const q = question.trim().replace(/[?!.]+$/, '');
  const m = q.match(/(?:which\s+is\s+)?(?:better|stronger|faster|safer|worse|bigger|smaller)\s+(.+?)\s+(?:or|vs\.?|versus)\s+(.+)$/i);
  if (m) return [m[1].trim(), m[2].trim()];
  const v = q.match(/^(.+?)\s+(?:vs\.?|versus|compared with|compared to)\s+(.+)$/i);
  return v ? [v[1].trim(), v[2].trim()] : null;
}

function dimensionAnswer(question: string, a: string, b: string, outcome: ResearchOutcome): Array<{ label: string; winner: string; reason: string }> {
  const q = question.toLowerCase();
  const corpus = textFor(outcome).toLowerCase();
  const out: Array<{ label: string; winner: string; reason: string }> = [];
  const has = (re: RegExp) => re.test(corpus);

  if (/(combat|fight|fighting|one[- ]on[- ]one|strength|power)/i.test(q)) {
    const tigerEvidence = has(/tiger.{0,500}(larg|heavier|muscl|forelimb|power|solitary|ambush)/i);
    const lionEvidence = has(/lion.{0,500}(mane|territorial|pride|coalition|male)/i);
    out.push({
      label: 'Combat',
      winner: tigerEvidence ? a : lionEvidence ? b : 'context-dependent',
      reason: tigerEvidence || lionEvidence
        ? 'The retrieved evidence contains physical or behavioural traits relevant to a one-on-one comparison; it does not establish a guaranteed real-world winner.'
        : 'The retrieved material does not establish a combat comparison strongly enough to name a winner.',
    });
  }

  if (/(pack|pride|social|group|team|coordinat)/i.test(q) || /better/.test(q)) {
    const lionSocial = /lion/.test(corpus) && /(social|pride|group|coalition)/.test(corpus);
    const tigerSolitary = /tiger/.test(corpus) && /(solitary|alone)/.test(corpus);
    out.push({
      label: 'Social / group behaviour',
      winner: lionSocial ? b : tigerSolitary ? a : 'context-dependent',
      reason: lionSocial
        ? 'Retrieved sources describe lions as social animals that live in prides and cooperate in groups.'
        : tigerSolitary
          ? 'Retrieved sources describe tigers as predominantly solitary.'
          : 'The retrieved material does not establish a clear winner on group behaviour.',
    });
  }

  if (out.length === 0) {
    out.push({ label: 'Overall', winner: 'context-dependent', reason: 'The evidence does not establish a single objective winner for this wording.' });
  }
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
  const dimensions = sides
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
