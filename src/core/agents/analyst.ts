/**
 * RISK ANALYST. Turns observations into falsifiable hypotheses, each anchored to a taxonomy pattern.
 *
 * The honest position it is built to hold: a lexical pattern match in public reporting evidences that
 * a pattern was *discussed*, never that it *occurred here*. Operational indicators - the only thing
 * that could show occurrence - are `unknown` unless someone supplies internal data, so coverage is
 * low and uncertainty is high. That is the reason a demo run lands on investigate rather than
 * escalate, and it is a feature.
 */
import type { CoverageResult, FalsePositiveGate, PatternMatch } from '../integrations/atlas';
import type { Evidence, Hypothesis, HypothesisStatus, IndicatorState, Observation, Signal } from '../domain/model';
import { asDataBlock } from '../ingest/sanitize';
import { emptyCost, type AgentContext, type AgentOutput } from './types';

export interface AnalystInput {
  question: string;
  signals: Signal[];
  evidence: Evidence[];
  observations: Observation[];
  scope: { geo: string[]; mode: string[] };
  /** Cluster count behind each pattern, from INTELLIGENCE. Used to hold back single-cluster claims. */
  clusterOf: Record<string, string>;
  /** Operational indicator states, if any internal data was supplied. Absent means `unknown`. */
  indicatorStates?: Record<string, IndicatorState>;
  maxHypotheses?: number;
}

export interface AnalystFinding {
  hypothesis: Hypothesis;
  match: PatternMatch;
  coverage: CoverageResult;
  gates: FalsePositiveGate[];
  /** Distinct event clusters behind the match. One cluster is one event, however many articles. */
  cluster_ids: string[];
  supporting_evidence_ids: string[];
}

export interface AnalystOutput extends AgentOutput<AnalystFinding> {
  /** Hypotheses replaced by a re-worded revision. Kept so the graph can hold both ends of the edge. */
  superseded: Hypothesis[];
  /** Patterns the lexical matcher never reached. Named so silence is visible. */
  patterns_considered: number;
  unknown_indicator_share: number;
}

const STATUS_NOTE: Record<HypothesisStatus, string> = {
  open: 'stated but not yet tested',
  supported: 'supported by corroborated evidence',
  insufficient_evidence: 'not testable on the evidence available',
  refuted: 'contradicted by the evidence',
  blocked: 'blocked by an unresolved objection',
};

function falsificationTest(patternName: string, gates: FalsePositiveGate[]): string {
  const first = gates[0];
  const ruleOut = first ? ` Then rule out the documented benign explanation: ${first.actually}` : '';
  return (
    `Retrieve the operational records for the named carriers over the window and check the ${patternName} indicators directly. ` +
    `The hypothesis is refuted if the indicators are recorded absent, or if every report traces to one publisher.${ruleOut}`
  );
}

export async function runAnalyst(ctx: AgentContext, input: AnalystInput): Promise<AnalystOutput> {
  const started = Date.now();
  ctx.assertAlive();
  ctx.spend('agent_call');

  const meta = await ctx.tools.atlas.meta();
  ctx.spend('retrieval');
  const matches = await ctx.tools.atlas.matchLexical(input.signals.map((s) => ({ id: s.id, text: s.title })));
  ctx.spend('retrieval');

  const evidenceBySignal = new Map(input.signals.map((s) => [s.id, s.evidence_ids]));
  const limit = input.maxHypotheses ?? 4;
  const findings: AnalystFinding[] = [];
  let unknownWeight = 0;
  let totalWeight = 0;

  for (const match of matches.slice(0, limit)) {
    ctx.assertAlive();
    const gates = await ctx.tools.atlas.falsePositiveGates(match.pattern_id);
    const coverage = await ctx.tools.atlas.coverage(match.pattern_id, input.indicatorStates ?? {});
    ctx.spend('retrieval', 2);
    unknownWeight += coverage.unknown_weight;
    totalWeight += coverage.total_weight;

    const cluster_ids = [...new Set(match.item_ids.map((id) => input.clusterOf[id]).filter((c): c is string => Boolean(c)))].sort();
    const supporting_evidence_ids = match.item_ids.flatMap((id) => evidenceBySignal.get(id) ?? []);

    // Status is decided by the evidence, not by how plausible the pattern feels. A lexical match with
    // no operational coverage can never be more than 'insufficient_evidence'.
    const status: HypothesisStatus = coverage.completeness === 0 ? 'insufficient_evidence' : cluster_ids.length >= 2 ? 'open' : 'insufficient_evidence';

    const statement =
      `${match.pattern_name} activity is present in the ${input.scope.geo.join('/') || 'in-scope'} network: ` +
      `${match.hits} report(s) across ${cluster_ids.length} distinct event cluster(s) discuss it in the window, ` +
      `and ${coverage.unknown_indicator_ids.length} of ${coverage.present_indicator_ids.length + coverage.unknown_indicator_ids.length} ` +
      `operational indicator(s) are unassessed.`;

    const hypothesis = ctx.minter.hypothesis('risk_analyst', {
      statement,
      falsification_test: falsificationTest(match.pattern_name, gates),
      pattern_id: match.pattern_id,
      status,
      scope: { geo: input.scope.geo, mode: input.scope.mode },
    });

    findings.push({ hypothesis, match, coverage, gates, cluster_ids, supporting_evidence_ids });
  }

  // The model, when configured, may only re-word statements the agent already validated. It sees the
  // structured facts as data, never as instructions, and may cite only the evidence listed here.
  let degraded_reason: string | null = null;
  const superseded: Hypothesis[] = [];
  if (findings.length > 0 && ctx.reasoner.uses_network) {
    const allowed = [...new Set(findings.flatMap((f) => f.supporting_evidence_ids))];
    const result = await ctx.reasoner.propose<string[]>({
      task: 'analyst.phrase_hypotheses',
      instruction:
        'Rewrite each hypothesis statement so a risk manager can read it in one breath. Do not add any claim, number, entity or citation that is not already present. Return a JSON array of strings, same length and order.',
      data_blocks: findings.map((f, i) => asDataBlock(`hypothesis_${i}`, 'draft hypothesis statement', f.hypothesis.statement)),
      allowed_evidence_ids: allowed,
      schema_hint: 'string[]',
      validate: (raw) => {
        if (!Array.isArray(raw) || raw.length !== findings.length || raw.some((s) => typeof s !== 'string' || s.length < 20)) {
          throw new Error('SHAPE_MISMATCH: expected one non-trivial string per hypothesis');
        }
        return raw as string[];
      },
      fallback: () => findings.map((f) => f.hypothesis.statement),
    });
    ctx.spend('tokens', result.est_tokens);
    degraded_reason = result.degraded ? result.degraded_reason : null;
    if (!result.degraded) {
      for (const [i, f] of findings.entries()) {
        superseded.push(f.hypothesis);
        findings[i] = { ...f, hypothesis: ctx.minter.hypothesis('risk_analyst', { ...f.hypothesis, statement: result.value[i]!, supersedes: f.hypothesis.id }) };
      }
    }
  }

  const unknown_indicator_share = totalWeight > 0 ? Number((unknownWeight / totalWeight).toFixed(3)) : 1;

  const uncertainties: string[] = [];
  if (findings.length === 0) {
    uncertainties.push(`No signal matched any of the ${meta.pattern_count} taxonomy patterns lexically; an unnamed pattern would be invisible to this method.`);
  } else {
    uncertainties.push(
      `Every match is a lexical topic match in reporting. None of them evidences that the pattern occurred in this organisation.`,
    );
    if (unknown_indicator_share > 0.8) {
      uncertainties.push(
        `${Math.round(unknown_indicator_share * 100)}% of indicator weight is unassessed because no internal operational data was supplied. Unknown is an evidence gap, not an absence.`,
      );
    }
    const single = findings.filter((f) => f.cluster_ids.length < 2);
    if (single.length > 0) uncertainties.push(`${single.length} hypothesis/es rest on a single event cluster, so they are uncorroborated.`);
    const gated = findings.reduce((n, f) => n + f.gates.length, 0);
    if (gated > 0) uncertainties.push(`${gated} documented false-positive gate(s) apply and none has been ruled out with data.`);
  }
  if (degraded_reason) uncertainties.push(`Model phrasing was requested and rejected (${degraded_reason}); deterministic wording is shown.`);

  const status = findings.length === 0 ? 'insufficient_evidence' : findings.some((f) => f.hypothesis.status === 'open') ? 'partially_supported' : 'hypothesis_only';

  return {
    agent: 'risk_analyst',
    run_id: ctx.run_id,
    findings,
    evidence_created: [],
    evidence_cited: [...new Set(findings.flatMap((f) => f.supporting_evidence_ids))],
    // Confidence in the *analysis*, held down by the unassessed indicators it depends on.
    confidence: findings.length === 0 ? 0 : Number(Math.min(0.6, (1 - unknown_indicator_share) * 0.6 + Math.min(findings.flatMap((f) => f.cluster_ids).length, 4) * 0.075).toFixed(3)),
    uncertainties,
    reasoning_status: status,
    recommended_next_step:
      findings.length === 0
        ? 'Widen retrieval before concluding anything; no pattern was named in the window.'
        : `Rule out ${findings[0]!.gates.length} documented false positive(s) for ${findings[0]!.match.pattern_name} with operational data (${STATUS_NOTE[findings[0]!.hypothesis.status]}).`,
    cost: { ...emptyCost(), calls: 1, ms: Date.now() - started },
    degraded_reason,
    superseded,
    patterns_considered: meta.pattern_count,
    unknown_indicator_share,
  };
}
