import { type HistoricalCertificationRecord, type LiveReadinessReport, type LiveSeatAssignment } from './types';

export function analyzeLiveReadiness(assignments: readonly LiveSeatAssignment[], certification: readonly HistoricalCertificationRecord[]): LiveReadinessReport {
  const models = [...new Set(assignments.map((item) => `${item.provider}/${item.model}`))].sort();
  const providers = [...new Set(assignments.map((item) => item.provider))].sort();
  const certifiedModels = new Set(certification.filter((item) => item.live_execution_certified).map((item) => `${item.provider}/${item.model}`));
  const certifiedProviders = new Set(certification.filter((item) => item.live_execution_certified).map((item) => item.provider));
  return Object.freeze({
    seat_count: assignments.length,
    unique_models: Object.freeze(models),
    unique_providers: Object.freeze(providers),
    role_diversity: new Set(assignments.map((item) => item.seat_id)).size,
    model_diversity: models.length,
    provider_diversity: providers.length,
    uncertified_models: Object.freeze(models.filter((item) => !certifiedModels.has(item))),
    uncertified_providers: Object.freeze(providers.filter((item) => !certifiedProviders.has(item))),
  });
}
