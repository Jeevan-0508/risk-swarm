import { z } from 'zod';

export const SPECIALIST_ACTIONS = [
  'ASSESS',
  'IDENTIFY_RISK',
  'IDENTIFY_CONTROL_GAPS',
  'FORM_HYPOTHESES',
  'CHALLENGE_ASSUMPTIONS',
  'REQUEST_EVIDENCE',
  'RECOMMEND_CONTROLS',
  'RECOMMEND_MONITORING',
  'RECOMMEND_ESCALATION',
  'ABSTAIN',
] as const;
export const SpecialistAction = z.enum(SPECIALIST_ACTIONS);
export type SpecialistAction = z.infer<typeof SpecialistAction>;

export const SPECIALIST_PROHIBITIONS = [
  'CREATE_EVIDENCE',
  'MODIFY_EVIDENCE',
  'DELETE_EVIDENCE',
  'CHANGE_EVIDENCE_TIER',
  'CLAIM_UNSUPPORTED_FACTS',
  'DECLARE_LEGAL_COMPLIANCE',
  'DECLARE_REGULATORY_CERTAINTY',
  'APPROVE_FINAL_DECISION',
  'REJECT_FINAL_DECISION',
  'OVERRIDE_RED_TEAM',
  'OVERRIDE_SENTINEL',
  'OVERRIDE_PUBLICATION_GATE',
  'SUPPRESS_DISAGREEMENT',
  'HIDE_UNCERTAINTY',
  'INVENT_CITATIONS',
] as const;
export const SpecialistProhibition = z.enum(SPECIALIST_PROHIBITIONS);
export type SpecialistProhibition = z.infer<typeof SpecialistProhibition>;

export interface SpecialistAuthority {
  readonly allowed_actions: readonly SpecialistAction[];
  readonly prohibited_actions: readonly SpecialistProhibition[];
  /** Advisory only: the specialist cannot approve, reject, or publish a decision. */
  readonly decision_authority: 'ADVISORY_ONLY';
}

export interface SpecialistEvidencePolicy {
  readonly receives_projection: true;
  readonly may_create_evidence: false;
  readonly may_modify_evidence: false;
  readonly may_change_evidence_tier: false;
  readonly citations_must_resolve: true;
}

export interface SpecialistAbstentionPolicy {
  readonly allowed: true;
  readonly distinct_from_unavailable: true;
  readonly minimum_evidence: 'NO_HARD_MINIMUM';
  readonly reasons: readonly string[];
}

/** Reusable metadata and authority boundary for every future specialist. */
export interface SpecialistContract<TModelOutput> {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly mandate: string;
  readonly allowed_actions: readonly SpecialistAction[];
  readonly prohibited_actions: readonly SpecialistProhibition[];
  readonly required_inputs: readonly string[];
  readonly optional_inputs: readonly string[];
  readonly output_schema: z.ZodType<TModelOutput>;
  readonly authority: SpecialistAuthority;
  readonly evidence_policy: SpecialistEvidencePolicy;
  readonly abstention_policy: SpecialistAbstentionPolicy;
}

export function assertSpecialistContract<TModelOutput>(contract: SpecialistContract<TModelOutput>): void {
  if (contract.id.trim().length === 0 || contract.version.trim().length === 0 || contract.name.trim().length === 0) {
    throw new Error('INVALID_SPECIALIST_CONTRACT: identity is incomplete');
  }
  if (contract.authority.decision_authority !== 'ADVISORY_ONLY') {
    throw new Error('INVALID_SPECIALIST_CONTRACT: specialist authority must be advisory only');
  }
  if (contract.evidence_policy.receives_projection !== true || contract.evidence_policy.may_create_evidence !== false || contract.evidence_policy.may_modify_evidence !== false || contract.evidence_policy.may_change_evidence_tier !== false) {
    throw new Error('INVALID_SPECIALIST_CONTRACT: evidence policy is not fail-closed');
  }
}
