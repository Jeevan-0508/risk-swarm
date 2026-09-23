import { describe, expect, it } from '../../test/bdd';
import { compareSystem1Results } from './compare';
import { unavailableResult, type System1Result } from '../types';

const layaBase = (over: Partial<System1Result> = {}): System1Result => ({
  case_id: 'C-001',
  model_id: 'laya-typed',
  model_version: 'convaiinnovations/laya-typed-decisions',
  decision: 'MONITOR',
  confidence: 0.7,
  uncertainty: 0.2,
  rationale: 'typed decision',
  evidence_ids: [],
  latency_ms: 100,
  status: 'SHADOW',
  raw: null,
  ...over,
});

const jevBase = (over: Partial<System1Result> = {}): System1Result => ({
  case_id: 'C-001',
  model_id: 'jev',
  model_version: null,
  decision: 'MONITOR',
  confidence: 0.7,
  uncertainty: 0.2,
  rationale: 'typed decision',
  evidence_ids: [],
  latency_ms: 50,
  status: 'LIVE',
  raw: null,
  ...over,
});

describe('compareSystem1Results', () => {
  it('reports agreement when both models pick the same stance with close confidence', () => {
    const result = compareSystem1Results({
      caseId: 'C-001', task: 'q', layaResult: layaBase(), jevResult: jevBase(),
      latencyMs: { laya: 100, jev: 50 },
    });
    expect(result.agreement).toBe(true);
    expect(result.disagreement).toBeNull();
    expect(result.agreement_score).toBeGreaterThan(0.5);
  });

  it('classifies a same-stance, large-confidence-gap case as CONFIDENCE, not CLASSIFICATION', () => {
    const result = compareSystem1Results({
      caseId: 'C-001', task: 'q',
      layaResult: layaBase({ confidence: 0.95 }),
      jevResult: jevBase({ confidence: 0.2 }),
      latencyMs: { laya: 100, jev: 50 },
    });
    expect(result.agreement).toBe(false);
    expect(result.disagreement?.disagreement_type).toBe('CONFIDENCE');
  });

  it('classifies a two-rung action-ladder split as RISK', () => {
    const result = compareSystem1Results({
      caseId: 'C-001', task: 'q',
      layaResult: layaBase({ decision: 'NOTE' }),
      jevResult: jevBase({ decision: 'ESCALATE' }),
      latencyMs: { laya: 100, jev: 50 },
    });
    expect(result.disagreement?.disagreement_type).toBe('RISK');
  });

  it('classifies an adjacent one-rung split as CLASSIFICATION, not RISK', () => {
    const result = compareSystem1Results({
      caseId: 'C-001', task: 'q',
      layaResult: layaBase({ decision: 'MONITOR' }),
      jevResult: jevBase({ decision: 'TARGETED_INVESTIGATION' }),
      latencyMs: { laya: 100, jev: 50 },
    });
    expect(result.disagreement?.disagreement_type).toBe('CLASSIFICATION');
  });

  it('never averages scores away - a disagreement always carries both raw stances and confidences', () => {
    const result = compareSystem1Results({
      caseId: 'C-001', task: 'q',
      layaResult: layaBase({ decision: 'ESCALATE', confidence: 0.9 }),
      jevResult: jevBase({ decision: 'NOTE', confidence: 0.4 }),
      latencyMs: { laya: 100, jev: 50 },
    });
    expect(result.disagreement?.laya_decision).toBe('ESCALATE');
    expect(result.disagreement?.jev_decision).toBe('NOTE');
    expect(result.disagreement?.laya_confidence).toBe(0.9);
    expect(result.disagreement?.jev_confidence).toBe(0.4);
  });

  it('does not fabricate a disagreement when Jev was UNAVAILABLE - records absence, not a fake stance', () => {
    const jevUnavailable = unavailableResult({ case_id: 'C-001', model_id: 'jev', model_version: null, reason: 'no invite' });
    const result = compareSystem1Results({
      caseId: 'C-001', task: 'q', layaResult: layaBase(), jevResult: jevUnavailable,
      latencyMs: { laya: 100, jev: 0 },
    });
    expect(result.disagreement).toBeNull();
    expect(result.agreement).toBe(false);
    expect(result.jev_result?.status).toBe('UNAVAILABLE');
  });

  it('handles a genuinely null jevResult (never dispatched) the same as UNAVAILABLE - absence, not a fabricated stance', () => {
    const result = compareSystem1Results({
      caseId: 'C-001', task: 'q', layaResult: layaBase(), jevResult: null,
      latencyMs: { laya: 100, jev: null },
    });
    expect(result.disagreement).toBeNull();
    expect(result.jev_result).toBeNull();
  });
});
