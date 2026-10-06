import { z } from 'zod';

export const SWARM_PROTOCOL_VERSION = '2.0.0-alpha.1' as const;
export type SwarmProtocolVersion = typeof SWARM_PROTOCOL_VERSION;

const id = <Name extends string>() => z.string().min(1).max(160).brand<Name>();

export const SwarmCaseIdSchema = id<'SwarmCaseId'>();
export const EvidenceIdSchema = id<'EvidenceId'>();
export const EvidencePackageIdSchema = id<'EvidencePackageId'>();
export const PositionIdSchema = id<'PositionId'>();
export const ClaimIdSchema = id<'ClaimId'>();
export const RiskFindingIdSchema = id<'RiskFindingId'>();
export const ControlGapIdSchema = id<'ControlGapId'>();
export const EvidenceRequestIdSchema = id<'EvidenceRequestId'>();
export const DisagreementIdSchema = id<'DisagreementId'>();
export const ChallengeIdSchema = id<'ChallengeId'>();
export const ChallengeResponseIdSchema = id<'ChallengeResponseId'>();
export const RevisionIdSchema = id<'RevisionId'>();
export const AuditFindingIdSchema = id<'AuditFindingId'>();
export const SynthesisIdSchema = id<'SynthesisId'>();
export const HumanDecisionIdSchema = id<'HumanDecisionId'>();
export const ExecutionEventIdSchema = id<'ExecutionEventId'>();

export type SwarmCaseId = z.infer<typeof SwarmCaseIdSchema>;
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;
export type EvidencePackageId = z.infer<typeof EvidencePackageIdSchema>;
export type PositionId = z.infer<typeof PositionIdSchema>;
export type ClaimId = z.infer<typeof ClaimIdSchema>;
export type RiskFindingId = z.infer<typeof RiskFindingIdSchema>;
export type ControlGapId = z.infer<typeof ControlGapIdSchema>;
export type EvidenceRequestId = z.infer<typeof EvidenceRequestIdSchema>;
export type DisagreementId = z.infer<typeof DisagreementIdSchema>;
export type ChallengeId = z.infer<typeof ChallengeIdSchema>;
export type ChallengeResponseId = z.infer<typeof ChallengeResponseIdSchema>;
export type RevisionId = z.infer<typeof RevisionIdSchema>;
export type AuditFindingId = z.infer<typeof AuditFindingIdSchema>;
export type SynthesisId = z.infer<typeof SynthesisIdSchema>;
export type HumanDecisionId = z.infer<typeof HumanDecisionIdSchema>;
export type ExecutionEventId = z.infer<typeof ExecutionEventIdSchema>;

export const SEAT_IDS = ['ATHENA', 'ARES', 'HADES', 'APOLLO', 'ZEUS'] as const;
export const ROUND1_SEAT_IDS = ['ATHENA', 'ARES', 'HADES', 'APOLLO'] as const;
export type SeatId = (typeof SEAT_IDS)[number];
export type Round1SeatId = (typeof ROUND1_SEAT_IDS)[number];
export const SeatIdSchema = z.enum(SEAT_IDS);
export const Round1SeatIdSchema = z.enum(ROUND1_SEAT_IDS);

export const SeatAuthoritySchema = z.enum(['ADVISORY', 'AUDIT', 'SYNTHESIS', 'HUMAN_DECISION']);
export type SeatAuthority = z.infer<typeof SeatAuthoritySchema>;

export interface SeatContract {
  readonly seat_id: SeatId;
  readonly mandate: string;
  readonly authority: SeatAuthority;
}

export const SeatContractSchema = z.object({
  seat_id: SeatIdSchema,
  mandate: z.string().min(1).max(500),
  authority: SeatAuthoritySchema,
}).superRefine((value, ctx) => {
  if (value.authority === 'HUMAN_DECISION') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'seat cannot hold human decision authority' });
  if (value.seat_id === 'APOLLO' && value.authority !== 'AUDIT') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Apollo authority is AUDIT' });
  if (value.seat_id === 'ZEUS' && value.authority !== 'SYNTHESIS') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Zeus authority is SYNTHESIS' });
  if (value.seat_id !== 'APOLLO' && value.seat_id !== 'ZEUS' && value.authority !== 'ADVISORY') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'risk seats are ADVISORY' });
});

export const SEAT_CONTRACTS: Readonly<Record<SeatId, SeatContract>> = {
  ATHENA: { seat_id: 'ATHENA', mandate: 'Risk Analyst: what is actually happening?', authority: 'ADVISORY' },
  ARES: { seat_id: 'ARES', mandate: 'Challenger / Red Team: what could everyone else be wrong about?', authority: 'ADVISORY' },
  HADES: { seat_id: 'HADES', mandate: 'Risk & Controls Manager: if this fails, what happens and what prevents it?', authority: 'ADVISORY' },
  APOLLO: { seat_id: 'APOLLO', mandate: 'Evidence & Governance Auditor: can the Council prove what it claims?', authority: 'AUDIT' },
  ZEUS: { seat_id: 'ZEUS', mandate: 'Risk Lead / Synthesizer: what does the human decision-maker need to know?', authority: 'SYNTHESIS' },
};

export const PROTOCOL_STATES = [
  'CASE_CREATED',
  'EVIDENCE_READY',
  'INDEPENDENT_ANALYSIS',
  'POSITIONS_LOCKED',
  'DISAGREEMENTS_IDENTIFIED',
  'CHALLENGE_ROUND',
  'REVISIONS_LOCKED',
  'AUDIT',
  'SYNTHESIS',
  'HUMAN_REVIEW',
  'CLOSED',
] as const;
export type ProtocolState = (typeof PROTOCOL_STATES)[number];
export const ProtocolStateSchema = z.enum(PROTOCOL_STATES);

export const EXECUTION_STATUSES = ['NOT_STARTED', 'RUNNING', 'SUCCESS', 'ABSTAINED', 'UNAVAILABLE', 'FAILED', 'REJECTED'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export const ExecutionStatusSchema = z.enum(EXECUTION_STATUSES);
export const TERMINAL_EXECUTION_STATUSES = ['SUCCESS', 'ABSTAINED', 'UNAVAILABLE', 'FAILED', 'REJECTED'] as const;
export type TerminalExecutionStatus = (typeof TERMINAL_EXECUTION_STATUSES)[number];
export const TerminalExecutionStatusSchema = z.enum(TERMINAL_EXECUTION_STATUSES);

const boundedText = (max: number) => z.string().max(max);
const boundedNonEmpty = (max: number) => z.string().min(1).max(max);
const boundedInt = (max: number) => z.number().int().finite().min(0).max(max);
const boundedPositiveInt = (max: number) => z.number().int().finite().min(1).max(max);
const timestamp = z.string().min(1).max(100);

export const SwarmPolicySchema = z.object({
  max_challenge_rounds: boundedInt(8),
  max_challenges: boundedInt(200),
  max_revisions: boundedInt(200),
  max_provider_calls: boundedInt(500),
  max_evidence_items: boundedPositiveInt(200),
  allow_provider_fallback: z.boolean(),
  allow_evidence_reseal: z.literal(false),
  require_human_review: z.literal(true),
});
export type SwarmPolicy = z.infer<typeof SwarmPolicySchema>;

export const DEFAULT_SWARM_POLICY: SwarmPolicy = {
  max_challenge_rounds: 1,
  max_challenges: 24,
  max_revisions: 24,
  max_provider_calls: 20,
  max_evidence_items: 64,
  allow_provider_fallback: false,
  allow_evidence_reseal: false,
  require_human_review: true,
};

export const SwarmScopeSchema = z.object({
  geo: z.array(boundedNonEmpty(40)).max(32),
  mode: z.array(boundedNonEmpty(80)).max(32),
  from: timestamp,
  to: timestamp,
});
export type SwarmScope = z.infer<typeof SwarmScopeSchema>;

export const SwarmCaseSchema = z.object({
  case_id: SwarmCaseIdSchema,
  protocol_version: z.literal(SWARM_PROTOCOL_VERSION),
  question: boundedNonEmpty(4000),
  scope: SwarmScopeSchema,
  created_at: timestamp,
  created_by: boundedNonEmpty(160),
  policy: SwarmPolicySchema,
  status: z.literal('CASE_CREATED'),
});
export type SwarmCase = z.infer<typeof SwarmCaseSchema>;

export const EvidenceItemSchema = z.object({
  evidence_id: EvidenceIdSchema,
  source_type: boundedNonEmpty(80),
  source_identity: boundedNonEmpty(300),
  url: boundedText(2000),
  title: boundedNonEmpty(500),
  observed_at: timestamp.nullable(),
  retrieved_at: timestamp,
  claim: boundedNonEmpty(2000),
  excerpt: boundedText(1200),
  tier: z.number().int().min(1).max(5),
  relevance: z.number().finite().min(0).max(1),
  reliability: z.number().finite().min(0).max(1),
  integrity_hash: boundedNonEmpty(200),
  incident_claim: z.boolean(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

const uniqueIds = (values: readonly string[]) => new Set(values).size === values.length;

export const EvidencePackageSchema = z.object({
  package_id: EvidencePackageIdSchema,
  case_id: SwarmCaseIdSchema,
  protocol_version: z.literal(SWARM_PROTOCOL_VERSION),
  items: z.array(EvidenceItemSchema).max(200),
  known_gaps: z.array(boundedText(500)).max(100),
  known_conflicts: z.array(boundedText(500)).max(100),
  package_hash: boundedNonEmpty(200),
  sealed_at: timestamp,
}).superRefine((value, ctx) => {
  if (!uniqueIds(value.items.map((item) => item.evidence_id))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duplicate evidence id' });
  for (let i = 1; i < value.items.length; i += 1) {
    if (value.items[i - 1]!.evidence_id.localeCompare(value.items[i]!.evidence_id) > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'evidence items must be deterministically ordered' });
      break;
    }
  }
});
export type EvidencePackage = z.infer<typeof EvidencePackageSchema>;

export const ClaimTypeSchema = z.enum(['OBSERVATION', 'INFERENCE', 'PREDICTION', 'RECOMMENDATION']);
export type ClaimType = z.infer<typeof ClaimTypeSchema>;
export const ClaimStatusSchema = z.enum(['SUPPORTED', 'UNCERTAIN', 'CHALLENGED', 'WITHDRAWN']);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ClaimSchema = z.object({
  claim_id: ClaimIdSchema,
  position_id: PositionIdSchema,
  statement: boundedNonEmpty(2000),
  type: ClaimTypeSchema,
  evidence_ids: z.array(EvidenceIdSchema).max(64),
  assumptions: z.array(boundedText(500)).max(32),
  uncertainty: boundedNonEmpty(1000),
  status: ClaimStatusSchema,
});
export type Claim = z.infer<typeof ClaimSchema>;

const subjectFields = {
  case_id: SwarmCaseIdSchema,
  position_id: PositionIdSchema,
  statement: boundedNonEmpty(1600),
  evidence_ids: z.array(EvidenceIdSchema).max(64),
  assumptions: z.array(boundedText(500)).max(32),
  uncertainty: boundedNonEmpty(1000),
};

export const RiskFindingSchema = z.object({
  finding_id: RiskFindingIdSchema,
  ...subjectFields,
  risk_level: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNDETERMINED']),
});
export type RiskFinding = z.infer<typeof RiskFindingSchema>;

export const ControlGapSchema = z.object({
  gap_id: ControlGapIdSchema,
  ...subjectFields,
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
});
export type ControlGap = z.infer<typeof ControlGapSchema>;

export const EvidenceRequestSchema = z.object({
  request_id: EvidenceRequestIdSchema,
  case_id: SwarmCaseIdSchema,
  position_id: PositionIdSchema,
  request: boundedNonEmpty(1200),
  reason: boundedNonEmpty(1200),
  evidence_ids: z.array(EvidenceIdSchema).max(64),
  status: z.enum(['OPEN', 'FULFILLED', 'UNRESOLVED']),
});
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;

export const ModelExecutionSchema = z.object({
  requested_provider: boundedText(120).nullable(),
  requested_model: boundedText(200).nullable(),
  executed_provider: boundedText(120).nullable(),
  executed_model: boundedText(200).nullable(),
  request_id: boundedText(160).nullable(),
  started_at: timestamp,
  ended_at: timestamp,
  duration_ms: z.number().finite().min(0).max(86_400_000),
  status: ExecutionStatusSchema,
  model_called: z.boolean(),
  independent: z.boolean(),
  fallback_used: z.boolean(),
  fallback_reason: boundedText(500).nullable(),
  failure_stage: boundedText(80).nullable(),
  failure_reason_code: boundedText(120).nullable(),
  diagnostics: z.record(z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()])).optional(),
}).superRefine((value, ctx) => {
  if (value.status === 'SUCCESS' && (!value.model_called || !value.independent)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'successful execution must be called and independent' });
  }
  if (value.status === 'SUCCESS' && value.fallback_used) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fallback cannot be successful independent execution' });
  if (value.fallback_used && !value.fallback_reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fallback reason required' });
  if (!value.fallback_used && value.fallback_reason !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fallback reason without fallback' });
  for (const key of Object.keys(value.diagnostics ?? {})) {
    if (/(key|secret|authorization|bearer|credential|prompt|response|raw|chain.?of.?thought)/i.test(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'diagnostics contain a prohibited sensitive field' });
    }
  }
});
export type ModelExecution = z.infer<typeof ModelExecutionSchema>;

export const PositionStatusSchema = z.enum(['PROPOSED', 'LOCKED', 'REVISED']);
export const ZEUS_RISK_LEVEL_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNDETERMINED'] as const;
export const RiskLevelSchema = z.enum(ZEUS_RISK_LEVEL_VALUES);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const AgentPositionSchema = z.object({
  position_id: PositionIdSchema,
  case_id: SwarmCaseIdSchema,
  seat_id: Round1SeatIdSchema,
  round: z.number().int().min(1).max(8),
  status: PositionStatusSchema,
  conclusion: boundedText(4000),
  risk_level: RiskLevelSchema,
  confidence: z.number().finite().min(0).max(1).nullable(),
  claims: z.array(ClaimSchema).max(100),
  evidence_ids: z.array(EvidenceIdSchema).max(100),
  assumptions: z.array(boundedText(500)).max(64),
  uncertainties: z.array(boundedText(1000)).max(64),
  risk_findings: z.array(RiskFindingSchema).max(64),
  control_gaps: z.array(ControlGapSchema).max(64),
  counterarguments: z.array(boundedText(1000)).max(64),
  position_references: z.array(PositionIdSchema).max(64),
  evidence_requests: z.array(EvidenceRequestSchema).max(64),
  recommendation: boundedText(1600).nullable(),
  abstained: z.boolean(),
  abstention_reason: boundedText(1000).nullable(),
  execution: ModelExecutionSchema,
  created_at: timestamp,
}).superRefine((value, ctx) => {
  if (value.abstained && !value.abstention_reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'abstention reason required' });
  if (!value.abstained && value.conclusion.trim().length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'conclusion required' });
  for (const claim of value.claims) if (claim.position_id !== value.position_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'claim belongs to another position' });
  for (const finding of value.risk_findings) if (finding.position_id !== value.position_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'risk finding belongs to another position' });
  for (const gap of value.control_gaps) if (gap.position_id !== value.position_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'control gap belongs to another position' });
  for (const request of value.evidence_requests) if (request.position_id !== value.position_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'evidence request belongs to another position' });
});
export type AgentPosition = z.infer<typeof AgentPositionSchema>;

export const DisagreementTypeSchema = z.enum(['RISK_RATING', 'CAUSAL', 'EVIDENCE_INTERPRETATION', 'CONTROL_EFFECTIVENESS', 'SCOPE', 'ASSUMPTION', 'CONFIDENCE', 'RECOMMENDATION']);
export const DisagreementSchema = z.object({
  disagreement_id: DisagreementIdSchema,
  case_id: SwarmCaseIdSchema,
  type: DisagreementTypeSchema,
  subject_ids: z.array(z.union([PositionIdSchema, ClaimIdSchema])).min(1).max(32),
  positions_by_seat: z.record(Round1SeatIdSchema, PositionIdSchema),
  materiality: z.enum(['MINOR', 'MATERIAL', 'BLOCKING']),
  basis: boundedNonEmpty(1600),
  evidence_ids: z.array(EvidenceIdSchema).max(64),
  unresolved: z.boolean(),
  status: z.enum(['OPEN', 'NARROWED', 'RESOLVED']),
});
export type Disagreement = z.infer<typeof DisagreementSchema>;

export const ChallengeTypeSchema = z.enum(['ASSUMPTION', 'EVIDENCE', 'CAUSAL', 'SEVERITY', 'CONTROL', 'AUTHORITY', 'SCOPE', 'CONFIDENCE', 'RECOMMENDATION']);
export const ChallengeTargetTypeSchema = z.enum(['POSITION', 'CLAIM', 'DISAGREEMENT']);
export const ChallengeRequestedActionSchema = z.enum(['DEFEND', 'REVISE', 'CONCEDE', 'REQUEST_EVIDENCE', 'ABSTAIN']);
export const ChallengeSchema = z.object({
  challenge_id: ChallengeIdSchema,
  case_id: SwarmCaseIdSchema,
  round: z.number().int().min(1).max(8),
  from_seat: Round1SeatIdSchema,
  to_seat: Round1SeatIdSchema,
  target_position: PositionIdSchema,
  target_claim: ClaimIdSchema.nullable(),
  challenge_type: ChallengeTypeSchema,
  reasoning: boundedNonEmpty(2000),
  evidence_ids: z.array(EvidenceIdSchema).max(64),
  disagreement_id: DisagreementIdSchema.optional(),
  target_type: ChallengeTargetTypeSchema.optional(),
  challenge_text: boundedNonEmpty(2000).optional(),
  requested_action: ChallengeRequestedActionSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.from_seat === value.to_seat) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'seat cannot challenge itself' });
});
export type Challenge = z.infer<typeof ChallengeSchema>;

export const ChallengeResponseSchema = z.object({
  response_id: ChallengeResponseIdSchema,
  case_id: SwarmCaseIdSchema,
  challenge_id: ChallengeIdSchema,
  responding_seat: Round1SeatIdSchema,
  action: z.enum(['DEFEND', 'REVISE', 'CONCEDE', 'REQUEST_EVIDENCE', 'ABSTAIN']),
  rationale: boundedNonEmpty(2000),
  evidence_ids: z.array(EvidenceIdSchema).max(64),
  revision_id: RevisionIdSchema.nullable(),
  round: z.number().int().min(1).max(8).optional(),
  source_position: PositionIdSchema.optional(),
  revision_lineage: z.array(PositionIdSchema).max(16).optional(),
}).superRefine((value, ctx) => {
  if ((value.action === 'REVISE' || value.action === 'CONCEDE') && !value.revision_id) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'revision id required for revise or concede response' });
  if (value.action !== 'REVISE' && value.action !== 'CONCEDE' && value.revision_id !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'revision id only valid for revise or concede response' });
});
export type ChallengeResponse = z.infer<typeof ChallengeResponseSchema>;

/**
 * Phase 5 adds a strict envelope around the older protocol-compatible
 * challenge fields.  The base schemas remain backward compatible with the
 * Phase 2/4 replay fixtures; Phase 5 events must pass these stricter forms.
 */
export const Phase5ChallengeSchema = ChallengeSchema.and(z.object({
  disagreement_id: DisagreementIdSchema,
  target_type: ChallengeTargetTypeSchema,
  challenge_text: boundedNonEmpty(2000),
  requested_action: ChallengeRequestedActionSchema,
}));
export type Phase5Challenge = z.infer<typeof Phase5ChallengeSchema>;

export const Phase5ChallengeResponseSchema = ChallengeResponseSchema.and(z.object({
  round: z.number().int().min(1).max(8),
  source_position: PositionIdSchema,
  revision_lineage: z.array(PositionIdSchema).max(16),
}));
export type Phase5ChallengeResponse = z.infer<typeof Phase5ChallengeResponseSchema>;

export const RevisionSchema = z.object({
  revision_id: RevisionIdSchema,
  case_id: SwarmCaseIdSchema,
  old_position_id: PositionIdSchema,
  new_position_id: PositionIdSchema,
  triggering_challenge_id: ChallengeIdSchema,
  triggering_response_id: ChallengeResponseIdSchema,
  changed_claim_ids: z.array(ClaimIdSchema).max(100),
  retained_claim_ids: z.array(ClaimIdSchema).max(100),
  reason: boundedNonEmpty(2000),
});
export type Revision = z.infer<typeof RevisionSchema>;

export const AuditFindingSchema = z.object({
  finding_id: AuditFindingIdSchema,
  case_id: SwarmCaseIdSchema,
  check_id: boundedNonEmpty(160),
  source: z.enum(['DETERMINISTIC', 'MODEL']),
  status: z.enum(['VERIFIED', 'WARNING', 'BLOCKED', 'UNOBSERVABLE']),
  subject_ids: z.array(z.string().min(1).max(160)).max(64),
  evidence_ids: z.array(EvidenceIdSchema).max(64),
  detail: boundedNonEmpty(2000),
  remediation: boundedText(1200).nullable(),
});
export type AuditFinding = z.infer<typeof AuditFindingSchema>;

export const ParticipationEntrySchema = z.object({
  seat_id: Round1SeatIdSchema,
  status: ExecutionStatusSchema,
  position_id: PositionIdSchema.nullable(),
  participated: z.boolean(),
  reason: boundedNonEmpty(500),
});
export type ParticipationEntry = z.infer<typeof ParticipationEntrySchema>;

export const SynthesisBriefSchema = z.object({
  synthesis_id: SynthesisIdSchema,
  case_id: SwarmCaseIdSchema,
  risk_summary: boundedNonEmpty(3000),
  risk_level: RiskLevelSchema,
  majority_position: PositionIdSchema.nullable(),
  minority_positions: z.array(PositionIdSchema).max(32),
  unresolved_disagreements: z.array(DisagreementIdSchema).max(64),
  strongest_evidence: z.array(EvidenceIdSchema).max(64),
  weakest_assumptions: z.array(boundedNonEmpty(1000)).max(64),
  evidence_gaps: z.array(boundedNonEmpty(1000)).max(64),
  control_gaps: z.array(ControlGapIdSchema).max(64),
  recommended_controls: z.array(boundedNonEmpty(1200)).max(64),
  uncertainty: boundedNonEmpty(1600),
  participation_summary: z.array(ParticipationEntrySchema),
  audit_findings: z.array(AuditFindingIdSchema).max(64),
  human_action_required: boundedNonEmpty(1600),
  human_decision_status: z.literal('PENDING'),
}).superRefine((value, ctx) => {
  const text = JSON.stringify(value);
  if (/APPROVED_BY_ZEUS|REJECTED_BY_ZEUS|final\s+decision\s+by\s+zeus/i.test(text)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'synthesis cannot assign human authority to Zeus' });
});
export type SynthesisBrief = z.infer<typeof SynthesisBriefSchema>;

/** Phase 6 Zeus contracts. These are deliberately separate from the compact
 * Phase 2 synthesis brief so historical fixtures remain replay-compatible. */
/** Closed Zeus control-effectiveness vocabulary. Keep this as the single
 * source of truth for both the provider JSON Schema and the canonical DTO. */
export const ZEUS_CONTROL_EFFECTIVENESS_VALUES = ['EFFECTIVE', 'PARTIAL', 'UNVERIFIED', 'INEFFECTIVE', 'NOT_APPLICABLE'] as const;
export type ZeusControlEffectiveness = (typeof ZEUS_CONTROL_EFFECTIVENESS_VALUES)[number];

export const ZeusControlEffectivenessSchema = z.enum(ZEUS_CONTROL_EFFECTIVENESS_VALUES);
export const ZEUS_EVIDENCE_QUALITY_VALUES = ['STRONG', 'MIXED', 'WEAK', 'INSUFFICIENT'] as const;
export const ZeusEvidenceQualitySchema = z.enum(ZEUS_EVIDENCE_QUALITY_VALUES);
export const ZEUS_DISAGREEMENT_REFERENCE_STATUS_VALUES = ['OPEN', 'NARROWED'] as const;
export const ZeusDisagreementReferenceStatusSchema = z.enum(ZEUS_DISAGREEMENT_REFERENCE_STATUS_VALUES);
export const ZEUS_DISAGREEMENT_REFERENCE_MATERIALITY_VALUES = ['MATERIAL', 'BLOCKING'] as const;
export const ZeusDisagreementReferenceMaterialitySchema = z.enum(ZEUS_DISAGREEMENT_REFERENCE_MATERIALITY_VALUES);
export const ZEUS_HUMAN_DECISION_STATUS_VALUES = ['PENDING'] as const;

/** Exact machine-verifiable authority boundary shared by DTO, provider schema,
 * prompt, semantic validation, and artifact verification. */
export const ZEUS_AUTHORITY_CONTRACT = {
  mode: 'ADVISORY_SYNTHESIS_ONLY',
  final_decision_authority: 'HUMAN',
  human_decision_required: true,
  may_approve_deployment: false,
  may_reject_deployment: false,
  may_declare_compliance: false,
} as const;
export const ZeusAuthorityStatementSchema = z.object({
  mode: z.literal(ZEUS_AUTHORITY_CONTRACT.mode),
  final_decision_authority: z.literal(ZEUS_AUTHORITY_CONTRACT.final_decision_authority),
  human_decision_required: z.literal(true),
  may_approve_deployment: z.literal(false),
  may_reject_deployment: z.literal(false),
  may_declare_compliance: z.literal(false),
}).strict();
export type ZeusAuthorityStatement = z.infer<typeof ZeusAuthorityStatementSchema>;

export const ZeusEvidenceMetadataSchema = z.object({
  evidence_id: EvidenceIdSchema,
  source_type: boundedNonEmpty(80),
  source_identity: boundedNonEmpty(300),
  title: boundedNonEmpty(500),
  tier: z.number().int().min(1).max(5),
  relevance: z.number().finite().min(0).max(1),
  reliability: z.number().finite().min(0).max(1),
  integrity_hash: boundedNonEmpty(200),
});
export type ZeusEvidenceMetadata = z.infer<typeof ZeusEvidenceMetadataSchema>;

export const ZeusMinorityPositionSchema = z.object({
  seat_ids: z.array(Round1SeatIdSchema).min(1).max(4),
  position_summary: boundedNonEmpty(2000),
  evidence_ids: z.array(EvidenceIdSchema).max(64),
  disagreement_ids: z.array(DisagreementIdSchema).max(64),
  why_it_matters: boundedNonEmpty(1600),
});
export type ZeusMinorityPosition = z.infer<typeof ZeusMinorityPositionSchema>;

/**
 * Provider-facing preservation references. The canonical input manifest keeps
 * the full source records; the synthesis only needs compact IDs and state so
 * every material item remains addressable without reproducing council prose.
 */
export const ZeusMinorityPositionReferenceSchema = z.object({
  position_id: PositionIdSchema,
  seat_id: Round1SeatIdSchema,
});
export type ZeusMinorityPositionReference = z.infer<typeof ZeusMinorityPositionReferenceSchema>;

export const ZeusDisagreementViewSchema = z.object({
  disagreement_id: DisagreementIdSchema,
  type: DisagreementTypeSchema,
  status: z.enum(['OPEN', 'NARROWED', 'RESOLVED']),
  participating_seats: z.array(Round1SeatIdSchema).min(1).max(4),
  position_ids: z.array(PositionIdSchema).min(1).max(32),
  evidence_ids: z.array(EvidenceIdSchema).max(64),
  materiality: z.enum(['MINOR', 'MATERIAL', 'BLOCKING']),
  basis: boundedNonEmpty(1600),
  challenge_ids: z.array(ChallengeIdSchema).max(64),
  response_ids: z.array(ChallengeResponseIdSchema).max(64),
  revision_ids: z.array(RevisionIdSchema).max(64),
  remaining_uncertainty: boundedNonEmpty(1200),
});
export type ZeusDisagreementView = z.infer<typeof ZeusDisagreementViewSchema>;

export const ZeusDisagreementReferenceSchema = z.object({
  disagreement_id: DisagreementIdSchema,
  status: ZeusDisagreementReferenceStatusSchema,
  materiality: ZeusDisagreementReferenceMaterialitySchema,
});
export type ZeusDisagreementReference = z.infer<typeof ZeusDisagreementReferenceSchema>;

export const ZeusReadinessSchema = z.object({
  ready: z.boolean(),
  blockers: z.array(boundedNonEmpty(500)).max(32),
  warnings: z.array(boundedNonEmpty(500)).max(32),
  required_inputs_present: z.record(z.boolean()),
  human_authority_intact: z.literal(true),
});
export type ZeusReadiness = z.infer<typeof ZeusReadinessSchema>;

export const ZeusSynthesisInputSchema = z.object({
  input_version: z.literal('ZEUS_INPUT_V1'),
  case: SwarmCaseSchema,
  evidence_metadata: z.array(ZeusEvidenceMetadataSchema).max(200),
  final_positions: z.array(AgentPositionSchema).min(1).max(32),
  revisions: z.array(RevisionSchema).max(200),
  pre_challenge_disagreements: z.array(ZeusDisagreementViewSchema).max(64),
  post_challenge_disagreements: z.array(ZeusDisagreementViewSchema).max(64),
  challenges: z.array(ChallengeSchema).max(200),
  challenge_responses: z.array(ChallengeResponseSchema).max(200),
  minority_positions: z.array(ZeusMinorityPositionSchema).max(64),
  audit_findings: z.array(AuditFindingSchema).max(200),
  evidence_requests: z.array(EvidenceRequestSchema).max(200),
  abstentions: z.array(ParticipationEntrySchema).max(8),
  readiness: ZeusReadinessSchema,
  human_decision: z.null(),
  input_fingerprint: boundedNonEmpty(200),
});
export type ZeusSynthesisInput = z.infer<typeof ZeusSynthesisInputSchema>;

export const ZEUS_SYNTHESIS_OUTPUT_LIMITS = {
  executive_text: 640,
  concise_text: 240,
  risk_items: 8,
  control_items: 8,
  agreement_items: 4,
  uncertainty_items: 8,
  assumption_items: 8,
  evidence_gap_items: 8,
  decision_option_items: 4,
  next_action_items: 6,
  escalation_items: 4,
  source_position_items: 64,
  source_disagreement_items: 64,
  source_evidence_items: 200,
  source_audit_items: 200,
  source_ids_per_item: 8,
} as const;

const ZeusMaterialRiskSchema = z.object({
  statement: boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text),
  risk_level: RiskLevelSchema,
  uncertainty: boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text),
  source_position_ids: z.array(PositionIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item),
  source_evidence_ids: z.array(EvidenceIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item),
});
const ZeusControlAssessmentSchema = z.object({
  statement: boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text),
  effectiveness: ZeusControlEffectivenessSchema,
  gaps: z.array(boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text)).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item),
  source_position_ids: z.array(PositionIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item),
  source_evidence_ids: z.array(EvidenceIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item),
});
const ZeusEvidenceAssessmentSchema = z.object({
  summary: boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text),
  quality: ZeusEvidenceQualitySchema,
  evidence_ids: z.array(EvidenceIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_evidence_items),
  gaps: z.array(boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text)).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.evidence_gap_items),
});
const ZeusAuditSummarySchema = z.object({
  finding_ids: z.array(AuditFindingIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items),
  blocker_count: z.number().int().min(0).max(200),
  warning_count: z.number().int().min(0).max(200),
  citation_failures: z.array(AuditFindingIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items),
  evidence_integrity_findings: z.array(AuditFindingIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items),
  authority_findings: z.array(AuditFindingIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items),
  summary: boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text),
});
export const ZeusExecutionMetadataSchema = z.object({
  seat_id: z.literal('ZEUS'),
  provider_requested: boundedText(120).nullable(),
  model_requested: boundedText(200).nullable(),
  provider_executed: boundedText(120).nullable(),
  model_executed: boundedText(200).nullable(),
  request_id: boundedText(160).nullable(),
  prompt_version: boundedNonEmpty(120),
  prompt_fingerprint: boundedNonEmpty(200),
  input_fingerprint: boundedNonEmpty(200),
  output_validation: z.literal('PASS'),
  finish_reason: boundedText(120).nullable(),
  output_tokens: z.number().int().min(0).nullable(),
  fallback_used: z.literal(false),
  retry_index: z.literal(0),
  /** Runtime-owned audit trail for lossless source-reference formatting fixes. */
  reference_normalizations: z.array(z.object({
    path: boundedNonEmpty(240),
    reference_class: boundedNonEmpty(40),
    emitted_value: boundedNonEmpty(160),
    canonical_value: boundedNonEmpty(160),
  })).max(64).default([]),
});
export type ZeusExecutionMetadata = z.infer<typeof ZeusExecutionMetadataSchema>;

const ZeusSynthesisBodyShape = {
  executive_summary: boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text),
  decision_context: boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text),
  material_risks: z.array(ZeusMaterialRiskSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.risk_items),
  control_assessment: z.array(ZeusControlAssessmentSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.control_items),
  evidence_assessment: ZeusEvidenceAssessmentSchema,
  areas_of_agreement: z.array(boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text)).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.agreement_items),
  material_disagreements: z.array(ZeusDisagreementReferenceSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_disagreement_items),
  minority_positions: z.array(ZeusMinorityPositionReferenceSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_position_items),
  uncertainties: z.array(boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text)).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.uncertainty_items),
  assumptions: z.array(boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text)).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.assumption_items),
  evidence_gaps: z.array(boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text)).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.evidence_gap_items),
  decision_options: z.array(boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text)).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.decision_option_items),
  recommended_next_actions: z.array(boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text)).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.next_action_items),
  escalations: z.array(boundedNonEmpty(ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text)).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.escalation_items),
  audit_summary: ZeusAuditSummarySchema,
  confidence: z.number().finite().min(0).max(1),
  source_position_ids: z.array(PositionIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_position_items),
  source_disagreement_ids: z.array(DisagreementIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_disagreement_items),
  source_evidence_ids: z.array(EvidenceIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_evidence_items),
  source_audit_finding_ids: z.array(AuditFindingIdSchema).max(ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_audit_items),
} as const;

/** Provider-owned semantic Zeus body. System identity, provenance, authority,
 * protocol, and integrity metadata are intentionally not part of this DTO. */
export const ZeusSynthesisBodySchema = z.object(ZeusSynthesisBodyShape).strict();
export type ZeusSynthesisBody = z.infer<typeof ZeusSynthesisBodySchema>;

/** Canonical SWARM-owned Zeus envelope persisted in events and artifacts. */
export const ZeusSynthesisBriefSchema = z.object({
  synthesis_id: SynthesisIdSchema,
  case_id: SwarmCaseIdSchema,
  seat_id: z.literal('ZEUS'),
  ...ZeusSynthesisBodyShape,
  human_decision_required: z.literal(true),
  authority_statement: ZeusAuthorityStatementSchema,
  execution: ZeusExecutionMetadataSchema,
  synthesis_fingerprint: boundedNonEmpty(200),
  human_decision_status: z.literal('PENDING'),
}).superRefine((value, ctx) => {
  const text = JSON.stringify({ ...value, authority_statement: '' });
  if (/\b(?:approve|approves|approval|reject|rejects|rejection)\s+(?:of\s+)?(?:deployment|release|the\s+decision)\b|\b(?:deployment|release)\s+(?:approved|rejected)\b|\bclose\s+the\s+case|\blegal(?:ly)?\s+compliant\b|\b(?:fully\s+)?compliant\b|\bcompliance\s+(?:is\s+)?(?:confirmed|declared|certified)\b|\bregulatory\s+cert(?:if|ainty)|claim\s+regulator\s+approval|final\s+decision/i.test(text)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Zeus cannot hold final, legal, or regulatory authority' });
  }
  if (JSON.stringify(value.authority_statement) !== JSON.stringify(ZEUS_AUTHORITY_CONTRACT)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['authority_statement'], message: 'authority boundary is required' });
  }
});
export type ZeusSynthesisBrief = z.infer<typeof ZeusSynthesisBriefSchema>;

export const HumanDecisionSchema = z.object({
  decision_id: HumanDecisionIdSchema,
  case_id: SwarmCaseIdSchema,
  human_actor: boundedNonEmpty(160),
  decision: boundedNonEmpty(1600),
  timestamp,
  note: boundedNonEmpty(2000),
  diverges_from_synthesis: z.boolean(),
  divergence_reason: boundedText(1600).nullable(),
}).superRefine((value, ctx) => {
  if (SEAT_IDS.includes(value.human_actor.toUpperCase() as SeatId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'seat cannot be human actor' });
  if (value.diverges_from_synthesis && !value.divergence_reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'divergence reason required' });
  if (!value.diverges_from_synthesis && value.divergence_reason !== null) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'divergence reason without divergence' });
});
export type HumanDecision = z.infer<typeof HumanDecisionSchema>;

const eventBase = <Type extends string>(type: Type) => z.object({
  event_id: ExecutionEventIdSchema,
  case_id: SwarmCaseIdSchema,
  protocol_version: z.literal(SWARM_PROTOCOL_VERSION),
  sequence: z.number().int().min(1).max(100_000),
  timestamp,
  actor: boundedNonEmpty(160),
  type: z.literal(type),
});

const event = <Type extends string, Shape extends z.ZodRawShape>(type: Type, shape: Shape) => eventBase(type).extend(shape);

export const SwarmExecutionEventSchema = z.discriminatedUnion('type', [
  event('CASE_CREATED', { case: SwarmCaseSchema }),
  event('EVIDENCE_SEALED', { evidence_package: EvidencePackageSchema }),
  event('INDEPENDENT_ANALYSIS_STARTED', {}),
  event('SEAT_STARTED', { seat_id: Round1SeatIdSchema }),
  event('SEAT_COMPLETED', { seat_id: Round1SeatIdSchema, position_id: PositionIdSchema, execution: ModelExecutionSchema }),
  event('SEAT_ABSTAINED', { seat_id: Round1SeatIdSchema, reason: boundedNonEmpty(1000), execution: ModelExecutionSchema }),
  event('SEAT_UNAVAILABLE', { seat_id: Round1SeatIdSchema, reason: boundedNonEmpty(1000), execution: ModelExecutionSchema }),
  event('SEAT_FAILED', { seat_id: Round1SeatIdSchema, reason: boundedNonEmpty(1000), execution: ModelExecutionSchema }),
  event('SEAT_REJECTED', { seat_id: Round1SeatIdSchema, reason: boundedNonEmpty(1000), execution: ModelExecutionSchema }),
  event('POSITION_PROPOSED', { position: AgentPositionSchema }),
  event('POSITIONS_LOCKED', {}),
  event('DISAGREEMENT_IDENTIFIED', { disagreement: DisagreementSchema }),
  event('DISAGREEMENTS_FINALIZED', {}),
  event('CHALLENGE_ROUND_STARTED', { round: z.number().int().min(1).max(8) }),
  event('CHALLENGE_GENERATION_STARTED', { round: z.number().int().min(1).max(8) }),
  event('CHALLENGES_GENERATED', { challenge_ids: z.array(ChallengeIdSchema).max(200) }),
  event('CHALLENGE_EMITTED', { challenge: ChallengeSchema }),
  event('CHALLENGE_RESPONSE_STARTED', { challenge_id: ChallengeIdSchema, responding_seat: Round1SeatIdSchema }),
  event('CHALLENGE_RESPONSE_FAILED', { challenge_id: ChallengeIdSchema, responding_seat: Round1SeatIdSchema, reason: boundedNonEmpty(500) }),
  event('CHALLENGE_RESPONSE_RECORDED', { response: ChallengeResponseSchema }),
  event('EVIDENCE_REQUEST_RECORDED', { request: EvidenceRequestSchema }),
  event('REVISION_CREATED', { revision_id: RevisionIdSchema, position_id: PositionIdSchema }),
  event('CONCESSION_RECORDED', { challenge_id: ChallengeIdSchema, response_id: ChallengeResponseIdSchema, position_id: PositionIdSchema }),
  event('REVISION_RECORDED', { revision: RevisionSchema, position: AgentPositionSchema }),
  event('REVISIONS_LOCKED', {}),
  event('DISAGREEMENTS_REEVALUATED', { disagreements: z.array(DisagreementSchema).max(64) }),
  event('AUDIT_STARTED', {}),
  event('AUDIT_FINDING_RECORDED', { finding: AuditFindingSchema }),
  event('AUDIT_COMPLETED', {}),
  event('POST_CHALLENGE_AUDIT_COMPLETED', {}),
  event('ZEUS_READINESS_EVALUATED', { ready: z.boolean(), reason: boundedNonEmpty(800) }),
  event('ROUND_STOPPED', { reason: boundedNonEmpty(800) }),
  event('ZEUS_SYNTHESIS_REQUESTED', { input: ZeusSynthesisInputSchema, input_fingerprint: boundedNonEmpty(200), request_budget: z.literal(1) }),
  event('ZEUS_SYNTHESIS_STARTED', { input_fingerprint: boundedNonEmpty(200), prompt_version: boundedNonEmpty(120) }),
  event('ZEUS_SYNTHESIS_COMPLETED', { synthesis: ZeusSynthesisBriefSchema }),
  event('ZEUS_SYNTHESIS_FAILED', { failure_code: boundedNonEmpty(160) }),
  event('HUMAN_REVIEW_REQUIRED', { human_decision_required: z.literal(true), decision_status: z.literal('PENDING') }),
  event('SYNTHESIS_STARTED', {}),
  event('SYNTHESIS_READY', { synthesis: SynthesisBriefSchema }),
  event('HUMAN_REVIEW_STARTED', {}),
  event('HUMAN_DECISION_RECORDED', { decision: HumanDecisionSchema }),
  event('CASE_CLOSED', {}),
]);
export type SwarmExecutionEvent = z.infer<typeof SwarmExecutionEventSchema>;
export type SwarmEventType = SwarmExecutionEvent['type'];

export interface SeatExecutionState {
  readonly seat_id: Round1SeatId;
  readonly status: ExecutionStatus;
  readonly position_id: PositionId | null;
  readonly execution: ModelExecution | null;
  readonly reason: string | null;
}

export interface SwarmBlackboard {
  readonly protocol_version: SwarmProtocolVersion;
  readonly case: SwarmCase | null;
  readonly state: ProtocolState | null;
  readonly evidence_package: EvidencePackage | null;
  readonly claims: readonly Claim[];
  readonly positions: readonly AgentPosition[];
  readonly disagreements: readonly Disagreement[];
  readonly challenges: readonly Challenge[];
  readonly challenge_responses: readonly ChallengeResponse[];
  readonly evidence_requests: readonly EvidenceRequest[];
  readonly revisions: readonly Revision[];
  readonly audit_findings: readonly AuditFinding[];
  readonly synthesis: SynthesisBrief | null;
  readonly human_decision: HumanDecision | null;
  readonly seat_execution_state: Readonly<Record<Round1SeatId, SeatExecutionState>>;
  readonly execution_events: readonly SwarmExecutionEvent[];
  readonly audit_completed: boolean;
  readonly synthesis_started: boolean;
  readonly zeus_readiness: ZeusReadiness | null;
  readonly zeus_input: ZeusSynthesisInput | null;
  readonly zeus_synthesis: ZeusSynthesisBrief | null;
}

export interface Round1SeatInput {
  readonly seat_id: Round1SeatId;
  readonly case: Pick<SwarmCase, 'case_id' | 'protocol_version' | 'question' | 'scope' | 'policy'>;
  readonly evidence_package: EvidencePackage;
}
