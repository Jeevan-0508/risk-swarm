/**
 * The learning loop. An outcome recorded by a human becomes a lesson, and a lesson may only tighten a
 * gate. That asymmetry is the whole design: a wrong escalation teaches the system to demand more before
 * escalating again, while a missed risk can never teach it to demand less. A loop that could loosen its
 * own gates is a loop an attacker can train.
 */
import { Minter } from '../domain/build';
import type { Decision, Lesson, Outcome, ScoringPolicyDelta, Tier } from '../domain/model';
import { applyPolicyDelta, PolicyDeltaRejected, type ScoringPolicy } from '../scoring/policy';

export interface OutcomeInput {
  decision: Decision;
  /** The pattern the decision was about. A lesson is scoped to it, never applied globally. */
  pattern_key: string | null;
  verdict: Outcome['verdict'];
  what_happened: string;
  useful_evidence_ids?: string[];
  misleading_evidence_ids?: string[];
  agent_scorecard?: Outcome['agent_scorecard'];
}

export interface LessonProposal {
  /** Null when nothing may be learned. The reason is always stated. */
  rule: ScoringPolicyDelta | null;
  rationale: string;
}

const MAX_MIN_SOURCES = 4;
const MAX_FP_MULTIPLIER = 1.5;
const EXPIRES_AFTER_RUNS = 20;

export function buildOutcome(minter: Minter, input: OutcomeInput): Outcome {
  return minter.outcome('human', {
    decision_id: input.decision.id,
    what_happened: input.what_happened,
    verdict: input.verdict,
    useful_evidence_ids: input.useful_evidence_ids ?? [],
    misleading_evidence_ids: input.misleading_evidence_ids ?? [],
    agent_scorecard: input.agent_scorecard ?? {},
  });
}

/**
 * Derives what the run should have demanded, given how it turned out. Reads the policy that was in
 * force so a lesson never proposes a gate the policy already has.
 */
export function proposeLesson(
  outcome: Outcome,
  context: { pattern_key: string | null; policy: ScoringPolicy; misleading_tiers?: Tier[] },
): LessonProposal {
  const { pattern_key, policy } = context;

  if (pattern_key === null) {
    return { rule: null, rationale: 'The decision names no pattern, so a lesson would have to apply everywhere. Nothing is learned globally.' };
  }

  if (outcome.verdict === 'correct') {
    return { rule: null, rationale: 'The call was right. A correct outcome is not evidence that the gates are too strict, so nothing changes.' };
  }

  if (outcome.verdict === 'false_negative') {
    return {
      rule: null,
      rationale:
        'The risk was real and the system held back. The only change that would have caught it is a looser gate, and a gate may never be loosened by a lesson — otherwise a run of planted misses would train the system into recklessness. This outcome is recorded for a human to act on, not learned from.',
    };
  }

  const reasons: string[] = [];
  const rule: ScoringPolicyDelta = { pattern_key, expires_after_runs: EXPIRES_AFTER_RUNS };

  const nextSources = Math.min(policy.min_independent_sources + 1, MAX_MIN_SOURCES);
  if (nextSources > policy.min_independent_sources) {
    rule.min_independent_sources = nextSources as 2 | 3 | 4;
    reasons.push(`require ${nextSources} independent source(s) instead of ${policy.min_independent_sources}`);
  }

  const nextFp = Math.min(Number((policy.fp_risk_multiplier + 0.1).toFixed(2)), MAX_FP_MULTIPLIER);
  if (nextFp > policy.fp_risk_multiplier) {
    rule.fp_risk_multiplier = nextFp;
    reasons.push(`weight false-positive risk at x${nextFp} instead of x${policy.fp_risk_multiplier}`);
  }

  const misleading = context.misleading_tiers ?? [];
  const allWeak = misleading.length > 0 && misleading.every((t) => t >= 3);
  if (allWeak) {
    const target: Tier = 2;
    if (policy.required_min_tier === null || target < policy.required_min_tier) {
      rule.required_min_tier = target;
      reasons.push('demand at least one tier-2 source, since every misleading item was tier-3 or weaker');
    }
  }

  if (reasons.length === 0) {
    return {
      rule: null,
      rationale: `The outcome was ${outcome.verdict.replace(/_/g, ' ')}, but every gate a lesson could tighten is already at its ceiling for this pattern. Tightening further would need a human to change the policy itself.`,
    };
  }

  const verb = outcome.verdict === 'false_positive' ? 'was wrong' : 'was only partly right';
  return {
    rule,
    rationale: `The last call on this pattern ${verb}: ${outcome.what_happened} Next time, ${reasons.join('; ')}.`,
  };
}

/** Mints the lesson node. Returns null when the proposal has no rule, so nothing empty is written. */
export function buildLesson(minter: Minter, outcome: Outcome, proposal: LessonProposal): Lesson | null {
  if (proposal.rule === null) return null;
  return minter.lesson('human', {
    outcome_id: outcome.id,
    pattern_key: proposal.rule.pattern_key,
    rule: proposal.rule,
    rationale: proposal.rationale,
    runs_applied: 0,
  });
}

export interface LessonLedgerEntry {
  lesson: Lesson;
  /** Rejected lessons are kept, so an attempt to loosen a gate stays visible. */
  accepted: boolean;
  rejected_reason: string | null;
}

/**
 * Vets a lesson against the policy it would change. A lesson that would loosen anything is kept in the
 * ledger and marked rejected rather than dropped: an invisible rejection is indistinguishable from an
 * attack that was never noticed.
 */
export function vetLesson(lesson: Lesson, policy: ScoringPolicy): LessonLedgerEntry {
  try {
    applyPolicyDelta(policy, lesson.rule);
    return { lesson, accepted: true, rejected_reason: null };
  } catch (error) {
    if (error instanceof PolicyDeltaRejected) return { lesson, accepted: false, rejected_reason: error.reason };
    throw error;
  }
}

/** Lessons still in force. A lesson expires by run count so a one-off never hardens into a permanent rule. */
export function activeLessons(ledger: LessonLedgerEntry[]): Array<{ pattern_key: string; rule: ScoringPolicyDelta }> {
  return ledger
    .filter((e) => e.accepted)
    .filter((e) => {
      const limit = e.lesson.rule.expires_after_runs;
      return limit === undefined || e.lesson.runs_applied < limit;
    })
    .map((e) => ({ pattern_key: e.lesson.pattern_key, rule: e.lesson.rule }));
}
