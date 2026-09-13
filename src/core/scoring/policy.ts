/**
 * Scoring policy. The defaults are the gates described in docs/SCORING.md. Lessons learned from
 * outcomes may tighten a policy for a pattern key; nothing can loosen one.
 */
import type { ScoringPolicyDelta, Tier } from '../domain/model';

export interface ScoringPolicy {
  min_independent_sources: number;
  fp_risk_multiplier: number;
  required_min_tier: Tier | null;
  /** Reference number of independent clusters that counts as a full evidence base. */
  evidence_reference_clusters: number;
  escalate_min_confidence: number;
  escalate_min_independent_sources: number;
  escalate_max_fp_risk: number;
}

export const DEFAULT_POLICY: ScoringPolicy = {
  min_independent_sources: 2,
  fp_risk_multiplier: 1,
  required_min_tier: null,
  evidence_reference_clusters: 5,
  escalate_min_confidence: 0.6,
  escalate_min_independent_sources: 3,
  escalate_max_fp_risk: 0.4,
};

export class PolicyDeltaRejected extends Error {
  constructor(readonly reason: string) {
    super(`POLICY_DELTA_REJECTED: ${reason}`);
    this.name = 'PolicyDeltaRejected';
  }
}

/**
 * Applies a lesson's delta. A delta may only tighten: this is what makes the learning loop
 * un-poisonable. Anything that would loosen a gate is rejected outright rather than clamped, so the
 * attempt is visible instead of silently ignored.
 */
export function applyPolicyDelta(base: ScoringPolicy, delta: ScoringPolicyDelta): ScoringPolicy {
  const next = { ...base };

  if (delta.min_independent_sources !== undefined) {
    if (delta.min_independent_sources < base.min_independent_sources) {
      throw new PolicyDeltaRejected(`min_independent_sources may only increase (${base.min_independent_sources} -> ${delta.min_independent_sources})`);
    }
    next.min_independent_sources = delta.min_independent_sources;
  }

  if (delta.fp_risk_multiplier !== undefined) {
    if (delta.fp_risk_multiplier < base.fp_risk_multiplier) {
      throw new PolicyDeltaRejected(`fp_risk_multiplier may only increase (${base.fp_risk_multiplier} -> ${delta.fp_risk_multiplier})`);
    }
    next.fp_risk_multiplier = delta.fp_risk_multiplier;
  }

  if (delta.required_min_tier !== undefined) {
    // Tier 1 is stronger than tier 2, so tightening means a *lower* number.
    if (base.required_min_tier !== null && delta.required_min_tier > base.required_min_tier) {
      throw new PolicyDeltaRejected(`required_min_tier may only tighten (${base.required_min_tier} -> ${delta.required_min_tier})`);
    }
    next.required_min_tier = delta.required_min_tier;
  }

  return next;
}

/** Pattern-scoped policies, keyed as `PATTERN|GEO` so a lesson stays local to where it was learned. */
export function policyFor(patternKey: string | null, active: Array<{ pattern_key: string; rule: ScoringPolicyDelta }>, base = DEFAULT_POLICY): ScoringPolicy {
  let policy = base;
  for (const lesson of active) {
    if (patternKey === null) continue;
    const applies = lesson.pattern_key === patternKey || patternKey.startsWith(`${lesson.pattern_key}|`) || lesson.pattern_key.startsWith(`${patternKey}|`);
    if (!applies) continue;
    try {
      policy = applyPolicyDelta(policy, lesson.rule);
    } catch {
      // A lesson that would loosen the policy is skipped. The rejection is surfaced when the lesson
      // is created, not silently here.
    }
  }
  return policy;
}
