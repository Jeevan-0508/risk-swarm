import { SEAT_CONTRACTS, SEAT_IDS, type SeatAuthority, type SeatId } from '../contracts';

export interface RuntimeSeatDefinition {
  readonly seat_id: SeatId;
  readonly display_name: string;
  readonly mandate: string;
  readonly authority: SeatAuthority;
  readonly allowed_actions: readonly string[];
  readonly forbidden_actions: readonly string[];
}

const commonForbidden = ['CREATE_EVIDENCE', 'MODIFY_EVIDENCE', 'DELETE_EVIDENCE', 'WRITE_HUMAN_DECISION', 'CLOSE_CASE'];

export const RUNTIME_SEATS: Readonly<Record<SeatId, RuntimeSeatDefinition>> = {
  ATHENA: {
    ...SEAT_CONTRACTS.ATHENA,
    display_name: 'ATHENA — Risk Analyst',
    allowed_actions: ['ASSESS', 'FORM_HYPOTHESES', 'REQUEST_EVIDENCE', 'RECOMMEND_CONTROLS'],
    forbidden_actions: [...commonForbidden, 'SUPPRESS_UNCERTAINTY', 'DECLARE_COMPLIANCE'],
  },
  ARES: {
    ...SEAT_CONTRACTS.ARES,
    display_name: 'ARES — Challenger / Red Team',
    allowed_actions: ['CHALLENGE_ASSUMPTIONS', 'FORM_HYPOTHESES', 'REQUEST_EVIDENCE', 'ABSTAIN'],
    forbidden_actions: [...commonForbidden, 'REWARD_AGREEMENT', 'SUPPRESS_MINORITY'],
  },
  HADES: {
    ...SEAT_CONTRACTS.HADES,
    display_name: 'HADES — Risk & Controls Manager',
    allowed_actions: ['ASSESS', 'IDENTIFY_CONTROL_GAPS', 'RECOMMEND_CONTROLS', 'REQUEST_EVIDENCE'],
    forbidden_actions: [...commonForbidden, 'DECLARE_COMPLIANCE', 'APPROVE_DEPLOYMENT'],
  },
  APOLLO: {
    ...SEAT_CONTRACTS.APOLLO,
    display_name: 'APOLLO — Evidence & Governance Auditor',
    allowed_actions: ['AUDIT_CITATIONS', 'AUDIT_PROVENANCE', 'CHALLENGE_ASSUMPTIONS', 'REQUEST_EVIDENCE'],
    forbidden_actions: [...commonForbidden, 'CREATE_EVIDENCE', 'CERTIFY_COMPLIANCE'],
  },
  ZEUS: {
    ...SEAT_CONTRACTS.ZEUS,
    display_name: 'ZEUS — Risk Lead / Synthesizer',
    allowed_actions: ['SYNTHESIZE', 'PRESERVE_DISAGREEMENT', 'RECOMMEND_CONTROLS'],
    forbidden_actions: [...commonForbidden, 'SUPPRESS_MINORITY', 'INVENT_CONSENSUS', 'APPROVE_DEPLOYMENT', 'REJECT_DEPLOYMENT'],
  },
};

export const ROUND1_RUNTIME_SEATS = SEAT_IDS.filter((seat): seat is Exclude<SeatId, 'ZEUS'> => seat !== 'ZEUS');
