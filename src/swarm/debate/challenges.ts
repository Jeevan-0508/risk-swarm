import { ChallengeSchema, type AgentPosition, type Challenge, type Disagreement, type Round1SeatId, type SwarmBlackboard, type SwarmCase } from '../contracts';
import { RUNTIME_SEATS } from '../seats/definitions';

export const CHALLENGE_PRIORITY: readonly Disagreement['type'][] = ['EVIDENCE_INTERPRETATION', 'RISK_RATING', 'ASSUMPTION', 'CONTROL_EFFECTIVENESS', 'RECOMMENDATION', 'CONFIDENCE', 'CAUSAL', 'SCOPE'];

/**
 * Canonical semantic compatibility contract. A disagreement is challenged
 * along its own protocol dimension; a model may not relabel the selected
 * disagreement as a different dimension. A later protocol step may surface
 * a newly identified dimension as a separate disagreement.
 */
export const PHASE5_DISAGREEMENT_CHALLENGE_COMPATIBILITY = Object.freeze({
  RISK_RATING: ['SEVERITY'],
  CAUSAL: ['CAUSAL'],
  EVIDENCE_INTERPRETATION: ['EVIDENCE'],
  CONTROL_EFFECTIVENESS: ['CONTROL'],
  SCOPE: ['SCOPE'],
  ASSUMPTION: ['ASSUMPTION'],
  CONFIDENCE: ['CONFIDENCE'],
  RECOMMENDATION: ['RECOMMENDATION'],
} as const satisfies Readonly<Record<Disagreement['type'], readonly Challenge['challenge_type'][]>>);

export const PHASE5_CHALLENGE_COMPATIBILITY_SOURCE = 'src/swarm/debate/challenges.ts#allowedChallengeTypesForDisagreement' as const;

export function allowedChallengeTypesForDisagreement(type: Disagreement['type']): readonly Challenge['challenge_type'][] {
  return PHASE5_DISAGREEMENT_CHALLENGE_COMPATIBILITY[type];
}

export function challengeTypeCompatible(disagreementType: Disagreement['type'], challengeType: Challenge['challenge_type']): boolean {
  return allowedChallengeTypesForDisagreement(disagreementType).includes(challengeType);
}

function preferredChallenger(type: Disagreement['type'], positions: readonly AgentPosition[]): AgentPosition | undefined {
  const preferred: Record<Disagreement['type'], Round1SeatId[]> = {
    EVIDENCE_INTERPRETATION: ['APOLLO', 'ARES', 'ATHENA', 'HADES'],
    RISK_RATING: ['ARES', 'HADES', 'APOLLO', 'ATHENA'],
    ASSUMPTION: ['ARES', 'APOLLO', 'ATHENA', 'HADES'],
    CONTROL_EFFECTIVENESS: ['HADES', 'ARES', 'APOLLO', 'ATHENA'],
    RECOMMENDATION: ['ARES', 'HADES', 'APOLLO', 'ATHENA'],
    CONFIDENCE: ['ARES', 'APOLLO', 'ATHENA', 'HADES'],
    CAUSAL: ['ARES', 'ATHENA', 'APOLLO', 'HADES'],
    SCOPE: ['APOLLO', 'ARES', 'ATHENA', 'HADES'],
  };
  for (const seat of preferred[type]) {
    const found = positions.find((position) => position.seat_id === seat);
    if (found) return found;
  }
  return positions[0];
}

function targetFor(challenger: AgentPosition, disagreement: Disagreement, positions: readonly AgentPosition[]): AgentPosition | undefined {
  const candidates = positions.filter((position) => position.position_id !== challenger.position_id && disagreement.positions_by_seat[position.seat_id] !== undefined);
  return [...candidates].sort((a, b) => Math.abs((b.confidence ?? 0) - (challenger.confidence ?? 0)) - Math.abs((a.confidence ?? 0) - (challenger.confidence ?? 0)) || a.seat_id.localeCompare(b.seat_id))[0];
}

function targetClaim(target: AgentPosition, type: Disagreement['type']): string | null {
  if (type === 'EVIDENCE_INTERPRETATION' || type === 'ASSUMPTION' || type === 'CAUSAL') return target.claims[0]?.claim_id ?? null;
  return target.claims[0]?.claim_id ?? null;
}

function challengeType(type: Disagreement['type']): Challenge['challenge_type'] {
  return allowedChallengeTypesForDisagreement(type)[0]!;
}

/**
 * Duplicate protection is about the semantic challenge target, not merely
 * the disagreement being examined. Two seats may legitimately be challenged
 * about one disagreement; the same seat/target/purpose may not be emitted
 * twice.
 */
export function challengeDuplicateIdentity(challenge: Challenge): string {
  const targetId = challenge.target_type === 'CLAIM'
    ? challenge.target_claim
    : challenge.target_type === 'DISAGREEMENT'
      ? challenge.disagreement_id
      : challenge.target_position;
  return JSON.stringify([
    challenge.disagreement_id ?? null,
    challenge.target_position,
    challenge.target_type ?? null,
    targetId ?? null,
    challenge.challenge_type,
    challenge.requested_action ?? null,
  ]);
}

export function planChallenges(
  positions: readonly AgentPosition[],
  disagreements: readonly Disagreement[],
  caseValue: SwarmCase,
): Challenge[] {
  const sorted = [...disagreements].sort((a, b) => CHALLENGE_PRIORITY.indexOf(a.type) - CHALLENGE_PRIORITY.indexOf(b.type) || a.disagreement_id.localeCompare(b.disagreement_id));
  const challenges: Challenge[] = [];
  for (const disagreement of sorted) {
    if (challenges.length >= caseValue.policy.max_challenges) break;
    const challenger = preferredChallenger(disagreement.type, positions);
    if (!challenger) continue;
    const target = targetFor(challenger, disagreement, positions);
    if (!target || target.seat_id === challenger.seat_id) continue;
    const challenge: Challenge = {
      challenge_id: `challenge-${challenges.length + 1}` as Challenge['challenge_id'],
      case_id: caseValue.case_id,
      round: 1,
      from_seat: challenger.seat_id,
      to_seat: target.seat_id,
      target_position: target.position_id,
      target_claim: targetClaim(target, disagreement.type) as Challenge['target_claim'],
      challenge_type: challengeType(disagreement.type),
      reasoning: `${RUNTIME_SEATS[challenger.seat_id].display_name} challenges ${RUNTIME_SEATS[target.seat_id].display_name}: ${disagreement.basis}`,
      evidence_ids: [...disagreement.evidence_ids],
    };
    challenges.push(challenge);
  }
  return challenges;
}

export const PHASE5_MAX_CHALLENGE_ROUNDS = 1 as const;
export const PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT = 2 as const;
export const PHASE5_MAX_TOTAL_CHALLENGES = 6 as const;
export const PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT = 3 as const;

export const PHASE5_SELECTION_PRIORITY: readonly Disagreement['type'][] = ['RISK_RATING', 'CONTROL_EFFECTIVENESS', 'EVIDENCE_INTERPRETATION', 'CONFIDENCE', 'ASSUMPTION', 'RECOMMENDATION', 'CAUSAL', 'SCOPE'];

export type Phase5ChallengeCandidateDisposition = 'ADMITTED' | 'NOT_SELECTED' | 'DUPLICATE_REJECTED' | 'INCOMPATIBLE_REJECTED' | 'SEMANTIC_REJECTED' | 'BUDGET_REJECTED';

export interface Phase5ChallengeCandidateRecord {
  readonly candidate_index: number;
  readonly challenge_id: string;
  readonly disagreement_id: string | null;
  readonly to_seat: string | null;
  readonly target_seat: string | null;
  readonly target_position: string | null;
  readonly target_position_id: string | null;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly challenge_type: string | null;
  readonly requested_action: string | null;
  readonly evidence_reference_count: number;
  readonly disposition: Phase5ChallengeCandidateDisposition;
  readonly reason: string;
}

export interface Phase5ChallengeAdmissionResult {
  readonly candidates: readonly Challenge[];
  readonly admitted: readonly Challenge[];
  readonly dispositions: readonly Phase5ChallengeCandidateRecord[];
  readonly counts: {
    readonly provider_candidate_count: number;
    readonly dto_valid_candidate_count: number;
    readonly semantic_valid_candidate_count: number;
    readonly compatible_candidate_count: number;
    readonly deduplicated_candidate_count: number;
    readonly selected_candidate_count: number;
    readonly admitted_challenge_count: number;
  };
}

function candidateRecord(challenge: Partial<Challenge>, candidate_index: number, disposition: Phase5ChallengeCandidateDisposition, reason: string): Phase5ChallengeCandidateRecord {
  const target_type = typeof challenge.target_type === 'string' ? challenge.target_type : null;
  const target_id = target_type === 'CLAIM'
    ? (typeof challenge.target_claim === 'string' ? challenge.target_claim : null)
    : target_type === 'DISAGREEMENT'
      ? (typeof challenge.disagreement_id === 'string' ? challenge.disagreement_id : null)
      : (typeof challenge.target_position === 'string' ? challenge.target_position : null);
  return {
    candidate_index,
    challenge_id: typeof challenge.challenge_id === 'string' ? challenge.challenge_id : `candidate-${candidate_index + 1}`,
    disagreement_id: typeof challenge.disagreement_id === 'string' ? challenge.disagreement_id : null,
    to_seat: typeof challenge.to_seat === 'string' ? challenge.to_seat : null,
    target_seat: typeof challenge.to_seat === 'string' ? challenge.to_seat : null,
    target_position: typeof challenge.target_position === 'string' ? challenge.target_position : null,
    target_position_id: typeof challenge.target_position === 'string' ? challenge.target_position : null,
    target_type,
    target_id,
    challenge_type: typeof challenge.challenge_type === 'string' ? challenge.challenge_type : null,
    requested_action: typeof challenge.requested_action === 'string' ? challenge.requested_action : null,
    evidence_reference_count: Array.isArray(challenge.evidence_ids) ? challenge.evidence_ids.length : 0,
    disposition,
    reason,
  };
}

function challengeSelectionKey(challenge: Challenge, disagreementType: Disagreement['type']): string {
  return JSON.stringify([
    PHASE5_SELECTION_PRIORITY.indexOf(disagreementType),
    challenge.disagreement_id ?? '',
    challenge.to_seat,
    challenge.target_position,
    challenge.target_type ?? '',
    challenge.target_claim ?? '',
    challenge.challenge_type,
    challenge.requested_action ?? '',
    [...challenge.evidence_ids].sort(),
    challenge.challenge_id,
  ]);
}

function semanticChallengeReason(challenge: Challenge, disagreements: readonly Disagreement[], positions: readonly AgentPosition[], caseValue: SwarmCase): string | null {
  if (challenge.case_id !== caseValue.case_id || challenge.round !== 1 || challenge.from_seat !== 'ARES') return 'CHALLENGE_RUNTIME_AUTHORITY_INVALID';
  if (!challenge.disagreement_id || challenge.target_type === undefined || challenge.requested_action === undefined || !challenge.challenge_text) return 'CHALLENGE_REQUIRED_PHASE5_FIELDS_MISSING';
  const disagreement = disagreements.find((item) => item.disagreement_id === challenge.disagreement_id);
  if (!disagreement || disagreement.case_id !== caseValue.case_id) return 'CHALLENGE_DISAGREEMENT_REFERENCE_INVALID';
  const target = positions.find((position) => position.position_id === challenge.target_position);
  if (!target || target.seat_id !== challenge.to_seat || disagreement.positions_by_seat[target.seat_id] !== target.position_id || target.seat_id === 'ARES') return 'CHALLENGE_TARGET_REFERENCE_INVALID';
  if (challenge.evidence_ids.some((evidenceId) => !disagreement.evidence_ids.includes(evidenceId))) return 'CHALLENGE_EVIDENCE_REFERENCE_INVALID';
  if (challenge.target_type === 'CLAIM') {
    if (!challenge.target_claim || !target.claims.some((claim) => claim.claim_id === challenge.target_claim)) return 'CHALLENGE_CLAIM_REFERENCE_INVALID';
  } else if (challenge.target_type === 'POSITION' && challenge.target_claim !== null) {
    return 'CHALLENGE_POSITION_TARGET_SHAPE_INVALID';
  } else if (challenge.target_type === 'DISAGREEMENT' && (challenge.target_claim !== null || challenge.target_position !== disagreement.positions_by_seat[challenge.to_seat])) {
    return 'CHALLENGE_DISAGREEMENT_TARGET_SHAPE_INVALID';
  }
  return null;
}

/**
 * The sole Phase 5 boundary between provider-generated candidates and
 * CHALLENGE_EMITTED protocol events. Provider order is not authoritative.
 * Every candidate is classified, then only the deterministic admitted subset
 * is handed to the reducer.
 */
export function selectAndAdmitPhase5Challenges(
  candidates: readonly Challenge[],
  disagreements: readonly Disagreement[],
  positions: readonly AgentPosition[],
  caseValue: SwarmCase,
): Phase5ChallengeAdmissionResult {
  const dispositions: Phase5ChallengeCandidateRecord[] = [];
  const dtoValid = candidates.filter((candidate, candidate_index) => {
    const parsed = ChallengeSchema.safeParse(candidate);
    if (!parsed.success) {
      dispositions.push(candidateRecord(candidate, candidate_index, 'SEMANTIC_REJECTED', 'CHALLENGE_DTO_INVALID'));
      return false;
    }
    return true;
  });
  const semanticValid: Challenge[] = [];
  for (const candidate of dtoValid) {
    const reason = semanticChallengeReason(candidate, disagreements, positions, caseValue);
    if (reason) {
      const candidate_index = candidates.indexOf(candidate);
      dispositions.push(candidateRecord(candidate, candidate_index, 'SEMANTIC_REJECTED', reason));
    } else semanticValid.push(candidate);
  }
  const compatible = semanticValid.filter((candidate) => {
    const disagreement = disagreements.find((item) => item.disagreement_id === candidate.disagreement_id)!;
    if (challengeTypeCompatible(disagreement.type, candidate.challenge_type)) return true;
    dispositions.push(candidateRecord(candidate, candidates.indexOf(candidate), 'INCOMPATIBLE_REJECTED', 'CHALLENGE_TYPE_INCOMPATIBLE'));
    return false;
  });
  const sorted = [...compatible].sort((a, b) => {
    const aType = disagreements.find((item) => item.disagreement_id === a.disagreement_id)!.type;
    const bType = disagreements.find((item) => item.disagreement_id === b.disagreement_id)!.type;
    return challengeSelectionKey(a, aType).localeCompare(challengeSelectionKey(b, bType));
  });
  const deduplicated: Challenge[] = [];
  const seen = new Set<string>();
  for (const candidate of sorted) {
    const identity = challengeDuplicateIdentity(candidate);
    if (seen.has(identity)) {
      dispositions.push(candidateRecord(candidate, candidates.indexOf(candidate), 'DUPLICATE_REJECTED', 'CHALLENGE_DUPLICATE_IDENTITY'));
      continue;
    }
    seen.add(identity);
    deduplicated.push(candidate);
  }
  const admitted: Challenge[] = [];
  const perDisagreement = new Map<string, number>();
  const perTargetSeat = new Map<string, number>();
  for (const candidate of deduplicated) {
    const disagreementId = candidate.disagreement_id!;
    const disagreementCount = perDisagreement.get(disagreementId) ?? 0;
    const targetCount = perTargetSeat.get(candidate.to_seat) ?? 0;
    let reason: string | null = null;
    if (admitted.length >= Math.min(PHASE5_MAX_TOTAL_CHALLENGES, caseValue.policy.max_challenges)) reason = 'PHASE5_TOTAL_CHALLENGE_BUDGET';
    else if (disagreementCount >= PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT) reason = 'PHASE5_DISAGREEMENT_CHALLENGE_BUDGET';
    else if (targetCount >= PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT) reason = 'PHASE5_TARGET_SEAT_CHALLENGE_BUDGET';
    if (reason) {
      dispositions.push(candidateRecord(candidate, candidates.indexOf(candidate), 'BUDGET_REJECTED', reason));
      continue;
    }
    admitted.push(candidate);
    perDisagreement.set(disagreementId, disagreementCount + 1);
    perTargetSeat.set(candidate.to_seat, targetCount + 1);
    dispositions.push(candidateRecord(candidate, candidates.indexOf(candidate), 'ADMITTED', 'CANONICAL_SELECTION'));
  }
  dispositions.sort((a, b) => a.candidate_index - b.candidate_index);
  return {
    candidates,
    admitted,
    dispositions,
    counts: {
      provider_candidate_count: candidates.length,
      dto_valid_candidate_count: dtoValid.length,
      semantic_valid_candidate_count: semanticValid.length,
      compatible_candidate_count: compatible.length,
      deduplicated_candidate_count: deduplicated.length,
      selected_candidate_count: admitted.length,
      admitted_challenge_count: admitted.length,
    },
  };
}

/**
 * Phase 5 planner. ARES is the sole primary challenger and the target set is
 * deliberately closed to the three advisory seats that can revise a Round 1
 * position. Priority and IDs are deterministic so the plan is replayable.
 */
export function planPhase5Challenges(
  positions: readonly AgentPosition[],
  disagreements: readonly Disagreement[],
  caseValue: SwarmCase,
): Challenge[] {
  const ares = positions.find((position) => position.seat_id === 'ARES');
  if (!ares || caseValue.policy.max_challenge_rounds < PHASE5_MAX_CHALLENGE_ROUNDS) return [];
  const targets = new Map<Round1SeatId, number>();
  const out: Challenge[] = [];
  const sorted = [...disagreements].sort((a, b) => PHASE5_SELECTION_PRIORITY.indexOf(a.type) - PHASE5_SELECTION_PRIORITY.indexOf(b.type) || a.disagreement_id.localeCompare(b.disagreement_id));
  for (const disagreement of sorted) {
    if (out.length >= PHASE5_MAX_TOTAL_CHALLENGES || out.length >= caseValue.policy.max_challenges) break;
    const eligible = (['ATHENA', 'HADES', 'APOLLO'] as const)
      .filter((seat) => disagreement.positions_by_seat[seat] && (targets.get(seat) ?? 0) < PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT)
      .map((seat) => positions.find((position) => position.seat_id === seat))
      .filter((position): position is AgentPosition => Boolean(position));
    const target = eligible.reduce((best, candidate) => {
      if (!best) return candidate;
      const candidateCount = targets.get(candidate.seat_id) ?? 0;
      const bestCount = targets.get(best.seat_id) ?? 0;
      return candidateCount < bestCount ? candidate : best;
    }, undefined as AgentPosition | undefined);
    if (!target) continue;
    const targetClaim = targetClaimFor(target, disagreement.type);
    const challenge = {
      challenge_id: `challenge-${out.length + 1}` as Challenge['challenge_id'],
      case_id: caseValue.case_id,
      round: 1,
      from_seat: 'ARES' as const,
      to_seat: target.seat_id,
      target_position: target.position_id,
      target_claim: targetClaim as Challenge['target_claim'],
      challenge_type: challengeType(disagreement.type),
      reasoning: `ARES challenges ${RUNTIME_SEATS[target.seat_id].display_name}: ${disagreement.basis}`,
      evidence_ids: [...disagreement.evidence_ids],
      disagreement_id: disagreement.disagreement_id,
      target_type: targetClaim ? 'CLAIM' as const : 'POSITION' as const,
      challenge_text: `Address the ${disagreement.type.toLowerCase()} disagreement using only the sealed evidence and your own Round 1 position.`,
      requested_action: 'DEFEND' as const,
    } satisfies Challenge;
    out.push(challenge);
    targets.set(target.seat_id, (targets.get(target.seat_id) ?? 0) + 1);
  }
  return out;
}

function targetClaimFor(target: AgentPosition, type: Disagreement['type']): string | null {
  return targetClaim(target, type);
}

export function buildChallengeInput(state: Pick<SwarmBlackboard, 'case' | 'evidence_package' | 'positions'>, challenge: Challenge): import('../engine/executor').ChallengeInput {
  if (!state.case || !state.evidence_package) throw new Error('CHALLENGE_INPUT_REQUIRES_SEALED_CASE');
  const target = state.positions.find((position) => position.position_id === challenge.target_position);
  if (!target) throw new Error('CHALLENGE_TARGET_NOT_FOUND');
  const opposing = challenge.target_claim ? target.claims.find((claim) => claim.claim_id === challenge.target_claim) : undefined;
  return Object.freeze({
    seat_id: target.seat_id,
    case: { case_id: state.case.case_id, protocol_version: state.case.protocol_version, question: state.case.question, scope: state.case.scope, policy: state.case.policy },
    evidence_package: state.evidence_package,
    prior_position: target,
    challenge,
    opposing_excerpt: Object.freeze({ position_id: target.position_id, seat_id: target.seat_id, conclusion: target.conclusion, risk_level: target.risk_level, confidence: target.confidence, target_claim: opposing?.statement ?? null }),
    execution_context: { invocation: 0, phase: 'CHALLENGE_RESPONSE' as const },
  });
}
