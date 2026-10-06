import {
  AgentPositionSchema,
  HumanDecisionSchema,
  ModelExecutionSchema,
  SEAT_IDS,
  type AgentPosition,
  type EvidencePackage,
  type HumanDecision,
  type ModelExecution,
  type SwarmCase,
} from '../contracts';
import { evidenceIds, stableStringify, verifyEvidencePackageHash } from '../evidence/package';

const FORBIDDEN_POSITION_AUTHORITY = /\b(?:approve|reject)\s+(?:deployment|release|the\s+decision)|\blegal(?:ly)?\s+compliant\b|\bregulatory\s+cert(?:if|ainty)|\bfinal\s+decision\b/i;

export type ProtocolErrorCode =
  | 'INVALID_EVENT'
  | 'INVALID_TRANSITION'
  | 'UNKNOWN_REFERENCE'
  | 'EVIDENCE_MUTATION'
  | 'UNKNOWN_EVIDENCE'
  | 'AUTHORITY_VIOLATION'
  | 'BUDGET_EXCEEDED'
  | 'ROUND_LEAKAGE'
  | 'POSITION_LOCK_VIOLATION'
  | 'EVENT_SEQUENCE_ERROR'
  | 'DUPLICATE_ID'
  | 'DUPLICATE_REFERENCE'
  | 'ZEUS_SYNTHESIS_FINGERPRINT_MISMATCH'
  | 'SCHEMA_ERROR';

export type SafeProtocolDiagnostics = Readonly<Record<string, string | number | boolean | null>>;

export class SwarmProtocolError extends Error {
  constructor(readonly code: ProtocolErrorCode, message: string = code, readonly diagnostics: SafeProtocolDiagnostics = {}) {
    super(message);
    this.name = 'SwarmProtocolError';
  }
}

export function fail(code: ProtocolErrorCode, message: string = code, diagnostics: SafeProtocolDiagnostics = {}): never {
  throw new SwarmProtocolError(code, message, diagnostics);
}

export function assertExecutionTruth(execution: ModelExecution, expected?: 'SUCCESS' | 'ABSTAINED' | 'UNAVAILABLE' | 'FAILED' | 'REJECTED'): void {
  const parsed = ModelExecutionSchema.safeParse(execution);
  if (!parsed.success) fail('SCHEMA_ERROR');
  if (expected && execution.status !== expected) fail('AUTHORITY_VIOLATION');
  if (execution.status === 'SUCCESS' && (!execution.model_called || !execution.independent)) fail('AUTHORITY_VIOLATION');
  if (execution.status === 'SUCCESS' && execution.fallback_used) fail('AUTHORITY_VIOLATION');
}

export function assertKnownEvidence(ids: readonly string[], packageValue: EvidencePackage): void {
  const known = evidenceIds(packageValue);
  for (const id of ids) if (!known.has(id)) fail('UNKNOWN_EVIDENCE');
}

export function assertPositionValid(position: AgentPosition, caseValue: SwarmCase, packageValue: EvidencePackage): void {
  if (!AgentPositionSchema.safeParse(position).success) fail('SCHEMA_ERROR');
  if (position.case_id !== caseValue.case_id) fail('UNKNOWN_REFERENCE');
  if (!SEAT_IDS.includes(position.seat_id)) fail('AUTHORITY_VIOLATION');
  if (position.round === 1 && position.position_references.length > 0) fail('ROUND_LEAKAGE');
  assertExecutionTruth(position.execution, 'SUCCESS');
  assertKnownEvidence(position.evidence_ids, packageValue);
  for (const claim of position.claims) {
    assertKnownEvidence(claim.evidence_ids, packageValue);
    if (claim.position_id !== position.position_id) fail('UNKNOWN_REFERENCE');
    if ((claim.type === 'INFERENCE' || claim.type === 'PREDICTION') && claim.uncertainty.trim().length === 0) fail('SCHEMA_ERROR');
  }
  for (const finding of position.risk_findings) assertKnownEvidence(finding.evidence_ids, packageValue);
  for (const gap of position.control_gaps) assertKnownEvidence(gap.evidence_ids, packageValue);
  for (const request of position.evidence_requests) assertKnownEvidence(request.evidence_ids, packageValue);
  if (position.abstained) fail('AUTHORITY_VIOLATION');
  const positionText = [position.conclusion, position.recommendation ?? '', ...position.claims.map((claim) => claim.statement)].join(' ');
  if (FORBIDDEN_POSITION_AUTHORITY.test(positionText)) fail('AUTHORITY_VIOLATION');
}

/**
 * Revision identity and protocol metadata are intentionally excluded. A
 * revision must change canonical position meaning, not merely mint a new
 * position id or round number.
 */
function positionSemanticProjection(position: AgentPosition): unknown {
  return {
    case_id: position.case_id,
    seat_id: position.seat_id,
    conclusion: position.conclusion,
    risk_level: position.risk_level,
    confidence: position.confidence,
    claims: position.claims.map((claim) => ({ statement: claim.statement, type: claim.type, evidence_ids: claim.evidence_ids, assumptions: claim.assumptions, uncertainty: claim.uncertainty, status: claim.status })),
    evidence_ids: position.evidence_ids,
    assumptions: position.assumptions,
    uncertainties: position.uncertainties,
    risk_findings: position.risk_findings.map((finding) => ({ statement: finding.statement, evidence_ids: finding.evidence_ids, assumptions: finding.assumptions, uncertainty: finding.uncertainty, risk_level: finding.risk_level })),
    control_gaps: position.control_gaps.map((gap) => ({ statement: gap.statement, evidence_ids: gap.evidence_ids, assumptions: gap.assumptions, uncertainty: gap.uncertainty, priority: gap.priority })),
    counterarguments: position.counterarguments,
    evidence_requests: position.evidence_requests.map((request) => ({ request: request.request, reason: request.reason, evidence_ids: request.evidence_ids, status: request.status })),
    recommendation: position.recommendation,
    abstained: position.abstained,
    abstention_reason: position.abstention_reason,
  };
}

export function hasMeaningfulPositionChange(previous: AgentPosition, revised: AgentPosition): boolean {
  return stableStringify(positionSemanticProjection(previous)) !== stableStringify(positionSemanticProjection(revised));
}

export function assertHumanDecision(decision: HumanDecision, caseValue: SwarmCase): void {
  if (!HumanDecisionSchema.safeParse(decision).success) fail('SCHEMA_ERROR');
  if (decision.case_id !== caseValue.case_id) fail('UNKNOWN_REFERENCE');
  if (SEAT_IDS.includes(decision.human_actor.toUpperCase() as (typeof SEAT_IDS)[number])) fail('AUTHORITY_VIOLATION');
}

export interface VerificationReport {
  readonly ok: boolean;
  readonly checks: readonly string[];
}

export function verifyEvidencePackage(packageValue: EvidencePackage): VerificationReport {
  const checks: string[] = [];
  if (!verifyEvidencePackageHash(packageValue)) return { ok: false, checks: ['package_hash'] };
  if (!Object.isFrozen(packageValue) || packageValue.items.some((item) => !Object.isFrozen(item))) return { ok: false, checks: ['package_immutability'] };
  checks.push('package_hash', 'package_immutability', 'known_evidence');
  return { ok: true, checks };
}
