import { describe, expect, it } from '../test/bdd';
import { Minter, fixedClock } from '../domain/build';
import { DEFAULT_POLICY, policyFor } from '../scoring/policy';
import type { Decision, Lesson } from '../domain/model';
import { activeLessons, buildLesson, buildOutcome, proposeLesson, vetLesson } from './lessons';

const NOW = '2026-09-13T00:00:00.000Z';
const minter = () => new Minter('RUN-L', fixedClock(NOW));

const decision = (over: Partial<Decision> = {}): Decision => ({
  id: 'D-001', kind: 'decision', created_at: NOW, created_by: 'decision_engine', run_id: 'RUN-L', supersedes: null,
  question: 'q', hypothesis_ids: ['H-001'], headline_risk: 'r', severity_band: 'HIGH', severity_score: 0.5,
  confidence: null, confidence_blocked_reason: 'contested', urgency: 'ELEVATED', action_band: 'MONITOR',
  gates_failed: [], caps_applied: [], rationale: [], unresolved_objections: [], owner_role: 'role',
  review_by: NOW, regulatory_implications: [], decided_by: 'system_recommendation', human_note: null, human_verdict: null,
  ...over,
});

const outcomeOf = (verdict: 'correct' | 'false_positive' | 'false_negative' | 'partially_correct') =>
  buildOutcome(minter(), { decision: decision(), pattern_key: 'FFT-002|DE', verdict, what_happened: 'The carrier was legitimate.' });

describe('learning loop', () => {
  it('learns nothing from a call that was right', () => {
    const p = proposeLesson(outcomeOf('correct'), { pattern_key: 'FFT-002|DE', policy: DEFAULT_POLICY });
    expect(p.rule).toBeNull();
    expect(p.rationale).toContain('not evidence that the gates are too strict');
  });

  it('refuses to learn anything from a missed risk, and says why', () => {
    const p = proposeLesson(outcomeOf('false_negative'), { pattern_key: 'FFT-002|DE', policy: DEFAULT_POLICY });
    expect(p.rule).toBeNull();
    expect(p.rationale).toContain('may never be loosened');
  });

  it('tightens the evidence bar after a false positive, scoped to the pattern', () => {
    const p = proposeLesson(outcomeOf('false_positive'), { pattern_key: 'FFT-002|DE', policy: DEFAULT_POLICY });
    expect(p.rule).not.toBeNull();
    expect(p.rule!.pattern_key).toBe('FFT-002|DE');
    expect(p.rule!.min_independent_sources).toBe(3);
    expect(p.rule!.fp_risk_multiplier).toBe(1.1);
    expect(p.rule!.expires_after_runs).toBeGreaterThan(0);
  });

  it('demands a stronger source only when every misleading item was a weak one', () => {
    const weak = proposeLesson(outcomeOf('false_positive'), { pattern_key: 'FFT-002|DE', policy: DEFAULT_POLICY, misleading_tiers: [3, 4] });
    expect(weak.rule!.required_min_tier).toBe(2);
    const mixed = proposeLesson(outcomeOf('false_positive'), { pattern_key: 'FFT-002|DE', policy: DEFAULT_POLICY, misleading_tiers: [1, 3] });
    expect(mixed.rule!.required_min_tier).toBeUndefined();
  });

  it('stops at the ceiling instead of tightening without limit', () => {
    const maxed = { ...DEFAULT_POLICY, min_independent_sources: 4, fp_risk_multiplier: 1.5, required_min_tier: 1 as const };
    const p = proposeLesson(outcomeOf('false_positive'), { pattern_key: 'FFT-002|DE', policy: maxed, misleading_tiers: [4] });
    expect(p.rule).toBeNull();
    expect(p.rationale).toContain('already at its ceiling');
  });

  it('refuses a global lesson', () => {
    const p = proposeLesson(outcomeOf('false_positive'), { pattern_key: null, policy: DEFAULT_POLICY });
    expect(p.rule).toBeNull();
    expect(p.rationale).toContain('Nothing is learned globally');
  });

  it('keeps a loosening lesson in the ledger, marked rejected, instead of dropping it silently', () => {
    const m = minter();
    const outcome = outcomeOf('false_positive');
    const poisoned: Lesson = {
      ...buildLesson(m, outcome, { rule: { pattern_key: 'FFT-002|DE', min_independent_sources: 2 }, rationale: 'planted' })!,
    };
    const tightened = { ...DEFAULT_POLICY, min_independent_sources: 3 };
    const entry = vetLesson(poisoned, tightened);
    expect(entry.accepted).toBe(false);
    expect(entry.rejected_reason).toContain('may only increase');
    expect(activeLessons([entry]).length).toBe(0);
  });

  it('applies an accepted lesson to the pattern it was learned on and nowhere else', () => {
    const m = minter();
    const outcome = outcomeOf('false_positive');
    const proposal = proposeLesson(outcome, { pattern_key: 'FFT-002|DE', policy: DEFAULT_POLICY });
    const lesson = buildLesson(m, outcome, proposal)!;
    const active = activeLessons([vetLesson(lesson, DEFAULT_POLICY)]);
    expect(policyFor('FFT-002|DE', active).min_independent_sources).toBe(3);
    expect(policyFor('FFT-008|DE', active).min_independent_sources).toBe(DEFAULT_POLICY.min_independent_sources);
  });

  it('lets a lesson expire by run count so a one-off never becomes permanent', () => {
    const m = minter();
    const outcome = outcomeOf('false_positive');
    const lesson = buildLesson(m, outcome, proposeLesson(outcome, { pattern_key: 'FFT-002|DE', policy: DEFAULT_POLICY }))!;
    const spent: Lesson = { ...lesson, runs_applied: lesson.rule.expires_after_runs! };
    expect(activeLessons([vetLesson(spent, DEFAULT_POLICY)]).length).toBe(0);
  });

  it('writes an outcome that names the decision it judges and who judged it', () => {
    const o = outcomeOf('partially_correct');
    expect(o.decision_id).toBe('D-001');
    expect(o.created_by).toBe('human');
    expect(o.verdict).toBe('partially_correct');
  });
});
