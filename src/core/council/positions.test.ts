import { describe, expect, it } from '../test/bdd';
import { createDeterministicReasoner } from '../reasoner/deterministic';
import { assertNoFabricatedCitations, FabricatedCitationError, type Reasoner } from '../reasoner/types';
import { buildPositionRequest, requestPosition } from './positions';
import { fixtureEvidence } from './fixtures.test-helpers';

const evidence = fixtureEvidence([
  { id: 'EV-001', title: 'Tiger', excerpt: 'Tigers can outweigh lions by over a hundred pounds and are generally more powerful in a fight.' },
  { id: 'EV-002', title: 'Lion', excerpt: 'Lions live in prides while tigers are typically solitary.' },
]);

function stubReasoner(response: unknown): Reasoner {
  return {
    id: 'stub',
    uses_network: true,
    async propose(req) {
      const value = req.validate(response);
      assertNoFabricatedCitations(value, req.allowed_evidence_ids);
      return { value, provider: 'stub', degraded: false, degraded_reason: null, est_tokens: 10, ms: 1 };
    },
  };
}

describe('Olympian position requests', () => {
  it('builds a request that only allows citing evidence ids actually retrieved', () => {
    const req = buildPositionRequest('ATHENA', 'lion vs tiger?', evidence);
    expect(req.allowed_evidence_ids).toEqual(['EV-001', 'EV-002']);
    expect(req.data_blocks).toHaveLength(2);
    expect(req.instruction).toContain('ATHENA');
  });

  it('accepts a well-formed independent position and stamps the correct agent', async () => {
    const reasoner = stubReasoner({ stance: 'tiger', confidence: 0.8, reasoning_summary: 'Evidence favors tiger in combat.', claims: ['Tigers outweigh lions'], evidence_ids: ['EV-001'], evidence_requests: [], assumptions: ['one-on-one, no pride support'] });
    const out = await requestPosition('ARES', reasoner, 'lion vs tiger?', evidence);
    expect(out.degraded).toBe(false);
    expect(out.value.agent).toBe('ARES');
    expect(out.value.stance).toBe('tiger');
  });

  it('rejects a position that cites an evidence id it was never given', async () => {
    const reasoner = stubReasoner({ stance: 'tiger', confidence: 0.8, reasoning_summary: 'x', claims: ['x'], evidence_ids: ['EV-999'], evidence_requests: [], assumptions: [] });
    await expect(reasoner.propose(buildPositionRequest('HADES', 'lion vs tiger?', evidence))).rejects.toThrow(FabricatedCitationError);
  });

  it('falls back to a low-confidence, non-fabricated position with no model configured', async () => {
    const out = await requestPosition('ATHENA', createDeterministicReasoner(), 'lion vs tiger?', evidence);
    expect(out.value.stance).toBe('insufficient_evidence');
    expect(out.value.confidence).toBeLessThan(0.5);
    expect(out.value.claims).toEqual([]);
  });

  it('the fallback never fabricates evidence even with zero retrieved items', async () => {
    const out = await requestPosition('HADES', createDeterministicReasoner(), 'anything?', []);
    expect(out.value.stance).toBe('insufficient_evidence');
    expect(out.value.reasoning_summary).toContain('No model configured and no evidence');
  });
});
