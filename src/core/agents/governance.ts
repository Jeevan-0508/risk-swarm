/**
 * GOVERNANCE OFFICER. Answers a narrow question: what obligations attach to *acting on this
 * investigation with an automated system*?
 *
 * It never claims a freight-law finding, and it never evidences an incident. Its evidence objects are
 * regulator citations with `incident_claim: false`, which is the only legitimate way a tier-1 source
 * enters the chain here: it can satisfy the escalation gate on source quality while remaining unable
 * to prove that anything happened.
 */
import type { Evidence, Hypothesis, RegulatoryImplication } from '../domain/model';
import { emptyCost, type AgentContext, type AgentOutput } from './types';

export interface GovernanceInput {
  question: string;
  hypotheses: Hypothesis[];
  /** True when the run's recommendation could adversely affect a named counterparty. */
  affects_counterparty: boolean;
  /** True when a decision would be acted on without a human in the loop. */
  automated_action: boolean;
  /** True when a language model contributed any wording in this run. */
  model_used: boolean;
  unresolved_objections: number;
}

export interface GovernanceFinding {
  implication: RegulatoryImplication;
  trigger: string;
  evidence: Evidence | null;
}

export interface GovernanceOutput extends AgentOutput<GovernanceFinding> {
  implications: RegulatoryImplication[];
  requirements_considered: number;
  frameworks: string[];
}

interface Trigger {
  requirement_id: string;
  when: (i: GovernanceInput) => boolean;
  proposed: RegulatoryImplication['applicability'];
  reason: (i: GovernanceInput) => string;
}

/**
 * Fixed, reviewable trigger table. Applicability is proposed here and then capped by the adapter,
 * which is why a management standard can never come back as `established`.
 */
const TRIGGERS: Trigger[] = [
  {
    requirement_id: 'EUAIA-14',
    when: () => true,
    proposed: 'established',
    reason: () => 'The run produces a risk recommendation about a counterparty, so a named human must be able to understand, override and stop it.',
  },
  {
    requirement_id: 'EUAIA-12',
    when: () => true,
    proposed: 'established',
    reason: () => 'Every agent output, citation and score in the run is logged with its inputs, which is what this obligation asks for.',
  },
  {
    requirement_id: 'EUAIA-15',
    when: (i) => i.model_used,
    proposed: 'established',
    reason: () => 'A language model contributed wording, so accuracy claims and prompt-injection resistance are in scope.',
  },
  {
    requirement_id: 'EUAIA-50',
    when: (i) => i.model_used,
    proposed: 'possible',
    reason: () => 'Model-generated wording appears in output read by humans and must be disclosed as such.',
  },
  {
    requirement_id: 'EUAIA-9',
    when: (i) => i.unresolved_objections > 0,
    proposed: 'possible',
    reason: (i) => `${i.unresolved_objections} objection(s) remain open, which is exactly the residual risk a risk-management system is required to record rather than discard.`,
  },
  {
    requirement_id: 'GDPR-5',
    when: () => true,
    proposed: 'established',
    reason: () => 'Public reporting about named carriers is processed here, so purpose limitation, accuracy and minimisation apply to the investigation record itself.',
  },
  {
    requirement_id: 'GDPR-6',
    when: (i) => i.affects_counterparty,
    proposed: 'established',
    reason: () => 'A lawful basis is needed before an adverse assessment of a named counterparty is recorded or shared.',
  },
  {
    requirement_id: 'GDPR-22',
    when: (i) => i.automated_action,
    proposed: 'established',
    reason: () => 'If the recommendation were actioned without human review it would be a solely automated decision with a significant effect.',
  },
  {
    requirement_id: 'GDPR-32',
    when: (i) => i.affects_counterparty,
    proposed: 'possible',
    reason: () => 'The investigation record contains unproven allegations, so access to it has to be restricted.',
  },
  {
    requirement_id: 'ISO42001-6.1.4',
    when: () => true,
    proposed: 'established',
    reason: () => 'An impact assessment of this system on the carriers it assesses is the natural home for the false-positive cost.',
  },
  {
    requirement_id: 'NIST-MAP-2.3',
    when: () => true,
    proposed: 'possible',
    reason: () => 'The scoring method, its caps and its failure modes are documented and testable, which is what scientific integrity asks for here.',
  },
];

export async function runGovernance(ctx: AgentContext, input: GovernanceInput): Promise<GovernanceOutput> {
  const started = Date.now();
  ctx.assertAlive();
  ctx.spend('agent_call');

  const all = await ctx.tools.governance.requirements();
  ctx.spend('retrieval');
  const known = new Set(all.map((r) => r.id));

  const findings: GovernanceFinding[] = [];
  const missing: string[] = [];

  for (const trigger of TRIGGERS) {
    if (!trigger.when(input)) continue;
    if (!known.has(trigger.requirement_id)) {
      // The snapshot moved under us. Say so rather than silently dropping an obligation.
      missing.push(trigger.requirement_id);
      continue;
    }
    ctx.assertAlive();
    const implication = await ctx.tools.governance.implication({
      requirement_id: trigger.requirement_id,
      proposed_applicability: trigger.proposed,
      reasoning: trigger.reason(input),
    });
    ctx.spend('retrieval');

    // A citation is evidence of an obligation's text, never of an incident. Both flags matter.
    const evidence =
      implication.applicability === 'not_established' || implication.url === null
        ? null
        : ctx.minter.evidence('governance_officer', {
            source: implication.framework,
            source_type: 'regulator',
            url: implication.url,
            title: `${implication.citation} ${implication.ref} - ${implication.title}`,
            publication_date: null,
            retrieved_at: ctx.now,
            claim: `${implication.citation} ${implication.ref} imposes: ${implication.title}`,
            excerpt_or_summary: implication.reasoning,
            reliability: 1,
            relevance: 0.6,
            agents_that_used_it: ['governance_officer'],
            cluster_id: null,
            injection_suspected: false,
            incident_claim: false,
          });

    findings.push({ implication, trigger: trigger.requirement_id, evidence: evidence ?? null });
  }

  const implications = findings.map((f) => f.implication);
  const established = implications.filter((i) => i.applicability === 'established').length;
  const notEstablished = implications.filter((i) => i.applicability === 'not_established');

  const uncertainties: string[] = [
    'Framework summaries are plain-language paraphrases for operational use. They are not legal text and this is not legal advice.',
  ];
  if (notEstablished.length > 0) uncertainties.push(`${notEstablished.length} candidate requirement(s) could not be established from a resolvable citation and are reported as such.`);
  if (missing.length > 0) uncertainties.push(`${missing.length} expected requirement id(s) are absent from the pinned snapshot (${missing.join(', ')}), so those obligations were not assessed.`);
  if (!input.affects_counterparty) uncertainties.push('No named counterparty was recorded as adversely affected, so the data-protection obligations that turn on that were not raised.');

  const frameworks = [...new Set(implications.map((i) => i.framework))].sort();

  return {
    agent: 'governance_officer',
    run_id: ctx.run_id,
    findings,
    evidence_created: findings.flatMap((f) => (f.evidence ? [f.evidence.id] : [])),
    evidence_cited: [],
    // Confidence in the mapping, not in the risk. The trigger table is fixed, so it is high but not 1:
    // it cannot know obligations outside the four pinned frameworks.
    confidence: implications.length === 0 ? 0 : Number(Math.min(0.9, 0.5 + established * 0.08).toFixed(3)),
    uncertainties,
    reasoning_status: implications.length === 0 ? 'insufficient_evidence' : established > 0 ? 'supported' : 'partially_supported',
    recommended_next_step:
      established > 0
        ? `Name the accountable owner for ${established} established obligation(s) before the recommendation is actioned.`
        : 'No obligation could be established from the pinned frameworks; treat the governance position as unassessed.',
    cost: { ...emptyCost(), calls: 1, ms: Date.now() - started },
    implications,
    requirements_considered: all.length,
    frameworks,
  };
}
