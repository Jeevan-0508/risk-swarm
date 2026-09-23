/**
 * `runSystem1Arena()` (directive §6): sends the same case independently to Laya and Jev. Neither
 * model receives the other's answer — `callLaya`/`callJev` each take only the raw `System1Case`, so
 * there is no shared object either could read the other's result from.
 */
import { callLaya } from '../laya/client';
import type { LayaCallDeps } from '../laya/client';
import { DEFAULT_LAYA_MODEL_ID } from '../laya/registry';
import { callJev } from '../jev/client';
import type { JevCallDeps } from '../jev/client';
import type { System1Case } from '../types';
import { compareSystem1Results } from './compare';
import type { System1ArenaResult } from './types';

export interface RunSystem1ArenaDeps {
  layaModelId?: string;
  layaDeps?: LayaCallDeps;
  jevDeps?: JevCallDeps;
}

export async function runSystem1Arena(
  input: System1Case,
  deps: RunSystem1ArenaDeps = {},
): Promise<System1ArenaResult> {
  const layaModelId = deps.layaModelId ?? DEFAULT_LAYA_MODEL_ID;

  const [layaResult, jevResult] = await Promise.all([
    callLaya(layaModelId, input, deps.layaDeps),
    callJev(input, deps.jevDeps),
  ]);

  return compareSystem1Results({
    caseId: input.case_id,
    task: input.question,
    layaResult,
    jevResult,
    latencyMs: { laya: layaResult.latency_ms, jev: jevResult.latency_ms },
  });
}
