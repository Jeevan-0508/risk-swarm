/**
 * CHALLENGER. Argues the benign case against every hypothesis, from the taxonomy's own documented
 * false positives.
 *
 * It is deterministic on purpose. A challenge is only raised when a named deficiency exists in the
 * record - a missing corroborating source, an unruled-out gate, an unmerged duplicate pair - so a
 * challenge can always be answered with data rather than with rhetoric. It cannot be talked out of one.
 */
import type { AnalystFinding } from './analyst';
import type { Challenge, Evidence } from '../domain/model';
import { emptyCost, RUN_LEVEL_TARGET, type AgentContext, type AgentOutput } from './types';

export interface ChallengerInput {
  findings: AnalystFinding[];
  evidence: Evidence[];
  independent_source_count: number;
  possible_duplicate_pairs: number;
  cluster_count: number;
  recurrence_buckets: number;
  window_buckets: number;
  /** Share of signals whose re-derived category is insolvency-driven rather than fraud. */
  benign_category_share: number;
  min_independent_sources: number;
}

export interface ChallengerOutput extends AgentOutput<Challenge> {
  ungated_false_positives: number;
  total_false_positive_gates: number;
}

export function runChallenger(ctx: AgentContext, input: ChallengerInput): ChallengerOutput {
  const started = Date.now();
  ctx.assertAlive();
  ctx.spend('agent_call');

  const challenges: Challenge[] = [];
  const raise = (
    target_id: string,
    severity: Challenge['severity'],
    basis: Challenge['basis'],
    argument: string,
    alternative_explanation: string | null,
    evidence_ids: string[] = [],
  ) => challenges.push(ctx.minter.challenge('challenger', { target_id, severity, basis, argument, alternative_explanation, evidence_ids, resolution: 'open', rebuttal: null }));

  const incidentEvidence = input.evidence.filter((e) => e.incident_claim);
  const publishers = new Set(incidentEvidence.map((e) => e.source));
  let ungated = 0;
  let totalGates = 0;

  for (const f of input.findings) {
    ctx.assertAlive();
    totalGates += f.gates.length;

    if (input.independent_source_count < input.min_independent_sources) {
      raise(
        f.hypothesis.id,
        'blocking',
        'evidence_deficiency',
        `${input.independent_source_count} independent publisher(s) stand behind this, below the ${input.min_independent_sources} the policy requires. A single outlet's framing cannot be distinguished from the event itself.`,
        null,
        f.supporting_evidence_ids,
      );
    }

    if (f.cluster_ids.length < 2) {
      raise(
        f.hypothesis.id,
        'blocking',
        'evidence_deficiency',
        `All reporting behind this hypothesis collapses into ${f.cluster_ids.length || 'no'} event cluster(s), so repeated coverage of one incident is being read as a trend.`,
        'One isolated incident, reported more than once.',
        f.supporting_evidence_ids,
      );
    }

    if (f.coverage.completeness === 0) {
      raise(
        f.hypothesis.id,
        'material',
        'evidence_deficiency',
        `No operational indicator for ${f.match.pattern_name} has been assessed, so nothing distinguishes this network from one where the pattern is absent.`,
        'The pattern is discussed in the market but does not occur in this network.',
      );
    }

    // Every documented gate that nobody has ruled out with data is an open benign explanation.
    for (const gate of f.gates) {
      ungated += 1;
      raise(
        f.hypothesis.id,
        'material',
        'ungated_false_positive',
        `Documented false positive not ruled out: what looks like "${gate.looks_like}" is often "${gate.actually}". Ruling it out requires ${gate.how_to_rule_out}`,
        gate.actually,
      );
    }

    if (f.match.basis === 'lexical_topic_match') {
      raise(
        f.hypothesis.id,
        'material',
        'alternative_explanation',
        `The link to ${f.match.pattern_name} rests on the terms ${f.match.matched_terms.map((t) => `"${t}"`).join(', ')} appearing in headlines. Coverage of a pattern rises when journalists notice it, independently of whether it is happening more.`,
        'Increased media attention to an existing baseline rather than a change in the underlying rate.',
      );
    }

    if (input.benign_category_share > 0.5) {
      raise(
        f.hypothesis.id,
        'material',
        'alternative_explanation',
        `${Math.round(input.benign_category_share * 100)}% of the surviving signals re-derive to insolvency rather than fraud. Carrier failure produces the same surface - sudden substitution, unfamiliar subcontractors, missed collections - through ordinary commercial distress.`,
        'Insolvency-driven carrier substitution in a contracting freight market.',
      );
    }
  }

  if (input.possible_duplicate_pairs > 0) {
    const target = input.findings[0]?.hypothesis.id ?? RUN_LEVEL_TARGET;
    raise(
      target,
      'material',
      'evidence_deficiency',
      `${input.possible_duplicate_pairs} report pair(s) scored close to the duplicate threshold without being merged. If they are the same event, the independent-source count of ${input.independent_source_count} is overstated.`,
      'Fewer distinct events than counted.',
    );
  }

  if (input.recurrence_buckets <= 1 && input.window_buckets > 1) {
    const target = input.findings[0]?.hypothesis.id ?? RUN_LEVEL_TARGET;
    raise(
      target,
      'material',
      'alternative_explanation',
      `All activity falls inside 1 of ${input.window_buckets} weekly buckets, which is a spike rather than a trend.`,
      'Normal variation in a low-count series.',
    );
  }

  const blocking = challenges.filter((c) => c.severity === 'blocking').length;

  const uncertainties: string[] = [];
  if (challenges.length === 0) uncertainties.push('No deficiency matched the deterministic checks; that is the absence of a known weakness, not proof of soundness.');
  if (publishers.size > 0 && publishers.size < 3) uncertainties.push(`Only ${publishers.size} distinct publisher(s) appear in the incident evidence, so publisher-level bias cannot be assessed.`);

  return {
    agent: 'challenger',
    run_id: ctx.run_id,
    findings: challenges,
    evidence_created: [],
    evidence_cited: [...new Set(challenges.flatMap((c) => c.evidence_ids))],
    // Confidence that the challenges are well-founded. Each one names a fact in the record.
    confidence: challenges.length === 0 ? 0.4 : 0.9,
    uncertainties,
    reasoning_status: challenges.length === 0 ? 'insufficient_evidence' : 'supported',
    recommended_next_step:
      blocking > 0
        ? `Answer ${blocking} blocking objection(s) with data before any escalation is considered.`
        : challenges.length > 0
          ? `Rule out ${ungated} documented false positive(s) to close the benign explanations.`
          : null,
    cost: { ...emptyCost(), calls: 1, ms: Date.now() - started },
    ungated_false_positives: ungated,
    total_false_positive_gates: totalGates,
  };
}
