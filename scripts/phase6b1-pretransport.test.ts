import { describe, expect, test } from 'bun:test';
import { MockTransport } from '../src/swarm/models/transport';
import {
  PHASE6B_CONFIRMATION_VARIABLE,
  PHASE6B_EXPECTED_INPUT_FINGERPRINT,
  PHASE6B_HISTORICAL_BLOCKING_GATE,
  Phase6bRequestBudget,
  formatPhase6bPreflight,
  phase6bAuthorizationGate,
  phase6bPreflight,
  preparePhase6bLiveZeus,
} from './phase6b1-pretransport';

const AUTHORIZED_OFFLINE_ENV = {
  SWARM_LIVE_ZEUS_SYNTHESIS_CONFIRM: 'YES',
  SWARM_COUNCIL_PROVIDER: 'xai',
  SWARM_COUNCIL_MODEL: 'grok-4.7',
  SWARM_COUNCIL_MAX_OUTPUT_TOKENS: '1600',
  XAI_API_KEY: 'offline-placeholder-not-a-credential',
};

describe('Phase 6B.1 pretransport gate forensics', () => {
  test('preserves the historical blocker and requires exact dedicated authorization', () => {
    expect(PHASE6B_HISTORICAL_BLOCKING_GATE).toBe('CREDENTIAL_PRESENCE');
    expect(PHASE6B_CONFIRMATION_VARIABLE).toBe('SWARM_LIVE_ZEUS_SYNTHESIS_CONFIRM');
    expect(phase6bAuthorizationGate({ ...AUTHORIZED_OFFLINE_ENV, SWARM_LIVE_ZEUS_SYNTHESIS_CONFIRM: 'NO' })).toBe('BLOCKED');
    expect(phase6bAuthorizationGate(AUTHORIZED_OFFLINE_ENV)).toBe('PASS');
  });

  test('missing credential blocks before transport and exposes only sanitized presence', async () => {
    const secret = 'offline-secret-must-not-escape';
    const status = await preparePhase6bLiveZeus({ ...AUTHORIZED_OFFLINE_ENV, XAI_API_KEY: undefined });
    expect(status.preflight.request_precheck).toBe('BLOCKED');
    expect(status.preflight.blocking_gate).toBe('CREDENTIAL_PRESENCE');
    expect(status.preflight.credential_available).toBe('NO');
    expect(status.live_provider_calls).toBe(0);
    expect(JSON.stringify(status)).not.toContain(secret);
    expect(formatPhase6bPreflight(status.preflight).join('\n')).not.toMatch(/authorization:|bearer\s|api[_ -]?key\s*[:=]\s*offline/i);
  });

  test('authorized offline preflight validates the canonical input fingerprint without entering transport', async () => {
    const status = await preparePhase6bLiveZeus(AUTHORIZED_OFFLINE_ENV);
    expect(status.preflight.request_precheck).toBe('PASS');
    expect(status.preflight.input_fingerprint).toBe(PHASE6B_EXPECTED_INPUT_FINGERPRINT);
    expect(status.preflight.readiness).toBe('PASS');
    expect(status.preflight.human_decision).toBe('PENDING');
    expect(status.transport_entered).toBe(false);
    expect(status.live_network_calls).toBe(0);
    expect(status.live_provider_calls).toBe(0);
    expect(status.real_model_calls).toBe(0);
  });

  test('mock transport boundary is never crossed by the Phase 6B.1 preparation seam', async () => {
    const mockTransport = new MockTransport(() => {
      throw new Error('MOCK_TRANSPORT_MUST_NOT_BE_ENTERED');
    });
    const status = await preparePhase6bLiveZeus({ ...AUTHORIZED_OFFLINE_ENV, SWARM_LIVE_ZEUS_SYNTHESIS_CONFIRM: 'NO' });
    const withProbe = await preparePhase6bLiveZeus({ ...AUTHORIZED_OFFLINE_ENV, SWARM_LIVE_ZEUS_SYNTHESIS_CONFIRM: 'NO' }, mockTransport);
    expect(status.transport_entered).toBe(false);
    expect(withProbe.transport_entered).toBe(false);
    expect(mockTransport.requests).toHaveLength(0);
  });

  test('one-request budget blocks a second request before any transport boundary', () => {
    const budget = new Phase6bRequestBudget();
    expect(budget.reserve()).toBe(true);
    expect(budget.reserve()).toBe(false);
    expect(budget.stats()).toEqual({ maximum: 1, attempted: 1, blocked: 1 });
  });

  test('preflight output contains no credential, authorization header, raw response, or prompt', async () => {
    const status = await preparePhase6bLiveZeus(AUTHORIZED_OFFLINE_ENV);
    const output = formatPhase6bPreflight(status.preflight).join('\n');
    expect(output).not.toContain(AUTHORIZED_OFFLINE_ENV.XAI_API_KEY);
    expect(output).not.toMatch(/Bearer\s/i);
    expect(output).not.toMatch(/authorization\s*:/i);
    expect(output).not.toMatch(/raw_response|reasoning_content|chain.of.thought/i);
  });
});
