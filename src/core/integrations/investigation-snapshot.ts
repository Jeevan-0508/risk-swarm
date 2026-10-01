import type { CouncilResult } from '../council/types';
import { REASONING_AGENTS } from '../council/types';
import { SwarmReplayCapture, type BuildSwarmReplayCaptureInput, buildSwarmReplayCapture } from './replay-capture';
import { FraudWatchCandidateMO } from './fraud-watch-candidate';
import { validateInvestigationSnapshot, type InvestigationSnapshot, type InvestigationPosition } from '../../../contracts/investigation-v1.mjs';

const ROLES = { ATHENA: 'evidence_analysis', ARES: 'adversarial_challenge', HADES: 'alternative_explanations' } as const;

/** Candidate fields become a bounded question, never a retrieved source or evidence ID. */
export function candidateInvestigationQuestion(value: unknown): string {
  const candidate = FraudWatchCandidateMO.parse(value);
  const signals = [...new Set(candidate.candidate.supporting_cases.flatMap((c) => c.signal_types))]
    .slice(0, 12).map((s) => s.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 80)).filter(Boolean);
  return `What independent external evidence supports or contradicts a genuinely new freight fraud behavior involving ${signals.join(', ') || 'the supplied behavior'}? These signal names come from a synthetic simulation and are hypothesis context only. Compare known patterns, alternative explanations, missing evidence and source disagreements; do not infer that a real incident occurred.`;
}

export function buildInvestigationSnapshot(input: BuildSwarmReplayCaptureInput & { council: CouncilResult | null }): InvestigationSnapshot<SwarmReplayCapture> {
  const capture = buildSwarmReplayCapture(input);
  const council = input.council;
  if (council && council.question !== input.question) throw new Error('Council question differs from the frozen research question.');
  const sourceIds = new Set(capture.research.source_records.map((s) => s.evidence_id));
  const context = council?.recorded_context;
  const selected = context?.selected_evidence_ids ?? [];
  const positions: InvestigationPosition[] = council ? REASONING_AGENTS.map((agent) => {
    const row = council.positions[agent];
    const position = row.position;
    const typed = position.typed_claims ?? position.claims.map((text) => ({ type: position.evidence_ids.length ? 'INFERENCE' as const : 'UNKNOWN' as const, text, evidence_ids: position.evidence_ids }));
    return {
      agent, role: ROLES[agent], provider: row.provider,
      model: row.provider === 'deterministic' ? null : context?.assignments[agent].model ?? null,
      model_revision: null, provider_version: null,
      status: row.degraded ? 'unavailable' : row.provider === 'deterministic' ? 'fallback' : 'independent',
      stance: position.stance, reasoning_summary: position.reasoning_summary,
      claims: typed.map((c, index) => ({
        id: `${agent}:claim:${index + 1}`, asserted_type: c.type,
        epistemic_type: c.type === 'FACT' ? 'INFERENCE' : c.type,
        text: c.text, evidence_ids: [...new Set(c.evidence_ids)], verification: 'unverified', confidence: null,
      })),
      evidence_ids: [...new Set(position.evidence_ids)], evidence_requests: position.evidence_requests,
      assumptions: position.assumptions, latency_ms: row.ms, degraded_reason: row.degraded_reason,
    };
  }) : [];
  const verdict = council?.verdict.verdict;
  const snapshot: InvestigationSnapshot<SwarmReplayCapture> = {
    schema_version: 'swarm-investigation-snapshot.v1', kind: 'risk_swarm_investigation_snapshot',
    captured_at: input.capturedAt, capture,
    analysis: {
      status: council ? 'recorded' : 'not_run',
      selected_source_ids: selected.filter((id) => sourceIds.has(id)),
      omitted_source_ids: selected.filter((id) => !sourceIds.has(id)),
      positions,
      disagreement: council ? {
        independent_count: council.disagreement.independent_count,
        distinct_stances: council.disagreement.distinct_stances,
        agreement: council.disagreement.agreement,
        independence_scope: 'separate_requests_not_verified_model_independence',
      } : null,
      decision: council && verdict ? {
        data_class: 'model_or_policy_proposal', state: verdict.verdict_type === 'UNRESOLVED' || verdict.cited_evidence_ids.length === 0 ? 'abstained' : 'proposed',
        ...verdict, provider: council.verdict.provider,
        model: council.verdict.provider === 'deterministic' ? null : context?.assignments.ZEUS.model ?? null,
        model_revision: null, provider_version: null,
      } : null,
      trace: council?.trace.map((event) => ({ ...event, agent: event.agent ?? null })) ?? [],
    },
    outcome: { status: 'not_observed', correctness: 'unknown', record: null },
    unknowns: [
      'Source authenticity, claim entailment and source independence have not been independently verified.',
      'Model/provider implementation versions are not returned by these adapters; configured model names may be mutable aliases.',
      'No operational outcome or decision correctness assessment has been recorded.',
      ...(council ? [] : ['Council analysis was not run.']),
      ...(selected.some((id) => !sourceIds.has(id)) ? ['Internal evidence content was omitted; the exported context is incomplete.'] : []),
      ...(capture.hypothesis_context ? ['Synthetic candidate context establishes no real-world incident or novelty.'] : []),
    ],
    knowledge_promotion: 'prohibited',
  };
  const checked = validateInvestigationSnapshot<SwarmReplayCapture>(snapshot, (value) => SwarmReplayCapture.safeParse(value).success);
  if (!checked.ok) throw new Error(checked.error);
  return checked.value;
}
