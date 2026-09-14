/**
 * Who speaks. Not every question needs all seven agents, and an agent with nothing to work from used to
 * answer anyway - which is how a governance obligation ends up attached to a question about
 * astrophysics. Participation is decided once, from the question and the loaded pack, before any agent
 * runs, and every decision carries the reason it was made.
 *
 * An agent that does not participate abstains. It does not return a hypothesis with no pattern, or an
 * obligation with no control behind it: it returns an output that says it had nothing to work from. The
 * distinction matters downstream, because `insufficient_evidence` means the evidence was looked for and
 * was not there, while an abstention means this agent was never the right one to ask.
 */
import type { AgentId } from '../domain/model';
import type { QuestionModel } from '../question/model';
import type { KnowledgePack } from '../packs/types';

export interface ParticipationDecision {
  agent: AgentId;
  participating: boolean;
  /** Why, in words a reader can disagree with. Never empty. */
  reason: string;
}

/** The five agents whose work is about evidence structure rather than about a subject. */
const ALWAYS: Array<[AgentId, string]> = [
  ['scout', 'Retrieval is needed for every question, whatever the subject.'],
  ['intelligence', 'Deduplication and clustering apply to any evidence set.'],
  ['challenger', 'Challenging how a conclusion was built is domain-neutral.'],
  ['red_team', 'Integrity checks are about the record, not about the subject.'],
  ['decision_engine', 'A run must end in a stated position, including "not enough evidence".'],
];

export function decideParticipation(question: QuestionModel, pack: KnowledgePack): ParticipationDecision[] {
  const decisions: ParticipationDecision[] = ALWAYS.map(([agent, reason]) => ({ agent, participating: true, reason }));

  decisions.push(
    pack.supports.taxonomy_matching
      ? { agent: 'risk_analyst', participating: true, reason: `The "${pack.label}" pack has a pinned taxonomy, so a named pattern can be matched or explicitly not matched.` }
      : {
          agent: 'risk_analyst',
          participating: false,
          reason: `The "${pack.label}" pack has no pinned taxonomy, so no pattern can be named. Nothing was inferred in its place.`,
        },
  );

  const covered = pack.supports.governance_mapping && governanceApplies(question, pack);
  decisions.push({
    agent: 'governance_officer',
    participating: covered,
    reason: covered
      ? `The question sits in "${question.domain}", which the "${pack.label}" pack's control set covers.`
      : pack.supports.governance_mapping
        ? `The question sits in "${question.domain}", which the "${pack.label}" pack's control set does not cover. No obligation was mapped, because one invented here would be noise.`
        : `The "${pack.label}" pack has no control set, so there is nothing to map an obligation against.`,
  });

  return decisions;
}

/**
 * A pack declares the domains its control set covers. The question's subdomains count too: "GDPR
 * exposure in freight tendering" is a freight question with a regulation dimension, and both agents
 * should be in the room.
 */
function governanceApplies(question: QuestionModel, pack: KnowledgePack): boolean {
  if (pack.governance_domains.length === 0) return false;
  const labels = [question.domain, ...question.subdomains];
  return labels.some((label) => pack.governance_domains.includes(label));
}

export const participatingAgents = (decisions: ParticipationDecision[]): AgentId[] =>
  decisions.filter((d) => d.participating).map((d) => d.agent);

export const abstainedAgents = (decisions: ParticipationDecision[]): AgentId[] =>
  decisions.filter((d) => !d.participating).map((d) => d.agent);

export function participationNote(decisions: ParticipationDecision[]): string {
  const out = abstainedAgents(decisions);
  return out.length === 0
    ? `All ${decisions.length} agents participated.`
    : `${decisions.length - out.length} of ${decisions.length} agents participated. Abstained: ${out.join(', ')}.`;
}
