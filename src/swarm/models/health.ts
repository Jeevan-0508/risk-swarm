import { type Clock, type HealthObservation, type HealthStatus, type ModelErrorCode, type ModelId, type ProviderId } from './types';

function key(provider: ProviderId, model?: ModelId): string {
  return `${provider}\u0000${model ?? '*'}`;
}

export class HealthStore {
  private readonly observations = new Map<string, HealthObservation>();

  constructor(private readonly clock: Clock) {}

  observe(provider: ProviderId, model: ModelId | null, status: HealthStatus, reason_code: ModelErrorCode | null, source = 'runtime'): HealthObservation {
    const observation: HealthObservation = Object.freeze({ provider, model, status, reason_code, source, observed_at: this.clock.iso() });
    this.observations.set(key(provider, model ?? undefined), observation);
    return observation;
  }

  get(provider: ProviderId, model?: ModelId): HealthObservation {
    return this.observations.get(key(provider, model)) ?? Object.freeze({ provider, model: model ?? null, status: 'UNKNOWN', reason_code: null, source: 'unobserved', observed_at: this.clock.iso() });
  }
}
