import { describe, expect, it } from '../../test/bdd';
import { decideAfterLaya, decideAfterJev } from './policy';
import type { System1ArenaResult } from '../arena/types';
import type { System1Case, System1Result } from '../types';

const CASE = (over: Partial<System1Case> = {}): System1Case => ({
  case_id: 'C-001',
  question: 'q',
  state: 'a carrier went dark for 6 hours',
  candidate_stances: ['NOTE', 'MONITOR', 'TARGETED_INVESTIGATION', 'ESCALATE'],
  risk_hint: null,
  ...over,
});

const LAYA = (over: Partial<System1Result> = {}): System1Result => ({
  case_id: 'C-001',
  model_id: 'laya-typed',
  model_version: 'convaiinnovations/laya-typed-decisions',
  decision: 'MONITOR',
  confidence: 0.8,
  uncertainty: 0.1,
  rationale: '',
  evidence_ids: [],
  latency_ms: 100,
  status: 'SHADOW',
  raw: null,
  ...over,
});

describe('decideAfterLaya', () => {
  it('CALL_JEV: even a high Laya score is only a model proposal, not evidence', () => {
    const d = decideAfterLaya(CASE({ risk_hint: 'low' }), LAYA({ confidence: 0.9 }));
    expect(d.action).toBe('CALL_JEV');
    expect(d.reason).toMatch(/not calibrated evidence/);
  });

  it('CALL_JEV: a low score still gets a second proposal for evidence review', () => {
    const d = decideAfterLaya(CASE(), LAYA({ confidence: 0.1 }));
    expect(d.action).toBe('CALL_JEV');
  });

  it('ESCALATE_SWARM (HIGH_RISK): high-risk case never accepted on confidence alone', () => {
    const d = decideAfterLaya(CASE({ risk_hint: 'high' }), LAYA({ confidence: 0.99 }));
    expect(d.action).toBe('ESCALATE_SWARM');
    expect(d.escalation_trigger).toBe('HIGH_RISK');
  });

  it('CALL_JEV: medium-risk case always gets a second opinion regardless of confidence', () => {
    const d = decideAfterLaya(CASE({ risk_hint: 'medium' }), LAYA({ confidence: 0.99 }));
    expect(d.action).toBe('CALL_JEV');
  });

  it('ESCALATE_SWARM (INSUFFICIENT_EVIDENCE): empty case context routes to review, not a guess', () => {
    const d = decideAfterLaya(CASE({ state: '   ' }), LAYA({ confidence: 0.99 }));
    expect(d.action).toBe('ESCALATE_SWARM');
    expect(d.escalation_trigger).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('ABSTAIN (MODEL_FAILURE): a failed Laya call is never treated as confident', () => {
    const d = decideAfterLaya(CASE(), LAYA({ status: 'ERROR', confidence: 0, decision: 'ERROR' }));
    expect(d.action).toBe('ABSTAIN');
    expect(d.escalation_trigger).toBe('MODEL_FAILURE');
  });
});

const arena = (over: Partial<System1ArenaResult> = {}): System1ArenaResult => ({
  case_id: 'C-001',
  laya_result: LAYA(),
  jev_result: null,
  agreement: false,
  agreement_score: 0,
  confidence_delta: null,
  evidence_overlap: null,
  latency_ms: { laya: 100, jev: null, total: 100 },
  disagreement: null,
  ...over,
});

describe('decideAfterJev', () => {
  const jevUsable: System1Result = { ...LAYA(), model_id: 'jev', model_version: null, status: 'LIVE' };

  it('ESCALATE_SWARM (INSUFFICIENT_EVIDENCE): agreement alone does not verify a proposal', () => {
    const d = decideAfterJev(arena({ agreement: true, jev_result: jevUsable }));
    expect(d.action).toBe('ESCALATE_SWARM');
    expect(d.escalation_trigger).toBe('INSUFFICIENT_EVIDENCE');
    expect(d.reason).toMatch(/agreement is not verification/);
  });

  it('ESCALATE_SWARM (DISAGREEMENT): Laya + Jev disagree', () => {
    const d = decideAfterJev(arena({
      agreement: false,
      jev_result: jevUsable,
      disagreement: { case_id: 'C-001', task: 'q', laya_decision: 'NOTE', jev_decision: 'ESCALATE', laya_confidence: 0.7, jev_confidence: 0.8, disagreement_type: 'RISK', detail: '' },
    }));
    expect(d.action).toBe('ESCALATE_SWARM');
    expect(d.escalation_trigger).toBe('DISAGREEMENT');
  });

  it('ESCALATE_SWARM (LOW_CONFIDENCE_NO_JEV): Jev unreachable, no second opinion to resolve an unconfident Laya', () => {
    const d = decideAfterJev(arena({ jev_result: null }));
    expect(d.action).toBe('ESCALATE_SWARM');
    expect(d.escalation_trigger).toBe('LOW_CONFIDENCE_NO_JEV');
  });
});
