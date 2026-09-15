import { describe, expect, it } from '../test/bdd';
import { createDeterministicReasoner } from '../reasoner/deterministic';
import { DEFAULT_MAX_OUTPUT_TOKENS } from '../reasoner/shared';
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
  /**
   * Phase 1 live-debug brief (evidence-payload fix): reproduces the reported shape (37 evidence
   * items, each at the research pipeline's own per-item storage ceiling — title 300 chars, excerpt
   * 1200 chars) and proves the resulting prompt stays bounded rather than growing linearly with no
   * cap, without dropping a single evidence item, id, or the ability to cite it.
   */
  const bigEvidence = fixtureEvidence(
    Array.from({ length: 37 }, (_, i) => ({
      id: `E-${String(i).padStart(3, '0')}`,
      title: 'T'.repeat(300),
      excerpt: `UNIQUE_MARKER_${i} ${'X'.repeat(1190)}`,
    })),
  );


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

  it('bounds a large (37-item) evidence set to a fraction of its unbounded size, instead of growing without limit', () => {
    const req = buildPositionRequest('ARES', 'which planet has largest diameter in solar system?', bigEvidence);
    const evidenceCharCount = req.data_blocks.join('').length;
    // Unbounded (title 300 + excerpt 1200 per item, no cap) would run to roughly 37 * 1550 ≈ 57,000
    // chars. The fix must keep it well under half that while still saying something about every item.
    expect(evidenceCharCount).toBeLessThan(30_000);
    expect(req.data_blocks).toHaveLength(37);
  });

  it('keeps every evidence id citable after bounding the excerpt, even in a large set', () => {
    const req = buildPositionRequest('ARES', 'q', bigEvidence);
    expect(req.allowed_evidence_ids).toHaveLength(37);
    for (const id of req.allowed_evidence_ids) {
      expect(req.data_blocks.some((block) => block.includes(`id="${id}"`))).toBe(true);
    }
  });

  it('still gives the model enough of each long excerpt to reason over, not just a title', () => {
    const req = buildPositionRequest('ARES', 'q', bigEvidence);
    // The unique marker near the start of each excerpt must survive truncation.
    for (let i = 0; i < 37; i++) {
      expect(req.data_blocks[i]).toContain(`UNIQUE_MARKER_${i}`);
    }
  });

  it('truncates an over-long excerpt with a visible marker, never silently or by fabricating a summary', () => {
    const longExcerpt = fixtureEvidence([{ id: 'E-LONG', title: 'Long', excerpt: 'Y'.repeat(1200) }]);
    const req = buildPositionRequest('ARES', 'q', longExcerpt);
    expect(req.data_blocks[0]).toContain('…');
    // The truncated block must be a strict prefix of the real text plus the marker — nothing invented.
    expect(req.data_blocks[0]).toContain('Y'.repeat(100));
    expect(req.data_blocks[0].length).toBeLessThan('Y'.repeat(1200).length);
  });

  it('leaves a short excerpt completely untouched — no unnecessary truncation', () => {
    const shortExcerpt = fixtureEvidence([{ id: 'E-SHORT', title: 'Short', excerpt: 'A short, single-sentence excerpt well under the cap.' }]);
    const req = buildPositionRequest('ARES', 'q', shortExcerpt);
    expect(req.data_blocks[0]).toContain('A short, single-sentence excerpt well under the cap.');
    expect(req.data_blocks[0]).not.toContain('…');
  });

  it('did not raise the output token cap again this turn — the fix is the prompt, not the ceiling', () => {
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(1600);
  });
});
