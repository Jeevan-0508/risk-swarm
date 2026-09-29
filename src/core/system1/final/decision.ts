/**
 * `runSystem1ThenSwarm()` — CASE -> LAYA PROPOSAL -> JEV PROPOSAL -> ARENA -> SWARM EVIDENCE REVIEW.
 * A System-1 model proposal or agreement never becomes a final action. Every `FinalDecision` explains
 * WHAT/WHY/EVIDENCE/CONFIDENCE STATUS/DISAGREEMENT/ESCALATION/REPLAY/FINAL, honestly — `replay` is
 * `NOT_RUN` here, not fabricated, because
 * wiring ORBIT's adversarial replay (`core/orbit/orbit.ts`, which runs over a full `RunResult` from
 * `investigate()`) onto a Council verdict is a real, separate integration this slice does not build.
 */
import { routeSystem1Case, type RouteSystem1CaseDeps } from '../router/route';
import { escalateToSwarm } from './escalate';
import type { EscalateToSwarmArgs } from './escalate';
import type { System1Case } from '../types';
import type { CouncilResult } from '../../council/types';

export type FinalDecisionSource = 'SWARM' | 'ABSTAINED';

export interface FinalDecision {
  case_id: string;
  source: FinalDecisionSource;
  what: string;
  why: string;
  evidence_ids: string[];
  /** Null because upstream model self-reports are not calibrated probabilities or evidence of correctness. */
  confidence: null;
  confidence_note: string;
  disagreement: import('../arena/types').ModelDisagreement | null;
  escalation: { escalated: boolean; trigger: import('../router/policy').EscalationTrigger };
  replay: 'NOT_RUN' | 'STABLE' | 'FRAGILE' | 'FAILED' | 'INCONCLUSIVE';
  final: 'INSUFFICIENT_EVIDENCE' | 'MODEL_POSITION_FOR_REVIEW';
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
        confidence: null,
        confidence_note: 'No confidence estimate is available; the system abstained because evidence or execution was insufficient.',
        disagreement: route.arena.disagreement,
        escalation: { escalated: false, trigger: route.decision.escalation_trigger },
        replay: 'NOT_RUN',
        final: 'INSUFFICIENT_EVIDENCE',
      },
    };
  }

  // ESCALATE_SWARM
  if (!deps.swarm) {
    throw new Error('routeSystem1Case escalated to SWARM but no swarm dependencies (evidence/config/deps) were supplied — see RunSystem1ThenSwarmDeps.swarm.');
  }
  const council = await escalateToSwarm({ case: caseInput, route, ...deps.swarm });
  const hasCitedEvidence = council.verdict.verdict.cited_evidence_ids.length > 0;
  const hasModelPosition = council.verdict.verdict.verdict_type !== 'UNRESOLVED' && hasCitedEvidence;

  return {
    council,
    final: {
      case_id: caseInput.case_id,
      source: 'SWARM',
      what: council.verdict.verdict.answer,
      why: `Escalated (${route.decision.escalation_trigger}): ${route.decision.reason}. SWARM position: ${council.verdict.verdict.verdict_type}. Evidence-ID validation does not verify citation relevance or entailment.`,
      evidence_ids: council.verdict.verdict.cited_evidence_ids,
      confidence: null,
      confidence_note: 'The Council does not produce a numeric confidence estimate; agreement is not verification.',
      disagreement: route.arena.disagreement,
      escalation: { escalated: true, trigger: route.decision.escalation_trigger },
      replay: 'NOT_RUN',
      final: hasModelPosition ? 'MODEL_POSITION_FOR_REVIEW' : 'INSUFFICIENT_EVIDENCE',
    },
  };
}
