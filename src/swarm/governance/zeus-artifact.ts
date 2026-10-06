import { z } from 'zod';
import type { SwarmBlackboard, SwarmExecutionEvent } from '../contracts';
import { ZeusReadinessSchema, ZeusSynthesisBriefSchema, ZeusSynthesisInputSchema } from '../contracts';
import { deterministicPackageHash } from '../evidence/package';
import { validateZeusSynthesis, zeusSynthesisFingerprint } from './zeus';

export const ZeusArtifactSchema = z.object({
  artifact_schema_version: z.union([z.literal('SWARM_PHASE6A_ZEUS_ARTIFACT_V1'), z.literal('SWARM_PHASE6B_LIVE_ZEUS_ARTIFACT_V1')]),
  case_id: z.string().min(1),
  zeus_readiness: ZeusReadinessSchema,
  input_manifest: ZeusSynthesisInputSchema,
  input_fingerprint: z.string().min(1),
  synthesis: ZeusSynthesisBriefSchema,
  synthesis_fingerprint: z.string().min(1),
  validation: z.object({
    json_parse: z.literal('PASS'),
    dto_validation: z.literal('PASS'),
    semantic_validation: z.literal('PASS'),
    source_reference_validation: z.literal('PASS'),
    protocol_validation: z.literal('PASS'),
  }),
  authority_attestation: z.literal('HUMAN_DECISION_REQUIRED'),
  minority_preservation_attestation: z.literal('PASS'),
  disagreement_preservation_attestation: z.literal('PASS'),
  audit_preservation_attestation: z.literal('PASS'),
  event_sequence: z.array(z.object({ sequence: z.number().int().positive(), type: z.string().min(1) })),
  request_ledger: z.object({ request_budget: z.literal(1), requests: z.literal(1), retry_requests: z.literal(0), fallback_requests: z.literal(0), provider_requests: z.union([z.literal(0), z.literal(1)]) }),
  human_decision: z.null(),
  artifact_fingerprint: z.string().min(1),
});
export type ZeusArtifact = z.infer<typeof ZeusArtifactSchema>;

export interface ZeusArtifactBuildOptions {
  readonly artifact_schema_version?: ZeusArtifact['artifact_schema_version'];
  readonly provider_requests?: 0 | 1;
}

export function buildZeusArtifact(state: SwarmBlackboard, options: ZeusArtifactBuildOptions = {}): ZeusArtifact {
  if (!state.zeus_readiness || !state.zeus_input || !state.zeus_synthesis || state.state !== 'HUMAN_REVIEW') throw new Error('ZEUS_ARTIFACT_REQUIRES_HUMAN_REVIEW_STATE');
  const withoutFingerprint = {
    artifact_schema_version: options.artifact_schema_version ?? 'SWARM_PHASE6A_ZEUS_ARTIFACT_V1',
    case_id: state.case!.case_id,
    zeus_readiness: state.zeus_readiness,
    input_manifest: state.zeus_input,
    input_fingerprint: state.zeus_input.input_fingerprint,
    synthesis: state.zeus_synthesis,
    synthesis_fingerprint: state.zeus_synthesis.synthesis_fingerprint,
    validation: { json_parse: 'PASS' as const, dto_validation: 'PASS' as const, semantic_validation: 'PASS' as const, source_reference_validation: 'PASS' as const, protocol_validation: 'PASS' as const },
    authority_attestation: 'HUMAN_DECISION_REQUIRED' as const,
    minority_preservation_attestation: 'PASS' as const,
    disagreement_preservation_attestation: 'PASS' as const,
    audit_preservation_attestation: 'PASS' as const,
    event_sequence: state.execution_events.map((event) => ({ sequence: event.sequence, type: event.type })),
    request_ledger: { request_budget: 1 as const, requests: 1 as const, retry_requests: 0 as const, fallback_requests: 0 as const, provider_requests: options.provider_requests ?? 0 },
    human_decision: null,
  };
  return ZeusArtifactSchema.parse({ ...withoutFingerprint, artifact_fingerprint: deterministicPackageHash(withoutFingerprint) });
}

/** Reconstructs only durable Zeus state. It never calls a provider and does
 * not depend on the in-memory reducer state that created the artifact. */
export function replayZeusArtifact(artifact: unknown): { readonly input: ZeusArtifact['input_manifest']; readonly synthesis: ZeusArtifact['synthesis']; readonly human_decision_required: true; readonly human_decision: null; readonly artifact_only_replay: 'PASS' } {
  const parsed = verifyZeusArtifact(artifact);
  return { input: parsed.input_manifest, synthesis: parsed.synthesis, human_decision_required: true, human_decision: null, artifact_only_replay: 'PASS' };
}

export function verifyZeusArtifact(artifact: unknown): ZeusArtifact {
  const parsed = ZeusArtifactSchema.parse(artifact);
  if (parsed.case_id !== parsed.input_manifest.case.case_id || parsed.case_id !== parsed.synthesis.case_id) throw new Error('ZEUS_ARTIFACT_CASE_MISMATCH');
  if (parsed.input_fingerprint !== parsed.input_manifest.input_fingerprint) throw new Error('ZEUS_ARTIFACT_INPUT_FINGERPRINT_MISMATCH');
  validateZeusSynthesis(parsed.synthesis, parsed.input_manifest);
  if (parsed.synthesis_fingerprint !== parsed.synthesis.synthesis_fingerprint || parsed.synthesis_fingerprint !== zeusSynthesisFingerprint(parsed.synthesis)) throw new Error('ZEUS_ARTIFACT_SYNTHESIS_FINGERPRINT_MISMATCH');
  const { artifact_fingerprint: _artifactFingerprint, ...artifactWithoutFingerprint } = parsed;
  const expectedArtifactFingerprint = deterministicPackageHash(artifactWithoutFingerprint);
  if (parsed.artifact_fingerprint !== expectedArtifactFingerprint) throw new Error('ZEUS_ARTIFACT_FINGERPRINT_MISMATCH');
  if (parsed.event_sequence.length === 0 || parsed.event_sequence.some((event, index) => event.sequence !== index + 1)) throw new Error('ZEUS_ARTIFACT_EVENT_SEQUENCE_INVALID');
  if (parsed.event_sequence.at(-1)?.type !== 'HUMAN_REVIEW_REQUIRED') throw new Error('ZEUS_ARTIFACT_HUMAN_REVIEW_GATE_FAILED');
  return parsed;
}

export function eventSequence(events: readonly SwarmExecutionEvent[]): ZeusArtifact['event_sequence'] {
  return events.map((event) => ({ sequence: event.sequence, type: event.type }));
}
