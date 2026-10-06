import { type ModelResponse } from './types';

export interface ExecutionDiversity {
  readonly unique_models: readonly string[];
  readonly unique_providers: readonly string[];
  readonly fallback_count: number;
  readonly same_model_count: number;
}

export function analyzeExecutionDiversity(responses: readonly Pick<ModelResponse, 'status' | 'execution'>[]): ExecutionDiversity {
  const successful = responses.filter((response) => response.status === 'SUCCESS' && response.execution.executed_model !== null);
  const models = [...new Set(successful.map((response) => `${response.execution.executed_provider}/${response.execution.executed_model}`))].sort();
  const providers = [...new Set(successful.map((response) => response.execution.executed_provider!))].sort();
  return Object.freeze({ unique_models: Object.freeze(models), unique_providers: Object.freeze(providers), fallback_count: responses.filter((response) => response.execution.fallback_used).length, same_model_count: Math.max(0, successful.length - models.length) });
}
