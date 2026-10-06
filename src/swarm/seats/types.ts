import { type ClaimStatus, type ClaimType, type Round1SeatId, type RiskLevel, type SeatAuthority } from '../contracts';

export const SEAT_PROMPT_VERSIONS = {
  ATHENA: 'ATHENA_PROMPT_V1',
  ARES: 'ARES_PROMPT_V1',
  HADES: 'HADES_PROMPT_V1',
  APOLLO: 'APOLLO_PROMPT_V1',
} as const satisfies Readonly<Record<Round1SeatId, string>>;

export interface SeatClaimOutput {
  readonly statement: string;
  readonly type: ClaimType;
  readonly evidence_ids: readonly string[];
  readonly assumptions: readonly string[];
  readonly uncertainty: string;
  readonly status: ClaimStatus;
}

export interface SeatRiskFindingOutput {
  readonly statement: string;
  readonly evidence_ids: readonly string[];
  readonly assumptions: readonly string[];
  readonly uncertainty: string;
  readonly risk_level: RiskLevel;
}

export interface SeatControlGapOutput {
  readonly statement: string;
  readonly evidence_ids: readonly string[];
  readonly assumptions: readonly string[];
  readonly uncertainty: string;
  readonly priority: Exclude<RiskLevel, 'UNDETERMINED'>;
}

export interface SeatEvidenceRequestOutput {
  readonly request: string;
  readonly reason: string;
  readonly evidence_ids: readonly string[];
}

/** Model-facing DTO. Runtime-owned identity, case, and evidence content are deliberately absent. */
export interface SeatAssessmentOutput {
  readonly conclusion: string;
  readonly risk_level: RiskLevel;
  readonly confidence: number | null;
  readonly claims: readonly SeatClaimOutput[];
  readonly assumptions: readonly string[];
  readonly uncertainties: readonly string[];
  readonly risk_findings: readonly SeatRiskFindingOutput[];
  readonly control_gaps: readonly SeatControlGapOutput[];
  readonly counterarguments: readonly string[];
  readonly evidence_requests: readonly SeatEvidenceRequestOutput[];
  readonly recommendation: string | null;
  readonly abstained: boolean;
  readonly abstention_reason: string | null;
}

export interface SeatChallengeOutput {
  readonly action: 'DEFEND' | 'REVISE' | 'CONCEDE' | 'REQUEST_EVIDENCE' | 'ABSTAIN';
  readonly rationale: string;
  readonly evidence_ids: readonly string[];
  readonly revised_assessment: SeatAssessmentOutput | null;
  readonly concession: string | null;
  readonly abstention_reason: string | null;
}

export interface SeatDefinition {
  readonly seat_id: Round1SeatId;
  readonly display_name: string;
  readonly mandate: string;
  readonly authority: Extract<SeatAuthority, 'ADVISORY' | 'AUDIT'>;
  readonly responsibilities: readonly string[];
  readonly prohibitions: readonly string[];
  readonly evidence_rules: readonly string[];
  readonly reasoning_instructions: readonly string[];
  readonly challenge_behavior: readonly string[];
  readonly prompt_version: string;
}

export interface LiveSeatAssignment {
  readonly seat_id: Round1SeatId;
  readonly provider: string;
  readonly model: string;
}

export interface LiveReadinessReport {
  readonly seat_count: number;
  readonly unique_models: readonly string[];
  readonly unique_providers: readonly string[];
  readonly role_diversity: number;
  readonly model_diversity: number;
  readonly provider_diversity: number;
  readonly uncertified_models: readonly string[];
  readonly uncertified_providers: readonly string[];
}

export interface HistoricalCertificationRecord {
  readonly provider: string;
  readonly model: string;
  readonly live_execution_certified: boolean;
  readonly observed_http_status: number | null;
  readonly structured_output: 'PASS' | 'FAIL' | 'UNKNOWN';
  readonly observed_at: string;
  readonly note: string;
}
