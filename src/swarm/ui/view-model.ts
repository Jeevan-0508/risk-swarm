import type {
  AgentPosition,
  Disagreement,
  EvidenceItem,
  Round1SeatId,
  SeatId,
  SwarmBlackboard,
  SwarmExecutionEvent,
} from '../contracts';
import { currentPositions } from '../debate/disagreements';

export const SWARM_SEAT_LAYOUT: Readonly<Record<SeatId, { readonly x: number; readonly y: number }>> = {
  ATHENA: { x: 50, y: 8 },
  ARES: { x: 86, y: 34 },
  HADES: { x: 72, y: 82 },
  APOLLO: { x: 28, y: 82 },
  ZEUS: { x: 14, y: 34 },
};

export type CouncilSeatState = 'DORMANT' | 'ANALYZING' | 'POSITION SUBMITTED' | 'POSITION LOCKED' | 'DISAGREEMENT IDENTIFIED' | 'RESPONDING' | 'DEFENDED' | 'REVISED' | 'AUDIT COMPLETE' | 'ZEUS READY' | 'SYNTHESIZING' | 'HUMAN REVIEW REQUIRED';

export interface CouncilSeatView {
  readonly seat_id: SeatId;
  readonly label: string;
  readonly state: CouncilSeatState;
  readonly active: boolean;
  readonly position: AgentPosition | null;
  readonly position_history: readonly AgentPosition[];
  readonly layout: { readonly x: number; readonly y: number };
}

export interface CouncilDisagreementView {
  readonly disagreement: Disagreement;
  readonly edges: readonly { readonly from: Round1SeatId; readonly to: Round1SeatId }[];
}

export interface CouncilChallengeView {
  readonly challenge_id: string;
  readonly from: Round1SeatId;
  readonly to: Round1SeatId;
  readonly response: string | null;
}

export interface CouncilViewModel {
  readonly mode: 'IDLE' | 'LIVE' | 'REPLAY';
  readonly protocol_state: string;
  readonly phase: string;
  readonly seats: readonly CouncilSeatView[];
  readonly evidence_core: {
    readonly case_id: string | null;
    readonly question: string | null;
    readonly evidence_count: number;
    readonly open_disagreement_count: number;
    readonly audit_warning_count: number;
    readonly audit_blocker_count: number;
  };
  readonly disagreements: readonly CouncilDisagreementView[];
  readonly challenges: readonly CouncilChallengeView[];
  readonly revisions: readonly { readonly revision_id: string; readonly seat_id: Round1SeatId | null; readonly old_position_id: string; readonly new_position_id: string }[];
  readonly timeline: readonly { readonly sequence: number; readonly type: string; readonly actor: string; readonly timestamp: string }[];
  readonly human_review: { readonly required: boolean; readonly status: 'PENDING' | 'NOT_REQUIRED' };
  readonly zeus: { readonly ready: boolean; readonly synthesized: boolean; readonly synthesis_id: string | null };
  readonly evidence: readonly EvidenceItem[];
  readonly forensics: readonly { readonly seat_id: string; readonly status: string; readonly provider: string | null; readonly model: string | null; readonly request_id: string | null }[];
}

function hasEvent(events: readonly SwarmExecutionEvent[], type: SwarmExecutionEvent['type']): boolean {
  return events.some((event) => event.type === type);
}

function seatState(state: SwarmBlackboard, events: readonly SwarmExecutionEvent[], seat: SeatId, position: AgentPosition | null): CouncilSeatState {
  if (seat === 'ZEUS') {
    if (hasEvent(events, 'HUMAN_REVIEW_REQUIRED')) return 'HUMAN REVIEW REQUIRED';
    if (state.zeus_synthesis || hasEvent(events, 'ZEUS_SYNTHESIS_STARTED')) return 'SYNTHESIZING';
    if (state.zeus_readiness?.ready || hasEvent(events, 'ZEUS_READINESS_EVALUATED')) return 'ZEUS READY';
    return 'DORMANT';
  }
  const execution = state.seat_execution_state[seat];
  if (hasEvent(events, 'POST_CHALLENGE_AUDIT_COMPLETED') && seat === 'APOLLO') return 'AUDIT COMPLETE';
  const targeted = state.challenges.some((challenge) => challenge.to_seat === seat);
  const responses = state.challenge_responses.filter((response) => response.responding_seat === seat);
  if (responses.some((response) => response.action === 'REVISE')) return 'REVISED';
  if (responses.some((response) => response.action === 'DEFEND')) return 'DEFENDED';
  if (targeted && hasEvent(events, 'CHALLENGE_RESPONSE_STARTED')) return 'RESPONDING';
  if (state.disagreements.some((item) => item.positions_by_seat[seat] === position?.position_id && item.status === 'OPEN')) return 'DISAGREEMENT IDENTIFIED';
  if (position?.status === 'LOCKED' || hasEvent(events, 'POSITIONS_LOCKED')) return 'POSITION LOCKED';
  if (position) return 'POSITION SUBMITTED';
  if (execution.status === 'RUNNING' || hasEvent(events, 'INDEPENDENT_ANALYSIS_STARTED')) return 'ANALYZING';
  return 'DORMANT';
}

function disagreementEdges(disagreement: Disagreement): CouncilDisagreementView['edges'] {
  const seats = Object.keys(disagreement.positions_by_seat) as Round1SeatId[];
  return seats.slice(1).map((to) => ({ from: seats[0]!, to }));
}

export function buildCouncilViewModel(state: SwarmBlackboard, events: readonly SwarmExecutionEvent[] = state.execution_events, mode: 'LIVE' | 'REPLAY' = 'REPLAY'): CouncilViewModel {
  const positions = currentPositions(state);
  const seatViews = (['ATHENA', 'ARES', 'HADES', 'APOLLO', 'ZEUS'] as const).map((seat) => {
    const history = positions.filter((position) => position.seat_id === seat);
    const position = history.at(-1) ?? null;
    return {
      seat_id: seat,
      label: seat,
      state: seatState(state, events, seat, position),
      active: seat === 'ZEUS' ? Boolean(state.zeus_readiness?.ready || state.zeus_synthesis) : Boolean(position),
      position,
      position_history: history,
      layout: SWARM_SEAT_LAYOUT[seat],
    };
  });
  const open = state.disagreements.filter((item) => item.status === 'OPEN' && item.materiality !== 'MINOR');
  const phase = state.zeus_synthesis ? 'HUMAN REVIEW' : state.zeus_readiness?.ready ? 'ZEUS READY' : state.state ?? 'IDLE';
  return {
    mode,
    protocol_state: state.state ?? 'IDLE',
    phase,
    seats: seatViews,
    evidence_core: {
      case_id: state.case?.case_id ?? null,
      question: state.case?.question ?? null,
      evidence_count: state.evidence_package?.items.length ?? 0,
      open_disagreement_count: open.length,
      audit_warning_count: state.audit_findings.filter((finding) => finding.status === 'WARNING').length,
      audit_blocker_count: state.audit_findings.filter((finding) => finding.status === 'BLOCKED').length,
    },
    disagreements: state.disagreements.map((disagreement) => ({ disagreement, edges: disagreementEdges(disagreement) })),
    challenges: state.challenges.map((challenge) => ({ challenge_id: challenge.challenge_id, from: challenge.from_seat, to: challenge.to_seat, response: state.challenge_responses.find((response) => response.challenge_id === challenge.challenge_id)?.action ?? null })),
    revisions: state.revisions.map((revision) => ({ revision_id: revision.revision_id, seat_id: positions.find((position) => position.position_id === revision.new_position_id)?.seat_id ?? null, old_position_id: revision.old_position_id, new_position_id: revision.new_position_id })),
    timeline: events.map((event) => ({ sequence: event.sequence, type: event.type, actor: event.actor, timestamp: event.timestamp })),
    human_review: { required: Boolean(state.case?.policy.require_human_review) || Boolean(state.zeus_synthesis), status: state.human_decision === null ? 'PENDING' : 'NOT_REQUIRED' },
    zeus: { ready: Boolean(state.zeus_readiness?.ready), synthesized: Boolean(state.zeus_synthesis), synthesis_id: state.zeus_synthesis?.synthesis_id ?? null },
    evidence: state.evidence_package?.items ?? [],
    forensics: positions.map((position) => ({ seat_id: position.seat_id, status: position.execution.status, provider: position.execution.executed_provider, model: position.execution.executed_model, request_id: position.execution.request_id })),
  };
}
