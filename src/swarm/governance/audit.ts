import { ROUND1_SEAT_IDS, type AuditFinding, type AgentPosition, type SwarmBlackboard } from '../contracts';
import { currentPositions } from '../debate/disagreements';
import { verifyEvidencePackage } from './verifier';

const FORBIDDEN_AUTHORITY = /\b(?:approve|reject)\s+(?:deployment|release|the\s+decision)|\blegal(?:ly)?\s+compliant\b|\bregulatory\s+cert(?:if|ainty)|\bfinal\s+decision\b/i;

function finding(index: number, value: Omit<AuditFinding, 'finding_id'>): AuditFinding {
  return { ...value, finding_id: `audit-${index + 1}` as AuditFinding['finding_id'] };
}

function positionsWithForbiddenAuthority(positions: readonly AgentPosition[]): AgentPosition[] {
  return positions.filter((position) => FORBIDDEN_AUTHORITY.test([position.conclusion, position.recommendation ?? '', ...position.claims.map((claim) => claim.statement)].join(' ')));
}

/** Deterministic Apollo verification. It checks protocol facts and never calls a model. */
export function runApolloDeterministicAudit(state: SwarmBlackboard): AuditFinding[] {
  if (!state.case || !state.evidence_package) throw new Error('AUDIT_REQUIRES_SEALED_CASE');
  const findings: AuditFinding[] = [];
  const positions = currentPositions(state);
  const packageReport = verifyEvidencePackage(state.evidence_package);
  findings.push(finding(findings.length, {
    case_id: state.case.case_id,
    check_id: 'evidence_package_integrity',
    source: 'DETERMINISTIC',
    status: packageReport.ok ? 'VERIFIED' : 'BLOCKED',
    subject_ids: [],
    evidence_ids: [],
    detail: packageReport.ok ? 'Sealed evidence package hash and immutability checks passed.' : 'Evidence package hash or immutability check failed.',
    remediation: packageReport.ok ? null : 'Discard the corrupted projection and rebuild from a trusted seal event.',
  }));

  const knownEvidence = new Set(state.evidence_package.items.map((item) => item.evidence_id));
  const citationValid = positions.every((position) => [
    ...position.evidence_ids,
    ...position.claims.flatMap((claim) => claim.evidence_ids),
    ...position.risk_findings.flatMap((risk) => risk.evidence_ids),
    ...position.control_gaps.flatMap((gap) => gap.evidence_ids),
    ...position.evidence_requests.flatMap((request) => request.evidence_ids),
  ].every((evidenceId) => knownEvidence.has(evidenceId)));
  findings.push(finding(findings.length, {
    case_id: state.case.case_id,
    check_id: 'citation_integrity',
    source: 'DETERMINISTIC',
    status: citationValid ? 'VERIFIED' : 'BLOCKED',
    subject_ids: positions.map((position) => position.position_id),
    evidence_ids: positions.flatMap((position) => position.evidence_ids.filter((evidenceId) => knownEvidence.has(evidenceId))),
    detail: citationValid ? 'All accepted position, claim, finding, control, and request citations resolve in the sealed package.' : 'An accepted structured field cites evidence outside the sealed package.',
    remediation: citationValid ? null : 'Reject the candidate and preserve the package boundary.',
  }));

  const startedSeats: readonly string[] = state.execution_events.filter((event) => event.type === 'SEAT_STARTED').map((event) => event.seat_id);
  const blindDispatchValid = startedSeats.length === ROUND1_SEAT_IDS.length && ROUND1_SEAT_IDS.every((seat) => startedSeats.filter((started) => started === seat).length === 1) && !startedSeats.includes('ZEUS');
  findings.push(finding(findings.length, {
    case_id: state.case.case_id,
    check_id: 'round1_blind_dispatch',
    source: 'DETERMINISTIC',
    status: blindDispatchValid ? 'VERIFIED' : 'BLOCKED',
    subject_ids: [],
    evidence_ids: [],
    detail: blindDispatchValid ? 'Round 1 dispatch records exactly the four eligible seats and excludes Zeus.' : 'Round 1 dispatch metadata does not match the eligible seat set.',
    remediation: blindDispatchValid ? null : 'Rebuild the run from the sealed snapshot with the stable Round 1 roster.',
  }));

  const lineageValid = state.revisions.every((revision) => state.positions.some((position) => position.position_id === revision.old_position_id) && state.positions.some((position) => position.position_id === revision.new_position_id) && state.challenges.some((challenge) => challenge.challenge_id === revision.triggering_challenge_id) && state.challenge_responses.some((response) => response.response_id === revision.triggering_response_id));
  findings.push(finding(findings.length, {
    case_id: state.case.case_id,
    check_id: 'revision_lineage_integrity',
    source: 'DETERMINISTIC',
    status: lineageValid ? 'VERIFIED' : 'BLOCKED',
    subject_ids: state.revisions.map((revision) => revision.new_position_id),
    evidence_ids: [],
    detail: lineageValid ? 'Every revision preserves old position, new position, challenge, and response references.' : 'A revision lineage reference is incomplete.',
    remediation: lineageValid ? null : 'Reject the incomplete revision and retain the prior position.',
  }));

  const budgetsValid = state.challenges.length <= state.case.policy.max_challenges && state.revisions.length <= state.case.policy.max_revisions && state.challenges.every((challenge) => challenge.round <= state.case!.policy.max_challenge_rounds);
  findings.push(finding(findings.length, {
    case_id: state.case.case_id,
    check_id: 'protocol_budget_integrity',
    source: 'DETERMINISTIC',
    status: budgetsValid ? 'VERIFIED' : 'BLOCKED',
    subject_ids: state.challenges.map((challenge) => challenge.challenge_id),
    evidence_ids: [],
    detail: budgetsValid ? 'Challenge, revision, and challenge-round counts remain within policy bounds.' : 'A protocol count exceeds its configured policy budget.',
    remediation: budgetsValid ? null : 'Stop the run and preserve the bounded event log for review.',
  }));

  const invalidAuthority = positionsWithForbiddenAuthority(positions);
  findings.push(finding(findings.length, {
    case_id: state.case.case_id,
    check_id: 'seat_authority_boundaries',
    source: 'DETERMINISTIC',
    status: invalidAuthority.length === 0 ? 'VERIFIED' : 'BLOCKED',
    subject_ids: invalidAuthority.map((position) => position.position_id),
    evidence_ids: invalidAuthority.flatMap((position) => position.evidence_ids),
    detail: invalidAuthority.length === 0 ? 'No accepted position claims human or regulatory decision authority.' : 'An accepted position contains forbidden decision or compliance authority language.',
    remediation: invalidAuthority.length === 0 ? null : 'Reject the position and keep the human decision boundary outside the seats.',
  }));

  const missing = Object.values(state.seat_execution_state).filter((seat) => seat.status !== 'SUCCESS');
  findings.push(finding(findings.length, {
    case_id: state.case.case_id,
    check_id: 'seat_participation_truth',
    source: 'DETERMINISTIC',
    status: missing.length === 0 ? 'VERIFIED' : 'WARNING',
    subject_ids: [],
    evidence_ids: [],
    detail: missing.length === 0 ? 'All eligible Round 1 seats completed independent positions.' : `${missing.length} eligible seat(s) did not complete a successful position; no missing seat was counted as a vote.`,
    remediation: missing.length === 0 ? null : 'Disclose incomplete participation in every synthesis.',
  }));

  const requests = state.evidence_requests.length;
  findings.push(finding(findings.length, {
    case_id: state.case.case_id,
    check_id: 'evidence_request_boundary',
    source: 'DETERMINISTIC',
    status: requests === 0 ? 'VERIFIED' : 'WARNING',
    subject_ids: [],
    evidence_ids: state.evidence_requests.flatMap((request) => request.evidence_ids),
    detail: requests === 0 ? 'No retrieval request was silently applied to the sealed package.' : `${requests} evidence request(s) remain unresolved and did not mutate the sealed package.`,
    remediation: requests === 0 ? null : 'Resolve or disclose the request in a future explicit evidence-package transition.',
  }));

  const openDisagreements = state.disagreements.filter((disagreement) => disagreement.unresolved && disagreement.materiality !== 'MINOR');
  findings.push(finding(findings.length, {
    case_id: state.case.case_id,
    check_id: 'unresolved_disagreement_preservation',
    source: 'DETERMINISTIC',
    status: openDisagreements.length === 0 ? 'VERIFIED' : 'WARNING',
    subject_ids: openDisagreements.map((disagreement) => disagreement.disagreement_id),
    evidence_ids: openDisagreements.flatMap((disagreement) => disagreement.evidence_ids),
    detail: openDisagreements.length === 0 ? 'No material unresolved disagreement was dropped.' : `${openDisagreements.length} material disagreement(s) remain unresolved and must reach synthesis.`,
    remediation: openDisagreements.length === 0 ? null : 'Preserve each disagreement and its minority positions in the synthesis.',
  }));

  const sharedUnsupportedAssumption = positions.length >= 2 && positions.every((position) => position.assumptions.length > 0 && position.evidence_ids.length === 0 && position.assumptions[0] === positions[0]!.assumptions[0]);
  if (sharedUnsupportedAssumption) {
    findings.push(finding(findings.length, {
      case_id: state.case.case_id,
      check_id: 'shared_unsupported_assumption',
      source: 'DETERMINISTIC',
      status: 'BLOCKED',
      subject_ids: positions.map((position) => position.position_id),
      evidence_ids: [],
      detail: 'Agreement rests on a shared assumption with no cited evidence; agreement is not evidential support.',
      remediation: 'Obtain supporting evidence or preserve the result as unresolved.',
    }));
  }

  const riskGroups = new Map<AgentPosition['risk_level'], AgentPosition[]>();
  for (const position of positions) riskGroups.set(position.risk_level, [...(riskGroups.get(position.risk_level) ?? []), position]);
  const majorityRisk = [...riskGroups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  if (majorityRisk && majorityRisk[1].length > positions.length / 2) {
    const supportedMinority = positions.some((position) => position.risk_level !== majorityRisk[0] && position.evidence_ids.length > 0);
    const unsupportedMajority = majorityRisk[1].every((position) => position.evidence_ids.length === 0 && position.assumptions.length > 0);
    if (supportedMinority && unsupportedMajority) {
      findings.push(finding(findings.length, {
        case_id: state.case.case_id,
        check_id: 'majority_basis_integrity',
        source: 'DETERMINISTIC',
        status: 'BLOCKED',
        subject_ids: majorityRisk[1].map((position) => position.position_id),
        evidence_ids: positions.filter((position) => position.risk_level !== majorityRisk[0]).flatMap((position) => position.evidence_ids),
        detail: 'The numerical majority is unsupported while a minority position cites evidence; majority size is not proof.',
        remediation: 'Preserve the supported minority and require human review of the evidential conflict.',
      }));
    }
  }

  const totalSuccess = positions.every((position) => position.execution.status === 'SUCCESS');
  findings.push(finding(findings.length, {
    case_id: state.case.case_id,
    check_id: 'round1_execution_truth',
    source: 'DETERMINISTIC',
    status: totalSuccess ? 'VERIFIED' : 'WARNING',
    subject_ids: positions.map((position) => position.position_id),
    evidence_ids: positions.flatMap((position) => position.evidence_ids),
    detail: totalSuccess ? 'All accepted positions carry successful independent execution truth.' : 'The projection preserves missing or non-successful seat execution state without fabricating a position.',
    remediation: totalSuccess ? null : 'Do not interpret missing seats as semantic agreement.',
  }));
  return findings;
}
