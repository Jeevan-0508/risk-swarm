import { describe, expect, it } from '../test/bdd';
import { computeDisagreementIndex, computeScore, type EvidenceRef, type ScoringInput } from './score';
import { applyPolicyDelta, DEFAULT_POLICY, policyFor, PolicyDeltaRejected } from './policy';
import type { Tier } from '../domain/model';

const ev = (id: string, tier: Tier, source_identity: string, over: Partial<EvidenceRef> = {}): EvidenceRef => ({
  id,
  tier,
  relevance: 0.9,
  cluster_id: `CL-${id}`,
  source_identity,
  incident_claim: true,
  injection_suspected: false,
  ...over,
});

const input = (over: Partial<ScoringInput> = {}): ScoringInput => ({
  evidence: [ev('E-1', 1, 'bag.de'), ev('E-2', 2, 'tapa.org'), ev('E-3', 3, 'trans.info'), ev('E-4', 3, 'dvz.de')],
  cluster_count: 4,
  possible_duplicate_pairs: 0,
  recurrence_buckets: 4,
  window_buckets: 6,
  pattern: { severity: 'critical', unknown_share: 0.3 },
  scope_breadth: 0.8,
  newest_evidence_at: '2026-09-10T00:00:00.000Z',
  now: '2026-09-13T00:00:00.000Z',
  regulatory_deadline_days: null,
  agent_positions: [
    { agent: 'risk_analyst', reasoning_status: 'supported', confidence: 0.8 },
    { agent: 'governance_officer', reasoning_status: 'supported', confidence: 0.75 },
    { agent: 'challenger', reasoning_status: 'partially_supported', confidence: 0.7 },
  ],
  challenges: [],
  red_team: [],
  evidence_conflicts: 0,
  ungated_false_positives: 0,
  total_false_positive_gates: 3,
  circular_support_count: 0,
  declared_uncertainties: 1,
  reversibility: 'hard_to_reverse',
  ...over,
});

describe('scoring: the well-evidenced case', () => {
  it('escalates only when every gate is satisfied', () => {
    const r = computeScore(input());
    expect(r.independent_evidence_count).toBe(4);
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    expect(r.action_band).toBe('ESCALATE');
    expect(r.gates_failed).toEqual([]);
    expect(r.severity_band).toBe('CRITICAL');
  });

  it('keeps severity, confidence and urgency separate', () => {
    const r = computeScore(input({ pattern: { severity: 'low', unknown_share: 0.3 } }));
    expect(r.severity_band).toBe('LOW');
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.urgency).toBe('ELEVATED');
  });

  it('explains every factor and keeps all of them in range', () => {
    const r = computeScore(input());
    for (const f of Object.values(r.factors)) {
      expect(f.value).toBeGreaterThanOrEqual(0);
      expect(f.value).toBeLessThanOrEqual(1);
      expect(f.explanation.length).toBeGreaterThan(10);
    }
    expect(r.factors.potential_impact.explanation).toContain('not a probability');
  });

  it('is deterministic', () => {
    expect(JSON.stringify(computeScore(input()))).toBe(JSON.stringify(computeScore(input())));
  });
});

describe('scoring: the hard caps', () => {
  it('caps confidence and the band when there is one independent source', () => {
    const r = computeScore(input({ evidence: [ev('E-1', 1, 'bag.de')], cluster_count: 1 }));
    expect(r.independent_evidence_count).toBe(1);
    expect(r.confidence).toBeLessThanOrEqual(0.35);
    expect(r.caps_applied.join(' ')).toContain('capped at 0.35');
    expect(['NOTE', 'MONITOR']).toContain(r.action_band);
  });

  it('gives model reasoning no confidence at all', () => {
    const r = computeScore(input({ evidence: [ev('E-1', 5, 'llm'), ev('E-2', 5, 'llm')], cluster_count: 2 }));
    expect(r.confidence).toBe(0);
    expect(r.caps_applied.join(' ')).toContain('tier-5');
    expect(r.action_band).not.toBe('ESCALATE');
  });

  it('will not let knowledge-base structure evidence an incident', () => {
    const r = computeScore(input({ evidence: [ev('E-1', 4, 'taxonomy'), ev('E-2', 4, 'atlas'), ev('E-3', 4, 'control-room')], cluster_count: 3 }));
    expect(r.confidence).toBeLessThanOrEqual(0.45);
    expect(r.caps_applied.join(' ')).toContain('not an incident');
  });

  it('publishes no confidence figure while a blocking finding stands, and caps the band', () => {
    const r = computeScore(input({ red_team: [{ severity: 'blocking', resolution: 'open', finding_class: 'unsupported_claim' }] }));
    expect(r.confidence).toBeNull();
    expect(r.confidence_blocked_reason).toContain('blocking');
    expect(r.action_band).toBe('MONITOR');
  });

  it('drops to NOTE when false-positive risk is high', () => {
    const r = computeScore(input({ ungated_false_positives: 3, total_false_positive_gates: 3, possible_duplicate_pairs: 4, cluster_count: 2, evidence: [ev('E-1', 3, 'a.de'), ev('E-2', 3, 'b.de')], circular_support_count: 1 }));
    expect(r.factors.false_positive_risk.value).toBeGreaterThan(0.6);
    expect(r.action_band).toBe('NOTE');
  });

  it('refuses to escalate a finding no official or industry source supports', () => {
    const r = computeScore(input({ evidence: [ev('E-1', 3, 'a.de'), ev('E-2', 3, 'b.de'), ev('E-3', 3, 'c.de'), ev('E-4', 3, 'd.de')] }));
    expect(r.gates_failed.join(' ')).toContain('no tier-1 or tier-2 source');
    expect(r.action_band).not.toBe('ESCALATE');
  });

  it('halves the weight of a source that tried to issue instructions', () => {
    const clean = computeScore(input());
    const dirty = computeScore(input({ evidence: [ev('E-1', 1, 'bag.de', { injection_suspected: true }), ev('E-2', 2, 'tapa.org'), ev('E-3', 3, 'trans.info'), ev('E-4', 3, 'dvz.de')] }));
    expect(dirty.factors.source_reliability.value).toBeLessThan(clean.factors.source_reliability.value);
  });

  it('will not escalate without a described mechanism from the taxonomy', () => {
    const r = computeScore(input({ pattern: null }));
    expect(r.factors.potential_impact.value).toBe(0);
    expect(r.severity_band).toBe('LOW');
    expect(r.action_band).not.toBe('ESCALATE');
    expect(r.factors.uncertainty.value).toBeGreaterThan(0.6);
  });

  it('treats agreement as worthless without independent evidence', () => {
    const agreeing = Array.from({ length: 6 }, (_, i) => ({ agent: `a${i}`, reasoning_status: 'supported' as const, confidence: 0.9 }));
    const r = computeScore(input({ evidence: [ev('E-1', 3, 'trans.info')], cluster_count: 1, agent_positions: agreeing }));
    expect(r.factors.agent_agreement.value).toBe(1);
    expect(r.confidence).toBeLessThanOrEqual(0.35);
    expect(['NOTE', 'MONITOR']).toContain(r.action_band);
  });

  it('does not count duplicates inside one cluster as extra evidence', () => {
    const shared = { cluster_id: 'CL-1' };
    const one = computeScore(input({ evidence: [ev('E-1', 3, 'trans.info', shared)], cluster_count: 1 }));
    const five = computeScore(input({
      evidence: [
        ev('E-1', 3, 'trans.info', shared),
        ev('E-2', 3, 'msn.de', shared),
        ev('E-3', 3, 'x.de', shared),
        ev('E-4', 3, 'y.de', shared),
        ev('E-5', 3, 'z.de', shared),
      ],
      cluster_count: 1,
    }));
    expect(five.factors.evidence_strength.value).toBe(one.factors.evidence_strength.value);
    expect(five.independent_evidence_count).toBe(1);
  });

  it('handles an empty evidence base without dividing by zero', () => {
    const r = computeScore(input({ evidence: [], cluster_count: 0, recurrence_buckets: 0, window_buckets: 0 }));
    expect(r.factors.evidence_strength.value).toBe(0);
    expect(r.factors.source_reliability.value).toBe(0);
    expect(r.confidence).toBeLessThanOrEqual(0.35);
    expect(Number.isFinite(r.severity_score)).toBe(true);
  });
});

describe('disagreement index', () => {
  it('rises with open objections, evidence conflicts and confidence spread', () => {
    const quiet = computeDisagreementIndex(input());
    const noisy = computeDisagreementIndex(
      input({
        challenges: [{ severity: 'material', resolution: 'open' }, { severity: 'material', resolution: 'open' }],
        red_team: [{ severity: 'blocking', resolution: 'open', finding_class: 'same_source_echo' }],
        evidence_conflicts: 2,
        agent_positions: [
          { agent: 'risk_analyst', reasoning_status: 'supported', confidence: 0.9 },
          { agent: 'challenger', reasoning_status: 'insufficient_evidence', confidence: 0.2 },
          { agent: 'red_team', reasoning_status: 'insufficient_evidence', confidence: 0.1 },
        ],
      }),
    );
    expect(noisy.value).toBeGreaterThan(quiet.value);
    expect(noisy.terms).toHaveLength(4);
    expect(noisy.terms.reduce((n, t) => n + t.contribution, 0)).toBeCloseTo(noisy.value, 1);
    expect(noisy.terms.every((t) => t.explanation.length > 5)).toBe(true);
  });

  it('counts a blocking objection twice as heavily as a material one', () => {
    const material = computeDisagreementIndex(input({ challenges: [{ severity: 'material', resolution: 'open' }] }));
    const blocking = computeDisagreementIndex(input({ challenges: [{ severity: 'blocking', resolution: 'open' }] }));
    expect(blocking.value).toBeGreaterThan(material.value);
  });

  it('ignores objections that were rebutted', () => {
    const r = computeDisagreementIndex(input({ challenges: [{ severity: 'blocking', resolution: 'rebutted' }] }));
    expect(r.terms.find((t) => t.key === 'unresolved_objections')?.normalised).toBe(0);
  });
});

describe('learning policy', () => {
  it('accepts a tightening delta', () => {
    const p = applyPolicyDelta(DEFAULT_POLICY, { pattern_key: 'FFT-002|DE', min_independent_sources: 3, fp_risk_multiplier: 1.3, required_min_tier: 2 });
    expect(p.min_independent_sources).toBe(3);
    expect(p.fp_risk_multiplier).toBe(1.3);
    expect(p.required_min_tier).toBe(2);
  });

  it('rejects any attempt to loosen a gate', () => {
    expect(() => applyPolicyDelta({ ...DEFAULT_POLICY, min_independent_sources: 3 }, { pattern_key: 'k', min_independent_sources: 2 })).toThrow(PolicyDeltaRejected);
    expect(() => applyPolicyDelta({ ...DEFAULT_POLICY, fp_risk_multiplier: 1.4 }, { pattern_key: 'k', fp_risk_multiplier: 1.1 })).toThrow(PolicyDeltaRejected);
    expect(() => applyPolicyDelta({ ...DEFAULT_POLICY, required_min_tier: 1 }, { pattern_key: 'k', required_min_tier: 2 })).toThrow(PolicyDeltaRejected);
  });

  it('applies a lesson only to the pattern it was learned on', () => {
    const lessons = [{ pattern_key: 'FFT-002|DE', rule: { pattern_key: 'FFT-002|DE', min_independent_sources: 4 as const } }];
    expect(policyFor('FFT-002|DE', lessons).min_independent_sources).toBe(4);
    expect(policyFor('FFT-006|DE', lessons).min_independent_sources).toBe(2);
    expect(policyFor(null, lessons).min_independent_sources).toBe(2);
  });

  it('makes a tightened policy visibly harder to escalate', () => {
    // Four independent publishers, best source is tier 2: enough to escalate under the default policy.
    const evidence = [ev('E-1', 2, 'tapa.org'), ev('E-2', 2, 'iru.org'), ev('E-3', 3, 'trans.info'), ev('E-4', 3, 'dvz.de')];
    const before = computeScore(input({ evidence, cluster_count: 4 }));
    expect(before.action_band).toBe('ESCALATE');

    const tightened = applyPolicyDelta(DEFAULT_POLICY, { pattern_key: 'FFT-002|DE', min_independent_sources: 4, required_min_tier: 1 });
    const after = computeScore(input({ evidence, cluster_count: 4, policy: { ...tightened, escalate_min_independent_sources: 4 } }));
    expect(after.action_band).not.toBe('ESCALATE');
    expect(after.caps_applied.join(' ')).toContain('tier-1');
    expect(after.confidence).toBeLessThan(before.confidence as number);
  });
});
