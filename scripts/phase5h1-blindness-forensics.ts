export interface Round1BlindnessAttestation {
  readonly seat_id: string;
  readonly round: 1;
  readonly peer_position_count: number;
  readonly peer_position_ids: readonly string[];
  readonly peer_context_present: boolean;
  readonly peer_reasoning_present?: boolean;
  readonly evidence_fingerprint: string;
  readonly request_context_fingerprint: string;
  readonly seat_contract_version: string;
}

export type Round1BlindnessStatus = 'PASS' | 'FAIL' | 'UNVERIFIABLE';

/** Evaluates only the pre-request context attestation. Position validity and
 * later Apollo audit state are deliberately not inputs to this predicate. */
export function evaluateRound1Blindness(attestation: Round1BlindnessAttestation | null | undefined, expectedEvidenceFingerprint: string): Round1BlindnessStatus {
  if (!attestation) return 'UNVERIFIABLE';
  if (attestation.peer_position_count !== 0 || attestation.peer_position_ids.length !== 0 || attestation.peer_context_present || attestation.peer_reasoning_present === true) return 'FAIL';
  if (!attestation.seat_id || attestation.round !== 1 || !attestation.evidence_fingerprint || attestation.evidence_fingerprint !== expectedEvidenceFingerprint || !attestation.request_context_fingerprint || !attestation.seat_contract_version) return 'UNVERIFIABLE';
  return 'PASS';
}
