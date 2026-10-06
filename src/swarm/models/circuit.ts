import { isInfrastructureFailure } from './errors';
import { type Clock, type ModelErrorCode, type ModelId, type ProviderId } from './types';

export const CIRCUIT_STATES = ['CLOSED', 'OPEN', 'HALF_OPEN'] as const;
export type CircuitState = (typeof CIRCUIT_STATES)[number];

interface CircuitRecord {
  state: CircuitState;
  failures: number;
  opened_at: number | null;
}

export interface CircuitBreakerOptions {
  readonly threshold?: number;
  readonly cooldown_ms?: number;
  readonly clock: Clock;
}

export class CircuitBreaker {
  private readonly records = new Map<string, CircuitRecord>();
  private readonly threshold: number;
  private readonly cooldown_ms: number;

  constructor(options: CircuitBreakerOptions) {
    this.threshold = Math.max(1, options.threshold ?? 3);
    this.cooldown_ms = Math.max(0, options.cooldown_ms ?? 30_000);
    this.clock = options.clock;
  }

  private readonly clock: Clock;

  private recordFor(provider: ProviderId, model: ModelId): CircuitRecord {
    const id = `${provider}\u0000${model}`;
    let record = this.records.get(id);
    if (!record) {
      record = { state: 'CLOSED', failures: 0, opened_at: null };
      this.records.set(id, record);
    }
    return record;
  }

  state(provider: ProviderId, model: ModelId): CircuitState {
    const record = this.recordFor(provider, model);
    if (record.state === 'OPEN' && record.opened_at !== null && this.clock.now() - record.opened_at >= this.cooldown_ms) record.state = 'HALF_OPEN';
    return record.state;
  }

  allow(provider: ProviderId, model: ModelId): boolean {
    return this.state(provider, model) !== 'OPEN';
  }

  recordSuccess(provider: ProviderId, model: ModelId): void {
    const record = this.recordFor(provider, model);
    record.state = 'CLOSED';
    record.failures = 0;
    record.opened_at = null;
  }

  recordFailure(provider: ProviderId, model: ModelId, code: ModelErrorCode): void {
    if (!isInfrastructureFailure(code)) return;
    const record = this.recordFor(provider, model);
    if (record.state === 'HALF_OPEN') {
      record.state = 'OPEN';
      record.opened_at = this.clock.now();
      record.failures = this.threshold;
      return;
    }
    record.failures += 1;
    if (record.failures >= this.threshold) {
      record.state = 'OPEN';
      record.opened_at = this.clock.now();
    }
  }
}
