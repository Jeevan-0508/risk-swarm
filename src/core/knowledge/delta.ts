/**
 * THE RESEARCH LEDGER.
 *
 * Decision #3: canonical taxonomy stays pinned, hashed, human-approved (a knowledge pack's
 * `taxonomy_snapshot`). Research taxonomy is different - derived per question from what a run's
 * research plan actually retrieved - and it can never write canonical directly. This module is the
 * one place a research observation becomes a `KnowledgeDelta`: a proposal, not a fact, and not a
 * graph node. It never mutates a pack, never asserts a category exists just because a question asked
 * about it, and every delta it builds defaults to `status: 'proposed'` - only the approval workflow
 * (a later phase) may move one to `'approved'` or `'rejected'`.
 *
 * A delta is deliberately not part of the `RiskGraph`. It is meta-knowledge about the taxonomy
 * itself, not evidence or a hypothesis about an incident, so it carries no citation obligations
 * SENTINEL would need to police - the evidence ids it lists are a pointer into the run's own evidence,
 * checkable by anyone, not a claim requiring graph-integrity enforcement of its own.
 */
import type { QuestionModel } from '../question/model';
import type { ResearchPlan } from '../research/plan';
import type { NormalizedEvidence } from '../research/normalize';
import { contentHash } from '../sources/hash';

export type KnowledgeDeltaStatus = 'proposed' | 'approved' | 'rejected';

export interface KnowledgeDelta {
  id: string;
  run_id: string;
  question: string;
  domain: string;
  subdomains: string[];
  /** The words that drove the classification, so a reviewer can see why without re-running anything. */
  keywords: string[];
  status: KnowledgeDeltaStatus;
  /** Pointers into this run's own evidence. Empty is reported, not hidden - see `rationale`. */
  evidence_ids: string[];
  evidence_count: number;
  distinct_source_count: number;
  proposed_at: string;
  rationale: string;
}

export interface ProposeDeltaOptions {
  run_id: string;
  now: string;
}

/**
 * Builds at most one proposal per run. Returns `null` when the plan itself never expected a
 * knowledge update - a timeless question, or one external research could not reach - because a
 * delta proposed anyway would be a taxonomy claim manufactured from nothing.
 */
export async function proposeDelta(
  question: QuestionModel,
  plan: ResearchPlan,
  evidence: NormalizedEvidence[],
  options: ProposeDeltaOptions,
): Promise<KnowledgeDelta | null> {
  if (!plan.knowledge_update_expected) return null;

  const external = evidence.filter((e) => e.provenance.origin === 'external');
  const distinctSources = new Set(external.map((e) => e.provenance.source_identity));

  const id = `KD-${await contentHash(`${options.run_id}:${question.domain}:${question.subdomains.join(',')}`)}`;
  const scope = question.subdomains.length > 0 ? `${question.domain} / ${question.subdomains.join(', ')}` : question.domain;
  const rationale =
    external.length > 0
      ? `${external.length} external item(s) across ${distinctSources.size} source(s) support classifying this question under "${scope}".`
      : `The plan expected a knowledge update for "${scope}" but no external evidence was normalized, so this proposal rests on the question alone.`;

  return {
    id,
    run_id: options.run_id,
    question: question.query,
    domain: question.domain,
    subdomains: question.subdomains,
    keywords: question.keywords,
    status: 'proposed',
    evidence_ids: external.map((e) => e.evidence.id),
    evidence_count: external.length,
    distinct_source_count: distinctSources.size,
    proposed_at: options.now,
    rationale,
  };
}

export interface ResearchLedger {
  entries: KnowledgeDelta[];
}

export function emptyLedger(): ResearchLedger {
  return { entries: [] };
}

/** Append-only, and a no-op on `null` - the honest result of a run that expected no update. */
export function appendDelta(ledger: ResearchLedger, delta: KnowledgeDelta | null): ResearchLedger {
  if (delta === null) return ledger;
  return { entries: [...ledger.entries, delta] };
}

export function deltasForDomain(ledger: ResearchLedger, domain: string): KnowledgeDelta[] {
  return ledger.entries.filter((d) => d.domain === domain);
}

export function pendingDeltas(ledger: ResearchLedger): KnowledgeDelta[] {
  return ledger.entries.filter((d) => d.status === 'proposed');
}
