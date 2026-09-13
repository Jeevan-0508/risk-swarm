import { assertNoFabricatedCitations, type ReasonRequest, type ReasonResult, type Reasoner } from './types';

/**
 * The default reasoner: no network, no key, no variance. It returns the agent's own deterministic
 * construction, but still passes it through validation and the provenance check, so the demo path
 * exercises exactly the same fences as the model path.
 */
export function createDeterministicReasoner(): Reasoner {
  return {
    id: 'deterministic',
    uses_network: false,
    async propose<T>(req: ReasonRequest<T>): Promise<ReasonResult<T>> {
      const started = Date.now();
      const raw = req.fallback();
      const value = req.validate(raw);
      assertNoFabricatedCitations(value, req.allowed_evidence_ids);
      return { value, provider: 'deterministic', degraded: false, degraded_reason: null, est_tokens: 0, ms: Date.now() - started };
    },
  };
}
