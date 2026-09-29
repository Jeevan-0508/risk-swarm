import { describe, expect, it } from '../test/bdd';
import type { Decision } from '../domain/model';
import { createRiskOsSink } from './riskos';

describe('RISK//OS export', () => {
  it('omits an evidence-confidence classification derived from an uncalibrated policy index', () => {
    const decision = {
      id: 'DEC-1',
      run_id: 'RUN-1',
      question: 'Was this incident established?',
      headline_risk: 'Unverified incident report',
      hypothesis_ids: [],
      action_band: 'MONITOR',
      severity_band: 'MEDIUM',
      severity_score: 0.4,
      confidence: 0.99,
      created_at: '2026-09-29T00:00:00.000Z',
      review_by: '2026-10-01',
      rationale: [],
      unresolved_objections: [],
    } as unknown as Decision;
    const candidate = createRiskOsSink().exportRisk({
      decision,
      actions: [],
      evidence: [],
      now: '2026-09-29T00:00:00.000Z',
    });

    expect('evidenceConfidence' in candidate.risk).toBe(false);
    expect(candidate.import_instructions.join(' ')).toContain('intentionally omitted');
    expect(candidate.import_instructions.join(' ')).toContain('human review');
  });
});
