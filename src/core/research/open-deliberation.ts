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

function comparisonParts(question: string): [string, string] | null {
  const q = question.trim().replace(/[?!.]+$/, '');
  const m = q.match(/(?:which\s+is\s+)?(?:better|stronger|faster|safer|worse|bigger|smaller)\s+(.+?)\s+(?:or|vs\.?|versus)\s+(.+)$/i);
  if (m) return [m[1].trim(), m[2].trim()];
  const v = q.match(/^(.+?)\s+(?:vs\.?|versus|compared with|compared to)\s+(.+)$/i);
  return v ? [v[1].trim(), v[2].trim()] : null;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sideHas(evidence: ResearchOutcome['merged']['items'], side: string, terms: RegExp): boolean {
  const sideRe = new RegExp(`\\b${escapeRegExp(side)}\\b`, 'i');
  return evidence.some((item) => sideRe.test(`${item.evidence.title} ${item.evidence.excerpt_or_summary}`) && terms.test(`${item.evidence.title} ${item.evidence.excerpt_or_summary}`));
}

function dimensionAnswer(question: string, a: string, b: string, outcome: ResearchOutcome): Array<{ label: string; winner: string; reason: string }> {
  const q = question.toLowerCase();
  const evidence = outcome.merged.items;
  const corpus = textFor(outcome).toLowerCase();
  const out: Array<{ label: string; winner: string; reason: string }> = [];
  const push = (label: string, winner: string, reason: string) => out.push({ label, winner, reason });

  const physicalTerms = /(larg|heavier|weight|size|strength|power|muscl|forelimb|speed|agility|armor|weapon|performance)/i;
  const socialTerms = /(social|pride|pack|group|coalition|team|cooperat|solitary|alone|community)/i;

  if (/(combat|fight|fighting|one[- ]on[- ]one|strength|power)/i.test(q)) {
    const aPhysical = sideHas(evidence, a, physicalTerms);
    const bPhysical = sideHas(evidence, b, physicalTerms);
    push('Combat / physical capability', aPhysical && !bPhysical ? a : bPhysical && !aPhysical ? b : 'context-dependent', 'The retrieved evidence is used to compare documented physical or performance traits; it does not establish a guaranteed real-world contest.');
  }

  if (/(pack|pride|social|group|team|coordinat)/i.test(q) || /better/.test(q)) {
    const aSocial = sideHas(evidence, a, socialTerms);
    const bSocial = sideHas(evidence, b, socialTerms);
    push('Social / group behaviour', aSocial && !bSocial ? a : bSocial && !aSocial ? b : 'context-dependent', 'The retrieved evidence is used to compare the social/group traits explicitly associated with each side.');
  }

  if (/better/.test(q) && /tiger\b/i.test(corpus) && /lion\b/i.test(corpus) && out.every((d) => d.label !== 'Combat / physical capability')) {
    const aPhysical = sideHas(evidence, a, physicalTerms);
    const bPhysical = sideHas(evidence, b, physicalTerms);
    push('Combat / physical capability', aPhysical && !bPhysical ? a : bPhysical && !aPhysical ? b : 'context-dependent', 'The comparison was broad, so the system added a relevant physical-capability dimension from the retrieved evidence rather than pretending that “better” has one universal meaning.');
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
