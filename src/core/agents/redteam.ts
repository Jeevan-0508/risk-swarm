/**
 * RED TEAM. Attacks the investigation itself rather than the risk.
 *
 * Its remit is asymmetric by design: a `fail` verdict can stop an escalation, but nothing it produces
 * can ever create one. That asymmetry is what makes it safe to run automatically - the worst it can do
 * is send work back.
 */
import type { AnalystFinding } from './analyst';
import type { Challenge, Evidence, GraphNode, RedTeamClass, RedTeamFinding, Signal } from '../domain/model';
import { TIER_WEIGHT } from '../domain/model';
import { emptyCost, type AgentContext, type AgentOutput } from './types';

export interface RedTeamInput {
  findings: AnalystFinding[];
  signals: Signal[];
  evidence: Evidence[];
  challenges: Challenge[];
  cluster_count: number;
  /** Every node id that legitimately exists in this run, for the fabrication check. */
  known_node_ids: string[];
  /** Node-level claims that assert an impact figure, for the quantification check. */
  quantified_claims?: Array<{ node_id: string; text: string; has_basis: boolean }>;
  /** Support edges as (from -> to), used to detect a claim that supports itself. */
  support_edges?: Array<{ from: string; to: string }>;
  unknown_indicator_share: number;
  benign_category_share: number;
}

export interface RedTeamOutput extends AgentOutput<RedTeamFinding> {
  verdict: 'pass' | 'pass_with_findings' | 'fail';
  /** Set when the verdict is fail: the orchestrator must send the run back rather than publish it. */
  rework_reason: string | null;
  checks_run: number;
}

const CLEARS: Record<RedTeamClass, string> = {
  hallucination: 'Every cited id resolves to a node created in this run.',
  unsupported_claim: 'The claim carries at least one evidence object asserting it.',
  weak_source_chain: 'At least one tier-1 or tier-2 source supports the chain.',
  duplicate_evidence: 'Duplicated evidence is merged into one cluster or counted once.',
  same_source_echo: 'A second independent event cluster corroborates the conclusion.',
  confirmation_bias: 'A benign explanation is tested against data and recorded as ruled out.',
  circular_reasoning: 'The support chain terminates in evidence rather than in itself.',
  correlation_as_causation: 'A mechanism is evidenced, not inferred from co-occurrence.',
  normal_variation: 'The observed count exceeds the historical baseline for the same window length.',
  regulatory_misinterpretation: 'The regulatory claim cites a resolvable provision.',
  impact_overestimate: 'The impact figure names its basis and unit.',
  missing_evidence: 'The indicator states are assessed rather than unknown.',
};

export function runRedTeam(ctx: AgentContext, input: RedTeamInput): RedTeamOutput {
  const started = Date.now();
  ctx.assertAlive();
  ctx.spend('agent_call');

  const out: RedTeamFinding[] = [];
  let checks = 0;
  const flag = (
    target_id: string,
    finding_class: RedTeamClass,
    severity: RedTeamFinding['severity'],
    argument: string,
    evidence_ids: string[] = [],
  ) =>
    out.push(
      ctx.minter.redTeamFinding('red_team', {
        target_id,
        finding_class,
        severity,
        argument,
        evidence_ids,
        clears_when: CLEARS[finding_class],
        resolution: 'open',
      }),
    );

  const known = new Set(input.known_node_ids);
  const incident = input.evidence.filter((e) => e.incident_claim);
  const runTarget = input.findings[0]?.hypothesis.id ?? 'run';

  // 1. Fabricated references. The cheapest and most damaging failure, so it is checked first.
  checks += 1;
  const cited = [
    ...input.challenges.flatMap((c) => [c.target_id, ...c.evidence_ids]),
    ...input.findings.flatMap((f) => [...f.supporting_evidence_ids, f.hypothesis.id]),
  ];
  const fabricated = [...new Set(cited.filter((id) => !known.has(id)))];
  if (fabricated.length > 0) {
    flag(runTarget, 'hallucination', 'blocking', `${fabricated.length} cited id(s) do not exist in this run: ${fabricated.slice(0, 5).join(', ')}. Any conclusion resting on them is void.`);
  }

  // 2. One event, reported many times, read as a pattern.
  checks += 1;
  if (input.cluster_count === 1 && input.findings.length > 0) {
    flag(runTarget, 'same_source_echo', 'blocking', 'The entire conclusion traces to a single event cluster. Repetition across outlets is not corroboration.');
  }

  // 3. Source concentration. One publisher dominating the record is a single point of failure.
  checks += 1;
  if (incident.length >= 2) {
    const counts = new Map<string, number>();
    for (const e of incident) counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
    const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    const share = n / incident.length;
    if (share > 0.6) {
      flag(runTarget, 'confirmation_bias', 'material', `${Math.round(share * 100)}% of incident evidence comes from ${top}. The picture is that outlet's coverage decisions as much as the underlying events.`);
    }
  }

  // 4. Source chain with no weight in it at all.
  checks += 1;
  const chainWeight = incident.reduce((n, e) => n + TIER_WEIGHT[e.tier], 0);
  if (input.findings.length > 0 && chainWeight === 0) {
    flag(runTarget, 'weak_source_chain', 'blocking', 'No incident evidence carries any evidential weight; the chain rests entirely on tier-5 reasoning.');
  } else if (input.findings.length > 0 && !incident.some((e) => e.tier <= 2)) {
    flag(runTarget, 'weak_source_chain', 'material', 'No regulator or industry-body source supports any incident claim; the record is entirely press reporting.');
  }

  // 5. The same incident report counted more than once. Structure citations are excluded: two articles
  // of one regulation legitimately share a framework url and duplicate nothing.
  checks += 1;
  const seenUrl = new Map<string, number>();
  for (const e of incident) if (e.url) seenUrl.set(e.url, (seenUrl.get(e.url) ?? 0) + 1);
  const dupUrls = [...seenUrl.entries()].filter(([, n]) => n > 1);
  if (dupUrls.length > 0) {
    flag(runTarget, 'duplicate_evidence', 'material', `${dupUrls.length} url(s) appear as more than one evidence object, which inflates the apparent volume of support.`);
  }

  // 6. A regulatory claim with no resolvable citation.
  checks += 1;
  const uncited = input.evidence.filter((e) => e.source_type === 'regulator' && e.url === null);
  if (uncited.length > 0) {
    flag(runTarget, 'regulatory_misinterpretation', 'blocking', `${uncited.length} regulator-tier claim(s) carry no resolvable citation.`);
  }

  // 7. Circular support: a claim that is, transitively, its own evidence.
  checks += 1;
  const edges = input.support_edges ?? [];
  if (edges.length > 0) {
    const adj = new Map<string, string[]>();
    for (const e of edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    const onCycle = (start: string): boolean => {
      const seen = new Set<string>();
      const stack = [start];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const next of adj.get(cur) ?? []) {
          if (next === start) return true;
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
      return false;
    };
    const circular = [...adj.keys()].filter(onCycle);
    if (circular.length > 0) {
      flag(runTarget, 'circular_reasoning', 'blocking', `${circular.length} node(s) support themselves transitively: ${circular.slice(0, 3).join(', ')}.`);
    }
  }

  // 8. An impact figure with no stated basis.
  checks += 1;
  for (const claim of input.quantified_claims ?? []) {
    if (!claim.has_basis) {
      flag(claim.node_id, 'impact_overestimate', 'material', `"${claim.text}" states a magnitude without naming its basis or unit, so it cannot be checked or challenged.`);
    }
  }

  // 9. A hypothesis nobody can ever disprove.
  checks += 1;
  for (const f of input.findings) {
    if (f.hypothesis.falsification_test.trim().length < 20) {
      flag(f.hypothesis.id, 'unsupported_claim', 'blocking', 'The hypothesis has no usable falsification test, so it cannot be investigated, only believed.');
    }
  }

  // 10. The whole picture may be ordinary commercial distress.
  checks += 1;
  if (input.benign_category_share >= 0.5 && input.findings.length > 0) {
    flag(runTarget, 'normal_variation', 'material', `${Math.round(input.benign_category_share * 100)}% of surviving signals are insolvency events. In a contracting market that is the expected baseline, not a fraud signal.`);
  }

  // 11. Conclusions drawn where almost nothing was measured.
  checks += 1;
  if (input.unknown_indicator_share > 0.8 && input.findings.length > 0) {
    flag(runTarget, 'missing_evidence', 'blocking', `${Math.round(input.unknown_indicator_share * 100)}% of indicator weight is unassessed. Any occurrence claim here is an assertion about data nobody has looked at.`);
  }

  // 12. Correlation presented as mechanism.
  checks += 1;
  for (const f of input.findings) {
    if (f.match.basis === 'lexical_topic_match' && f.coverage.completeness === 0) {
      flag(f.hypothesis.id, 'correlation_as_causation', 'material', `${f.match.pattern_name} is linked to this network only by shared vocabulary in reporting. No mechanism connecting the two has been evidenced.`);
    }
  }

  const blocking = out.filter((f) => f.severity === 'blocking');
  const verdict: RedTeamOutput['verdict'] = blocking.length > 0 ? 'fail' : out.length > 0 ? 'pass_with_findings' : 'pass';

  return {
    agent: 'red_team',
    run_id: ctx.run_id,
    findings: out,
    evidence_created: [],
    evidence_cited: [...new Set(out.flatMap((f) => f.evidence_ids))],
    confidence: 0.9,
    uncertainties: [
      `${checks} standing checks were run. A weakness outside them would pass unnoticed, so a pass is "no known defect", not "sound".`,
    ],
    reasoning_status: 'supported',
    recommended_next_step:
      verdict === 'fail'
        ? `Rework required: ${blocking.length} blocking finding(s). ${blocking[0]!.clears_when}`
        : out.length > 0
          ? 'Publish with the findings attached and unresolved.'
          : null,
    cost: { ...emptyCost(), calls: 1, ms: Date.now() - started },
    verdict,
    rework_reason: verdict === 'fail' ? blocking.map((f) => `${f.finding_class}: ${f.argument}`).join(' | ') : null,
    checks_run: checks,
  };
}

/** Ids of nodes that legitimately exist, for the fabrication check. */
export const knownIds = (nodes: GraphNode[]): string[] => nodes.map((n) => n.id);
