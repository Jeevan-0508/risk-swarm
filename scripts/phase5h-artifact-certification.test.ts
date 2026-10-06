import { describe, expect, test } from 'bun:test';
import { certifyPhase5hArtifactOnly, PHASE5H_RUN_FINGERPRINT, PHASE5H_RUN_ID } from './phase5h-artifact-certification';

describe('Phase 5H artifact-only final live certification', () => {
  test('certifies only persisted facts and fails closed when one required Round-1 seat was rejected', () => {
    const report = certifyPhase5hArtifactOnly();
    expect(report.run_id).toBe(PHASE5H_RUN_ID);
    expect(report.run_fingerprint).toBe(PHASE5H_RUN_FINGERPRINT);
    expect(report.computed_run_fingerprint).toBe(PHASE5H_RUN_FINGERPRINT);
    expect(report.artifact_schema_validation).toBe('PASS');
    expect(report.artifact_fingerprint_validation).toBe('PASS');
    expect(report.request_counts).toEqual({ round1: 4, challenge_generation: 1, challenge_response: 2, zeus: 0, total: 7 });
    expect(report.request_ledger_reconciliation).toBe('PASS');
    expect(report.round1).toMatchObject({ ATHENA: 'PASS', ARES: 'PASS', HADES: 'PASS', APOLLO: 'FAIL' });
    expect(report.round1_blindness).toBe('FAIL');
    expect(report.round1_blindness_evidence).toBe('UNVERIFIABLE');
    expect(report.round1_blindness_failure_predicate).toContain('peer_position_count=0');
    expect(report.challenge_admission).toMatchObject({ provider_candidates: 2, admitted: 2, status: 'PASS' });
    expect(report.responses).toEqual([{ challenge_id: 'challenge-1', target_seat: 'ATHENA', action: 'REVISE' }, { challenge_id: 'challenge-2', target_seat: 'HADES', action: 'REVISE' }]);
    expect(report.artifact_only_replay).toBe('PASS');
    expect(report.security).toEqual({ secret_scan: 'PASS', hidden_reasoning_scan: 'PASS' });
    expect(report.final_certification).toBe('FAIL');
  });

  test('certifies the new persisted live candidate only from its unchanged artifact', () => {
    const report = certifyPhase5hArtifactOnly(
      'artifacts/swarm/live-certifications/swarm-phase5g-1791214093989-6ffe3b68-c695-422c-9da7-30ad43f978d5.json',
      { run_id: 'swarm-phase5g-1791214093989-6ffe3b68-c695-422c-9da7-30ad43f978d5', run_fingerprint: 'fnv1a:c91145c9' },
    );
    expect(report.final_certification).toBe('PASS');
    expect(report.request_counts).toEqual({ round1: 4, challenge_generation: 1, challenge_response: 2, zeus: 0, total: 7 });
    expect(report.round1).toEqual({ ATHENA: 'PASS', ARES: 'PASS', HADES: 'PASS', APOLLO: 'PASS' });
    expect(report.round1_blindness).toBe('PASS');
    expect(report.evidence_immutability).toBe('PASS');
    expect(report.challenge_admission).toMatchObject({ provider_candidates: 2, admitted: 2, status: 'PASS' });
    expect(report.round2_privacy_boundary).toBe('PASS');
    expect(report.zeus_readiness_gate).toBe('PASS');
    expect(report.security).toEqual({ secret_scan: 'PASS', hidden_reasoning_scan: 'PASS' });
  });
});
