import type { ReasonRequest, Reasoner, ReasonResult, ModelExecution } from '../reasoner/types';
import type { SpecialistContract } from './contract';
import type { SpecialistEvidencePackage } from './evidence';
import { disabledSpecialistExecution, type SpecialistAssessmentStatus, type SpecialistRun, type SpecialistValidationStatus } from './execution';
import { countKnownCitations, SpecialistValidationError, validateSpecialistOutput } from './validation';

export interface SpecialistRequestInput<T> {
  readonly contract: SpecialistContract<T>;
  readonly evidencePackage: SpecialistEvidencePackage;
  readonly validate: (raw: unknown) => T;
}

export interface RunSpecialistInput<T> {
  readonly contract: SpecialistContract<T>;
  readonly evidencePackage: SpecialistEvidencePackage;
  readonly reasoner?: Reasoner;
  readonly buildRequest: (input: SpecialistRequestInput<T>) => ReasonRequest<T>;
  readonly validateOutput?: (raw: unknown) => T;
  readonly now?: () => string;
  readonly clock?: () => number;
}

function failedExecution(reason: string, provider: string | null, modelId: string | null): ModelExecution {
  return {
    model_called: provider !== null,
    provider,
    model_id: modelId,
    status: 'FAILED',
    degraded: true,
    degraded_reason: reason,
    independent: false,
  };
}

function validationStatus(execution: ModelExecution, reason: string | null): SpecialistValidationStatus {
  if (!execution.model_called || reason === null) return 'NOT_RUN';
  return /provider|timeout|timed out|api key|network|HTTP \d+/i.test(reason) ? 'NOT_RUN' : 'INVALID';
}

function makeRun<T>(input: {
  contract: SpecialistContract<T>;
  status: SpecialistAssessmentStatus;
  assessment: T | null;
  execution: ModelExecution;
  validation_status: SpecialistValidationStatus;
  abstention_reason: string | null;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  evidence_count: number;
  cited_evidence_count: number;
}): SpecialistRun<T> {
  return {
    specialist_id: input.contract.id,
    specialist_version: input.contract.version,
    assessment_status: input.status,
    assessment: input.assessment,
    execution: input.execution,
    validation_status: input.validation_status,
    abstention_reason: input.abstention_reason,
    observability: {
      specialist_id: input.contract.id,
      specialist_version: input.contract.version,
      provider: input.execution.provider,
      model: input.execution.model_id,
      started_at: input.started_at,
      completed_at: input.completed_at,
      duration_ms: input.duration_ms,
      model_called: input.execution.model_called,
      execution_status: input.execution.status,
      abstained: input.status === 'ABSTAINED',
      validation_status: input.validation_status,
      evidence_count: input.evidence_count,
      cited_evidence_count: input.cited_evidence_count,
    },
  };
}

/**
 * Generic one-call specialist runner. Any reasoner fallback value is deliberately discarded unless the
 * returned execution metadata proves a successful, independent model call.
 */
export async function runSpecialist<T>(input: RunSpecialistInput<T>): Promise<SpecialistRun<T>> {
  const now = input.now ?? (() => new Date().toISOString());
  const clock = input.clock ?? (() => Date.now());
  const started_at = now();
  const started = clock();
  const evidence_count = input.evidencePackage.evidence.length;

  if (input.reasoner === undefined) {
    const completed_at = now();
    return makeRun({
      contract: input.contract,
      status: 'UNAVAILABLE',
      assessment: null,
      execution: disabledSpecialistExecution('no specialist reasoner configured'),
      validation_status: 'NOT_RUN',
      abstention_reason: 'Specialist execution is disabled because no model reasoner was configured.',
      started_at,
      completed_at,
      duration_ms: Math.max(0, clock() - started),
      evidence_count,
      cited_evidence_count: 0,
    });
  }

  const validate = (raw: unknown): T => {
    const checked = validateSpecialistOutput(raw, input.contract, input.evidencePackage);
    return checked.value;
  };
  const request = input.buildRequest({ contract: input.contract, evidencePackage: input.evidencePackage, validate });
  let result: ReasonResult<T>;
  try {
    result = await input.reasoner.propose(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'specialist reasoner failed';
    const execution = failedExecution(reason, input.reasoner.id, input.reasoner.id);
    const completed_at = now();
    return makeRun({
      contract: input.contract,
      status: 'UNAVAILABLE',
      assessment: null,
      execution,
      validation_status: validationStatus(execution, reason),
      abstention_reason: reason,
      started_at,
      completed_at,
      duration_ms: Math.max(0, clock() - started),
      evidence_count,
      cited_evidence_count: 0,
    });
  }

  const execution = result.execution;
  if (execution === undefined || execution.status !== 'SUCCESS' || execution.model_called !== true || execution.degraded !== false || execution.independent !== true) {
    const safeExecution = execution ?? failedExecution('reasoner returned no execution metadata', result.provider || input.reasoner.id, input.reasoner.id);
    const completed_at = now();
    return makeRun({
      contract: input.contract,
      status: 'UNAVAILABLE',
      assessment: null,
      execution: safeExecution,
      validation_status: validationStatus(safeExecution, result.degraded_reason),
      abstention_reason: result.degraded_reason ?? 'specialist model execution did not produce an independent successful result',
      started_at,
      completed_at,
      duration_ms: Math.max(0, clock() - started),
      evidence_count,
      cited_evidence_count: 0,
    });
  }

  let assessment: T;
  let cited_evidence_count = 0;
  try {
    assessment = input.validateOutput === undefined
      ? validateSpecialistOutput(result.value, input.contract, input.evidencePackage).value
      : input.validateOutput(result.value);
    cited_evidence_count = countKnownCitations(assessment, input.evidencePackage);
  } catch (error) {
    const reason = error instanceof SpecialistValidationError ? error.message : 'specialist output failed validation';
    const invalidExecution: ModelExecution = { ...execution, status: 'DEGRADED', degraded: true, degraded_reason: reason, independent: false };
    const completed_at = now();
    return makeRun({
      contract: input.contract,
      status: 'UNAVAILABLE',
      assessment: null,
      execution: invalidExecution,
      validation_status: 'INVALID',
      abstention_reason: reason,
      started_at,
      completed_at,
      duration_ms: Math.max(0, clock() - started),
      evidence_count,
      cited_evidence_count: 0,
    });
  }

  const completed_at = now();
  const status = typeof assessment === 'object' && assessment !== null && (assessment as { assessment_status?: unknown }).assessment_status === 'ABSTAINED'
    ? 'ABSTAINED'
    : 'ASSESSED';
  const abstention_reason = status === 'ABSTAINED' && typeof assessment === 'object' && assessment !== null
    ? ((assessment as { abstention?: { reason?: string | null } }).abstention?.reason ?? null)
    : null;
  return makeRun({
    contract: input.contract,
    status,
    assessment,
    execution,
    validation_status: 'VALID',
    abstention_reason,
    started_at,
    completed_at,
    duration_ms: Math.max(0, clock() - started),
    evidence_count,
    cited_evidence_count,
  });
}
