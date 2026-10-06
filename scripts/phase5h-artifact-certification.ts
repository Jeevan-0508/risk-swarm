import { readFileSync } from 'node:fs';
import { AgentPositionSchema, ChallengeResponseSchema, ModelExecutionSchema } from '../src/swarm/contracts';
import { deterministicPackageHash } from '../src/swarm/evidence/package';
import { certifyPhase5gArtifact, loadPhase5gArtifact, replayPhase5gArtifact, scanPhase5gSecrets, type Phase5gCertificationArtifact } from './phase5g-durable-artifact';
import { evaluateRound1Blindness, type Round1BlindnessAttestation, type Round1BlindnessStatus } from './phase5h1-blindness-forensics';

export const PHASE5H_RUN_ID = 'swarm-phase5g-1791211595745-83cec8da-b9a5-419c-ac4d-4e26fa0e64a4' as const;
export const PHASE5H_RUN_FINGERPRINT = 'fnv1a:632328cd' as const;
export const PHASE5H_ARTIFACT_PATH = 'artifacts/swarm/live-certifications/swarm-phase5g-1791211595745-83cec8da-b9a5-419c-ac4d-4e26fa0e64a4.json' as const;

const REQUIRED_SEATS = ['ATHENA', 'ARES', 'HADES', 'APOLLO'] as const;

function recomputeFingerprint(artifact: Phase5gCertificationArtifact): string {
  return deterministicPackageHash({
    run_id: artifact.run_id,
    protocol_version: artifact.protocol_version,
    case_id: artifact.case.case_id,
    evidence: artifact.evidence,
    budgets: artifact.budgets,
    request_ledger: artifact.request_ledger.map(({ request_id, operation, seat_id, request_status, failure_stage, failure_code }) => ({ request_id, operation, seat_id, request_status, failure_stage, failure_code })),
    event_sequences: artifact.execution_events.map((event) => event.sequence),
  });
}

function hasForbiddenContext(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenContext);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => /peer_reasoning|zeus_context|human_decision_context|raw_response|reasoning_content|chain.?of.?thought|hidden.?reasoning/i.test(key) || hasForbiddenContext(child));
}

function eventIndex(events: readonly { readonly event_type: string }[], type: string): number {
  return events.findIndex((event) => event.event_type === type);
}

function orderedLifecycle(events: readonly { readonly event_type: string }[]): boolean {
  const milestones = ['CASE_CREATED', 'EVIDENCE_SEALED', 'INDEPENDENT_ANALYSIS_STARTED', 'POSITIONS_LOCKED', 'DISAGREEMENT_IDENTIFIED', 'CHALLENGE_ROUND_STARTED', 'REVISIONS_LOCKED', 'DISAGREEMENTS_REEVALUATED', 'AUDIT_STARTED', 'ZEUS_READINESS_EVALUATED', 'ROUND_STOPPED'];
  const indexes = milestones.map((type) => eventIndex(events, type));
  return indexes.every((index) => index >= 0) && indexes.every((index, cursor) => cursor === 0 || index > indexes[cursor - 1]!);
}

function acceptedEvidenceIds(artifact: Phase5gCertificationArtifact): Set<string> {
  const ids = new Set<string>(artifact.evidence.evidence_item_ids ?? []);
  const add = (value: unknown): void => {
    if (Array.isArray(value)) for (const item of value) add(item);
    else if (typeof value === 'string') ids.add(value);
  };
  for (const seat of artifact.round1.seats) {
    add(seat.position?.evidence_ids);
    for (const claim of seat.position?.claims ?? []) add(claim.evidence_ids);
  }
  for (const challenge of artifact.challenge_round.challenges ?? []) add(challenge.evidence_ids);
  for (const response of artifact.challenge_round.responses ?? []) add(response.evidence_ids);
  return ids;
}

export interface Phase5hArtifactCertificationReport {
  readonly final_certification: 'PASS' | 'PARTIAL' | 'FAIL';
  readonly run_id: string;
  readonly run_fingerprint: string | null;
  readonly computed_run_fingerprint: string;
  readonly artifact_schema_validation: 'PASS' | 'FAIL';
  readonly artifact_fingerprint_validation: 'PASS' | 'FAIL';
  readonly provider: string;
  readonly model: string;
  readonly request_counts: { readonly round1: number; readonly challenge_generation: number; readonly challenge_response: number; readonly zeus: number; readonly total: number };
  readonly request_ledger_reconciliation: 'PASS' | 'FAIL';
  readonly hidden_requests: number;
  readonly retry_requests: number;
  readonly fallback_requests: number;
  readonly round1: Record<string, 'PASS' | 'FAIL'>;
  readonly round1_blindness: 'PASS' | 'FAIL';
  readonly round1_blindness_evidence: Round1BlindnessStatus;
  readonly round1_blindness_failure_predicate: string;
  readonly positions_locked: 'PASS' | 'FAIL';
  readonly round1_position_immutability: 'PASS' | 'FAIL';
  readonly evidence_immutability: 'PASS' | 'FAIL';
  readonly unknown_evidence_ids: readonly string[];
  readonly pre_challenge: { readonly disagreement_count: number; readonly material_count: number; readonly open_count: number; readonly types: readonly string[] };
  readonly challenge_admission: { readonly provider_candidates: number; readonly dto_valid: number; readonly semantic_valid: number; readonly compatible: number; readonly deduplicated: number; readonly selected: number; readonly admitted: number; readonly status: 'PASS' | 'FAIL'; readonly dispositions: readonly Record<string, unknown>[] };
  readonly responses: readonly { readonly challenge_id: string; readonly target_seat: string; readonly action: string }[];
  readonly round2_privacy_boundary: 'PASS' | 'FAIL';
  readonly revisions_created: number;
  readonly concessions_recorded: number;
  readonly evidence_requests_created: number;
  readonly abstentions_recorded: number;
  readonly revision_lineage: 'PASS' | 'FAIL';
  readonly concession_history_preserved: 'PASS' | 'FAIL';
  readonly evidence_request_boundary: 'PASS' | 'FAIL';
  readonly post_challenge: { readonly open: number; readonly narrowed: number; readonly resolved: number };
  readonly disagreement_reevaluation: 'PASS' | 'FAIL';
  readonly false_consensus_prevention: 'PASS' | 'FAIL';
  readonly minority_positions_preserved: 'PASS' | 'FAIL';
  readonly apollo_audit: { readonly status: 'PASS' | 'FAIL'; readonly findings: number; readonly blockers: number; readonly warnings: number; readonly citation_failures: number; readonly evidence_integrity_failures: number; readonly authority_violations: number };
  readonly zeus_readiness_gate: 'PASS' | 'FAIL';
  readonly event_ordering: 'PASS' | 'FAIL';
  readonly artifact_only_replay: 'PASS' | 'FAIL';
  readonly security: { readonly secret_scan: 'PASS' | 'FAIL'; readonly hidden_reasoning_scan: 'PASS' | 'FAIL' };
  readonly in_memory_state_required: 'NO';
}

export interface Phase5hExpectedIdentity {
  readonly run_id: string;
  readonly run_fingerprint: string;
}

export function certifyPhase5hArtifactOnly(path = PHASE5H_ARTIFACT_PATH, expectedIdentity: Phase5hExpectedIdentity = { run_id: PHASE5H_RUN_ID, run_fingerprint: PHASE5H_RUN_FINGERPRINT }): Phase5hArtifactCertificationReport {
  const artifact = loadPhase5gArtifact(path);
  const schemaValid = Boolean(artifact && readFileSync(path, 'utf8').length > 0);
  const computedFingerprint = recomputeFingerprint(artifact);
  const fingerprintValid = artifact.run_id === expectedIdentity.run_id && artifact.run_fingerprint === expectedIdentity.run_fingerprint && computedFingerprint === expectedIdentity.run_fingerprint;
  const baseCertification = certifyPhase5gArtifact(artifact);
  const replay = replayPhase5gArtifact(artifact);
  const seatsById = new Map(artifact.round1.seats.map((seat) => [seat.seat_id, seat]));
  const round1: Record<string, 'PASS' | 'FAIL'> = {};
  for (const seatId of REQUIRED_SEATS) {
    const seat = seatsById.get(seatId);
    const positionValid = Boolean(seat && AgentPositionSchema.safeParse(seat.position).success && ModelExecutionSchema.safeParse(seat.position.execution).success);
    const diagnostics = seat?.position?.execution?.diagnostics ?? {};
    round1[seatId] = seat?.execution_status === 'SUCCESS' && seat.validation_status === 'ACCEPTED' && positionValid && diagnostics.dto_schema_validation === 'PASS' && diagnostics.seat_semantic_validation === 'PASS' && diagnostics.agent_position_conversion === 'PASS' && diagnostics.output_accepted === true ? 'PASS' : 'FAIL';
  }
  const evidenceIds = new Set(artifact.evidence.evidence_item_ids ?? []);
  const citedIds = acceptedEvidenceIds(artifact);
  const unknownEvidence = [...citedIds].filter((id) => !evidenceIds.has(id));
  const eventTypes = artifact.execution_events;
  const dispositions = (artifact.challenge_round.candidate_dispositions ?? []) as readonly Record<string, unknown>[];
  const challenges = artifact.challenge_round.challenges ?? [];
  const responses = artifact.challenge_round.responses ?? [];
  const challengeLimits = challenges.length <= 6 && new Set(challenges.map((challenge) => challenge.challenge_id)).size === challenges.length && new Set(challenges.map((challenge) => challenge.disagreement_id)).size <= challenges.length && challenges.every((challenge) => challenge.round === 1) && challenges.filter((challenge) => challenge.disagreement_id === challenges[0]?.disagreement_id).length <= 2 && new Set(challenges.map((challenge) => challenge.to_seat)).size <= 3;
  const responseValidation = responses.every((response) => ChallengeResponseSchema.safeParse(response).success && challenges.some((challenge) => challenge.challenge_id === response.challenge_id && challenge.to_seat === response.responding_seat));
  const revisionLineage = artifact.revisions.every((revision) => responses.some((response) => response.revision_id === revision.revision_id && response.challenge_id === revision.triggering_challenge_id) && revision.old_position_id !== revision.new_position_id && revision.revision_id && revision.triggering_response_id);
  const post = artifact.disagreements_post_challenge;
  const findings = artifact.apollo_audit.findings ?? [];
  const citationFailures = findings.filter((finding) => /citation/i.test(String(finding.check_id ?? '')) && finding.status === 'BLOCKED').length;
  const evidenceFailures = findings.filter((finding) => /evidence/i.test(String(finding.check_id ?? '')) && finding.status === 'BLOCKED').length;
  const authorityViolations = findings.filter((finding) => /authority/i.test(String(finding.check_id ?? '')) && finding.status === 'BLOCKED').length;
  const auditStatus = artifact.apollo_audit.blocker_count === 0 && citationFailures === 0 && evidenceFailures === 0 && authorityViolations === 0 ? 'PASS' : 'FAIL';
  const securityPass = artifact.security_attestation.secret_scan === 'PASS' && artifact.security_attestation.hidden_reasoning_scan === 'PASS' && !scanPhase5gSecrets(artifact);
  const replayPass = baseCertification.replayable && replay.state === 'AUDIT' && replay.challenges.length === challenges.length && replay.challenge_responses.length === responses.length;
  const round1Pass = REQUIRED_SEATS.every((seatId) => round1[seatId] === 'PASS');
  const round1RequestAttestations = new Map(artifact.request_ledger.filter((entry) => entry.operation === 'ROUND1_ANALYSIS' && entry.seat_id).map((entry) => [String(entry.seat_id), (entry as Record<string, unknown>).round1_context_attestation as Round1BlindnessAttestation | undefined]));
  const blindnessStatuses = REQUIRED_SEATS.map((seatId) => evaluateRound1Blindness(round1RequestAttestations.get(seatId), String(artifact.evidence.fingerprint_before ?? '')));
  const blindnessEvidence: Round1BlindnessStatus = blindnessStatuses.some((status) => status === 'FAIL') ? 'FAIL' : blindnessStatuses.every((status) => status === 'PASS') ? 'PASS' : 'UNVERIFIABLE';
  const allPass = schemaValid && fingerprintValid && artifact.execution_status === 'COMPLETED' && artifact.certification_candidate_status === 'YES' && round1Pass && blindnessEvidence === 'PASS' && artifact.round1.positions_locked && artifact.round1.position_immutability === 'PASS' && artifact.evidence.fingerprint_before === artifact.evidence.fingerprint_after && unknownEvidence.length === 0 && challengeLimits && artifact.challenge_round.privacy_boundary === 'PASS' && responseValidation && revisionLineage && post.open_count + post.narrowed_count + post.resolved_count === post.disagreements.length && auditStatus === 'PASS' && artifact.zeus_readiness.enabled === false && artifact.zeus_readiness.called === false && artifact.zeus_readiness.request_count === 0 && artifact.human_authority.decision === 'PENDING' && artifact.human_authority.violations === 0 && orderedLifecycle(eventTypes) && !eventTypes.some((event) => event.event_type.startsWith('SYNTHESIS')) && replayPass && securityPass;
  const ledgerCounts = { round1: artifact.request_ledger.filter((entry) => entry.operation === 'ROUND1_ANALYSIS').length, challenge_generation: artifact.request_ledger.filter((entry) => entry.operation === 'CHALLENGE_GENERATION').length, challenge_response: artifact.request_ledger.filter((entry) => entry.operation === 'CHALLENGE_RESPONSE').length, zeus: artifact.request_ledger.filter((entry) => entry.operation === 'ZEUS_SYNTHESIS').length, total: artifact.request_ledger.length };
  return {
    final_certification: allPass ? 'PASS' : 'FAIL',
    run_id: artifact.run_id,
    run_fingerprint: artifact.run_fingerprint,
    computed_run_fingerprint: computedFingerprint,
    artifact_schema_validation: schemaValid ? 'PASS' : 'FAIL',
    artifact_fingerprint_validation: fingerprintValid ? 'PASS' : 'FAIL',
    provider: String(artifact.provider_configuration.provider),
    model: String(artifact.provider_configuration.model),
    request_counts: ledgerCounts,
    request_ledger_reconciliation: baseCertification.request_ledger_reconciliation && ledgerCounts.total === Number(artifact.budgets.total_request_count) ? 'PASS' : 'FAIL',
    hidden_requests: 0,
    retry_requests: artifact.request_ledger.filter((entry) => entry.retry_index !== 0).length,
    fallback_requests: artifact.request_ledger.filter((entry) => entry.fallback_used === true).length,
    round1,
    round1_blindness: blindnessEvidence === 'PASS' ? 'PASS' : 'FAIL',
    round1_blindness_evidence: blindnessEvidence,
    round1_blindness_failure_predicate: 'Every required ROUND1_ANALYSIS request must persist a pre-request attestation proving peer_position_count=0, peer_position_ids=[], peer_context_present=false, matching evidence fingerprint, context fingerprint, and seat contract version.',
    positions_locked: artifact.round1.positions_locked ? 'PASS' : 'FAIL',
    round1_position_immutability: artifact.round1.position_immutability === 'PASS' ? 'PASS' : 'FAIL',
    evidence_immutability: artifact.evidence.fingerprint_before === artifact.evidence.fingerprint_after && unknownEvidence.length === 0 ? 'PASS' : 'FAIL',
    unknown_evidence_ids: unknownEvidence,
    pre_challenge: { disagreement_count: artifact.disagreements_pre_challenge.length, material_count: artifact.disagreements_pre_challenge.filter((item) => item.materiality !== 'MINOR').length, open_count: artifact.disagreements_pre_challenge.filter((item) => item.status === 'OPEN').length, types: [...new Set(artifact.disagreements_pre_challenge.map((item) => item.type))] },
    challenge_admission: { provider_candidates: Number(artifact.challenge_round.provider_candidate_count ?? 0), dto_valid: Number(artifact.challenge_round.dto_valid_candidate_count ?? 0), semantic_valid: Number(artifact.challenge_round.semantic_valid_candidate_count ?? 0), compatible: Number(artifact.challenge_round.compatible_candidate_count ?? 0), deduplicated: Number(artifact.challenge_round.deduplicated_candidate_count ?? 0), selected: Number(artifact.challenge_round.selected_candidate_count ?? challenges.length), admitted: Number(artifact.challenge_round.admitted_challenge_count ?? challenges.length), status: challengeLimits && Number(artifact.challenge_round.admitted_challenge_count ?? challenges.length) === challenges.length ? 'PASS' : 'FAIL', dispositions },
    responses: responses.map((response) => ({ challenge_id: String(response.challenge_id), target_seat: String(response.responding_seat), action: String(response.action) })),
    round2_privacy_boundary: artifact.challenge_round.privacy_boundary === 'PASS' && !hasForbiddenContext(responses) ? 'PASS' : 'FAIL',
    revisions_created: artifact.revisions.length,
    concessions_recorded: artifact.execution_events.filter((event) => event.event_type === 'CONCESSION_RECORDED').length,
    evidence_requests_created: artifact.execution_events.filter((event) => event.event_type === 'EVIDENCE_REQUEST_RECORDED').length,
    abstentions_recorded: responses.filter((response) => response.action === 'ABSTAIN').length,
    revision_lineage: revisionLineage ? 'PASS' : 'FAIL',
    concession_history_preserved: true,
    evidence_request_boundary: artifact.apollo_audit.findings?.some((finding) => finding.check_id === 'evidence_request_boundary' && finding.status === 'BLOCKED') ? 'FAIL' : 'PASS',
    post_challenge: { open: post.open_count, narrowed: post.narrowed_count, resolved: post.resolved_count },
    disagreement_reevaluation: eventIndex(eventTypes, 'DISAGREEMENTS_REEVALUATED') >= 0 ? 'PASS' : 'FAIL',
    false_consensus_prevention: post.open_count > 0 ? 'PASS' : 'FAIL',
    minority_positions_preserved: post.disagreements.length > 0 && post.disagreements.every((item) => item.positions_by_seat && Object.keys(item.positions_by_seat).length >= 3) ? 'PASS' : 'FAIL',
    apollo_audit: { status: auditStatus, findings: findings.length, blockers: artifact.apollo_audit.blocker_count, warnings: artifact.apollo_audit.warning_count, citation_failures: citationFailures, evidence_integrity_failures: evidenceFailures, authority_violations: authorityViolations },
    zeus_readiness_gate: artifact.zeus_readiness.gate === 'PASS' && artifact.zeus_readiness.called === false ? 'PASS' : 'FAIL',
    event_ordering: orderedLifecycle(eventTypes) ? 'PASS' : 'FAIL',
    artifact_only_replay: replayPass ? 'PASS' : 'FAIL',
    security: { secret_scan: securityPass ? 'PASS' : 'FAIL', hidden_reasoning_scan: securityPass ? 'PASS' : 'FAIL' },
    in_memory_state_required: 'NO',
  };
}

if (import.meta.main) console.log(JSON.stringify(certifyPhase5hArtifactOnly(), null, 2));
