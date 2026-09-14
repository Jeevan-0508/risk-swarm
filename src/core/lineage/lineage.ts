/**
 * Phase L1 - Decision Lineage, Evidence Needed, Source Concentration. All three are pure derivations
 * over data a completed `RunResult` already carries: no new agent, no new engine computation, no new
 * graph API. Designed in full in `docs/EVOLUTION-2.0.md`'s "Next session: Phase E" note and absorbed
 * into Council's own Decision Lineage ask (`docs/EVOLUTION-3.0-COUNCIL.md` Phase L1) rather than built
 * twice. Deliberately not wired onto `RunResult` or persisted: everything here is recomputable for
 * free from the graph and outputs a stored run already keeps, so storing a fourth report alongside
 * SENTINEL/PULSE/deliberation would only duplicate data already on disk.
 */
import { RiskGraph } from '../domain/graph';
import type { Decision, Evidence, Hypothesis, Observation } from '../domain/model';
import { sourceIdentity } from '../ingest/sanitize';
import type { CoverageResult, Pattern } from '../integrations/atlas';

// ---------------------------------------------------------------------------- Decision Lineage

export interface ObservationLineage {
  observation: Observation;
  /** Evidence this observation was itself derived from, via `graph.evidenceChain()`. */
  evidence: Evidence[];
}

export interface HypothesisLineage {
  hypothesis: Hypothesis;
  /** Every evidence node this hypothesis rests on, transitively - hypothesis <- observation <-
   *  evidence, via `graph.evidenceChain()`, exactly as that method's own doc describes it. Not just
   *  the analyst's own `supporting_evidence_ids`: it is a superset, since an observation this
   *  hypothesis is `based_on` may itself rest on more evidence than the analyst cited directly. */
  evidence: Evidence[];
  observations: ObservationLineage[];
}

export interface DecisionLineage {
  decision_id: string;
  /** Evidence the decision cites directly (`decision.evidence_cited`), via `graph.evidenceChain()`. */
  decision_evidence: Evidence[];
  hypotheses: HypothesisLineage[];
}

/**
 * "Why did the system conclude this" as a chain, not a paragraph: decision -> hypothesis ->
 * observation(s) -> evidence. `graph.evidenceChain(id)` already does the graph walk (it does not
 * traverse `based_on` edges, by design - see its own doc comment - so the hypothesis -> observation
 * link is read directly off `based_on` edges here, once per hypothesis, rather than reimplemented).
 */
export function decisionLineage(graph: RiskGraph, decision: Decision): DecisionLineage {
  const decision_evidence = graph.evidenceChain(decision.id);

  const hypotheses: HypothesisLineage[] = decision.hypothesis_ids
    .map((id) => graph.get(id))
    .filter((n): n is Hypothesis => n !== undefined && n.kind === 'hypothesis')
    .map((hypothesis) => {
      const evidence = graph.evidenceChain(hypothesis.id);
      const observations: ObservationLineage[] = graph
        .edges({ from: hypothesis.id, kind: 'based_on' })
        .map((e) => graph.get(e.to))
        .filter((n): n is Observation => n !== undefined && n.kind === 'observation')
        .map((observation) => ({ observation, evidence: graph.evidenceChain(observation.id) }));
      return { hypothesis, evidence, observations };
    });

  return { decision_id: decision.id, decision_evidence, hypotheses };
}

// ---------------------------------------------------------------------------- Evidence Needed

export interface EvidenceNeededItem {
  indicator_id: string;
  /** The indicator's own descriptive text, copied verbatim from the taxonomy - never paraphrased. */
  signal: string;
  observable_in: string;
  weight: number;
}

/**
 * "What would change the band" as a concrete, ranked ask, never a vague caveat. Takes an
 * already-computed `CoverageResult` and the exact `Pattern` object it was computed against (the
 * caller - the analyst already did this once per run, a UI screen does it again via
 * `atlas.pattern(patternId)`) and surfaces every indicator nobody has looked at, highest-leverage
 * first. No new indicator taxonomy, no invented weights: every field is copied from the pattern.
 */
export function evidenceNeeded(coverage: CoverageResult, pattern: Pattern): EvidenceNeededItem[] {
  const unknown = new Set(coverage.unknown_indicator_ids);
  return pattern.indicators
    .filter((ind) => unknown.has(ind.id))
    .map((ind) => ({ indicator_id: ind.id, signal: ind.signal, observable_in: ind.observable_in, weight: ind.weight }))
    .sort((a, b) => b.weight - a.weight || a.indicator_id.localeCompare(b.indicator_id));
}

// ---------------------------------------------------------------------------- Source Concentration

export interface SourceConcentrationEntry {
  source_identity: string;
  count: number;
  /** Share of this run's evidence held by this one source, rounded to 4 places. */
  share: number;
}

export interface SourceConcentration {
  total_evidence: number;
  /** Sorted by count, descending. Empty when the run cited no evidence at all. */
  by_source: SourceConcentrationEntry[];
  /** The share held by the single largest source - the number ORBIT's `source_concentration`
   *  scenario stress-tests; this is that same concentration, computed for every run, not just a
   *  stress test. 0 when there is no evidence to be concentrated in the first place. */
  top_source_share: number;
}

/**
 * The permanent, every-run version of ORBIT's `source_concentration` scenario. ORBIT groups raw,
 * pre-graph signals by their publisher string to build a synthetic stress case; this groups a
 * completed run's real `Evidence` nodes by `sourceIdentity()` - the same host/publisher
 * normalization SENTINEL's own `source_identity` check already uses, which is a strictly better key
 * than a raw publisher string (it collapses an aggregator host to `aggregator:` rather than counting
 * it as one more independent voice).
 */
export function sourceConcentration(evidence: Evidence[]): SourceConcentration {
  if (evidence.length === 0) return { total_evidence: 0, by_source: [], top_source_share: 0 };
  const counts = new Map<string, number>();
  for (const e of evidence) {
    const id = sourceIdentity(e.url, e.source);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const by_source = [...counts.entries()]
    .map(([source_identity, count]) => ({ source_identity, count, share: Number((count / evidence.length).toFixed(4)) }))
    .sort((a, b) => b.count - a.count || a.source_identity.localeCompare(b.source_identity));
  return { total_evidence: evidence.length, by_source, top_source_share: by_source[0]!.share };
}
