/**
 * THE APPROVAL WORKFLOW: the only door between research and canonical knowledge.
 *
 * Decision #3 again: a `KnowledgeDelta` is a research observation, and research never writes
 * canonical. So the ledger cannot change a pack. This module can - once, deliberately, and only with
 * a named human attached. The shape of that is deliberate:
 *
 *   - `proposeTaxonomyChange` turns a delta into a concrete, reviewable request against a real field
 *     of a real pack (`category_rules`), rather than a vague suggestion a reviewer has to interpret.
 *   - `validateProposal` is deterministic and stated as failures a human can read. It is the same
 *     answer every time, so a reviewer is deciding on merit, not on whatever the checker felt today.
 *   - `approveProposal` refuses an invalid proposal and refuses an anonymous one. There is no code
 *     path that adds a canonical category without both a passing validation and an approver's name.
 *   - Approval returns a NEW pack. Nothing here mutates the pack it was given, so a rejected or
 *     un-reviewed proposal cannot leave a trace in canonical knowledge by accident.
 *
 * The first gate is the one worth defending: two distinct sources minimum. One source repeated is the
 * same claim twice, which `normalize.ts` already refuses to call corroboration, and a taxonomy is
 * exactly the wrong place to start believing repetition.
 */
import type { KnowledgePack } from '../packs/types';
import type { KnowledgeDelta } from './delta';

export type ProposalStatus = 'proposed' | 'approved' | 'rejected';

export interface TaxonomyProposal {
  id: string;
  delta_id: string;
  run_id: string;
  target_pack_id: string;
  /** The canonical field this proposal would change. One field, named, so review is concrete. */
  kind: 'category_rule';
  category: string;
  terms: string[];
  evidence_count: number;
  distinct_source_count: number;
  created_at: string;
  status: ProposalStatus;
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
}

export interface ValidationResult {
  ok: boolean;
  /** Readable failures, in a fixed order. Empty exactly when `ok`. */
  failures: string[];
}

/** Two independent sources, below which a taxonomy change is one source repeated. */
export const MIN_DISTINCT_SOURCES = 2;

export function proposeTaxonomyChange(delta: KnowledgeDelta, pack: KnowledgePack, now: string): TaxonomyProposal {
  return {
    id: `TP-${delta.id}`,
    delta_id: delta.id,
    run_id: delta.run_id,
    target_pack_id: pack.id,
    kind: 'category_rule',
    category: delta.domain,
    terms: [...delta.keywords],
    evidence_count: delta.evidence_count,
    distinct_source_count: delta.distinct_source_count,
    created_at: now,
    status: 'proposed',
    decided_by: null,
    decided_at: null,
    note: null,
  };
}

const normalise = (s: string) => s.trim().toLowerCase();

export function validateProposal(proposal: TaxonomyProposal, pack: KnowledgePack): ValidationResult {
  const failures: string[] = [];

  if (proposal.target_pack_id !== pack.id) {
    failures.push(`The proposal targets pack "${proposal.target_pack_id}" but was validated against "${pack.id}".`);
  }
  if (proposal.status !== 'proposed') {
    failures.push(`This proposal was already ${proposal.status}, and a decision is not revisited by re-validating it.`);
  }
  if (normalise(proposal.category).length < 3) {
    failures.push('The category name is too short to mean anything in a taxonomy.');
  }
  if (proposal.terms.length === 0) {
    failures.push('A category with no terms can never match anything, so it would add nothing but a name.');
  }
  if (proposal.distinct_source_count < MIN_DISTINCT_SOURCES) {
    failures.push(
      `Only ${proposal.distinct_source_count} distinct source(s) support this, below the minimum of ${MIN_DISTINCT_SOURCES}: one source repeated is not corroboration.`,
    );
  }

  const existing = new Map(pack.category_rules.map(([category, terms]) => [normalise(category), { category, terms }]));
  if (existing.has(normalise(proposal.category))) {
    failures.push(`Pack "${pack.id}" already has a category "${proposal.category}", so this would overwrite pinned knowledge rather than extend it.`);
  }
  for (const [category, terms] of pack.category_rules) {
    for (const term of terms) {
      if (proposal.terms.some((t) => normalise(t) === normalise(term))) {
        failures.push(`The term "${term}" already belongs to category "${category}", so this proposal would make a signal match two categories.`);
      }
    }
  }

  return { ok: failures.length === 0, failures };
}

export interface Decision {
  by: string;
  now: string;
  note: string;
}

export class ApprovalRefused extends Error {
  constructor(readonly reasons: string[]) {
    super(`Approval refused: ${reasons.join(' ')}`);
    this.name = 'ApprovalRefused';
  }
}

export interface ApprovalResult {
  proposal: TaxonomyProposal;
  /** A new pack. The pack passed in is never modified. */
  pack: KnowledgePack;
}

/**
 * The only way a research observation reaches canonical taxonomy. Throws rather than returning a
 * partial result: a caller that ignored a validation failure would be exactly the silent path this
 * module exists to prevent.
 */
export function approveProposal(proposal: TaxonomyProposal, pack: KnowledgePack, decision: Decision): ApprovalResult {
  const reasons: string[] = [];
  if (decision.by.trim().length === 0) reasons.push('No approver was named, and canonical knowledge is not changed anonymously.');
  const validation = validateProposal(proposal, pack);
  reasons.push(...validation.failures);
  if (reasons.length > 0) throw new ApprovalRefused(reasons);

  return {
    proposal: { ...proposal, status: 'approved', decided_by: decision.by, decided_at: decision.now, note: decision.note },
    pack: { ...pack, category_rules: [...pack.category_rules, [proposal.category, [...proposal.terms]] as [string, string[]]] },
  };
}

/** Rejection needs a reason. An unexplained rejection teaches the next reviewer nothing. */
export function rejectProposal(proposal: TaxonomyProposal, decision: Decision): TaxonomyProposal {
  const reasons: string[] = [];
  if (decision.by.trim().length === 0) reasons.push('No reviewer was named.');
  if (decision.note.trim().length === 0) reasons.push('A rejection must say why.');
  if (proposal.status !== 'proposed') reasons.push(`This proposal was already ${proposal.status}.`);
  if (reasons.length > 0) throw new ApprovalRefused(reasons);
  return { ...proposal, status: 'rejected', decided_by: decision.by, decided_at: decision.now, note: decision.note };
}
