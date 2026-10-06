import {
  type AgentPosition,
  type Disagreement,
  type PositionId,
  type ProtocolState,
  type Round1SeatId,
  type SwarmBlackboard,
} from '../contracts';

export const MATERIALITY_POLICY = Object.freeze({
  confidence_delta: 0.15,
  risk_materiality_gap: 1,
  risk_blocking_gap: 2,
});

const RISK_RANK: Record<AgentPosition['risk_level'], number> = { UNDETERMINED: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export type PositionSummary =
  | 'UNANIMOUS'
  | 'MAJORITY'
  | 'SPLIT'
  | 'INSUFFICIENT_PARTICIPATION'
  | 'NO_COMPARABLE_POSITION';

export interface PositionSummaryProjection {
  readonly summary: PositionSummary;
  readonly comparable_positions: readonly AgentPosition[];
  readonly majority_position_id: PositionId | null;
  readonly majority_risk_level: AgentPosition['risk_level'] | null;
  readonly minority_position_ids: readonly PositionId[];
}

export function currentPositions(state: Pick<SwarmBlackboard, 'positions'>): AgentPosition[] {
  const latest = new Map<Round1SeatId, AgentPosition>();
  for (const position of state.positions) {
    const prior = latest.get(position.seat_id);
    if (!prior || position.round > prior.round) latest.set(position.seat_id, position);
  }
  return [...latest.values()].sort((a, b) => a.seat_id.localeCompare(b.seat_id));
}

export function summarizePositions(positions: readonly AgentPosition[]): PositionSummaryProjection {
  const comparable = positions.filter((position) => !position.abstained && position.execution.status === 'SUCCESS');
  if (comparable.length === 0) return { summary: 'NO_COMPARABLE_POSITION', comparable_positions: [], majority_position_id: null, majority_risk_level: null, minority_position_ids: [] };
  if (comparable.length < 2) return { summary: 'INSUFFICIENT_PARTICIPATION', comparable_positions: comparable, majority_position_id: null, majority_risk_level: null, minority_position_ids: [] };
  const groups = new Map<AgentPosition['risk_level'], AgentPosition[]>();
  for (const position of comparable) groups.set(position.risk_level, [...(groups.get(position.risk_level) ?? []), position]);
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  if (ranked.length === 1) return { summary: 'UNANIMOUS', comparable_positions: comparable, majority_position_id: null, majority_risk_level: ranked[0]![0], minority_position_ids: [] };
  if (ranked[0]![1].length > comparable.length / 2) {
    const majority = ranked[0]![1][0]!;
    return {
      summary: 'MAJORITY', comparable_positions: comparable, majority_position_id: majority.position_id, majority_risk_level: ranked[0]![0],
      minority_position_ids: comparable.filter((position) => position.risk_level !== ranked[0]![0]).map((position) => position.position_id),
    };
  }
  return { summary: 'SPLIT', comparable_positions: comparable, majority_position_id: null, majority_risk_level: null, minority_position_ids: comparable.map((position) => position.position_id) };
}

function baseDisagreement(
  positions: readonly AgentPosition[],
  type: Disagreement['type'],
  subject_ids: string[],
  materiality: Disagreement['materiality'],
  basis: string,
  evidence_ids: string[],
  index: number,
): Disagreement {
  return {
    disagreement_id: `disagreement-${type.toLowerCase()}-${index}` as Disagreement['disagreement_id'],
    case_id: positions[0]!.case_id,
    type,
    subject_ids: subject_ids as Disagreement['subject_ids'],
    positions_by_seat: Object.fromEntries(positions.map((position) => [position.seat_id, position.position_id])) as Disagreement['positions_by_seat'],
    materiality,
    basis,
    evidence_ids: [...new Set(evidence_ids)] as Disagreement['evidence_ids'],
    unresolved: true,
    status: 'OPEN',
  };
}

export function detectDisagreements(positions: readonly AgentPosition[]): Disagreement[] {
  const comparable = positions.filter((position) => position.execution.status === 'SUCCESS' && !position.abstained);
  if (comparable.length < 2) return [];
  const out: Disagreement[] = [];
  const first = comparable[0]!;
  const riskLevels = new Set(comparable.map((position) => position.risk_level));
  if (riskLevels.size > 1) {
    const ranks = comparable.map((position) => RISK_RANK[position.risk_level]);
    const gap = Math.max(...ranks) - Math.min(...ranks);
    out.push(baseDisagreement(comparable, 'RISK_RATING', comparable.map((position) => position.position_id), gap >= MATERIALITY_POLICY.risk_blocking_gap ? 'BLOCKING' : 'MATERIAL', `Risk levels differ: ${comparable.map((position) => `${position.seat_id}=${position.risk_level}`).join(', ')}.`, comparable.flatMap((position) => position.evidence_ids), out.length));
  }

  const confidence = comparable.map((position) => position.confidence).filter((value): value is number => value !== null);
  if (confidence.length >= 2 && Math.max(...confidence) - Math.min(...confidence) >= MATERIALITY_POLICY.confidence_delta) {
    out.push(baseDisagreement(comparable, 'CONFIDENCE', comparable.map((position) => position.position_id), 'MATERIAL', `Confidence differs by at least ${MATERIALITY_POLICY.confidence_delta.toFixed(2)}.`, comparable.flatMap((position) => position.evidence_ids), out.length));
  }

  const recommendations = new Set(comparable.map((position) => (position.recommendation ?? '').trim().toLowerCase()).filter(Boolean));
  if (recommendations.size > 1) out.push(baseDisagreement(comparable, 'RECOMMENDATION', comparable.map((position) => position.position_id), 'MATERIAL', 'Successful seats made materially different recommendations.', comparable.flatMap((position) => position.evidence_ids), out.length));

  const assumptions = new Set(comparable.flatMap((position) => position.assumptions.map((assumption) => assumption.trim().toLowerCase())));
  const sharedAssumption = comparable.length > 1 && comparable.every((position) => position.assumptions.length > 0 && position.assumptions.map((value) => value.trim().toLowerCase()).includes([...assumptions][0] ?? ''));
  if (assumptions.size > 1 || (assumptions.size === 1 && !sharedAssumption)) out.push(baseDisagreement(comparable, 'ASSUMPTION', comparable.map((position) => position.position_id), 'MATERIAL', 'Successful seats rely on different or non-uniform assumptions.', comparable.flatMap((position) => position.evidence_ids), out.length));

  const controlShapes = new Set(comparable.map((position) => position.control_gaps.map((gap) => `${gap.statement}|${gap.priority}`).sort().join('|')));
  if (controlShapes.size > 1) out.push(baseDisagreement(comparable, 'CONTROL_EFFECTIVENESS', comparable.map((position) => position.position_id), 'MATERIAL', 'Control-gap assessments differ across successful seats.', comparable.flatMap((position) => position.evidence_ids), out.length));

  const evidenceShapes = new Set(comparable.map((position) => [...position.evidence_ids].sort().join('|')));
  if (evidenceShapes.size > 1) out.push(baseDisagreement(comparable, 'EVIDENCE_INTERPRETATION', comparable.map((position) => position.position_id), 'MATERIAL', 'Successful seats cite different evidence sets.', comparable.flatMap((position) => position.evidence_ids), out.length));

  // Causal and scope disagreement require explicit structured fields in a later contract. Phase 2 does not infer them from prose.
  void first;
  return out;
}

/** Re-checks the original disagreement set after the single challenge round.
 * IDs and original records remain the audit reference; only status, current
 * subjects, positions, basis, and evidence are refreshed from the latest
 * positions. No consensus is manufactured when a disagreement remains. */
export function reevaluateDisagreements(
  original: readonly Disagreement[],
  positions: readonly AgentPosition[],
): Disagreement[] {
  const current = detectDisagreements(positions);
  const structurallyDetectable: ReadonlySet<Disagreement['type']> = new Set(['RISK_RATING', 'CONFIDENCE', 'RECOMMENDATION', 'ASSUMPTION', 'CONTROL_EFFECTIVENESS', 'EVIDENCE_INTERPRETATION']);
  return original.map((before) => {
    const after = current.find((item) => item.type === before.type);
    // Causal and scope disagreements require structured fields that this
    // protocol version does not infer. Absence from the detector is therefore
    // not evidence of resolution; preserve them for a later owned step.
    if (!after && !structurallyDetectable.has(before.type)) return { ...before, unresolved: true, status: 'OPEN' as const };
    if (!after) return { ...before, unresolved: false, status: 'RESOLVED' as const };
    const narrowed = after.subject_ids.length < before.subject_ids.length ||
      (before.materiality === 'BLOCKING' && after.materiality !== 'BLOCKING');
    return {
      ...after,
      disagreement_id: before.disagreement_id,
      status: narrowed ? 'NARROWED' as const : 'OPEN' as const,
      unresolved: true,
    };
  });
}

export function disagreementStateIsComparable(state: Pick<SwarmBlackboard, 'state'>): boolean {
  return state.state === ('POSITIONS_LOCKED' satisfies ProtocolState);
}
