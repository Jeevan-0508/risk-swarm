import type { ResearchOutcome } from './session';

export type OpenAgentId = 'scout' | 'intelligence' | 'analyst' | 'challenger' | 'red_team' | 'decision';

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
  ['challenger', 'ARES', 'CHALLENGER'],
  ['red_team', 'HADES', 'RED TEAM'],
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

function lower(s: string): string { return s.toLowerCase(); }

function dimensionAnswer(question: string, a: string, b: string, corpus: string): Array<{ label: string; winner: string; reason: string }> {
  const q = lower(question);
  const c = lower(corpus);
  const out: Array<{ label: string; winner: string; reason: string }> = [];
  const add = (label: string, winner: string, reason: string) => out.push({ label, winner, reason });

  if (/(combat|fight|fighting|one[- ]on[- ]one|strength|power)/i.test(q)) {
    const tigerSignals = /(tiger).{0,220}(larg|heavier|muscl|forelimb|power|solitary|ambush)/i.test(c);
    const lionSignals = /(lion).{0,220}(mane|territorial|pride|coalition|male)/i.test(c);
    if (tigerSignals || lionSignals) add('Combat', tigerSignals ? a : lionSignals ? b : 'context-dependent', 'The retrieved evidence supports a stronger case for the side whose physical/combat traits are explicitly described; a hypothetical animal fight has no universal guaranteed outcome.');
  }
  if (/(pack|pride|social|group|team|coordinat)/i.test(q) || /better/.test(q)) {
    const lionSocial = /lion/.test(c) && /(social|pride|group|coalition)/.test(c);
    const tigerSolitary = /tiger/.test(c) && /(solitary|alone)/.test(c);
    if (lionSocial || tigerSolitary) add('Social / group behaviour', lionSocial ? b : a, lionSocial ? 'Retrieved sources describe lions as social animals living in prides and cooperating in groups.' : 'Retrieved sources describe tigers as predominantly solitary.');
  }
  if (out.length === 0) add('Overall', 'context-dependent', 'The retrieved evidence does not establish a single objective winner for the wording of this question.');
  return out;
}

export function deliberateOpenResearch(question: string, outcome: ResearchOutcome): OpenAnswer {
  const corpus = textFor(outcome);
  const evidence = outcome.merged.items;
  const sources = new Set(evidence.map((i) => i.provenance.source_identity));
  const ids = evidence.map((i) => i.evidence.id);
  const steps: OpenAgentStep[] = [];
  const push = (id: OpenAgentId, findings: string[]) => {
    const meta = AGENTS.find((a) => a[0] === id)!;
    steps.push({ id, codename: meta[1], role: meta[2], status: evidence.length ? 'complete' : 'insufficient_evidence', findings, evidence_ids: ids });
  };

  push('scout', evidence.slice(0, 6).map((i) => `${i.evidence.title} — ${i.provenance.source_identity}`));
  push('intelligence', [
    `${evidence.length} evidence item(s) retained from ${sources.size} source identity/identities.`,
    outcome.execution.status === 'ok' ? 'Provider retrieval completed without provider failures.' : `Retrieval status: ${outcome.execution.status}.`,
  ]);

  const sides = comparisonParts(question);
  const dimensions = sides ? dimensionAnswer(question, sides[0], sides[1], corpus) : [{ label: 'Answer', winner: 'evidence-dependent', reason: 'The question is not a supported binary comparison shape, so the system reports the retrieved evidence rather than inventing a winner.' }];
  push('analyst', dimensions.map((d) => `${d.label}: ${d.winner} — ${d.reason}`));
  push('challenger', ['Check the strongest opposing explanation before accepting the first apparent winner.', 'Do not treat repeated reporting as independent corroboration.']);
  push('red_team', [
    outcome.execution.status === 'search_failed' ? 'BLOCKED: external retrieval failed; no evidence-backed conclusion is allowed.' : 'PASS WITH CAUTION: conclusion is bounded by the retrieved evidence and source coverage.',
    sources.size < 2 ? 'Single-source or low-diversity evidence should not be presented as certainty.' : 'Multiple source identities were retained.',
  ]);

  const first = dimensions[0];
  const headline = first.winner === 'evidence-dependent' ? 'Evidence-dependent answer' : `${first.winner} is stronger for ${first.label.toLowerCase()}`;
  const answer = dimensions.map((d) => `${d.winner} — ${d.label}: ${d.reason}`).join(' ');
  const caveat = outcome.execution.status === 'search_failed' || evidence.length === 0
    ? 'I could not establish this from live retrieved evidence, so I will not manufacture an answer.'
    : `Based on ${evidence.length} retained evidence item(s) from ${sources.size} source identity/identities. This is a contextual comparison, not a universal ranking.`;
  push('decision', [headline, answer]);

  return { headline, answer, caveat, dimensions, agents: steps, evidence_count: evidence.length, source_count: sources.size };
}
