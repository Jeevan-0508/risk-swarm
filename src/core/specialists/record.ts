import type { RunResult } from '../orchestrator/run';
import type { SpecialistRun } from './execution';

/** Attach an optional specialist result without exposing or mutating the canonical evidence graph. */
export function withSpecialist<TAssessment>(result: RunResult, specialist: SpecialistRun<TAssessment>): RunResult {
  return { ...result, specialists: [...result.specialists, specialist as SpecialistRun] };
}
