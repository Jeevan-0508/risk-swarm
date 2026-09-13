/**
 * INTELLIGENCE. Turns signals into observations by deterministic means only - no model is involved
 * anywhere in this agent, which is why its output can be audited line by line.
 *
 * Its single most important job: make sure that one event reported five times counts once.
 */
import { clusterItems, recurrenceBuckets, timeBucket, type Cluster, type PossibleDuplicatePair } from '../intel/cluster';
import { sourceIdentity } from '../ingest/sanitize';
import type { Evidence, Observation, Signal } from '../domain/model';
import { emptyCost, type AgentContext, type AgentOutput } from './types';

export interface IntelligenceInput {
  signals: Signal[];
  evidence: Evidence[];
  window: { from: string; to: string };
}

export interface IntelligenceOutput extends AgentOutput<Observation> {
  clusters: Cluster[];
  assignment: Record<string, string>;
  duplicates_removed: number;
  independent_source_count: number;
  possible_duplicate_pairs: PossibleDuplicatePair[];
  recurrence_buckets: string[];
  window_buckets: number;
  category_disagreements: number;
  /** Signals and evidence with their cluster_id filled in. Supersedes the scout versions. */
  clustered_signals: Signal[];
  clustered_evidence: Evidence[];
}

export function runIntelligence(ctx: AgentContext, input: IntelligenceInput): IntelligenceOutput {
  const started = Date.now();
  ctx.assertAlive();
  ctx.spend('agent_call');

  const evidenceById = new Map(input.evidence.map((e) => [e.id, e]));
  const items = input.signals.map((s) => ({
    id: s.id,
    title: s.title,
    source_identity: sourceIdentity(evidenceById.get(s.evidence_ids[0])?.url ?? null, s.source),
    occurred_at: s.occurred_at,
  }));

  const clustered = clusterItems(items);
  const buckets = recurrenceBuckets(clustered.clusters);
  const windowFrom = timeBucket(new Date(input.window.from).toISOString());
  const windowTo = timeBucket(new Date(input.window.to).toISOString());
  const window_buckets = windowFrom && windowTo ? Math.max(1, Number(windowTo.slice(1)) - Number(windowFrom.slice(1)) + 1) : 1;

  // Cluster membership is a fact about a node, so it is recorded as a revision rather than a mutation.
  const clustered_signals = input.signals.map((s) =>
    ctx.minter.signal('intelligence', { ...s, cluster_id: clustered.assignment[s.id] ?? null, supersedes: s.id }),
  );
  const clustered_evidence = input.evidence.map((e) => {
    const owner = input.signals.find((s) => s.evidence_ids.includes(e.id));
    const cluster_id = owner ? (clustered.assignment[owner.id] ?? null) : null;
    return ctx.minter.evidence('intelligence', { ...e, cluster_id, supersedes: e.id });
  });

  const category_disagreements = input.signals.filter((s) => s.category_disagreement).length;
  const categories = new Map<string, number>();
  for (const s of input.signals) categories.set(s.category_derived, (categories.get(s.category_derived) ?? 0) + 1);

  const observations: Observation[] = [];
  const obs = (statement: string, method: string, inputs: string[], computed_value: number | string) =>
    observations.push(
      ctx.minter.observation('intelligence', {
        statement,
        method,
        inputs,
        computed_value,
        window: { from: input.window.from, to: input.window.to },
      }),
    );

  obs(
    `${input.signals.length} signal(s) reduce to ${clustered.clusters.length} distinct event cluster(s) after deduplication`,
    'single-link agglomeration on title similarity, shared entity and a 72h window',
    input.signals.map((s) => s.id),
    clustered.clusters.length,
  );
  obs(
    `${clustered.independent_source_count} independent publisher(s) across those clusters`,
    'distinct canonical publisher identity, counted once per cluster, aggregator hosts excluded',
    clustered.clusters.flatMap((c) => c.member_ids),
    clustered.independent_source_count,
  );
  obs(
    `Clusters fall in ${buckets.length} distinct 7-day bucket(s) of ${window_buckets} in the window`,
    'fixed 7-day bucketing of the latest date in each cluster',
    clustered.clusters.flatMap((c) => c.member_ids),
    buckets.length,
  );
  for (const [category, count] of [...categories.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    obs(
      `${count} signal(s) re-derive to category "${category}"`,
      'keyword re-derivation of the upstream category label',
      input.signals.filter((s) => s.category_derived === category).map((s) => s.id),
      count,
    );
  }

  const uncertainties: string[] = [];
  if (clustered.possible_duplicate_pairs.length > 0) {
    uncertainties.push(
      `${clustered.possible_duplicate_pairs.length} pair(s) may describe the same event but scored below the merge threshold, so the independent-source count may be overstated.`,
    );
  }
  if (category_disagreements > 0) uncertainties.push(`${category_disagreements} signal(s) were labelled differently upstream; the re-derived label is used.`);
  if (clustered.clusters.length === 1) uncertainties.push('All evidence traces to a single event cluster, so nothing here is corroborated independently.');

  return {
    agent: 'intelligence',
    run_id: ctx.run_id,
    findings: observations,
    evidence_created: [],
    evidence_cited: input.evidence.map((e) => e.id),
    confidence: 1, // deterministic arithmetic over the given input; the numbers are not in doubt
    uncertainties,
    reasoning_status: 'supported',
    recommended_next_step: clustered.clusters.length === 0 ? null : 'Match clusters against taxonomy patterns.',
    cost: { ...emptyCost(), calls: 1, ms: Date.now() - started },
    clusters: clustered.clusters,
    assignment: clustered.assignment,
    duplicates_removed: clustered.duplicates_removed,
    independent_source_count: clustered.independent_source_count,
    possible_duplicate_pairs: clustered.possible_duplicate_pairs,
    recurrence_buckets: buckets,
    window_buckets,
    category_disagreements,
    clustered_signals,
    clustered_evidence,
  };
}
