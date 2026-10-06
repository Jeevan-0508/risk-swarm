import { type HistoricalCertificationRecord } from './types';

/** Historical observations only; this registry is not a live health check and contains no credentials. */
export const HISTORICAL_CERTIFICATION_REGISTRY: readonly HistoricalCertificationRecord[] = Object.freeze([
  { provider: 'gemini', model: 'gemini-3.8-flash', live_execution_certified: false, observed_http_status: 503, structured_output: 'FAIL', observed_at: 'PHASE_3B', note: 'Historical live certification observed provider HTTP 503.' },
  { provider: 'xai', model: 'grok-4.7', live_execution_certified: true, observed_http_status: 200, structured_output: 'PASS', observed_at: 'PHASE_3C', note: 'Historical live certification observed HTTP 200 with structured output PASS.' },
]);

export function certificationRecord(provider: string, model: string): HistoricalCertificationRecord | undefined {
  return HISTORICAL_CERTIFICATION_REGISTRY.find((item) => item.provider === provider && item.model === model);
}
