/**
 * `runSystem1ThenSwarm()` — the smallest complete vertical slice (directive's own closing
 * instruction): CASE -> LAYA -> JEV -> ARENA -> DISAGREEMENT -> SELECTIVE SWARM -> STRUCTURED FINAL
 * DECISION. Every `FinalDecision` explains WHAT/WHY/EVIDENCE/CONFIDENCE/DISAGREEMENT/ESCALATION/
 * REPLAY/FINAL (directive §32), honestly - `replay` is `NOT_RUN` here, not fabricated, because
 * wiring ORBIT's adversarial replay (`core/orbit/orbit.ts`, which runs over a full `RunResult` from
 * `investigate()`) onto a Council verdict is a real, separate integration this slice does not build.
 */
import { routeSystem1Case, type RouteSystem1CaseDeps } from '../router/route';
import { escalateToSwarm } from './escalate';
import type { EscalateToSwarmArgs } from './escalate';
import type { System1Case } from '../types';
import type { CouncilResult } from '../../council/types';

export type FinalDecisionSource = 'SYSTEM1' | 'SWARM' | 'ABSTAINED';

export interface FinalDecision {
  case_id: string;
  source: FinalDecisionSource;
  what: string;
  why: string;
  evidence_ids: string[];
  confidence: number;
  disagreement: import('../arena/types').ModelDisagreement | null;
  escalation: { escalated: boolean; trigger: import('../router/policy').EscalationTrigger };
  replay: 'NOT_RUN' | 'STABLE' | 'FRAGILE' | 'FAILED' | 'INCONCLUSIVE';
  final: string;
}

export interface RunSystem1ThenSwarmDeps {
  route?: RouteSystem1CaseDeps;
  /** Only read when the router escalates - a case System-1 accepts alone never needs evidence or
   * a model registry, matching directive §23's cost goal. */
  swarm?: Omit<EscalateToSwarmArgs, 'case' | 'route'>;
}

export async function runSystem1ThenSwarm(
  caseInput: System1Case,
  deps: RunSystem1ThenSwarmDeps = {},
): Promise<{ final: FinalDecision; council: CouncilResult | null }> {
  const route = await routeSystem1Case(caseInput, deps.route);

  if (route.decision.action === 'ABSTAIN') {
    return {
      council: null,
      final: {
        case_id: caseInput.case_id,
        source: 'ABSTAINED',
        what: 'No decision.',
        why: route.decision.reason,
        evidence_ids: [],
        confidence: 0,
        disagreement: route.arena.disagreement,
        escalation: { escalated: false, trigger: route.decision.escalation_trigger },
        replay: 'NOT_RUN',
        final: 'INSUFFICIENT_EVIDENCE',
      },
    };
  }

  if (route.decision.action === 'ACCEPT_SYSTEM1') {
    const laya = route.arena.laya_result;
    const jev = route.arena.jev_result;
    return {
      council: null,
      final: {
        case_id: caseInput.case_id,
        source: 'SYSTEM1',
        what: laya.decision,
        why: route.decision.reason,
        evidence_ids: [...laya.evidence_ids, ...(jev?.evidence_ids ?? [])],
        confidence: jev ? Math.min(laya.confidence, jev.confidence) : laya.confidence,
        disagreement: null,
        escalation: { escalated: false, trigger: null },
        replay: 'NOT_RUN',
        final: laya.decision,
      },
    };
  }

  // ESCALATE_SWARM
  if (!deps.swarm) {
    throw new Error('routeSystem1Case escalated to SWARM but no swarm dependencies (evidence/config/deps) were supplied — see RunSystem1ThenSwarmDeps.swarm.');
  }
  const council = await escalateToSwarm({ case: caseInput, route, ...deps.swarm });
  const resolved = council.verdict.verdict.verdict_type !== 'UNRESOLVED';

  return {
    council,
    final: {
      case_id: caseInput.case_id,
      source: 'SWARM',
      what: council.verdict.verdict.answer,
      why: `Escalated (${route.decision.escalation_trigger}): ${route.decision.reason}. SWARM verdict: ${council.verdict.verdict.verdict_type}.`,
      evidence_ids: council.verdict.verdict.cited_evidence_ids,
      confidence: council.verdict.verdict.confidence,
      disagreement: route.arena.disagreement,
      escalation: { escalated: true, trigger: route.decision.escalation_trigger },
      replay: 'NOT_RUN',
      final: resolved ? council.verdict.verdict.answer : 'UNRESOLVED',
    },
  };
}
