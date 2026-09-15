/**
 * EVOLUTION 6.0 — Council orchestration. Exactly four model calls maximum per question
 * (`MAX_OLYMPIAN_CALLS`): three independent positions, issued in parallel so none can see another's
 * answer, then one Zeus verdict over the structured result. No debate rounds yet — that is Phase 2.
 *
 * Every event pushed to `onEvent` corresponds to a real call this function actually made or a real
 * result it actually received. Nothing here is animated ahead of the fact.
 */
import type { NormalizedEvidence } from '../research/normalize';
import { createOlympianReasoners, modelDiversity, type RegistryConfig, type RegistryDeps } from '../reasoner/registry';
import { assessDisagreement } from './deliberate';
import { requestVerdict } from './deliberate';
import { requestPosition } from './positions';
import { REASONING_AGENTS, type CouncilResult, type CouncilTraceEvent, type ReasoningAgent } from './types';

export const MAX_OLYMPIAN_CALLS = 4;

export async function runCouncil(
  question: string,
  evidence: NormalizedEvidence[],
  config: RegistryConfig,
  deps: RegistryDeps,
  onEvent?: (event: CouncilTraceEvent) => void,
  now: () => string = () => new Date().toISOString(),
): Promise<CouncilResult> {
  const trace: CouncilTraceEvent[] = [];
  const push = (e: Omit<CouncilTraceEvent, 'at'>) => {
    const event = { ...e, at: now() };
    trace.push(event);
    onEvent?.(event);
  };

  const reasoners = createOlympianReasoners(config, deps);
  push({ kind: 'summoned', detail: `${REASONING_AGENTS.length} Olympians summoned for: "${question}"` });

  /*
   * Honest about what is actually about to happen: an enabled, keyed agent is about to make a real
   * model call; a disabled one never touches a model at all, and the trace must not imply otherwise
   * (Council Mode routinely runs with 1 of 4 Olympians configured - this is expected, not degraded).
   */
  for (const agent of REASONING_AGENTS) {
    const a = config[agent];
    push({
      kind: 'agent_called',
      agent,
      detail: a.enabled
        ? `${agent} reasoning independently over ${evidence.length} evidence item(s) via ${a.provider}/${a.model}`
        : `${agent} has no model configured — using its deterministic fallback over ${evidence.length} evidence item(s), not an independent model opinion`,
    });
  }

  // Parallel and structurally independent: each call only ever receives `question` and `evidence`.
  const settled = await Promise.all(REASONING_AGENTS.map((agent) => requestPosition(agent, reasoners[agent], question, evidence)));
  const positions = {} as CouncilResult['positions'];
  const positionsForDeliberation = {} as Record<ReasoningAgent, (typeof settled)[number]>;
  for (const [i, agent] of REASONING_AGENTS.entries()) {
    const result = settled[i]!;
    positionsForDeliberation[agent] = result;
    positions[agent] = { position: result.value, provider: result.provider, degraded: result.degraded, degraded_reason: result.degraded_reason, ms: result.ms, est_tokens: result.est_tokens };
    push(
      result.degraded
        ? { kind: 'agent_degraded', agent, detail: `${agent} could not reason independently: ${result.degraded_reason}` }
        : { kind: 'position_ready', agent, detail: `${agent} → "${result.value.stance}" (${Math.round(result.value.confidence * 100)}% confidence, ${result.provider})` },
    );
  }

  const disagreement = assessDisagreement(positionsForDeliberation);
  push({ kind: 'disagreement_assessed', detail: `${disagreement.agreement} across ${disagreement.independent_count} independent position(s): ${disagreement.distinct_stances.join(', ') || 'none'}` });

  push({
    kind: 'zeus_called',
    agent: 'ZEUS',
    detail: config.ZEUS.enabled
      ? `Zeus synthesizing a verdict from structured positions and the disagreement assessment via ${config.ZEUS.provider}/${config.ZEUS.model}`
      : 'Zeus has no model configured — synthesizing a verdict mechanically from the structured positions and the disagreement assessment, not an independent model judgment',
  });
  const zeus = await requestVerdict(reasoners.ZEUS, question, positionsForDeliberation, disagreement);
  push({ kind: 'verdict_ready', agent: 'ZEUS', detail: `${zeus.value.verdict_type}: "${zeus.value.answer}" (${Math.round(zeus.value.confidence * 100)}%)` });

  return {
    question,
    positions,
    disagreement,
    verdict: { verdict: zeus.value, provider: zeus.provider, degraded: zeus.degraded, degraded_reason: zeus.degraded_reason },
    trace,
    model_diversity: modelDiversity(config, deps),
  };
}
