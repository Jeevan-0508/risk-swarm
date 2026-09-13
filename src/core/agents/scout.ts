/**
 * SCOUT. Discovers external signals and nothing else: it does not interpret, rank or conclude.
 *
 * Every signal it emits carries at least one evidence object with a real url and publisher. A signal
 * without a verifiable url is dropped rather than downgraded, because an unverifiable signal is not a
 * weaker fact, it is not a fact.
 */
import { canonicalHost, sanitiseText } from '../ingest/sanitize';
import type { Evidence, Signal } from '../domain/model';
import { classifySource, emptyCost, type AgentContext, type AgentOutput } from './types';
import type { SignalQueryStats } from '../integrations/fomo';
import type { SnapshotFileProvenance } from '../integrations/loader';

export interface ScoutInput {
  question: string;
  scope: { geo: string[]; mode: string[]; from: string; to: string };
  limit?: number;
  minFreightRelevance?: number;
}

export interface ScoutFinding {
  signal: Signal;
  evidence: Evidence;
}

export interface ScoutOutput extends AgentOutput<ScoutFinding> {
  stats: SignalQueryStats;
  /** `files` is the pinned-snapshot hash record as synced, so SENTINEL can check it without re-fetching. */
  snapshot: { upstream_repo: string; commit: string | null; synced_files: number; files: SnapshotFileProvenance[] };
}

export async function runScout(ctx: AgentContext, input: ScoutInput): Promise<ScoutOutput> {
  const started = Date.now();
  ctx.assertAlive();
  ctx.spend('agent_call');

  const limit = input.limit ?? 40;
  const result = await ctx.tools.signals.querySignals({
    geo: input.scope.geo,
    from: input.scope.from,
    to: input.scope.to,
    limit,
    minFreightRelevance: input.minFreightRelevance,
  });

  const findings: ScoutFinding[] = [];
  const uncertainties: string[] = [];

  for (const raw of result.signals) {
    ctx.spend('retrieval');
    const host = canonicalHost(raw.url);
    const source_type = classifySource(host);
    const summary = sanitiseText(raw.title, 300);

    const evidence = ctx.minter.evidence('scout', {
      source: raw.publisher,
      source_type,
      url: raw.url,
      title: raw.title,
      publication_date: raw.published_at,
      retrieved_at: raw.retrieved_at || ctx.now,
      claim: raw.title,
      excerpt_or_summary: summary.text,
      // Reliability starts at the tier weight and is reduced for a suspected injection. Relevance is
      // the adapter's freight-relevance score: it is measured, not asserted.
      reliability: source_type === 'regulator' ? 1 : source_type === 'industry_body' ? 0.8 : 0.55,
      relevance: raw.freight_relevance,
      agents_that_used_it: ['scout'],
      cluster_id: null,
      injection_suspected: raw.injection_suspected,
      incident_claim: true,
    });

    const signal = ctx.minter.signal('scout', {
      title: raw.title,
      source: raw.publisher,
      occurred_at: raw.published_at,
      geo: raw.geo,
      mode: raw.mode,
      category_upstream: raw.category_upstream,
      category_derived: raw.category_derived,
      category_confidence: raw.category_confidence,
      category_disagreement: raw.category_disagreement,
      source_severity_hint: raw.severity_hint,
      evidence_ids: [evidence.id],
      cluster_id: null,
    });

    findings.push({ signal, evidence });
  }

  if (result.stats.truncated_by_limit) uncertainties.push(`Retrieval stopped at the ${limit}-signal cap, so coverage of the window is incomplete.`);
  if (result.stats.excluded_low_relevance > 0) uncertainties.push(`${result.stats.excluded_low_relevance} item(s) were excluded as not freight-related; a wrong exclusion would be invisible here.`);
  if (result.stats.category_disagreements > 0) uncertainties.push(`${result.stats.category_disagreements} signal(s) disagree with their upstream category label.`);
  if (findings.length === 0) uncertainties.push('No signal survived filtering, so absence of evidence must not be read as evidence of absence.');

  const injections = findings.filter((f) => f.evidence.injection_suspected).length;
  if (injections > 0) uncertainties.push(`${injections} retrieved item(s) contained instruction-shaped text and were downgraded.`);

  return {
    agent: 'scout',
    run_id: ctx.run_id,
    findings,
    evidence_created: findings.map((f) => f.evidence.id),
    evidence_cited: [],
    // Scout does not judge the risk. Its confidence is about retrieval coverage only.
    confidence: findings.length === 0 ? 0 : Math.min(1, findings.length / 10),
    uncertainties,
    reasoning_status: findings.length === 0 ? 'insufficient_evidence' : 'supported',
    recommended_next_step: findings.length === 0 ? 'Widen the window or the geography before drawing any conclusion.' : 'Cluster and deduplicate before interpretation.',
    cost: { ...emptyCost(), calls: 1, ms: Date.now() - started },
    stats: result.stats,
    snapshot: { upstream_repo: result.provenance.upstream_repo, commit: result.provenance.commit, synced_files: result.provenance.files.length, files: result.provenance.files },
  };
}
