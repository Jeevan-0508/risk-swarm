import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPhase5GoldenScenario } from '../src/swarm/evaluation/scenarios';
import { planPhase5Challenges, selectAndAdmitPhase5Challenges, type Phase5ChallengeAdmissionResult } from '../src/swarm/debate/challenges';
import { runOfflineAdversarialDeliberation } from '../src/swarm/engine/offline';
import { stableStringify, sealEvidence } from '../src/swarm/evidence/package';
import { Phase5gArtifactSession, certifyPhase5gArtifact, loadPhase5gArtifact, replayPhase5gArtifact } from './phase5g-durable-artifact';

async function fixture() {
  const scenario = buildPhase5GoldenScenario();
  const result = await runOfflineAdversarialDeliberation(scenario);
  const positions = result.events.filter((event): event is Extract<typeof event, { type: 'POSITION_PROPOSED' }> => event.type === 'POSITION_PROPOSED').map((event) => event.position);
  const disagreements = result.events.filter((event): event is Extract<typeof event, { type: 'DISAGREEMENT_IDENTIFIED' }> => event.type === 'DISAGREEMENT_IDENTIFIED').map((event) => event.disagreement);
  const planned = planPhase5Challenges(positions, disagreements, scenario.case);
  return { scenario, positions, disagreements, planned };
}

function candidatesForDisagreement(
  base: ReturnType<typeof planPhase5Challenges>[number],
  disagreement: Awaited<ReturnType<typeof fixture>>['disagreements'][number],
  positions: Awaited<ReturnType<typeof fixture>>['positions'],
  seats: readonly ('ATHENA' | 'HADES' | 'APOLLO')[] = ['ATHENA', 'HADES', 'APOLLO'],
) {
  return seats.map((seat, index) => {
    const target = positions.find((position) => position.position_id === disagreement.positions_by_seat[seat])!;
    const targetClaim = target.claims[0]?.claim_id ?? null;
    return {
      ...base,
      challenge_id: `challenge-${index + 1}` as typeof base.challenge_id,
      to_seat: seat,
      target_position: target.position_id,
      target_claim: targetClaim,
      target_type: targetClaim ? 'CLAIM' as const : 'POSITION' as const,
      disagreement_id: disagreement.disagreement_id,
      evidence_ids: [...disagreement.evidence_ids],
    };
  });
}

describe('Phase 5G.2 canonical challenge admission', () => {
  test('CASES A-F: one, two, three, four, six, and eight candidate distributions remain bounded', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const admission = (candidates: readonly typeof planned[number][]) => selectAndAdmitPhase5Challenges(candidates, disagreements, positions, scenario.case);
    const first = disagreements[0]!;
    const firstBase = planned.find((candidate) => candidate.disagreement_id === first.disagreement_id)!;
    expect(admission(candidatesForDisagreement(firstBase, first, positions, ['ATHENA']).slice(0, 1)).admitted).toHaveLength(1);
    expect(admission(candidatesForDisagreement(firstBase, first, positions).slice(0, 2)).admitted).toHaveLength(2);
    expect(admission(candidatesForDisagreement(firstBase, first, positions)).admitted).toHaveLength(2);
    const distributed = (count: number) => disagreements.slice(0, count).flatMap((disagreement, disagreementIndex) => {
      const base = planned.find((candidate) => candidate.disagreement_id === disagreement.disagreement_id)!;
      return candidatesForDisagreement(base, disagreement, positions).slice(0, 2).map((candidate, candidateIndex) => ({ ...candidate, challenge_id: `distribution-${disagreementIndex}-${candidateIndex}` as typeof candidate.challenge_id }));
    });
    expect(admission(distributed(2)).admitted).toHaveLength(4);
    expect(admission(distributed(3)).admitted).toHaveLength(6);
    expect(admission(distributed(4)).admitted).toHaveLength(6);
  });

  test('CASE A: three same-disagreement candidates admit exactly two before the reducer', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const disagreement = disagreements[0]!;
    const base = planned.find((candidate) => candidate.disagreement_id === disagreement.disagreement_id)!;
    const report = selectAndAdmitPhase5Challenges(candidatesForDisagreement(base, disagreement, positions), disagreements, positions, scenario.case);
    expect(report.counts).toMatchObject({ provider_candidate_count: 3, dto_valid_candidate_count: 3, semantic_valid_candidate_count: 3, compatible_candidate_count: 3, deduplicated_candidate_count: 3, selected_candidate_count: 2, admitted_challenge_count: 2 });
    expect(report.admitted).toHaveLength(2);
    expect(report.dispositions.filter((item) => item.disposition === 'BUDGET_REJECTED')).toHaveLength(1);
  });

  test('CASE B: duplicate semantic identity is rejected while different targets remain admissible', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const disagreement = disagreements[0]!;
    const base = planned.find((candidate) => candidate.disagreement_id === disagreement.disagreement_id)!;
    const candidates = candidatesForDisagreement(base, disagreement, positions);
    const duplicate = { ...candidates[0]!, challenge_id: 'challenge-duplicate' as typeof base.challenge_id };
    const report = selectAndAdmitPhase5Challenges([duplicate, ...candidates], disagreements, positions, scenario.case);
    expect(report.dispositions.filter((item) => item.disposition === 'DUPLICATE_REJECTED')).toHaveLength(1);
    expect(report.admitted).toHaveLength(2);
  });

  test('CASE C: different disagreements remain independent within the aggregate bounds', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const candidates = planned.map((candidate, index) => {
      const disagreement = disagreements.find((item) => item.disagreement_id === candidate.disagreement_id)!;
      return candidatesForDisagreement(candidate, disagreement, positions, [(['ATHENA', 'HADES', 'APOLLO'] as const)[index % 3]!])[0]!;
    });
    const report = selectAndAdmitPhase5Challenges(candidates, disagreements, positions, scenario.case);
    expect(report.admitted).toHaveLength(4);
    expect(report.dispositions.every((item) => item.disposition === 'ADMITTED')).toBe(true);
  });

  test('CASE D: incompatible challenge dimensions are rejected before admission', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const disagreement = disagreements.find((item) => item.type === 'CONFIDENCE')!;
    const base = planned.find((candidate) => candidate.disagreement_id === disagreement.disagreement_id)!;
    const incompatible = { ...candidatesForDisagreement(base, disagreement, positions, ['ATHENA'])[0]!, challenge_id: 'incompatible' as typeof base.challenge_id, challenge_type: 'SEVERITY' as const };
    const report = selectAndAdmitPhase5Challenges([incompatible], disagreements, positions, scenario.case);
    expect(report.admitted).toHaveLength(0);
    expect(report.dispositions[0]).toMatchObject({ disposition: 'INCOMPATIBLE_REJECTED', reason: 'CHALLENGE_TYPE_INCOMPATIBLE' });
  });

  test('CASE E: semantically invalid target references are rejected without reducer events', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const disagreement = disagreements[0]!;
    const base = planned.find((candidate) => candidate.disagreement_id === disagreement.disagreement_id)!;
    const invalid = { ...base, challenge_id: 'invalid-target' as typeof base.challenge_id, target_position: 'position-not-in-disagreement' as typeof base.target_position };
    const report = selectAndAdmitPhase5Challenges([invalid], disagreements, positions, scenario.case);
    expect(report.admitted).toHaveLength(0);
    expect(report.dispositions[0]).toMatchObject({ disposition: 'SEMANTIC_REJECTED', reason: 'CHALLENGE_TARGET_REFERENCE_INVALID' });
  });

  test('CASE J mixed candidates: valid, duplicate, incompatible, semantic, and overflow dispositions are all retained', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const disagreement = disagreements[0]!;
    const base = planned.find((candidate) => candidate.disagreement_id === disagreement.disagreement_id)!;
    const valid = candidatesForDisagreement(base, disagreement, positions);
    const duplicate = { ...valid[0]!, challenge_id: 'mixed-duplicate' as typeof base.challenge_id };
    const incompatible = { ...valid[1]!, challenge_id: 'mixed-incompatible' as typeof base.challenge_id, challenge_type: 'CONTROL' as const };
    const semantic = { ...valid[2]!, challenge_id: 'mixed-semantic' as typeof base.challenge_id, target_position: 'position-unknown' as typeof base.target_position };
    const overflow = { ...valid[0]!, challenge_id: 'mixed-overflow' as typeof base.challenge_id, requested_action: 'REVISE' as const };
    const report = selectAndAdmitPhase5Challenges([...valid, duplicate, incompatible, semantic, overflow], disagreements, positions, scenario.case);
    expect(report.admitted).toHaveLength(2);
    expect(report.dispositions.map((item) => item.disposition)).toEqual(expect.arrayContaining(['ADMITTED', 'DUPLICATE_REJECTED', 'INCOMPATIBLE_REJECTED', 'SEMANTIC_REJECTED', 'BUDGET_REJECTED']));
    expect(report.dispositions.every((item) => item.evidence_reference_count >= 0 && !('reasoning' in item))).toBe(true);
  });

  test('CASE F: four challenges to one target seat across four disagreements enforce the target-seat bound', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const extra = { ...disagreements[0]!, disagreement_id: 'disagreement-extra-target-seat' as typeof disagreements[number]['disagreement_id'] };
    const allDisagreements = [...disagreements.slice(0, 3), extra];
    const candidates = allDisagreements.map((disagreement, index) => {
      const sourceDisagreement = disagreement.disagreement_id === extra.disagreement_id ? disagreements[0]! : disagreement;
      const base = planned.find((candidate) => candidate.disagreement_id === sourceDisagreement.disagreement_id)!;
      return { ...candidatesForDisagreement(base, disagreement, positions, ['ATHENA'])[0]!, challenge_id: `seat-bound-${index + 1}` as typeof base.challenge_id };
    });
    const report = selectAndAdmitPhase5Challenges(candidates, allDisagreements, positions, scenario.case);
    expect(report.admitted).toHaveLength(3);
    expect(report.dispositions.filter((item) => item.disposition === 'BUDGET_REJECTED')).toHaveLength(1);
  });

  test('CASE G: seven candidates across four disagreements enforce the total six-challenge bound', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const extra = { ...disagreements[0]!, disagreement_id: 'disagreement-extra-total' as typeof disagreements[number]['disagreement_id'] };
    const allDisagreements = [...disagreements.slice(0, 3), extra];
    const candidates = allDisagreements.flatMap((disagreement, disagreementIndex) => {
      const sourceDisagreement = disagreement.disagreement_id === extra.disagreement_id ? disagreements[0]! : disagreement;
      const source = planned.find((candidate) => candidate.disagreement_id === sourceDisagreement.disagreement_id)!;
      return candidatesForDisagreement(source, disagreement, positions).slice(0, disagreementIndex === 3 ? 1 : 2).map((candidate, index) => ({ ...candidate, challenge_id: `total-bound-${disagreementIndex}-${index}` as typeof candidate.challenge_id }));
    });
    const report = selectAndAdmitPhase5Challenges(candidates, allDisagreements, positions, scenario.case);
    expect(candidates).toHaveLength(7);
    expect(report.admitted).toHaveLength(6);
    expect(report.dispositions.filter((item) => item.disposition === 'BUDGET_REJECTED')).toHaveLength(1);
  });

  test('CASE H: provider order cannot change the canonical admitted subset', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const candidates = planned.map((candidate, index) => ({ ...candidate, challenge_id: `order-${index + 1}` as typeof candidate.challenge_id }));
    const first = selectAndAdmitPhase5Challenges(candidates, disagreements, positions, scenario.case);
    const second = selectAndAdmitPhase5Challenges([...candidates].reverse(), disagreements, positions, scenario.case);
    expect(stableStringify(first.admitted)).toBe(stableStringify(second.admitted));
    expect(stableStringify(first.dispositions)).not.toBe('');
  });

  test('CASE I: the real incident shape is admitted upstream and response execution proceeds', async () => {
    const { scenario, positions, disagreements, planned } = await fixture();
    const targetDisagreement = disagreements[0]!;
    const source = planned.find((candidate) => candidate.disagreement_id === targetDisagreement.disagreement_id)!;
    let admission: Phase5ChallengeAdmissionResult | undefined;
    const result = await runOfflineAdversarialDeliberation({
      ...scenario,
      challenge_generator: { generate: async () => candidatesForDisagreement(source, targetDisagreement, positions) },
      challenge_admission_observer: (report) => { admission = report; },
    });
    expect(admission?.counts).toMatchObject({ provider_candidate_count: 3, admitted_challenge_count: 2 });
    expect(result.events.filter((event) => event.type === 'CHALLENGE_RESPONSE_STARTED')).toHaveLength(2);
    expect(result.blackboard.challenges).toHaveLength(2);
    expect(result.blackboard.state).toBe('AUDIT');
  });

  test('CASE J: durable metadata records dispositions without challenge text or hidden provider material', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'swarm-phase5g2-admission-'));
    try {
      const { scenario, positions, disagreements, planned } = await fixture();
      const packageValue = sealEvidence(scenario.case, scenario.evidence, { package_id: scenario.package_id, sealed_at: scenario.sealed_at });
      const session = new Phase5gArtifactSession({ provider: 'mock', model: 'phase5g2-offline-mock', case_value: scenario.case as unknown as Record<string, unknown>, evidence_package: packageValue as unknown as Record<string, unknown>, global_budget: 11, max_output_tokens: 4096 }, { directory, run_id: 'phase5g2-admission-test' });
      const targetDisagreement = disagreements[0]!;
      const source = planned.find((candidate) => candidate.disagreement_id === targetDisagreement.disagreement_id)!;
      const result = await runOfflineAdversarialDeliberation({
        ...scenario,
        request_observer: session,
        event_observer: (event) => session.observeEvent(event),
        challenge_admission_observer: (report) => session.observeChallengeAdmission(report),
        challenge_generator: { generate: async () => candidatesForDisagreement(source, targetDisagreement, positions) },
      });
      session.finalize(result);
      const artifact = loadPhase5gArtifact(session.artifact_path);
      expect(artifact.challenge_round).toMatchObject({ provider_candidate_count: 3, admitted_challenge_count: 2, admission_boundary: 'BEFORE_REDUCER' });
      expect((artifact.challenge_round.candidate_dispositions as Array<Record<string, unknown>>).some((item) => item.disposition === 'BUDGET_REJECTED')).toBe(true);
      expect(stableStringify(artifact.challenge_round.candidate_dispositions)).not.toContain('challenge_text');
      expect(stableStringify(artifact.challenge_round.candidate_dispositions)).not.toContain('reasoning');
      const certification = certifyPhase5gArtifact(artifact);
      expect(certification).toMatchObject({ ok: true, request_ledger_reconciliation: true, event_ordering: true, replayable: true });
      expect(replayPhase5gArtifact(artifact).state).toBe('AUDIT');
      expect(artifact.budgets).toMatchObject({ challenge_generation_request_count: 1, challenge_response_request_count: 2, total_request_count: 7 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
