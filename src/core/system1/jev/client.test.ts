import { describe, expect, it } from '../../test/bdd';
import { callJev } from './client';

const CASE = {
  case_id: 'C-001',
  question: 'Given this carrier behavior, what action should a fraud investigator take?',
  state: 'A carrier went dark for 6 hours then resumed with a route deviation.',
  candidate_stances: ['NOTE', 'MONITOR', 'TARGETED_INVESTIGATION', 'ESCALATE'],
  risk_hint: null,
};

describe('callJev', () => {
  it('returns UNAVAILABLE with no network call when no API key is configured (the real state today)', async () => {
    let fetchCalled = false;
    const fetchImpl = (async () => {
      fetchCalled = true;
      throw new Error('should never be called');
    });

    const result = await callJev(CASE, { apiKey: undefined, fetchImpl });

    expect(result.status).toBe('UNAVAILABLE');
    expect(result.decision).toBe('UNAVAILABLE');
    expect(fetchCalled).toBe(false);
    expect(result.rationale).toContain('invite-only');
  });

  it('fails closed to ERROR on a non-ok HTTP response, never fabricating a decision', async () => {
    const fetchImpl = (async () => new Response('', { status: 503, statusText: 'Service Unavailable' }));
    const result = await callJev(CASE, { apiKey: 'fake-key-for-test', fetchImpl });

    expect(result.status).toBe('ERROR');
    expect(result.rationale).toContain('503');
  });

  it('fails closed to ERROR when the response body has no valid decision/confidence shape', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ nonsense: true }), { status: 200 }));
    const result = await callJev(CASE, { apiKey: 'fake-key-for-test', fetchImpl });

    expect(result.status).toBe('ERROR');
  });

  it('returns a real LIVE result when a well-formed response comes back (proving the success path works, not just the failure paths)', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ decision: 'ESCALATE', confidence: 0.81, uncertainty: 0.1 }), { status: 200 }));
    const result = await callJev(CASE, { apiKey: 'fake-key-for-test', fetchImpl });

    expect(result.status).toBe('LIVE');
    expect(result.decision).toBe('ESCALATE');
    expect(result.confidence).toBe(0.81);
  });

  it('fails closed to ERROR when fetch itself throws (network failure)', async () => {
    const fetchImpl = (async () => { throw new Error('network unreachable'); });
    const result = await callJev(CASE, { apiKey: 'fake-key-for-test', fetchImpl });

    expect(result.status).toBe('ERROR');
    expect(result.rationale).toContain('network unreachable');
  });
});
