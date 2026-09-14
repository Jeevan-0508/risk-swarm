/**
 * The Council's deliberation coordinator. Answers one question over an already-completed
 * `RunResult`: what did the seven agents actually ask, challenge, answer and object to, said
 * explicitly, in order, with every claim pointing at a real node?
 *
 * The one rule everything else here serves: DO NOT CREATE FAKE CONVERSATION. Every event this module
 * emits is a deterministic projection of a field a real agent already produced - a `Challenge.argument`,
 * a `RedTeamFinding.clears_when`, an `AgentOutput.recommended_next_step`, a recorded `agent_positions`
 * entry. Nothing here calls a model, invents a rebuttal, or dramatises a disagreement that the record
 * does not already contain. `DisagreementRoom`'s objections and `score.ts`'s disagreement index stay
 * authoritative; this module narrates them as a sequence, never recomputes them.
 *
 * `resolution` on a `Challenge`/`RedTeamFinding` is `'open'` unless something in the run actually
 * resolved it. Today there is exactly one such resolver: when a red-team finding is reworkable
 * (see `orchestrator/run.ts`) and the orchestrator drops the hypothesis it targets rather than
 * re-running blind, that finding is kept - not deleted - with `resolution: 'accepted'`, and the
 * withdrawn hypothesis is kept alongside it as a `superseded` node. This module reads that field
 * the same way it reads everything else: a `DEFENSE`/`REBUTTAL`/agreement-by-resolution event fires
 * only when a real resolution is present, never invented to make the transcript look more settled
 * than the run actually was. A `Challenge` has no such resolver yet, so it stays `'open'` and the
 * event stays `'unresolved'`, honestly. The one reworkable class that names a specific hypothesis
 * rather than the run as a whole (`unsupported_claim`) is also not yet reachable by any pattern
 * shipped today - `analyst.ts` always synthesises a falsification test long enough to clear it - so
 * this resolver is real, deterministic code with no live occurrence yet either, the same honest gap
 * as the rest of this paragraph. See `coordinator.test.ts` for both the resolved and the still-open
 * shape.
 */
import type { RiskGraph } from '../domain/graph';
import { DeliberationEvent, type AgentId, type DeliberationEventType, type DeliberationOutcome } from '../domain/model';
import type { ScoutOutput } from '../agents/scout';
import type { IntelligenceOutput } from '../agents/intelligence';
import type { AnalystOutput } from '../agents/analyst';
import type { GovernanceOutput } from '../agents/governance';
import type { ChallengerOutput } from '../agents/challenger';
import type { RedTeamOutput } from '../agents/redteam';
import type { DecisionOutput } from '../agents/decision';

export interface DeliberationBudget {
  max_events: number;
  max_rounds: number;
  /** Per-agent cap, so one voice cannot dominate the record. */
  max_agent_responses: number;
}

/** Generous by design: a typical run produces well under 30 events across 8 fixed rounds. These caps
 *  exist to stop an adversarial or degenerate input from producing an unbounded transcript, not to
 *  bite in ordinary use - see `coordinator.test.ts` for what actually happens when they do bite. */
export const DEFAULT_DELIBERATION_BUDGET: DeliberationBudget = {
  max_events: 80,
  max_rounds: 12,
  max_agent_responses: 20,
};

export interface DeliberationOptions {
  budget?: Partial<DeliberationBudget>;
}

export interface DeliberationInput {
  run_id: string;
  graph: RiskGraph;
  scout: ScoutOutput;
  intelligence: IntelligenceOutput;
  analyst: AnalystOutput;
  governance: GovernanceOutput;
  challenger: ChallengerOutput;
  red_team: RedTeamOutput;
  decision: DecisionOutput;
}

export interface DeliberationReport {
  run_id: string;
  events: DeliberationEvent[];
  outcome: DeliberationOutcome;
  budget: DeliberationBudget;
  rounds_used: number;
  /** Which budget dimension stopped the deliberation, if any. Never silently truncated - see the
   *  terminal `resolution` event, which always states this plainly instead of implying consensus. */
  limited_by: 'max_events' | 'max_rounds' | 'max_agent_responses' | null;
}

type Draft = Omit<DeliberationEvent, 'id' | 'run_id' | 'sequence' | 'timestamp'>;

export function runDeliberation(input: DeliberationInput, options: DeliberationOptions = {}): DeliberationReport {
  const budget: DeliberationBudget = { ...DEFAULT_DELIBERATION_BUDGET, ...options.budget };
  // Council has no live per-event clock; every event carries the run's own completion instant rather
  // than a fabricated distinct wall-clock moment. `sequence` is the true ordering.
  const moment = input.decision.decision.created_at;
  const known = new Set(input.graph.all().map((n) => n.id));
  const keepKnown = (ids: string[]) => ids.filter((id) => known.has(id));

  const events: DeliberationEvent[] = [];
  const agentCounts = new Map<AgentId, number>();
  let round = 0;
  let limited_by: DeliberationReport['limited_by'] = null;

  const roomForOne = () => events.length < budget.max_events - 1;

  const emit = (draft: Draft): DeliberationEvent | null => {
    if (limited_by !== null) return null;
    if (!roomForOne()) {
      limited_by = 'max_events';
      return null;
    }
    const count = agentCounts.get(draft.from_agent) ?? 0;
    if (count >= budget.max_agent_responses) {
      limited_by = 'max_agent_responses';
      return null;
    }
    agentCounts.set(draft.from_agent, count + 1);
    const event: DeliberationEvent = {
      ...draft,
      id: `${input.run_id}-delib-${events.length}`,
      run_id: input.run_id,
      sequence: events.length,
      timestamp: moment,
      evidence_ids: keepKnown(draft.evidence_ids),
      claim_ids: keepKnown(draft.claim_ids),
    };
    events.push(event);
    return event;
  };

  const inRound = (body: () => void) => {
    if (limited_by !== null) return;
    if (round >= budget.max_rounds) {
      limited_by = 'max_rounds';
      return;
    }
    round += 1;
    body();
  };

  // Round 1 - opening: what was retrieved and deduplicated, in the discoverers' own words.
  inRound(() => {
    const scoutSummary =
      input.scout.uncertainties.length > 0
        ? input.scout.uncertainties.join(' ')
        : `${input.scout.findings.length} signal(s) retrieved from the pinned snapshot; no exclusion or retrieval cap applied.`;
    emit({
      from_agent: 'scout', to_agent: null, type: 'clarification', content: scoutSummary,
      evidence_ids: [], claim_ids: [], parent_event_id: null, status: 'resolved', requires_response: false,
    });
    const intelSummary =
      input.intelligence.uncertainties.length > 0
        ? input.intelligence.uncertainties.join(' ')
        : `${input.intelligence.clusters.length} distinct event cluster(s) found; no possible duplicate pair and no category disagreement.`;
    emit({
      from_agent: 'intelligence', to_agent: null, type: 'clarification', content: intelSummary,
      evidence_ids: [], claim_ids: [], parent_event_id: null, status: 'resolved', requires_response: false,
    });
  });

  // Round 2 - positions: the same `agent_positions` DisagreementRoom already renders, read as a
  // sequence of stances rather than a table. Six entries, not seven: decision_engine synthesizes the
  // council, it does not also state a position about itself ahead of doing so.
  inRound(() => {
    for (const p of input.decision.scoring_input.agent_positions) {
      const type: DeliberationEventType =
        p.reasoning_status === 'supported' || p.reasoning_status === 'partially_supported' ? 'agreement' : 'disagreement';
      emit({
        from_agent: p.agent as AgentId, to_agent: null, type,
        content: `Recorded position: ${p.reasoning_status.replace(/_/g, ' ')}, at confidence ${p.confidence.toFixed(2)}.`,
        evidence_ids: [], claim_ids: [], parent_event_id: null, status: 'resolved', requires_response: false,
      });
    }
  });

  // Round 3 - questions: every agent's own `recommended_next_step`, verbatim, addressed to whichever
  // agent owns the hypothesis (RISK ANALYST) unless the speaker already is that agent or is
  // synthesizing (DECISION ENGINE), in which case it is addressed to the council as a whole.
  inRound(() => {
    const steps: Array<{ agent: AgentId; step: string | null }> = [
      { agent: 'scout', step: input.scout.recommended_next_step },
      { agent: 'intelligence', step: input.intelligence.recommended_next_step },
      { agent: 'risk_analyst', step: input.analyst.recommended_next_step },
      { agent: 'governance_officer', step: input.governance.recommended_next_step },
      { agent: 'challenger', step: input.challenger.recommended_next_step },
      { agent: 'red_team', step: input.red_team.recommended_next_step },
      { agent: 'decision_engine', step: input.decision.recommended_next_step },
    ];
    for (const s of steps) {
      if (s.step === null) continue;
      emit({
        from_agent: s.agent,
        to_agent: s.agent === 'risk_analyst' || s.agent === 'decision_engine' ? null : 'risk_analyst',
        type: 'question', content: s.step, evidence_ids: [], claim_ids: [], parent_event_id: null,
        status: 'unresolved', requires_response: true,
      });
    }
  });

  // Round 4 - challenges. Every Challenge the challenger actually raised, in the order it raised them.
  inRound(() => {
    for (const c of input.challenger.findings) {
      const challengeEvent = emit({
        from_agent: 'challenger', to_agent: 'risk_analyst', type: 'challenge',
        content: `${c.argument} (basis: ${c.basis.replace(/_/g, ' ')}${c.alternative_explanation ? `; alternative explanation: ${c.alternative_explanation}` : ''})`,
        evidence_ids: c.evidence_ids, claim_ids: [c.target_id], parent_event_id: null,
        status: c.resolution === 'open' ? 'unresolved' : 'resolved', requires_response: c.resolution === 'open',
      });
      if (challengeEvent !== null && c.resolution !== 'open') {
        emit({
          from_agent: 'risk_analyst', to_agent: 'challenger',
          type: c.resolution === 'rebutted' ? 'rebuttal' : 'agreement',
          content: c.rebuttal ?? `The challenge is ${c.resolution}.`,
          evidence_ids: [], claim_ids: [c.target_id], parent_event_id: challengeEvent.id,
          status: 'resolved', requires_response: false,
        });
      }
    }
  });

  // Round 5 - objections. Every RedTeamFinding, the same way: real argument, real clears_when.
  inRound(() => {
    for (const f of input.red_team.findings) {
      const objectionEvent = emit({
        from_agent: 'red_team', to_agent: 'risk_analyst', type: 'objection',
        content: `${f.argument} Clears when: ${f.clears_when}`,
        evidence_ids: f.evidence_ids, claim_ids: [f.target_id], parent_event_id: null,
        status: f.resolution === 'open' ? 'unresolved' : 'resolved', requires_response: f.resolution === 'open',
      });
      if (objectionEvent !== null && f.resolution !== 'open') {
        emit({
          from_agent: 'risk_analyst', to_agent: 'red_team',
          type: f.resolution === 'rebutted' ? 'defense' : 'agreement',
          content: `Objection ${f.resolution}.`,
          evidence_ids: [], claim_ids: [f.target_id], parent_event_id: objectionEvent.id,
          status: 'resolved', requires_response: false,
        });
      }
    }
  });

  // Round 6 - governance answers: does an obligation apply, established or not, citation attached.
  inRound(() => {
    for (const f of input.governance.findings) {
      emit({
        from_agent: 'governance_officer', to_agent: null, type: 'answer',
        content: `${f.implication.citation} ${f.implication.ref}: ${f.implication.applicability.replace(/_/g, ' ')} - ${f.implication.reasoning}`,
        evidence_ids: f.evidence ? [f.evidence.id] : [], claim_ids: [input.decision.decision.id],
        parent_event_id: null, status: 'resolved', requires_response: false,
      });
    }
  });

  // Round 7 - revisions: a hypothesis actually re-worded and superseded, both ends of the edge named.
  inRound(() => {
    for (const old of input.analyst.superseded) {
      const replacement = input.analyst.findings.find((f) => f.hypothesis.supersedes === old.id)?.hypothesis;
      emit({
        from_agent: 'risk_analyst', to_agent: null, type: 'revision',
        content: replacement
          ? `Hypothesis revised: "${old.statement}" -> "${replacement.statement}"`
          : `Hypothesis "${old.statement}" was superseded.`,
        evidence_ids: [], claim_ids: replacement ? [old.id, replacement.id] : [old.id],
        parent_event_id: null, status: 'resolved', requires_response: false,
      });
    }
  });

  // Round 8 - escalation: only when the decision actually escalated. No band, no event.
  inRound(() => {
    if (input.decision.decision.action_band !== 'ESCALATE') return;
    emit({
      from_agent: 'decision_engine', to_agent: null, type: 'escalation',
      content: `Escalating: ${input.decision.decision.headline_risk} Gates failed: ${input.decision.decision.gates_failed.join('; ') || 'none'}. Caps applied: ${input.decision.decision.caps_applied.join('; ') || 'none'}.`,
      evidence_ids: [], claim_ids: [input.decision.decision.id], parent_event_id: null,
      status: 'resolved', requires_response: false,
    });
  });

  return finalize(input, events, budget, round, limited_by, keepKnown, moment);
}

function finalize(
  input: DeliberationInput,
  events: DeliberationEvent[],
  budget: DeliberationBudget,
  rounds_used: number,
  limited_by: DeliberationReport['limited_by'],
  keepKnown: (ids: string[]) => string[],
  moment: string,
): DeliberationReport {
  const disagreement = input.decision.score.disagreement_index.value;
  const unresolved = input.decision.decision.unresolved_objections.length;

  let outcome: DeliberationOutcome;
  if (limited_by !== null) outcome = 'LIMIT_REACHED';
  else if (unresolved === 0 && disagreement <= 25) outcome = 'CONSENSUS';
  else if (unresolved === 0 && disagreement <= 50) outcome = 'QUALIFIED_CONSENSUS';
  else if (disagreement > 50) outcome = 'MATERIAL_DISAGREEMENT';
  else outcome = 'UNRESOLVED';

  const summary =
    limited_by !== null
      ? `DELIBERATION LIMIT REACHED: ${limited_by} exhausted after ${events.length} event(s). The council's position is reported as unresolved rather than assumed.`
      : `${input.decision.decision.headline_risk} Outcome: ${outcome.replace(/_/g, ' ').toLowerCase()}, disagreement index ${disagreement}, ${unresolved} unresolved objection(s).`;

  // The terminal event is always minted, even when `max_events`/`max_rounds`/`max_agent_responses`
  // already fired - `roomForOne()` reserves exactly this slot during the rounds above. A council that
  // has been silenced by its own budget still has to say so.
  const resolution: DeliberationEvent = {
    id: `${input.run_id}-delib-${events.length}`,
    run_id: input.run_id,
    sequence: events.length,
    timestamp: moment,
    from_agent: 'decision_engine',
    to_agent: null,
    type: 'resolution',
    content: summary,
    evidence_ids: keepKnown(input.decision.evidence_cited),
    claim_ids: keepKnown([input.decision.decision.id]),
    parent_event_id: null,
    status: outcome === 'CONSENSUS' || outcome === 'QUALIFIED_CONSENSUS' ? 'resolved' : 'unresolved',
    requires_response: false,
  };
  events.push(resolution);

  // A cheap, whole-array schema check - the same discipline SENTINEL's `schema_integrity` applies to
  // graph nodes, applied here once rather than skipped because nothing mints these through `Minter`.
  DeliberationEvent.array().parse(events);

  return { run_id: input.run_id, events, outcome, budget, rounds_used, limited_by };
}
