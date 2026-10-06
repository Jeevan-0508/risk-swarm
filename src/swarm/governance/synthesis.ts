import { SynthesisBriefSchema, type AgentPosition, type AuditFinding, type ParticipationEntry, type SynthesisBrief, type SwarmBlackboard } from '../contracts';
import { currentPositions, summarizePositions } from '../debate/disagreements';
import { assertKnownEvidence, fail } from './verifier';

const FORBIDDEN_SYNTHESIS = /APPROVED_BY_ZEUS|REJECTED_BY_ZEUS|\b(?:approve|reject)\s+(?:deployment|release|the\s+decision)|\blegal(?:ly)?\s+compliant\b|\bregulatory\s+cert(?:if|ainty)|\bfinal\s+decision\b/i;

export interface SynthesisInput {
  readonly case: SwarmBlackboard['case'];
  readonly evidence_package: SwarmBlackboard['evidence_package'];
  readonly final_positions: readonly AgentPosition[];
  readonly participation_summary: readonly ParticipationEntry[];
  readonly disagreements: SwarmBlackboard['disagreements'];
  readonly challenges: SwarmBlackboard['challenges'];
  readonly challenge_responses: SwarmBlackboard['challenge_responses'];
  readonly revisions: SwarmBlackboard['revisions'];
  readonly audit_findings: readonly AuditFinding[];
  readonly evidence_requests: SwarmBlackboard['evidence_requests'];
}

export interface SynthesisExecutor {
  synthesize(input: SynthesisInput): Promise<unknown>;
}

export interface SynthesisReadiness {
  readonly ready: boolean;
  readonly reason: 'ACCEPTED_ANALYTICAL_POSITIONS' | 'NO_ACCEPTED_ANALYTICAL_POSITIONS';
}

/** Zeus is never invoked when Round 1 produced no accepted analytical position. */
export function assessSynthesisReadiness(input: Pick<SynthesisInput, 'final_positions'>): SynthesisReadiness {
  return input.final_positions.length > 0
    ? { ready: true, reason: 'ACCEPTED_ANALYTICAL_POSITIONS' }
    : { ready: false, reason: 'NO_ACCEPTED_ANALYTICAL_POSITIONS' };
}

export interface FixtureSynthesisPlan {
  readonly build: (input: SynthesisInput) => unknown;
}

export class FixtureSynthesisExecutor implements SynthesisExecutor {
  constructor(private readonly plan: FixtureSynthesisPlan) {}

  async synthesize(input: SynthesisInput): Promise<unknown> {
    return this.plan.build(input);
  }
}

export function defaultFixtureSynthesis(input: SynthesisInput): SynthesisBrief {
  const positions = input.final_positions;
  const summary = summarizePositions(positions);
  const majority = summary.majority_position_id;
  const riskLevel = summary.majority_risk_level ?? (positions.find((position) => position.risk_level === 'HIGH' || position.risk_level === 'CRITICAL')?.risk_level ?? 'UNDETERMINED');
  return {
    synthesis_id: `synthesis-${input.case!.case_id}` as SynthesisBrief['synthesis_id'],
    case_id: input.case!.case_id,
    risk_summary: summary.summary === 'MAJORITY' ? `A majority position rates the risk ${riskLevel}.` : `No forced consensus: ${summary.summary.toLowerCase().replaceAll('_', ' ')}.`,
    risk_level: riskLevel,
    majority_position: majority,
    minority_positions: [...summary.minority_position_ids],
    unresolved_disagreements: input.disagreements.filter((disagreement) => disagreement.unresolved).map((disagreement) => disagreement.disagreement_id),
    strongest_evidence: [...new Set(positions.flatMap((position) => position.evidence_ids))],
    weakest_assumptions: [...new Set(positions.flatMap((position) => position.assumptions))],
    evidence_gaps: input.evidence_requests.map((request) => request.request),
    control_gaps: [...new Set(positions.flatMap((position) => position.control_gaps.map((gap) => gap.gap_id)))],
    recommended_controls: positions.flatMap((position) => position.control_gaps.map((gap) => gap.statement)),
    uncertainty: positions.flatMap((position) => position.uncertainties).join(' ') || 'Uncertainty was not supplied by the fixture.',
    participation_summary: [...input.participation_summary],
    audit_findings: input.audit_findings.map((finding) => finding.finding_id),
    human_action_required: 'A human decision is required; this brief is advisory.',
    human_decision_status: 'PENDING',
  };
}

export function validateFixtureSynthesis(brief: unknown, input: SynthesisInput): SynthesisBrief {
  const parsed = SynthesisBriefSchema.safeParse(brief);
  if (!parsed.success) fail('SCHEMA_ERROR');
  const value = parsed.data;
  if (!input.case || !input.evidence_package || value.case_id !== input.case.case_id) fail('UNKNOWN_REFERENCE');
  const current = [...input.final_positions];
  const positionIds = new Set(current.map((position) => position.position_id));
  if (value.majority_position && !positionIds.has(value.majority_position)) fail('UNKNOWN_REFERENCE');
  if (value.minority_positions.some((positionId) => !positionIds.has(positionId))) fail('UNKNOWN_REFERENCE');
  const summary = summarizePositions(current);
  if (value.majority_position && summary.summary !== 'MAJORITY') fail('AUTHORITY_VIOLATION');
  if (summary.summary === 'MAJORITY' && value.majority_position === null) fail('AUTHORITY_VIOLATION');
  const materialOpen = input.disagreements.filter((disagreement) => disagreement.unresolved && disagreement.materiality !== 'MINOR');
  for (const disagreement of materialOpen) if (!value.unresolved_disagreements.includes(disagreement.disagreement_id)) fail('AUTHORITY_VIOLATION');
  for (const finding of input.audit_findings.filter((finding) => finding.status === 'BLOCKED')) if (!value.audit_findings.includes(finding.finding_id)) fail('AUTHORITY_VIOLATION');
  const expectedParticipation = JSON.stringify(input.participation_summary);
  if (JSON.stringify(value.participation_summary) !== expectedParticipation) fail('AUTHORITY_VIOLATION');
  assertKnownEvidence(value.strongest_evidence, input.evidence_package);
  if (FORBIDDEN_SYNTHESIS.test(JSON.stringify(value))) fail('AUTHORITY_VIOLATION');
  if (value.human_decision_status !== 'PENDING') fail('AUTHORITY_VIOLATION');
  return value;
}

export function currentSynthesisPositions(state: SwarmBlackboard): AgentPosition[] {
  return currentPositions(state);
}
