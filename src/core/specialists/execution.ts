import type { ModelExecution } from '../reasoner/types';

export type SpecialistAssessmentStatus = 'ASSESSED' | 'ABSTAINED' | 'UNAVAILABLE';
export type SpecialistValidationStatus = 'VALID' | 'INVALID' | 'NOT_RUN';

export interface SpecialistObservability {
  readonly specialist_id: string;
  readonly specialist_version: string;
  readonly provider: string | null;
  readonly model: string | null;
  readonly started_at: string;
  readonly completed_at: string;
  readonly duration_ms: number;
  readonly model_called: boolean;
  readonly execution_status: ModelExecution['status'];
  readonly abstained: boolean;
  readonly validation_status: SpecialistValidationStatus;
  readonly evidence_count: number;
  readonly cited_evidence_count: number;
}

export interface SpecialistRun<TAssessment = unknown> {
  readonly specialist_id: string;
  readonly specialist_version: string;
  readonly assessment_status: SpecialistAssessmentStatus;
  readonly assessment: TAssessment | null;
  readonly execution: ModelExecution;
  readonly validation_status: SpecialistValidationStatus;
  readonly abstention_reason: string | null;
  readonly observability: SpecialistObservability;
}

export const disabledSpecialistExecution = (reason: string): ModelExecution => ({
  model_called: false,
  provider: null,
  model_id: null,
  status: 'DISABLED',
  degraded: true,
  degraded_reason: reason,
  independent: false,
});
