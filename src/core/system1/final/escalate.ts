/**
 * `escalateToSwarm()` — SYSTEM-1 directive §9, §10. SWARM is this repo's own Olympian Council
 * (`core/council/run.ts`), not a second engine invented for System-1: three independent Olympians
 * reason over real evidence, Zeus synthesizes a verdict, and `assessDisagreement`
 * (`core/council/deliberate.ts`) already implements "diagnose disagreement" as a real, tested
 * function — reused here rather than duplicated.
 *
 * Per §10 ("SWARM must NOT blindly trust either model"), Laya/Jev's positions are never handed to
 * Council as the answer — they are folded into the *question text* as context to diagnose, exactly
 * like a human analyst would be told "two fast models disagreed on this, here's how" before being
 * asked to look into it themselves. Council's own agents still reason from the real evidence given
 * to them, not from System-1's stances.
 */
import { runCouncil } from '../../council/run';
import type { RegistryConfig, RegistryDeps } from '../../reasoner/registry';
import type { CouncilResult, CouncilTraceEvent } from '../../council/types';
import type { NormalizedEvidence } from '../../research/normalize';
import type { System1Case } from '../types';
import type { System1RouteResult } from '../router/route';

export interface EscalateToSwarmArgs {
  case: System1Case;
  route: System1RouteResult;
  evidence: NormalizedEvidence[];
  config: RegistryConfig;
  deps: RegistryDeps;
  onEvent?: (event: CouncilTraceEvent) => void;
  now?: () => string;
}

/** SYSTEM-1 directive §10: SWARM's first task is DIAGNOSE_DISAGREEMENT. Building this into the
 * literal question text (rather than a side-channel Council never reads) is what actually makes
 * Council reason about the disagreement instead of just re-answering the original question blind
 * to the fact that two fast models already looked at it and split. */
export function buildDiagnosticQuestion(caseInput: System1Case, route: System1RouteResult): string {
  const { laya_result: laya, jev_result: jev } = route.arena;
  const lines = [
    caseInput.question,
    '',
    '--- System-1 context for SWARM to diagnose, not to adopt as fact ---',
    `Laya (${laya.model_id}) proposed "${laya.decision}" (self-reported score ${laya.confidence.toFixed(3)}; status ${laya.status}).`,
    jev
      ? `Jev proposed "${jev.decision}" (self-reported score ${jev.confidence.toFixed(3)}; status ${jev.status}).`
      : 'Jev: not called for this case.',
    `Escalation reason: ${route.decision.reason}`,
    route.arena.disagreement
      ? `Disagreement type: ${route.arena.disagreement.disagreement_type} — ${route.arena.disagreement.detail}`
      : 'No classified disagreement (e.g. Jev was unreachable, or evidence was insufficient for a fast call).',
  ];
  return lines.join('\n');
}

export async function escalateToSwarm(args: EscalateToSwarmArgs): Promise<CouncilResult> {
  const question = buildDiagnosticQuestion(args.case, args.route);
  return runCouncil(question, args.evidence, args.config, args.deps, args.onEvent, args.now);
}
