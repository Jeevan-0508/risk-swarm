import { describe, expect, it } from '../test/bdd';
import { assessDisagreement, requestVerdict } from './deliberate';
import { createDeterministicReasoner } from '../reasoner/deterministic';
import { assertNoFabricatedCitations, type Reasoner } from '../reasoner/types';
import type { OlympianPosition, ReasoningAgent } from './types';
import type { ReasonResult } from '../reasoner/types';

function position(agent: ReasoningAgent, stance: string, confidence: number, degraded = false): ReasonResult<OlympianPosition> {
  return {
    value: { agent, stance, confidence, reasoning_summary: `${agent} reasons ${stance}`, claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
    provider: degraded ? 'deterministic' : `llm:${agent.toLowerCase()}-model`,
    degraded,
    degraded_reason: degraded ? 'no api key configured' : null,
    est_tokens: 10,
    ms: 5,
  };
}

function positions(rows: Array<[ReasoningAgent, string, number, boolean?]>): Record<ReasoningAgent, ReasonResult<OlympianPosition>> {
  const out = {} as Record<ReasoningAgent, ReasonResult<OlympianPosition>>;
  for (const [a, s, c, d] of rows) out[a] = position(a, s, c, d);
  return out;
}

describe('disagreement assessment', () => {
  it('reports strong consensus when all independent positions agree', () => {
    const d = assessDisagreement(positions([['ATHENA', 'tiger', 0.8], ['ARES', 'tiger', 0.75], ['HADES', 'Tiger', 0.7]]));
    expect(d.agreement).toBe('strong_consensus');
    expect(d.distinct_stances).toEqual(['tiger']);
    expect(d.independent_count).toBe(3);
  });

  it('reports a majority with a real minority when two agree and one does not', () => {
    const d = assessDisagreement(positions([['ATHENA', 'tiger', 0.8], ['ARES', 'tiger', 0.7], ['HADES', 'lion', 0.6]]));
    expect(d.agreement).toBe('majority');
    expect(d.distinct_stances.sort()).toEqual(['lion', 'tiger']);
  });

  it('reports a split when all three genuinely diverge', () => {
    const d = assessDisagreement(positions([['ATHENA', 'tiger', 0.6], ['ARES', 'lion', 0.6], ['HADES', 'insufficient_evidence', 0.4]]));
    expect(d.agreement).toBe('split');
  });

  it('does not count a degraded (fallback) position as an independent opinion', () => {
    const d = assessDisagreement(positions([['ATHENA', 'tiger', 0.8], ['ARES', 'tiger', 0.75], ['HADES', 'insufficient_evidence', 0.3, true]]));
    expect(d.independent_count).toBe(2);
    expect(d.agreement).toBe('strong_consensus');
  });

  it('is inconclusive when fewer than two agents produced an independent position', () => {
    const d = assessDisagreement(positions([['ATHENA', 'tiger', 0.8], ['ARES', 'insufficient_evidence', 0.3, true], ['HADES', 'insufficient_evidence', 0.3, true]]));
    expect(d.agreement).toBe('inconclusive');
  });
});

describe('Zeus verdict', () => {
  const consensus = positions([['ATHENA', 'tiger', 0.8], ['ARES', 'tiger', 0.75], ['HADES', 'tiger', 0.7]]);
  const split = positions([['ATHENA', 'tiger', 0.6], ['ARES', 'lion', 0.55], ['HADES', 'insufficient_evidence', 0.4]]);

  it('the deterministic fallback declares CONSENSUS only when the positions actually converge', async () => {
    const d = assessDisagreement(consensus);
    const out = await requestVerdict(createDeterministicReasoner(), 'lion vs tiger?', consensus, d);
    expect(out.value.verdict_type).toBe('CONSENSUS');
    expect(out.value.answer).toBe('tiger');
    expect(out.value.minority_view).toBeNull();
  });

  it('the deterministic fallback preserves the minority view rather than erasing it on a majority', async () => {
    const majority = positions([['ATHENA', 'tiger', 0.8], ['ARES', 'tiger', 0.7], ['HADES', 'lion', 0.6]]);
    const d = assessDisagreement(majority);
    const out = await requestVerdict(createDeterministicReasoner(), 'lion vs tiger?', majority, d);
    expect(out.value.verdict_type).toBe('MAJORITY');
    expect(out.value.minority_view).toContain('HADES');
    expect(out.value.minority_view).toContain('lion');
  });

  it('the deterministic fallback never manufactures a winner when the positions genuinely split', async () => {
    const d = assessDisagreement(split);
    const out = await requestVerdict(createDeterministicReasoner(), 'lion vs tiger?', split, d);
    expect(out.value.verdict_type).toBe('UNRESOLVED');
    expect(out.value.unresolved.length).toBeGreaterThan(0);
  });

  it('rejects a Zeus answer that cites an evidence id none of the three positions ever cited', async () => {
    const withEvidence = positions([['ATHENA', 'tiger', 0.8], ['ARES', 'tiger', 0.7], ['HADES', 'tiger', 0.7]]);
    withEvidence.ATHENA.value.evidence_ids = ['EV-001'];
    const stub: Reasoner = {
      id: 'stub', uses_network: true,
      async propose(req) {
        const value = req.validate({ verdict_type: 'CONSENSUS', answer: 'tiger', confidence: 0.8, rationale: ['fabricated'], minority_view: null, unresolved: [], cited_evidence_ids: ['EV-404'] });
        assertNoFabricatedCitations(value, req.allowed_evidence_ids);
        return { value, provider: 'stub', degraded: false, degraded_reason: null, est_tokens: 5, ms: 1 };
      },
    };
    const d = assessDisagreement(withEvidence);
    await expect(requestVerdict(stub, 'lion vs tiger?', withEvidence, d)).rejects.toThrow();
  });
});
