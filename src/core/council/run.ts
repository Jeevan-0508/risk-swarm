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
import { assessDisagreement, NO_INDEPENDENT_POSITIONS_MESSAGE } from './deliberate';
import { requestVerdict } from './deliberate';
import { requestPosition } from './positions';
import { REASONING_AGENTS, type CouncilResult, type CouncilTraceEvent, type CouncilVerdict, type OlympianPosition, type ReasoningAgent } from './types';
import type { ReasonResult } from '../reasoner/types';

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

  if (evidence.length === 0) {
    const noEvidenceReason = 'No evidence records were supplied; no model was called and no position was formed.';
    const positionResults = {} as Record<ReasoningAgent, ReasonResult<OlympianPosition>>;
    const positions = {} as CouncilResult['positions'];
    for (const agent of REASONING_AGENTS) {
      positionResults[agent] = {
        value: {
          agent,
          stance: 'insufficient_evidence',
          reasoning_summary: noEvidenceReason,
          claims: [],
          evidence_ids: [],
          evidence_requests: ['Provide source records with provenance before analysis.'],
          assumptions: [],
        },
        provider: 'deterministic',
        degraded: false,
        degraded_reason: null,
        est_tokens: 0,
        ms: 0,
      };
      positions[agent] = {
        position: positionResults[agent].value,
        provider: 'deterministic',
        degraded: false,
        degraded_reason: null,
        ms: 0,
        est_tokens: 0,
      };
    }
    const disagreement = assessDisagreement(positionResults);
    const verdict: CouncilVerdict = {
      verdict_type: 'UNRESOLVED',
      answer: 'insufficient_evidence',
      rationale: [],
      minority_view: null,
      unresolved: [noEvidenceReason],
      cited_evidence_ids: [],
    };
    const trace: CouncilTraceEvent[] = [
      { at: now(), kind: 'summoned', detail: `No evidence records supplied for: "${question}". Abstaining without contacting models.` },
      { at: now(), kind: 'disagreement_assessed', detail: NO_INDEPENDENT_POSITIONS_MESSAGE },
      { at: now(), kind: 'verdict_ready', agent: 'ZEUS', detail: 'UNRESOLVED: insufficient_evidence (no model called)' },
    ];
    for (const event of trace) onEvent?.(event);
    return {
      question,
      positions,
      disagreement,
      verdict: { verdict, provider: 'deterministic', degraded: false, degraded_reason: null },
      trace,
      model_diversity: { active_agents: 0, providers: 0, label: 'none — abstained before model calls' },
    };
  }

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
        ? `${agent} reasoning independently over ${evidence.length} evidence item(s) via ${a.provider}/${a.model} — request started`
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
    // Elapsed time only means something for a real network call - a deterministic fallback resolves
    // in under a millisecond and printing "0.0s" next to it would read as a measurement, not a fact.
    const wasNetworkCall = result.provider !== 'deterministic';
    const elapsedS = (result.ms / 1000).toFixed(1);
    push(
      result.degraded
        ? { kind: 'agent_degraded', agent, detail: `${agent} could not reason independently: ${result.degraded_reason}${wasNetworkCall ? ` (elapsed ${elapsedS}s)` : ''}` }
        : {
            kind: 'position_ready',
            agent,
            detail: `${agent} → "${result.value.stance}" (${result.provider})${wasNetworkCall ? ` — provider response received in ${elapsedS}s` : ''}`,
          },
    );
  }

  const disagreement = assessDisagreement(positionsForDeliberation);
  push({
    kind: 'disagreement_assessed',
    detail:
      disagreement.independent_count === 0
        ? NO_INDEPENDENT_POSITIONS_MESSAGE
        : `${disagreement.agreement} across ${disagreement.independent_count} independent position(s): ${disagreement.distinct_stances.join(', ') || 'none'}`,
  });

  push({
    kind: 'zeus_called',
    agent: 'ZEUS',
    detail: config.ZEUS.enabled
      ? `Zeus synthesizing a verdict from structured positions and the disagreement assessment via ${config.ZEUS.provider}/${config.ZEUS.model}`
      : 'Zeus has no model configured — synthesizing a verdict mechanically from the structured positions and the disagreement assessment, not an independent model judgment',
  });
  const zeus = await requestVerdict(reasoners.ZEUS, question, positionsForDeliberation, disagreement);
  push({ kind: 'verdict_ready', agent: 'ZEUS', detail: `${zeus.value.verdict_type}: "${zeus.value.answer}"` });

  return {
    question,
    positions,
    disagreement,
    verdict: { verdict: zeus.value, provider: zeus.provider, degraded: zeus.degraded, degraded_reason: zeus.degraded_reason },
    trace,
    model_diversity: modelDiversity(config, deps),
  };
}
