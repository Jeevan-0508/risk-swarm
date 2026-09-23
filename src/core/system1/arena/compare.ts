/**
 * Pure comparison logic for the System-1 Arena (directive §6, §7). Given the independent results
 * Laya and Jev produced for the *same* case, decide whether they agree, and if not, build a real
 * `ModelDisagreement` rather than averaging the difference away (directive §7: "Do NOT simply
 * average the scores").
 *
 * Only `CLASSIFICATION`, `CONFIDENCE` and `RISK` are ever assigned here — the Arena has no evidence
 * or policy context to tell a `NOVELTY`/`EVIDENCE`/`POLICY` disagreement apart from a plain
 * classification split; diagnosing *why* two models disagree is SWARM's job once escalated (see
 * `system1/final/escalate.ts`'s `DIAGNOSE_DISAGREEMENT` step, directive §10), not the Arena's.
 */
import type { System1Result } from '../types';
import type { DisagreementType, ModelDisagreement, System1ArenaResult } from './types';
import { ACTION_LADDER, type ActionBand } from '../../domain/model';

const FULL_AGREEMENT_SCORE = 0.9;
const DISAGREEMENT_SCORE = 0.15;
/** Same-stance confidence gap above which two "agreeing" models still count as a CONFIDENCE
 * disagreement (directive §7 lists CONFIDENCE as first-class, distinct from a stance split). */
const CONFIDENCE_GAP_THRESHOLD = 0.35;

function actionLadderRungGap(a: string, b: string): number | null {
  const ia = ACTION_LADDER.indexOf(a as ActionBand);
  const ib = ACTION_LADDER.indexOf(b as ActionBand);
  if (ia === -1 || ib === -1) return null;
  return Math.abs(ia - ib);
}

function classifyDisagreement(args: { layaResult: System1Result; jevResult: System1Result }): { type: DisagreementType; detail: string } {
  const { layaResult, jevResult } = args;
  if (layaResult.decision === jevResult.decision) {
    return {
      type: 'CONFIDENCE',
      detail: `Both models chose "${layaResult.decision}" but confidence differs by ${Math.abs(layaResult.confidence - jevResult.confidence).toFixed(3)} (>${CONFIDENCE_GAP_THRESHOLD}).`,
    };
  }
  const rungGap = actionLadderRungGap(layaResult.decision, jevResult.decision);
  if (rungGap !== null && rungGap >= 2) {
    return {
      type: 'RISK',
      detail: `Laya="${layaResult.decision}" vs Jev="${jevResult.decision}" are ${rungGap} rungs apart on the action ladder (${ACTION_LADDER.join(' < ')}) - a risk-severity disagreement, not just a label mismatch.`,
    };
  }
  return {
    type: 'CLASSIFICATION',
    detail: `Laya chose "${layaResult.decision}" (confidence ${layaResult.confidence.toFixed(3)}); Jev chose "${jevResult.decision}" (confidence ${jevResult.confidence.toFixed(3)}).`,
  };
}

export function compareSystem1Results(args: {
  caseId: string;
  task: string;
  layaResult: System1Result;
  jevResult: System1Result | null;
  latencyMs: { laya: number; jev: number | null };
}): System1ArenaResult {
  const { caseId, task, layaResult, jevResult, latencyMs } = args;

  const jevUsable = jevResult !== null && (jevResult.status === 'LIVE' || jevResult.status === 'SHADOW');

  if (!jevUsable) {
    return {
      case_id: caseId,
      laya_result: layaResult,
      jev_result: jevResult,
      agreement: false,
      agreement_score: 0,
      confidence_delta: null,
      evidence_overlap: null,
      latency_ms: { laya: latencyMs.laya, jev: latencyMs.jev, total: latencyMs.laya + (latencyMs.jev ?? 0) },
      // Not a `ModelDisagreement`: directive §7's disagreement types describe two real, comparable
      // opinions. An absent second opinion is a routing fact (see router/policy.ts), not a
      // disagreement to record as if Jev had actually taken a position.
      disagreement: null,
    };
  }

  const confidenceDelta = Math.abs(layaResult.confidence - (jevResult as System1Result).confidence);
  const sameDecision = layaResult.decision === (jevResult as System1Result).decision;
  const meaningfulConfidenceGap = confidenceDelta > CONFIDENCE_GAP_THRESHOLD;

  const evidenceOverlap = (() => {
    const a = new Set(layaResult.evidence_ids);
    const b = new Set((jevResult as System1Result).evidence_ids);
    if (a.size === 0 && b.size === 0) return null;
    const union = new Set([...a, ...b]);
    const intersection = [...a].filter((id) => b.has(id));
    return union.size === 0 ? null : intersection.length / union.size;
  })();

  if (sameDecision && !meaningfulConfidenceGap) {
    return {
      case_id: caseId,
      laya_result: layaResult,
      jev_result: jevResult,
      agreement: true,
      agreement_score: FULL_AGREEMENT_SCORE,
      confidence_delta: confidenceDelta,
      evidence_overlap: evidenceOverlap,
      latency_ms: { laya: latencyMs.laya, jev: latencyMs.jev, total: latencyMs.laya + (latencyMs.jev ?? 0) },
      disagreement: null,
    };
  }

  const classified = classifyDisagreement({ layaResult, jevResult: jevResult as System1Result });
  const disagreement: ModelDisagreement = {
    case_id: caseId,
    task,
    laya_decision: layaResult.decision,
    jev_decision: (jevResult as System1Result).decision,
    laya_confidence: layaResult.confidence,
    jev_confidence: (jevResult as System1Result).confidence,
    disagreement_type: classified.type,
    detail: classified.detail,
  };

  return {
    case_id: caseId,
    laya_result: layaResult,
    jev_result: jevResult,
    agreement: false,
    agreement_score: DISAGREEMENT_SCORE,
    confidence_delta: confidenceDelta,
    evidence_overlap: evidenceOverlap,
    latency_ms: { laya: latencyMs.laya, jev: latencyMs.jev, total: latencyMs.laya + (latencyMs.jev ?? 0) },
    disagreement,
  };
}
