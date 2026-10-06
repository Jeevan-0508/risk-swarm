import { jsonSchema, type OutputSchemaDescriptor } from '../models';
import { type EvidencePackage, type ClaimStatus, type ClaimType, type RiskLevel } from '../contracts';
import { type SeatAssessmentOutput, type SeatChallengeOutput, type SeatClaimOutput, type SeatControlGapOutput, type SeatEvidenceRequestOutput, type SeatRiskFindingOutput } from './types';

type ValidationSuccess<T> = { readonly success: true; readonly value: T };
type ValidationFailure = { readonly success: false; readonly error: string };
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

const RISK_LEVELS = new Set<RiskLevel>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNDETERMINED']);
const CLAIM_TYPES = new Set<ClaimType>(['OBSERVATION', 'INFERENCE', 'PREDICTION', 'RECOMMENDATION']);
const CLAIM_STATUSES = new Set<ClaimStatus>(['SUPPORTED', 'UNCERTAIN', 'CHALLENGED', 'WITHDRAWN']);
const PRIORITIES = new Set<Exclude<RiskLevel, 'UNDETERMINED'>>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): ValidationFailure | null {
  const expected = new Set(keys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  return unknown.length > 0 ? { success: false, error: `${label} contains unknown field(s): ${unknown.join(',')}` } : null;
}

function text(value: unknown, label: string, allowEmpty = false): ValidationResult<string> {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) return { success: false, error: `${label} must be a ${allowEmpty ? 'string' : 'non-empty string'}` };
  return { success: true, value };
}

function stringArray(value: unknown, label: string): ValidationResult<readonly string[]> {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) return { success: false, error: `${label} must be an array of non-empty strings` };
  return { success: true, value: value as string[] };
}

function boundedNumber(value: unknown, label: string): ValidationResult<number | null> {
  if (value === null) return { success: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return { success: false, error: `${label} must be null or a number from 0 to 1` };
  return { success: true, value };
}

function risk(value: unknown, label: string): ValidationResult<RiskLevel> {
  if (typeof value !== 'string' || !RISK_LEVELS.has(value as RiskLevel)) return { success: false, error: `${label} is not a canonical risk level` };
  return { success: true, value: value as RiskLevel };
}

function nestedClaim(value: unknown, index: number): ValidationResult<SeatClaimOutput> {
  if (!record(value)) return { success: false, error: `claims[${index}] must be an object` };
  const unknown = exact(value, ['statement', 'type', 'evidence_ids', 'assumptions', 'uncertainty', 'status'], `claims[${index}]`);
  if (unknown) return unknown;
  const statement = text(value.statement, `claims[${index}].statement`); if (!statement.success) return statement;
  if (typeof value.type !== 'string' || !CLAIM_TYPES.has(value.type as ClaimType)) return { success: false, error: `claims[${index}].type is invalid` };
  const evidence = stringArray(value.evidence_ids, `claims[${index}].evidence_ids`); if (!evidence.success) return evidence;
  const assumptions = stringArray(value.assumptions, `claims[${index}].assumptions`); if (!assumptions.success) return assumptions;
  const uncertainty = text(value.uncertainty, `claims[${index}].uncertainty`); if (!uncertainty.success) return uncertainty;
  if (typeof value.status !== 'string' || !CLAIM_STATUSES.has(value.status as ClaimStatus)) return { success: false, error: `claims[${index}].status is invalid` };
  if ((value.type === 'OBSERVATION' || value.type === 'INFERENCE' || value.type === 'PREDICTION') && evidence.value.length === 0) return { success: false, error: `claims[${index}] requires an evidence basis` };
  return { success: true, value: { statement: statement.value, type: value.type as ClaimType, evidence_ids: evidence.value, assumptions: assumptions.value, uncertainty: uncertainty.value, status: value.status as ClaimStatus } };
}

function nestedFinding(value: unknown, index: number): ValidationResult<SeatRiskFindingOutput> {
  if (!record(value)) return { success: false, error: `risk_findings[${index}] must be an object` };
  const unknown = exact(value, ['statement', 'evidence_ids', 'assumptions', 'uncertainty', 'risk_level'], `risk_findings[${index}]`); if (unknown) return unknown;
  const statement = text(value.statement, `risk_findings[${index}].statement`); if (!statement.success) return statement;
  const evidence = stringArray(value.evidence_ids, `risk_findings[${index}].evidence_ids`); if (!evidence.success) return evidence;
  const assumptions = stringArray(value.assumptions, `risk_findings[${index}].assumptions`); if (!assumptions.success) return assumptions;
  const uncertainty = text(value.uncertainty, `risk_findings[${index}].uncertainty`); if (!uncertainty.success) return uncertainty;
  const level = risk(value.risk_level, `risk_findings[${index}].risk_level`); if (!level.success) return level;
  if (evidence.value.length === 0 && assumptions.value.length === 0) return { success: false, error: `risk_findings[${index}] needs evidence or an explicit assumption` };
  return { success: true, value: { statement: statement.value, evidence_ids: evidence.value, assumptions: assumptions.value, uncertainty: uncertainty.value, risk_level: level.value } };
}

function nestedGap(value: unknown, index: number): ValidationResult<SeatControlGapOutput> {
  if (!record(value)) return { success: false, error: `control_gaps[${index}] must be an object` };
  const unknown = exact(value, ['statement', 'evidence_ids', 'assumptions', 'uncertainty', 'priority'], `control_gaps[${index}]`); if (unknown) return unknown;
  const statement = text(value.statement, `control_gaps[${index}].statement`); if (!statement.success) return statement;
  const evidence = stringArray(value.evidence_ids, `control_gaps[${index}].evidence_ids`); if (!evidence.success) return evidence;
  const assumptions = stringArray(value.assumptions, `control_gaps[${index}].assumptions`); if (!assumptions.success) return assumptions;
  const uncertainty = text(value.uncertainty, `control_gaps[${index}].uncertainty`); if (!uncertainty.success) return uncertainty;
  if (typeof value.priority !== 'string' || !PRIORITIES.has(value.priority as Exclude<RiskLevel, 'UNDETERMINED'>)) return { success: false, error: `control_gaps[${index}].priority is invalid` };
  if (evidence.value.length === 0 && assumptions.value.length === 0) return { success: false, error: `control_gaps[${index}] needs evidence or an explicit assumption` };
  return { success: true, value: { statement: statement.value, evidence_ids: evidence.value, assumptions: assumptions.value, uncertainty: uncertainty.value, priority: value.priority as Exclude<RiskLevel, 'UNDETERMINED'> } };
}

function nestedRequest(value: unknown, index: number): ValidationResult<SeatEvidenceRequestOutput> {
  if (!record(value)) return { success: false, error: `evidence_requests[${index}] must be an object` };
  const unknown = exact(value, ['request', 'reason', 'evidence_ids'], `evidence_requests[${index}]`); if (unknown) return unknown;
  const request = text(value.request, `evidence_requests[${index}].request`); if (!request.success) return request;
  const reason = text(value.reason, `evidence_requests[${index}].reason`); if (!reason.success) return reason;
  const evidence = stringArray(value.evidence_ids, `evidence_requests[${index}].evidence_ids`); if (!evidence.success) return evidence;
  return { success: true, value: { request: request.value, reason: reason.value, evidence_ids: evidence.value } };
}

export function validateSeatAssessmentShape(value: unknown): ValidationResult<SeatAssessmentOutput> {
  if (!record(value)) return { success: false, error: 'seat assessment must be an object' };
  const unknown = exact(value, ['conclusion', 'risk_level', 'confidence', 'claims', 'assumptions', 'uncertainties', 'risk_findings', 'control_gaps', 'counterarguments', 'evidence_requests', 'recommendation', 'abstained', 'abstention_reason'], 'seat assessment'); if (unknown) return unknown;
  const conclusion = text(value.conclusion, 'conclusion', true); if (!conclusion.success) return conclusion;
  const level = risk(value.risk_level, 'risk_level'); if (!level.success) return level;
  const confidence = boundedNumber(value.confidence, 'confidence'); if (!confidence.success) return confidence;
  if (!Array.isArray(value.claims)) return { success: false, error: 'claims must be an array' };
  const claims: SeatClaimOutput[] = []; for (let index = 0; index < value.claims.length; index += 1) { const item = nestedClaim(value.claims[index], index); if (!item.success) return item; claims.push(item.value); }
  const assumptions = stringArray(value.assumptions, 'assumptions'); if (!assumptions.success) return assumptions;
  const uncertainties = stringArray(value.uncertainties, 'uncertainties'); if (!uncertainties.success) return uncertainties;
  if (!Array.isArray(value.risk_findings)) return { success: false, error: 'risk_findings must be an array' };
  const findings: SeatRiskFindingOutput[] = []; for (let index = 0; index < value.risk_findings.length; index += 1) { const item = nestedFinding(value.risk_findings[index], index); if (!item.success) return item; findings.push(item.value); }
  if (!Array.isArray(value.control_gaps)) return { success: false, error: 'control_gaps must be an array' };
  const gaps: SeatControlGapOutput[] = []; for (let index = 0; index < value.control_gaps.length; index += 1) { const item = nestedGap(value.control_gaps[index], index); if (!item.success) return item; gaps.push(item.value); }
  const counterarguments = stringArray(value.counterarguments, 'counterarguments'); if (!counterarguments.success) return counterarguments;
  if (!Array.isArray(value.evidence_requests)) return { success: false, error: 'evidence_requests must be an array' };
  const requests: SeatEvidenceRequestOutput[] = []; for (let index = 0; index < value.evidence_requests.length; index += 1) { const item = nestedRequest(value.evidence_requests[index], index); if (!item.success) return item; requests.push(item.value); }
  if (typeof value.recommendation !== 'string' && value.recommendation !== null) return { success: false, error: 'recommendation must be a string or null' };
  if (typeof value.abstained !== 'boolean') return { success: false, error: 'abstained must be boolean' };
  if (typeof value.abstention_reason !== 'string' && value.abstention_reason !== null) return { success: false, error: 'abstention_reason must be a string or null' };
  if (value.abstained && (!value.abstention_reason || value.abstention_reason.trim().length === 0)) return { success: false, error: 'abstention requires a reason' };
  if (!value.abstained && conclusion.value.trim().length === 0) return { success: false, error: 'non-abstained assessment requires a conclusion' };
  return { success: true, value: { conclusion: conclusion.value, risk_level: level.value, confidence: confidence.value, claims, assumptions: assumptions.value, uncertainties: uncertainties.value, risk_findings: findings, control_gaps: gaps, counterarguments: counterarguments.value, evidence_requests: requests, recommendation: value.recommendation as string | null, abstained: value.abstained, abstention_reason: value.abstention_reason as string | null } };
}

export function validateSeatChallengeShape(value: unknown): ValidationResult<SeatChallengeOutput> {
  if (!record(value)) return { success: false, error: 'seat challenge response must be an object' };
  const unknown = exact(value, ['action', 'rationale', 'evidence_ids', 'revised_assessment', 'concession', 'abstention_reason'], 'seat challenge response'); if (unknown) return unknown;
  if (!['DEFEND', 'REVISE', 'CONCEDE', 'REQUEST_EVIDENCE', 'ABSTAIN'].includes(String(value.action))) return { success: false, error: 'challenge action is invalid' };
  const rationale = text(value.rationale, 'rationale'); if (!rationale.success) return rationale;
  const evidence = stringArray(value.evidence_ids, 'evidence_ids'); if (!evidence.success) return evidence;
  let revised: SeatAssessmentOutput | null = null;
  if (value.revised_assessment !== null) { const candidate = validateSeatAssessmentShape(value.revised_assessment); if (!candidate.success) return { success: false, error: `revised_assessment: ${candidate.error}` }; revised = candidate.value; }
  if (typeof value.concession !== 'string' && value.concession !== null) return { success: false, error: 'concession must be a string or null' };
  if (typeof value.abstention_reason !== 'string' && value.abstention_reason !== null) return { success: false, error: 'abstention_reason must be a string or null' };
  if (value.action === 'REVISE' && revised === null) return { success: false, error: 'REVISE requires revised_assessment' };
  if (value.action === 'CONCEDE' && (revised === null || !value.concession || value.concession.trim().length === 0)) return { success: false, error: 'CONCEDE requires concession and revised_assessment' };
  if (value.action === 'REQUEST_EVIDENCE' && rationale.value.trim().length === 0) return { success: false, error: 'REQUEST_EVIDENCE requires bounded rationale' };
  if (value.action === 'ABSTAIN' && (!value.abstention_reason || value.abstention_reason.trim().length === 0)) return { success: false, error: 'ABSTAIN requires abstention_reason' };
  return { success: true, value: { action: value.action as SeatChallengeOutput['action'], rationale: rationale.value, evidence_ids: evidence.value, revised_assessment: revised, concession: value.concession as string | null, abstention_reason: value.abstention_reason as string | null } };
}

const nonEmptyString = { type: 'string', minLength: 1 };
const stringList = { type: 'array', items: nonEmptyString };
const riskLevel = { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNDETERMINED'] };
const claimType = { type: 'string', enum: ['OBSERVATION', 'INFERENCE', 'PREDICTION', 'RECOMMENDATION'] };
const claimStatus = { type: 'string', enum: ['SUPPORTED', 'UNCERTAIN', 'CHALLENGED', 'WITHDRAWN'] };
const priority = { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] };

const SEAT_CLAIM_PROVIDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { statement: nonEmptyString, type: claimType, evidence_ids: stringList, assumptions: stringList, uncertainty: nonEmptyString, status: claimStatus },
  required: ['statement', 'type', 'evidence_ids', 'assumptions', 'uncertainty', 'status'],
};

const SEAT_FINDING_PROVIDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { statement: nonEmptyString, evidence_ids: stringList, assumptions: stringList, uncertainty: nonEmptyString, risk_level: riskLevel },
  required: ['statement', 'evidence_ids', 'assumptions', 'uncertainty', 'risk_level'],
};

const SEAT_GAP_PROVIDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { statement: nonEmptyString, evidence_ids: stringList, assumptions: stringList, uncertainty: nonEmptyString, priority },
  required: ['statement', 'evidence_ids', 'assumptions', 'uncertainty', 'priority'],
};

const SEAT_REQUEST_PROVIDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { request: nonEmptyString, reason: nonEmptyString, evidence_ids: stringList },
  required: ['request', 'reason', 'evidence_ids'],
};

export const SEAT_ASSESSMENT_PROVIDER_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    conclusion: { type: 'string' },
    risk_level: riskLevel,
    confidence: { anyOf: [{ type: 'number', minimum: 0, maximum: 1 }, { type: 'null' }] },
    claims: { type: 'array', items: SEAT_CLAIM_PROVIDER_SCHEMA },
    assumptions: stringList,
    uncertainties: stringList,
    risk_findings: { type: 'array', items: SEAT_FINDING_PROVIDER_SCHEMA },
    control_gaps: { type: 'array', items: SEAT_GAP_PROVIDER_SCHEMA },
    counterarguments: stringList,
    evidence_requests: { type: 'array', items: SEAT_REQUEST_PROVIDER_SCHEMA },
    recommendation: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    abstained: { type: 'boolean' },
    abstention_reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['conclusion', 'risk_level', 'confidence', 'claims', 'assumptions', 'uncertainties', 'risk_findings', 'control_gaps', 'counterarguments', 'evidence_requests', 'recommendation', 'abstained', 'abstention_reason'],
};

export const SEAT_CHALLENGE_PROVIDER_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['DEFEND', 'REVISE', 'CONCEDE', 'REQUEST_EVIDENCE', 'ABSTAIN'] },
    rationale: nonEmptyString,
    evidence_ids: stringList,
    revised_assessment: { anyOf: [SEAT_ASSESSMENT_PROVIDER_SCHEMA, { type: 'null' }] },
    concession: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    abstention_reason: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['action', 'rationale', 'evidence_ids', 'revised_assessment', 'concession', 'abstention_reason'],
};

export const SEAT_ASSESSMENT_SCHEMA: OutputSchemaDescriptor<SeatAssessmentOutput> = jsonSchema('swarm_seat_assessment_v1', validateSeatAssessmentShape, { strict: true, describe: 'Strict evidence-grounded SWARM seat assessment; no identity or chain-of-thought fields.', json_schema: SEAT_ASSESSMENT_PROVIDER_SCHEMA });
export const SEAT_CHALLENGE_SCHEMA: OutputSchemaDescriptor<SeatChallengeOutput> = jsonSchema('swarm_seat_challenge_v1', validateSeatChallengeShape, { strict: true, describe: 'Strict bounded SWARM challenge response.', json_schema: SEAT_CHALLENGE_PROVIDER_SCHEMA });

const FORBIDDEN_AUTHORITY = /\b(?:approve|reject)\s+(?:deployment|release|the\s+decision)|\bdeployment\s+(?:approved|rejected)|\bsystem\s+is\s+legally\s+compliant\b|\blegal(?:ly)?\s+compliant\b|\bregulatory\s+(?:approval|cert(?:if|ainty))|\bhuman\s+review\s+(?:is\s+)?unnecessary\b|\bclose\s+(?:this\s+)?case\b|\boverride\s+apollo\b|\bfinal\s+decision\b/i;

function allCitations(output: SeatAssessmentOutput): readonly string[] {
  return [
    ...output.claims.flatMap((item) => item.evidence_ids),
    ...output.risk_findings.flatMap((item) => item.evidence_ids),
    ...output.control_gaps.flatMap((item) => item.evidence_ids),
    ...output.evidence_requests.flatMap((item) => item.evidence_ids),
  ];
}

export function validateSeatAssessmentSemantics(output: SeatAssessmentOutput, evidencePackage: EvidencePackage): ValidationResult<SeatAssessmentOutput> {
  const known = new Set<string>(evidencePackage.items.map((item) => item.evidence_id));
  const citations = allCitations(output);
  for (const evidenceId of citations) if (!known.has(evidenceId)) return { success: false, error: `unknown evidence identifier: ${evidenceId}` };
  const textToCheck = [output.conclusion, output.recommendation ?? '', ...output.claims.map((item) => item.statement), ...output.risk_findings.map((item) => item.statement), ...output.control_gaps.map((item) => item.statement), ...output.counterarguments, ...output.evidence_requests.flatMap((item) => [item.request, item.reason])].join(' ');
  if (FORBIDDEN_AUTHORITY.test(textToCheck)) return { success: false, error: 'authority boundary violation' };
  if (evidencePackage.known_conflicts.length > 0 && output.confidence !== null && output.confidence >= 1) return { success: false, error: 'contradictory evidence cannot support certainty' };
  if (!output.abstained && output.claims.length === 0 && output.risk_findings.length === 0 && output.control_gaps.length === 0 && output.evidence_requests.length === 0) return { success: false, error: 'non-abstained assessment requires a material structured basis' };
  return { success: true, value: output };
}

export function validateChallengeSemantics(output: SeatChallengeOutput, evidencePackage: EvidencePackage): ValidationResult<SeatChallengeOutput> {
  const known = new Set<string>(evidencePackage.items.map((item) => item.evidence_id));
  for (const evidenceId of output.evidence_ids) if (!known.has(evidenceId)) return { success: false, error: `unknown evidence identifier: ${evidenceId}` };
  const textToCheck = [output.rationale, output.concession ?? '', output.abstention_reason ?? ''].join(' ');
  if (FORBIDDEN_AUTHORITY.test(textToCheck)) return { success: false, error: 'authority boundary violation' };
  if (output.revised_assessment) { const semantic = validateSeatAssessmentSemantics(output.revised_assessment, evidencePackage); if (!semantic.success) return semantic; }
  return { success: true, value: output };
}
