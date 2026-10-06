import { describe, expect, test } from 'bun:test';
import { AgentPositionSchema, Phase5ChallengeResponseSchema, RevisionSchema, type AgentPosition, type ChallengeResponse, type SwarmExecutionEvent } from '../src/swarm/contracts';
import { currentPositions, reevaluateDisagreements } from '../src/swarm/debate/disagreements';
import { runApolloDeterministicAudit } from '../src/swarm/governance/audit';
import { hasMeaningfulPositionChange } from '../src/swarm/governance/verifier';
import { replaySwarmEvents, reduceSwarmEvent } from '../src/swarm/engine/reducer';
import { buildPhase5GoldenScenario } from '../src/swarm/evaluation/scenarios';
import { SEAT_CHALLENGE_SCHEMA } from '../src/swarm/seats/validation';
import { stableStringify } from '../src/swarm/evidence/package';
import { configForPhase5d, mockTransportForPhase5d, runPhase5dOfflineLifecycle, Phase5dTransport } from './phase5d-live-revision-lineage';

function revisionEvent(events: readonly SwarmExecutionEvent[]) {
  const event = events.find((item): item is Extract<SwarmExecutionEvent, { type: 'REVISION_RECORDED' }> => item.type === 'REVISION_RECORDED');
  if (!event) throw new Error('REVISION_EVENT_MISSING');
  return event;
}

function noOpRevisionPosition(previous: AgentPosition): AgentPosition {
  const positionId = 'position-athena-noop-2' as AgentPosition['position_id'];
  return {
    ...previous,
    position_id: positionId,
    round: 2,
    status: 'REVISED',
    claims: previous.claims.map((claim, index) => ({ ...claim, claim_id: `${positionId}-claim-${index + 1}` as typeof claim.claim_id, position_id: positionId })),
    risk_findings: previous.risk_findings.map((finding, index) => ({ ...finding, finding_id: `${positionId}-finding-${index + 1}` as typeof finding.finding_id, position_id: positionId })),
    control_gaps: previous.control_gaps.map((gap, index) => ({ ...gap, gap_id: `${positionId}-gap-${index + 1}` as typeof gap.gap_id, position_id: positionId })),
    evidence_requests: previous.evidence_requests.map((request, index) => ({ ...request, request_id: `${positionId}-request-${index + 1}` as typeof request.request_id, position_id: positionId })),
    position_references: [previous.position_id],
  };
}

function revisedAssessmentResponse(): Record<string, unknown> {
  return {
    action: 'REVISE',
    rationale: 'The challenge requires a bounded revision.',
    evidence_ids: ['EV-001'],
    revised_assessment: null,
    concession: null,
    abstention_reason: null,
  };
}

describe('Phase 5D offline revision lineage and post-challenge reevaluation', () => {
  test('accepted REVISE creates a canonical revision with immutable Round 1 lineage', async () => {
    const result = await runPhase5dOfflineLifecycle();
    const event = revisionEvent(result.events);
    const revision = result.blackboard.revisions.find((item) => item.revision_id === event.revision.revision_id)!;
    const original = result.blackboard.positions.find((position) => position.position_id === revision.old_position_id)!;
    const revised = result.blackboard.positions.find((position) => position.position_id === revision.new_position_id)!;
    const response = result.blackboard.challenge_responses.find((item) => item.response_id === revision.triggering_response_id)!;
    const originalSnapshot = stableStringify(original);

    expect(RevisionSchema.safeParse(revision).success).toBe(true);
    expect(AgentPositionSchema.safeParse(revised).success).toBe(true);
    expect(revision.case_id).toBe(result.blackboard.case!.case_id);
    expect(original.seat_id).toBe('ATHENA');
    expect(revised.seat_id).toBe(original.seat_id);
    expect(revision.old_position_id).toBe(original.position_id);
    expect(revision.new_position_id).toBe(revised.position_id);
    expect(revision.triggering_challenge_id).toBe(response.challenge_id);
    expect(revision.triggering_response_id).toBe(response.response_id);
    expect(response.action).toBe('REVISE');
    expect(revised.round).toBe(2);
    expect(revised.position_references).toContain(original.position_id);
    expect(revised.position_id).not.toBe(original.position_id);
    expect(hasMeaningfulPositionChange(original, revised)).toBe(true);
    expect(stableStringify(original)).toBe(originalSnapshot);
    expect(result.blackboard.execution_events.some((item) => item.type === 'REVISIONS_LOCKED')).toBe(true);
    expect(result.blackboard.execution_events.some((item) => item.type === 'DISAGREEMENTS_REEVALUATED')).toBe(true);
  });

  test('runtime owns response, revision, position, case, seat, and lineage identity', () => {
    const spoofed = { ...revisedAssessmentResponse(), revision_id: 'revision-spoof', response_id: 'response-spoof', case_id: 'case-spoof', seat_id: 'HADES', challenge_id: 'challenge-spoof', round: 99 };
    expect(SEAT_CHALLENGE_SCHEMA.validate(spoofed).success).toBe(false);
    const parsed = Phase5ChallengeResponseSchema.safeParse({ ...spoofed, responding_seat: 'HADES' });
    expect(parsed.success).toBe(false);
  });

  test('no-op REVISE is rejected rather than minting a new historical version', async () => {
    const scenario = buildPhase5GoldenScenario();
    const result = await runPhase5dOfflineLifecycle();
    const event = revisionEvent(result.events);
    const index = result.events.indexOf(event);
    const before = replaySwarmEvents(result.events.slice(0, index));
    const old = before.positions.find((position) => position.position_id === event.revision.old_position_id)!;
    const noop = noOpRevisionPosition(old);
    const noopEvent = { ...event, position: noop, revision: { ...event.revision, new_position_id: noop.position_id } };
    expect(hasMeaningfulPositionChange(old, noop)).toBe(false);
    expect(() => reduceSwarmEvent(before, noopEvent)).toThrow(/INVALID_TRANSITION/);
    expect(scenario.name).toBe('REVISION_AFTER_CHALLENGE');
  });

  test('reevaluation preserves open, narrowed, resolved, confidence, and unsupported causal states without forcing consensus', async () => {
    const result = await runPhase5dOfflineLifecycle();
    const initial = result.events.find((item): item is Extract<SwarmExecutionEvent, { type: 'DISAGREEMENT_IDENTIFIED' }> => item.type === 'DISAGREEMENT_IDENTIFIED' && item.disagreement.type === 'RISK_RATING')!.disagreement;
    const positions = currentPositions(result.blackboard);
    const open = reevaluateDisagreements([initial], positions)[0]!;
    expect(open.status).toBe('OPEN');
    expect(open.unresolved).toBe(true);

    const narrowedInput = { ...initial, materiality: 'BLOCKING' as const, subject_ids: positions.map((position) => position.position_id) as typeof initial.subject_ids };
    const narrowed = reevaluateDisagreements([narrowedInput], positions.slice(0, 3))[0]!;
    expect(narrowed.status).toBe('NARROWED');
    expect(narrowed.unresolved).toBe(true);

    const aligned = positions.map((position) => ({ ...position, risk_level: 'HIGH' as const }));
    const resolved = reevaluateDisagreements([initial], aligned)[0]!;
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.unresolved).toBe(false);

    const confidence = { ...initial, disagreement_id: 'disagreement-confidence-phase5d' as typeof initial.disagreement_id, type: 'CONFIDENCE' as const };
    const loweredButConflicting = positions.map((position, index) => ({ ...position, confidence: index === 0 ? 0.2 : 0.8 }));
    expect(['OPEN', 'NARROWED']).toContain(reevaluateDisagreements([confidence], loweredButConflicting)[0]!.status);

    const causal = { ...initial, disagreement_id: 'disagreement-causal-phase5d' as typeof initial.disagreement_id, type: 'CAUSAL' as const };
    expect(reevaluateDisagreements([causal], aligned)[0]!.status).toBe('OPEN');
  });

  test('Apollo audits the revised state and Zeus readiness is evaluated without Zeus or synthesis', async () => {
    const result = await runPhase5dOfflineLifecycle();
    const findings = runApolloDeterministicAudit(result.blackboard);
    expect(findings.find((finding) => finding.check_id === 'citation_integrity')?.status).toBe('VERIFIED');
    expect(findings.find((finding) => finding.check_id === 'revision_lineage_integrity')?.status).toBe('VERIFIED');
    expect(findings.find((finding) => finding.check_id === 'seat_authority_boundaries')?.status).toBe('VERIFIED');
    expect(findings.some((finding) => finding.status === 'BLOCKED')).toBe(false);
    expect(result.events.some((item) => item.type === 'POST_CHALLENGE_AUDIT_COMPLETED')).toBe(true);
    expect(result.events.find((item) => item.type === 'ZEUS_READINESS_EVALUATED')).toMatchObject({ ready: true });
    expect(result.events.some((item) => item.type === 'SYNTHESIS_STARTED')).toBe(false);
    expect(result.blackboard.human_decision).toBeNull();
  });

  test('the complete offline lifecycle replays deterministically with no provider requirement', async () => {
    const first = await runPhase5dOfflineLifecycle();
    const second = await runPhase5dOfflineLifecycle();
    expect(stableStringify(first.events)).toBe(stableStringify(second.events));
    expect(stableStringify(first.blackboard)).toBe(stableStringify(second.blackboard));
    expect(first.events.some((item) => item.type === 'ZEUS_READINESS_EVALUATED')).toBe(true);
    expect(first.events.some((item) => item.actor === 'ZEUS')).toBe(false);
  });

  test('OUTPUT_TOKENS=null remains truthful and usage metadata is mapped when supplied', async () => {
    const nullUsage = await (await import('./phase5c-live-diagnostics')).runResponseDiagnostic(configForPhase5d(), mockTransportForPhase5d());
    expect(nullUsage.FINAL_EXECUTION_STATUS).toBe('SUCCESS');
    expect(nullUsage.OUTPUT_TOKENS).toBeNull();
    const usage = await (await import('./phase5c-live-diagnostics')).runResponseDiagnostic(configForPhase5d(), new Phase5dTransport(123));
    expect(usage.FINAL_EXECUTION_STATUS).toBe('SUCCESS');
    expect(usage.OUTPUT_TOKENS).toBe(123);
  });
});
