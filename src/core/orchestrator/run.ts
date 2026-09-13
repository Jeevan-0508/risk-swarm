/**
 * The orchestrator. Runs the seven agents in a fixed order, writes every node into one append-only
 * graph, meters the budget and stops the run rather than letting it wander.
 *
 * The rework rule is the part worth reading. A red-team failure is split in two:
 *   - a defect in how the investigation was *built* (a fabricated id, a circular chain, an untestable
 *     hypothesis) is reworkable: drop the offending hypothesis and run the chain again;
 *   - a defect in the *evidence that exists* (one publisher, no operational data, a benign baseline)
 *     is not reworkable, because re-running cannot conjure evidence. It is published, and it caps the
 *     band.
 * Conflating the two is how a system ends up looping forever or, worse, quietly relaxing its own gates.
 */
import { RiskGraph } from '../domain/graph';
import type { Edge, GraphNode, IndicatorState, Lesson, RedTeamClass } from '../domain/model';
import { policyFor, type ScoringPolicy } from '../scoring/policy';
import { runScout, type ScoutOutput } from '../agents/scout';
import { runIntelligence, type IntelligenceOutput } from '../agents/intelligence';
import { runAnalyst, type AnalystOutput } from '../agents/analyst';
import { runGovernance, type GovernanceOutput } from '../agents/governance';
import { runChallenger, type ChallengerOutput } from '../agents/challenger';
import { runRedTeam, type RedTeamOutput } from '../agents/redteam';
import { runDecision, type DecisionOutput } from '../agents/decision';
import { createHarness, type Budget, type Harness } from '../agents/harness';
import type { SnapshotLoader } from '../integrations/loader';
import type { SignalSource } from '../integrations/fomo';
import type { Reasoner } from '../reasoner/types';
import { runSentinel, type SentinelReport } from '../sentinel/sentinel';
import { runPulse, type PulseReport } from '../pulse/pulse';

/** Defects in how the investigation was built. Re-running the chain can actually fix these. */
const REWORKABLE: ReadonlySet<RedTeamClass> = new Set<RedTeamClass>(['hallucination', 'unsupported_claim', 'circular_reasoning', 'duplicate_evidence']);

export interface InvestigateOptions {
  loader: SnapshotLoader;
  run_id: string;
  now: string;
  question: string;
  scope: { geo: string[]; mode: string[]; from: string; to: string };
  limit?: number;
  minFreightRelevance?: number;
  indicatorStates?: Record<string, IndicatorState>;
  lessons?: Lesson[];
  /** Replaces the pinned signal snapshot. Everything else stays pinned, so only discovery goes live. */
  signals?: SignalSource;
  reasoner?: Reasoner;
  budget?: Partial<Budget>;
  maxRework?: number;
  /** True when the caller would act on the recommendation without human review. Governance needs it. */
  automatedAction?: boolean;
  /**
   * Called as each phase completes, with the entry that was just recorded. Awaited, so a UI can pace
   * the reveal on real completions instead of animating a fake progress bar.
   */
  onPhase?: (entry: PhaseLogEntry, spent: Budget) => void | Promise<void>;
  /** Receives the run's controls before the first phase, so an operator can stop it mid-flight. */
  onStart?: (control: { abort: (reason: string) => void }) => void;
  reversibility?: 'reversible' | 'hard_to_reverse' | 'irreversible';
}

export interface PhaseLogEntry {
  phase: string;
  agent: string;
  attempt: number;
  ms: number;
  findings: number;
  reasoning_status: string;
  note: string | null;
}

export interface RunResult {
  run_id: string;
  question: string;
  graph: RiskGraph;
  outputs: {
    scout: ScoutOutput;
    intelligence: IntelligenceOutput;
    analyst: AnalystOutput;
    governance: GovernanceOutput;
    challenger: ChallengerOutput;
    red_team: RedTeamOutput;
    decision: DecisionOutput;
  };
  policy: ScoringPolicy;
  attempts: number;
  rework_history: string[];
  log: PhaseLogEntry[];
  spent: Budget;
  benign_category_share: number;
  /** Evidence-integrity report over the graph this run actually built. Never affects the recommendation. */
  sentinel: SentinelReport;
  /** System-health report over this run's own process - budget, coverage, source diversity. Never affects the recommendation. */
  pulse: PulseReport;
}

const BENIGN_CATEGORY = 'insolven';

export async function investigate(options: InvestigateOptions): Promise<RunResult> {
  const harness: Harness = createHarness({
    loader: options.loader,
    run_id: options.run_id,
    now: options.now,
    reasoner: options.reasoner,
    signals: options.signals,
    budget: options.budget,
  });
  const { ctx } = harness;
  options.onStart?.({ abort: harness.abort });
  const log: PhaseLogEntry[] = [];
  const record = async (phase: string, attempt: number, out: { agent: string; cost: { ms: number }; findings: unknown[]; reasoning_status: string }, note: string | null = null) => {
    const entry: PhaseLogEntry = { phase, agent: out.agent, attempt, ms: out.cost.ms, findings: out.findings.length, reasoning_status: out.reasoning_status, note };
    log.push(entry);
    await options.onPhase?.(entry, { ...harness.spent });
  };

  const scout = await runScout(ctx, {
    question: options.question,
    scope: options.scope,
    limit: options.limit,
    minFreightRelevance: options.minFreightRelevance,
  });
  await record('discover', 1, scout);

  const intelligence = runIntelligence(ctx, {
    signals: scout.findings.map((f) => f.signal),
    evidence: scout.findings.map((f) => f.evidence),
    window: { from: options.scope.from, to: options.scope.to },
  });
  await record('deduplicate', 1, intelligence);

  const signals = intelligence.clustered_signals;
  const incidentEvidence = intelligence.clustered_evidence;
  const clusterOf = Object.fromEntries(signals.map((s) => [s.id, s.cluster_id ?? '']));
  const benign_category_share =
    signals.length === 0 ? 0 : signals.filter((s) => s.category_derived.toLowerCase().includes(BENIGN_CATEGORY)).length / signals.length;

  const maxRework = options.maxRework ?? 2;
  const rework_history: string[] = [];
  let attempt = 0;
  let excluded: string[] = [];
  let analyst!: AnalystOutput;
  let governance!: GovernanceOutput;
  let challenger!: ChallengerOutput;
  let red_team!: RedTeamOutput;
  let policy!: ScoringPolicy;

  for (;;) {
    attempt += 1;
    ctx.assertAlive();

    const produced = await runAnalyst(ctx, {
      question: options.question,
      signals,
      evidence: incidentEvidence,
      observations: intelligence.findings,
      scope: { geo: options.scope.geo, mode: options.scope.mode },
      clusterOf,
      indicatorStates: options.indicatorStates,
    });
    // Hypotheses the red team rejected as badly built are removed, not silently re-scored.
    analyst = excluded.length === 0 ? produced : { ...produced, findings: produced.findings.filter((f) => !excluded.includes(f.match.pattern_id)) };
    await record('analyse', attempt, analyst, excluded.length > 0 ? `excluded after rework: ${excluded.join(', ')}` : null);

    policy = policyFor(analyst.findings[0]?.match.pattern_id ?? null, (options.lessons ?? []).map((l) => ({ pattern_key: l.pattern_key, rule: l.rule })));

    governance = await runGovernance(ctx, {
      question: options.question,
      hypotheses: analyst.findings.map((f) => f.hypothesis),
      affects_counterparty: analyst.findings.length > 0,
      automated_action: options.automatedAction ?? false,
      model_used: ctx.reasoner.uses_network,
      unresolved_objections: 0,
    });
    await record('govern', attempt, governance);

    challenger = runChallenger(ctx, {
      findings: analyst.findings,
      evidence: incidentEvidence,
      independent_source_count: intelligence.independent_source_count,
      possible_duplicate_pairs: intelligence.possible_duplicate_pairs.length,
      cluster_count: intelligence.clusters.length,
      recurrence_buckets: intelligence.recurrence_buckets.length,
      window_buckets: intelligence.window_buckets,
      benign_category_share,
      min_independent_sources: policy.min_independent_sources,
    });
    await record('challenge', attempt, challenger);

    const governanceEvidence = governance.findings.flatMap((f) => (f.evidence ? [f.evidence] : []));
    const allEvidence = [...incidentEvidence, ...governanceEvidence];
    const knownNodes: GraphNode[] = [
      ...signals,
      ...allEvidence,
      ...intelligence.findings,
      ...analyst.findings.map((f) => f.hypothesis),
      ...challenger.findings,
    ];

    red_team = runRedTeam(ctx, {
      findings: analyst.findings,
      signals,
      evidence: allEvidence,
      challenges: challenger.findings,
      cluster_count: intelligence.clusters.length,
      known_node_ids: knownNodes.map((n) => n.id),
      unknown_indicator_share: analyst.unknown_indicator_share,
      benign_category_share,
    });
    await record('red_team', attempt, red_team, red_team.verdict);

    const reworkable = red_team.findings.filter((f) => f.severity === 'blocking' && REWORKABLE.has(f.finding_class));
    if (red_team.verdict !== 'fail' || reworkable.length === 0 || attempt > maxRework) {
      if (reworkable.length > 0) rework_history.push(`rework limit reached with ${reworkable.length} construction defect(s) still open`);
      break;
    }
    const drop = analyst.findings.filter((f) => reworkable.some((r) => r.target_id === f.hypothesis.id)).map((f) => f.match.pattern_id);
    excluded = [...new Set([...excluded, ...drop])];
    rework_history.push(`attempt ${attempt}: ${reworkable.map((f) => f.finding_class).join(', ')} -> dropped ${drop.join(', ') || 'nothing (run-level defect)'}`);
    if (drop.length === 0) break; // nothing to drop, so another attempt would be identical
  }

  const governanceEvidence = governance.findings.flatMap((f) => (f.evidence ? [f.evidence] : []));
  const allEvidence = [...incidentEvidence, ...governanceEvidence];

  const decision = await runDecision(ctx, {
    question: options.question,
    findings: analyst.findings,
    evidence: allEvidence,
    challenges: challenger.findings,
    red_team: red_team.findings,
    implications: governance.implications,
    agent_positions: [scout, intelligence, analyst, governance, challenger, red_team].map((a) => ({
      agent: a.agent,
      reasoning_status: a.reasoning_status,
      confidence: a.confidence,
    })),
    cluster_count: intelligence.clusters.length,
    possible_duplicate_pairs: intelligence.possible_duplicate_pairs.length,
    recurrence_buckets: intelligence.recurrence_buckets.length,
    window_buckets: intelligence.window_buckets,
    scope_breadth: scopeBreadth(options.scope),
    evidence_conflicts: intelligence.category_disagreements,
    ungated_false_positives: challenger.ungated_false_positives,
    total_false_positive_gates: challenger.total_false_positive_gates,
    circular_support_count: red_team.findings.filter((f) => f.finding_class === 'circular_reasoning').length,
    declared_uncertainties: [scout, intelligence, analyst, governance, challenger, red_team].reduce((n, a) => n + a.uncertainties.length, 0),
    reversibility: options.reversibility ?? 'hard_to_reverse',
    regulatory_deadline_days: null,
    policy,
  });
  await record('decide', attempt, decision, decision.decision.action_band);

  const graph = assemble({
    scout_signals: scout.findings.map((f) => f.signal),
    scout_evidence: scout.findings.map((f) => f.evidence),
    signals,
    evidence: allEvidence,
    intelligence,
    analyst,
    challenger,
    red_team,
    decision,
  });

  const sentinel = runSentinel({ graph, snapshotFiles: scout.snapshot.files });
  const pulse = runPulse({
    intelligence, governance, challenger, red_team, decision, policy, sentinel,
    spent: harness.spent,
    budget: harness.budget,
    // Live retrieval is captured by a UI-only side channel (see `liveSignalSource` in
    // `app/lib/engine.ts`), not returned through any agent output, so it is not yet in scope for
    // this engine-side report - a real gap noted in `docs/EVOLUTION-2.0.md`, not a fabricated VERIFIED.
  });

  return {
    run_id: options.run_id,
    question: options.question,
    graph,
    outputs: { scout, intelligence, analyst, governance, challenger, red_team, decision },
    policy,
    attempts: attempt,
    rework_history,
    log,
    spent: harness.spent,
    benign_category_share,
    sentinel,
    pulse,
  };
}

/** Geography x mode against a nominal ten-country, four-mode network. Stated so it can be argued with. */
function scopeBreadth(scope: { geo: string[]; mode: string[] }): number {
  const geo = Math.min(1, scope.geo.length / 10);
  const mode = Math.min(1, scope.mode.length / 4);
  return Number(Math.min(1, (geo + mode) / 2 + 0.25).toFixed(3));
}

function assemble(parts: {
  scout_signals: GraphNode[];
  scout_evidence: GraphNode[];
  signals: GraphNode[];
  evidence: GraphNode[];
  intelligence: IntelligenceOutput;
  analyst: AnalystOutput;
  challenger: ChallengerOutput;
  red_team: RedTeamOutput;
  decision: DecisionOutput;
}): RiskGraph {
  const graph = new RiskGraph();
  const add = (nodes: GraphNode[]) => nodes.forEach((n) => graph.add(n));

  // Order matters: a superseding node may only be added after the node it replaces, so the revision
  // history in the graph reads forwards.
  add(parts.scout_evidence);
  add(parts.scout_signals);
  add(parts.evidence.filter((e) => !graph.has(e.id)));
  add(parts.signals.filter((s) => !graph.has(s.id)));
  add(parts.intelligence.findings);
  add(parts.analyst.superseded);
  add(parts.analyst.findings.map((f) => f.hypothesis));
  add(parts.challenger.findings);
  add(parts.red_team.findings);
  graph.add(parts.decision.decision);
  add(parts.decision.actions);

  const edges: Edge[] = [];
  const push = (from: string, to: string, kind: Edge['kind'], created_by: Edge['created_by']) => edges.push({ from, to, kind, weight: 1, created_by });

  for (const s of parts.signals) {
    if (s.kind !== 'signal') continue;
    for (const e of s.evidence_ids) if (graph.has(e)) push(s.id, e, 'based_on', 'scout');
  }
  for (const o of parts.intelligence.findings) for (const i of o.inputs) if (graph.has(i)) push(o.id, i, 'derived_from', 'intelligence');
  for (const f of parts.analyst.findings) {
    for (const e of f.supporting_evidence_ids) if (graph.has(e)) push(e, f.hypothesis.id, 'supports', 'risk_analyst');
    for (const o of parts.intelligence.findings) push(f.hypothesis.id, o.id, 'based_on', 'risk_analyst');
  }
  for (const c of parts.challenger.findings) if (graph.has(c.target_id)) push(c.id, c.target_id, 'weakens', 'challenger');
  for (const f of parts.red_team.findings) if (graph.has(f.target_id)) push(f.id, f.target_id, 'weakens', 'red_team');
  for (const h of parts.decision.decision.hypothesis_ids) if (graph.has(h)) push(parts.decision.decision.id, h, 'based_on', 'decision_engine');
  // The decision cites its evidence directly. Without this a reader could not ask the graph what the
  // recommendation actually rests on: 'based_on' is a structural link, not a provenance one.
  for (const e of parts.decision.evidence_cited) if (graph.has(e)) push(parts.decision.decision.id, e, 'cites', 'decision_engine');
  for (const a of parts.decision.actions) push(parts.decision.decision.id, a.id, 'realised_by', 'decision_engine');

  for (const e of edges) graph.link(e);
  return graph;
}
