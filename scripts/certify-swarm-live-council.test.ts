import { describe, expect, test } from 'bun:test';
import { MockTransport } from '../src/swarm/models/transport';
import { BudgetedTransport, LIVE_MODEL, LIVE_PROVIDER, LIVE_REQUEST_BUDGET, configFromEnvironment, formatLiveCouncilReport, preparePhase4B, runOfflineDryRun, syntheticCase, validateManualConfiguration } from './certify-swarm-live-council';

describe('Phase 4B controlled live Council preparation', () => {
  test('refuses missing or non-explicit live configuration before transport construction', () => {
    expect(validateManualConfiguration({ provider: '', model: '', confirm: '' })).toHaveLength(4);
    expect(validateManualConfiguration({ provider: LIVE_PROVIDER, model: LIVE_MODEL, credential: 'present-only', confirm: 'YES' })).toEqual([]);
    expect(configFromEnvironment({ SWARM_COUNCIL_PROVIDER: 'xai', SWARM_COUNCIL_MODEL: 'grok-4.7', XAI_API_KEY: 'secret', SWARM_LIVE_COUNCIL_CONFIRM: 'NO' }).confirm).toBe('NO');
  });

  test('enforces the four-request budget before a fifth delegate request', async () => {
    const delegate = new MockTransport(() => ({ status: 200, headers: {}, body: '{}' }));
    const budget = new BudgetedTransport(delegate, LIVE_REQUEST_BUDGET);
    for (let index = 0; index < LIVE_REQUEST_BUDGET; index += 1) await budget.request({ method: 'POST', url: 'https://mock.invalid' });
    await expect(budget.request({ method: 'POST', url: 'https://mock.invalid' })).rejects.toThrow('LIVE_COUNCIL_REQUEST_BUDGET_EXCEEDED');
    expect(budget.stats()).toEqual({ request_count: 4, attempted_count: 5, blocked_count: 1 });
    expect(delegate.requests).toHaveLength(4);
  });

  test('uses one sealed synthetic case and preserves the exact evidence fingerprint for all seats', async () => {
    const dry = await runOfflineDryRun();
    const synthetic = syntheticCase();
    expect(synthetic.case.question).not.toMatch(/ATHENA|ARES|HADES|APOLLO|HIGH|LOW|CRITICAL/i);
    expect(new Set(dry.baseline.seat_reports.map((report) => report.evidence_fingerprint)).size).toBe(1);
    expect(dry.baseline.seat_reports).toHaveLength(4);
    expect(dry.baseline.budget).toEqual({ request_count: 4, attempted_count: 4, blocked_count: 0 });
    expect(dry.baseline.blackboard.execution_events.filter((event) => event.type === 'POSITION_PROPOSED').map((event) => event.position.seat_id)).toEqual(['ATHENA', 'ARES', 'HADES', 'APOLLO']);
    expect(dry.baseline.blackboard.execution_events.some((event) => event.type === 'CHALLENGE_EMITTED')).toBe(false);
    expect(dry.baseline.replay_deterministic).toBe(true);
  });

  test('keeps provider failure, malformed output, and unknown citation local and truthful', async () => {
    const dry = await runOfflineDryRun();
    expect(dry.failure.seat_reports.find((report) => report.seat === 'ATHENA')?.final_execution_status).toBe('UNAVAILABLE');
    expect(dry.malformed.seat_reports.find((report) => report.seat === 'ARES')?.final_execution_status).toBe('REJECTED');
    expect(dry.unknownCitation.seat_reports.find((report) => report.seat === 'HADES')?.final_execution_status).toBe('REJECTED');
    expect(dry.unknownCitation.blackboard.positions.some((position) => position.seat_id === 'HADES')).toBe(false);
  });

  test('preparation report passes and formatted live output contains no credential', async () => {
    const preparation = await preparePhase4B();
    expect(preparation).toMatchObject({ SWARM_2_PHASE_4B_PREPARATION: 'PASS', PROVIDER: 'xai', MODEL: 'grok-4.7', REQUEST_BUDGET: 4, LIVE_COUNCIL_EXECUTION: 'NOT_RUN', READY_FOR_MANUAL_LIVE_COUNCIL: 'YES', LIVE_NETWORK_CALLS_FROM_CODEX: 0, LIVE_PROVIDER_CALLS_FROM_CODEX: 0, REAL_MODEL_CALLS_FROM_CODEX: 0, LIVE_COUNCIL_CALLS_FROM_CODEX: 0 });
    const dry = await runOfflineDryRun();
    const report = formatLiveCouncilReport(dry.baseline);
    expect(report).not.toContain('PHASE4B_OFFLINE_SECRET_DO_NOT_LEAK');
    expect(report).not.toMatch(/authorization|bearer|api[_ -]?key|chain.?of.?thought/i);
  });
});
