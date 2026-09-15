import { describe, expect, it } from '../test/bdd';
import { assessDisagreement, requestVerdict, NO_INDEPENDENT_POSITIONS_MESSAGE } from './deliberate';
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

/** What a genuinely disabled agent actually returns: `degraded: false` (nothing failed) but `provider: 'deterministic'` — it never called a model at all. */
function deterministicFallbackPosition(agent: ReasoningAgent, stance: string): ReasonResult<OlympianPosition> {
  return {
    value: { agent, stance, confidence: 0, reasoning_summary: `${agent} deterministic fallback`, claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
    provider: 'deterministic',
    degraded: false,
    degraded_reason: null,
    est_tokens: 0,
    ms: 1,
  };
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

  it('does not count a disabled agent\'s deterministic fallback as independent, even though it reports degraded: false', () => {
    const rows: Record<ReasoningAgent, ReasonResult<OlympianPosition>> = {
      ATHENA: deterministicFallbackPosition('ATHENA', 'insufficient_evidence'),
      HADES: deterministicFallbackPosition('HADES', 'insufficient_evidence'),
      ARES: position('ARES', 'tiger', 0.7, true),
    };
    const d = assessDisagreement(rows);
    expect(d.independent_count).toBe(0);
    expect(d.agreement).toBe('inconclusive');
  });

  it('counts a genuine LLM position as independent alongside excluded deterministic fallbacks', () => {
    const rows: Record<ReasoningAgent, ReasonResult<OlympianPosition>> = {
      ATHENA: deterministicFallbackPosition('ATHENA', 'insufficient_evidence'),
      HADES: deterministicFallbackPosition('HADES', 'insufficient_evidence'),
      ARES: position('ARES', 'tiger', 0.7, false),
    };
    const d = assessDisagreement(rows);
    expect(d.independent_count).toBe(1);
    expect(d.stances.ARES).toBe('tiger');
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

  it('is explicit that Zeus never really adjudicated when every position was deterministic fallback or degraded', async () => {
    const rows: Record<ReasoningAgent, ReasonResult<OlympianPosition>> = {
      ATHENA: {
        value: { agent: 'ATHENA', stance: 'insufficient_evidence', confidence: 0, reasoning_summary: 'x', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
        provider: 'deterministic', degraded: false, degraded_reason: null, est_tokens: 0, ms: 1,
      },
      HADES: {
        value: { agent: 'HADES', stance: 'insufficient_evidence', confidence: 0, reasoning_summary: 'x', claims: [], evidence_ids: [], evidence_requests: [], assumptions: [] },
        provider: 'deterministic', degraded: false, degraded_reason: null, est_tokens: 0, ms: 1,
      },
      ARES: position('ARES', 'tiger', 0.7, true),
    };
    const d = assessDisagreement(rows);
    expect(d.independent_count).toBe(0);
    const out = await requestVerdict(createDeterministicReasoner(), 'lion vs tiger?', rows, d);
    expect(out.provider).toBe('deterministic');
    expect(out.value.verdict_type).toBe('UNRESOLVED');
    expect(out.value.unresolved).toContain(NO_INDEPENDENT_POSITIONS_MESSAGE);
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
