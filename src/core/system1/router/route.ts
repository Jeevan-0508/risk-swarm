/**
 * `routeSystem1Case()` — the lazy LAYA proposal -> JEV proposal -> SWARM evidence-review cascade.
 * Calls Laya first and calls Jev when the case can proceed. Model scores and agreement never accept
 * an action; this case schema has no verifiable source-evidence manifest. The router asks the caller
 * to escalate to SWARM and never runs SWARM itself.
 */
import { callLaya } from '../laya/client';
import type { LayaCallDeps } from '../laya/client';
import { DEFAULT_LAYA_MODEL_ID } from '../laya/registry';
import { callJev } from '../jev/client';
import type { JevCallDeps } from '../jev/client';
import { compareSystem1Results } from '../arena/compare';
import type { System1ArenaResult } from '../arena/types';
import type { System1Case } from '../types';
import { decideAfterJev, decideAfterLaya, type AfterJevDecision, type AfterLayaDecision } from './policy';

export interface System1RouteResult {
  case_id: string;
  jev_called: boolean;
  arena: System1ArenaResult;
  decision: AfterLayaDecision | AfterJevDecision;
}

export interface RouteSystem1CaseDeps {
  layaModelId?: string;
  layaDeps?: LayaCallDeps;
  jevDeps?: JevCallDeps;
}

export async function routeSystem1Case(
  input: System1Case,
  deps: RouteSystem1CaseDeps = {},
): Promise<System1RouteResult> {
  const layaModelId = deps.layaModelId ?? DEFAULT_LAYA_MODEL_ID;
  const layaResult = await callLaya(layaModelId, input, deps.layaDeps);

  const afterLaya = decideAfterLaya(input, layaResult);

  if (afterLaya.action !== 'CALL_JEV') {
    // No Jev call made — the Arena shape still needs a placeholder so callers get one consistent
    // result type regardless of which branch fired. `jev_result: null` states plainly it was never
    // dispatched, distinct from `UNAVAILABLE` (dispatched, but no runtime existed to answer).
    const arena: System1ArenaResult = {
      case_id: input.case_id,
      laya_result: layaResult,
      jev_result: null,
      agreement: false,
      agreement_score: 0,
      confidence_delta: null,
      evidence_overlap: null,
      latency_ms: { laya: layaResult.latency_ms, jev: null, total: layaResult.latency_ms },
      disagreement: null,
    };
    return { case_id: input.case_id, jev_called: false, arena, decision: afterLaya };
  }

  const jevResult = await callJev(input, deps.jevDeps);
  const arena = compareSystem1Results({
    caseId: input.case_id,
    task: input.question,
    layaResult,
    jevResult,
    latencyMs: { laya: layaResult.latency_ms, jev: jevResult.latency_ms },
  });

  const afterJev = decideAfterJev(arena);
  return { case_id: input.case_id, jev_called: true, arena, decision: afterJev };
}
