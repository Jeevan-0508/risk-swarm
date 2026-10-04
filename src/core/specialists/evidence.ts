import type { Evidence, SourceType, Tier } from '../domain/model';
import type { RiskGraph } from '../domain/graph';
import type { RunResult } from '../orchestrator/run';

export interface SpecialistEvidenceReference {
  readonly evidence_id: string;
  readonly source_type: SourceType;
  readonly source_identity: string;
  readonly title: string;
  readonly excerpt: string;
  /** The source's observed/publication date when present; never inferred from retrieval time. */
  readonly observed_at: string | null;
  readonly retrieved_at: string;
  readonly tier: Tier;
  readonly relevance: number;
  readonly incident_claim: boolean;
}

export interface SpecialistScope {
  readonly geo: readonly string[];
  readonly mode: readonly string[];
  readonly from: string;
  readonly to: string;
}

export interface SpecialistProvenanceSummary {
  readonly evidence_count: number;
  readonly source_count: number;
  readonly source_identities: readonly string[];
  readonly tier_counts: Readonly<Record<string, number>>;
  readonly all_items_have_provenance: boolean;
}

/** Deeply immutable, bounded projection of SWARM evidence. No graph or mutation API crosses this seam. */
export interface SpecialistEvidencePackage {
  readonly investigation_id: string;
  readonly question: string;
  readonly domain: string;
  readonly scope: SpecialistScope;
  readonly evidence: readonly SpecialistEvidenceReference[];
  readonly known_uncertainties: readonly string[];
  readonly known_conflicts: readonly string[];
  readonly known_gaps: readonly string[];
  readonly provenance_summary: SpecialistProvenanceSummary;
  readonly generated_at: string;
}

export interface SpecialistEvidenceContext {
  readonly investigation_id: string;
  readonly question: string;
  readonly domain: string;
  readonly scope: SpecialistScope;
  readonly evidence: readonly Evidence[];
  readonly known_uncertainties?: readonly string[];
  readonly known_conflicts?: readonly string[];
  readonly known_gaps?: readonly string[];
  readonly generated_at: string;
  readonly max_evidence?: number;
}

const MAX_EVIDENCE = 32;
const MAX_EXCERPT = 900;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function reference(evidence: Evidence): SpecialistEvidenceReference {
  return {
    evidence_id: evidence.id,
    source_type: evidence.source_type,
    source_identity: evidence.source,
    title: evidence.title,
    excerpt: evidence.excerpt_or_summary.slice(0, MAX_EXCERPT),
    observed_at: evidence.publication_date,
    retrieved_at: evidence.retrieved_at,
    tier: evidence.tier,
    relevance: evidence.relevance,
    incident_claim: evidence.incident_claim,
  };
}

/** Build a bounded, detached evidence projection. The input graph is never retained. */
export function buildSpecialistEvidencePackage(context: SpecialistEvidenceContext): SpecialistEvidencePackage {
  const limit = Math.max(1, Math.min(MAX_EVIDENCE, context.max_evidence ?? MAX_EVIDENCE));
  const selected = [...context.evidence]
    .sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(reference);
  const source_identities = [...new Set(selected.map((item) => item.source_identity))].sort();
  const tier_counts: Record<string, number> = {};
  for (const item of selected) tier_counts[String(item.tier)] = (tier_counts[String(item.tier)] ?? 0) + 1;
  const packageValue: SpecialistEvidencePackage = {
    investigation_id: context.investigation_id,
    question: context.question,
    domain: context.domain,
    scope: {
      geo: [...context.scope.geo],
      mode: [...context.scope.mode],
      from: context.scope.from,
      to: context.scope.to,
    },
    evidence: selected,
    known_uncertainties: [...(context.known_uncertainties ?? [])],
    known_conflicts: [...(context.known_conflicts ?? [])],
    known_gaps: [...(context.known_gaps ?? [])],
    provenance_summary: {
      evidence_count: selected.length,
      source_count: source_identities.length,
      source_identities,
      tier_counts,
      all_items_have_provenance: selected.every((item) => item.source_identity.length > 0 && item.retrieved_at.length > 0),
    },
    generated_at: context.generated_at,
  };
  return deepFreeze(packageValue);
}

/** The graph is accepted only to make the projection call-site explicit; it is never stored or exposed. */
export function evidenceFromGraph(graph: RiskGraph): Evidence[] {
  return graph.byKind('evidence').map((item) => ({ ...item }));
}

/** Convenience integration seam for a completed SWARM run; the caller still supplies semantic domain/scope. */
export function buildSpecialistEvidencePackageFromRun(
  result: RunResult,
  context: Omit<SpecialistEvidenceContext, 'investigation_id' | 'question' | 'evidence' | 'known_uncertainties' | 'known_conflicts' | 'known_gaps'>,
): SpecialistEvidencePackage {
  const outputs = Object.values(result.outputs);
  const known_uncertainties = outputs.flatMap((output) => output.uncertainties ?? []);
  const known_conflicts = result.outputs.intelligence.category_disagreements > 0
    ? [`${result.outputs.intelligence.category_disagreements} deterministic category disagreement(s) were recorded.`]
    : [];
  const known_gaps = result.outputs.red_team.findings
    .filter((finding) => finding.finding_class === 'missing_evidence')
    .map((finding) => finding.argument);
  return buildSpecialistEvidencePackage({
    ...context,
    investigation_id: result.run_id,
    question: result.question,
    evidence: evidenceFromGraph(result.graph),
    known_uncertainties,
    known_conflicts,
    known_gaps,
  });
}
