import { z } from 'zod';
import {
  ChallengeRequestedActionSchema,
  ChallengeTargetTypeSchema,
  ChallengeTypeSchema,
  DisagreementIdSchema,
  EvidenceIdSchema,
  PositionIdSchema,
  Round1SeatIdSchema,
  type AgentPosition,
  type Challenge,
  type Disagreement,
  type EvidencePackage,
  type SwarmCase,
} from '../contracts';
import { jsonSchema } from './structured-output';
import { type ModelExecutionPlan, type ModelResponse, type OutputSchemaDescriptor } from './types';
import { ModelRouter } from './router';
import { allowedChallengeTypesForDisagreement, PHASE5_CHALLENGE_COMPATIBILITY_SOURCE, PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT, PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT, PHASE5_MAX_TOTAL_CHALLENGES } from '../debate/challenges';

export const Phase5ChallengeDraftSchema = z.object({
  disagreement_id: DisagreementIdSchema,
  to_seat: z.enum(['ATHENA', 'HADES', 'APOLLO']),
  target_type: ChallengeTargetTypeSchema,
  target_position: PositionIdSchema,
  target_claim: z.string().min(1).max(160).nullable(),
  challenge_type: ChallengeTypeSchema,
  challenge_text: z.string().min(1).max(2000),
  evidence_ids: z.array(EvidenceIdSchema).max(64),
  requested_action: ChallengeRequestedActionSchema,
}).strict();

export type Phase5ChallengeDraft = z.infer<typeof Phase5ChallengeDraftSchema>;

export const Phase5ChallengeGenerationOutputSchema = z.object({
  challenges: z.array(Phase5ChallengeDraftSchema).max(6),
}).strict();

export type Phase5ChallengeGenerationOutput = z.infer<typeof Phase5ChallengeGenerationOutputSchema>;

const PHASE5_CHALLENGE_DRAFT_PROVIDER_SCHEMA = (allowedChallengeTypes: readonly Challenge['challenge_type'][]): Readonly<Record<string, unknown>> => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    disagreement_id: { type: 'string', minLength: 1 },
    to_seat: { type: 'string', enum: ['ATHENA', 'HADES', 'APOLLO'] },
    target_type: { type: 'string', enum: ['POSITION', 'CLAIM', 'DISAGREEMENT'] },
    target_position: { type: 'string', minLength: 1 },
    target_claim: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
    challenge_type: { type: 'string', enum: [...allowedChallengeTypes] },
    challenge_text: { type: 'string', minLength: 1 },
    evidence_ids: { type: 'array', items: { type: 'string', minLength: 1 } },
    requested_action: { type: 'string', enum: ['DEFEND', 'REVISE', 'CONCEDE', 'REQUEST_EVIDENCE', 'ABSTAIN'] },
  },
  required: ['disagreement_id', 'to_seat', 'target_type', 'target_position', 'target_claim', 'challenge_type', 'challenge_text', 'evidence_ids', 'requested_action'],
});

export const PHASE5_CHALLENGE_GENERATION_PROVIDER_SCHEMA: Readonly<Record<string, unknown>> = {
  type: 'object',
  additionalProperties: false,
  properties: { challenges: { type: 'array', maxItems: 6, items: PHASE5_CHALLENGE_DRAFT_PROVIDER_SCHEMA(['ASSUMPTION', 'EVIDENCE', 'CAUSAL', 'SEVERITY', 'CONTROL', 'AUTHORITY', 'SCOPE', 'CONFIDENCE', 'RECOMMENDATION']) } },
  required: ['challenges'],
};

export function phase5ChallengeGenerationProviderSchema(maxItems = 6, allowedChallengeTypes: readonly Challenge['challenge_type'][] = ['ASSUMPTION', 'EVIDENCE', 'CAUSAL', 'SEVERITY', 'CONTROL', 'AUTHORITY', 'SCOPE', 'CONFIDENCE', 'RECOMMENDATION']): Readonly<Record<string, unknown>> {
  return {
    ...PHASE5_CHALLENGE_GENERATION_PROVIDER_SCHEMA,
    properties: { challenges: { type: 'array', maxItems, items: PHASE5_CHALLENGE_DRAFT_PROVIDER_SCHEMA(allowedChallengeTypes) } },
  };
}

export function phase5ChallengeDraftsToChallenges(input: Phase5ChallengeGenerationInput, output: Phase5ChallengeGenerationOutput): readonly Challenge[] {
  return output.challenges.map((draft, index) => ({
    challenge_id: `challenge-${index + 1}` as Challenge['challenge_id'],
    case_id: input.case.case_id,
    round: 1,
    from_seat: 'ARES' as const,
    to_seat: draft.to_seat,
    target_position: draft.target_position,
    target_claim: draft.target_claim as Challenge['target_claim'],
    challenge_type: draft.challenge_type,
    reasoning: draft.challenge_text,
    evidence_ids: [...draft.evidence_ids],
    disagreement_id: draft.disagreement_id,
    target_type: draft.target_type,
    challenge_text: draft.challenge_text,
    requested_action: draft.requested_action,
  }));
}

export function phase5ChallengeGenerationSchema(maxItems = 6, allowedChallengeTypes: readonly Challenge['challenge_type'][] = ['ASSUMPTION', 'EVIDENCE', 'CAUSAL', 'SEVERITY', 'CONTROL', 'AUTHORITY', 'SCOPE', 'CONFIDENCE', 'RECOMMENDATION']): OutputSchemaDescriptor<Phase5ChallengeGenerationOutput> {
  return jsonSchema<Phase5ChallengeGenerationOutput>(
    'swarm_phase5_challenge_generation',
    (value) => {
      const parsed = Phase5ChallengeGenerationOutputSchema.safeParse(value);
      if (!parsed.success) return { success: false, error: 'challenge generation schema invalid' };
      if (parsed.data.challenges.some((challenge) => !allowedChallengeTypes.includes(challenge.challenge_type))) return { success: false, error: 'challenge type incompatible with selected disagreement' };
      return { success: true, value: parsed.data };
    },
    { strict: true, describe: `Bounded ARES challenge drafts; at most ${maxItems} challenge(s) for this generation scope; allowed challenge types are ${allowedChallengeTypes.join(', ')}; compatibility source ${PHASE5_CHALLENGE_COMPATIBILITY_SOURCE}; no peer reasoning or authority output.`, json_schema: phase5ChallengeGenerationProviderSchema(maxItems, allowedChallengeTypes) },
  );
}

export const PHASE5_CHALLENGE_GENERATION_SCHEMA = phase5ChallengeGenerationSchema();

export interface Phase5ChallengeGenerationInput {
  readonly case: Pick<SwarmCase, 'case_id' | 'protocol_version' | 'question' | 'scope' | 'policy'>;
  readonly evidence_package: EvidencePackage;
  readonly positions: readonly AgentPosition[];
  readonly disagreements: readonly Disagreement[];
}

/** Provider-neutral Phase 5 challenge generation seam. The router owns
 * provider/model selection, retries, capabilities, and structured validation. */
export class ModelChallengeGenerator {
  constructor(
    private readonly router: ModelRouter,
    private readonly plan: ModelExecutionPlan,
    private readonly requestId = (caseId: string, invocation: number) => `model-request-${caseId}-ARES-phase5-challenges-${invocation}`,
    private readonly max_output_tokens = 1200,
    private readonly max_challenges = 6,
  ) {}

  async execute(input: Phase5ChallengeGenerationInput, invocation = 1): Promise<ModelResponse<Phase5ChallengeGenerationOutput>> {
    const selectedDisagreement = input.disagreements[0];
    const allowedChallengeTypes = input.disagreements.length > 0
      ? [...new Set(input.disagreements.flatMap((disagreement) => allowedChallengeTypesForDisagreement(disagreement.type)))]
      : ['ASSUMPTION', 'EVIDENCE', 'CAUSAL', 'SEVERITY', 'CONTROL', 'AUTHORITY', 'SCOPE', 'CONFIDENCE', 'RECOMMENDATION'] as const;
    return this.router.execute({
      request_id: this.requestId(input.case.case_id, invocation),
      case_id: input.case.case_id,
      seat_id: 'ARES',
      purpose: 'SWARM_PHASE5_CHALLENGE_GENERATION',
      model_requirements: ['TEXT_GENERATION', 'STRUCTURED_OUTPUT'] as const,
      system_instruction: 'You are ARES. Generate only bounded, targeted challenge drafts. Use only the allowed challenge types for the selected disagreement. Do not relabel the disagreement, synthesize, decide, or reveal peer reasoning.',
      task_instruction: this.max_challenges === 2
        ? `Generate at most two high-value targeted challenges for the selected disagreement. Each challenge must target exactly one eligible seat. The selected disagreement type is ${selectedDisagreement?.type ?? 'UNKNOWN'}; allowed challenge_type values are ${allowedChallengeTypes.join(', ')}. Do not introduce an incompatible challenge dimension or optimize for producing the maximum number.`
        : `Identify the highest-priority disagreements and return only compatible, non-duplicate challenge candidates. The runtime admits at most ${PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT} challenges per disagreement, at most ${PHASE5_MAX_CHALLENGES_PER_TARGET_SEAT} challenges per target seat, and at most ${PHASE5_MAX_TOTAL_CHALLENGES} total challenges in one round; return no more than ${this.max_challenges} candidates. Direct each challenge to exactly one eligible target seat and use only the selected disagreement's allowed challenge_type values from the canonical compatibility contract.`,
      context: {
        seat_id: 'ARES',
        scope: input.case.scope,
        evidence_package_id: input.evidence_package.package_id,
        position_summaries: input.positions.map((position) => ({ seat_id: position.seat_id, position_id: position.position_id, risk_level: position.risk_level, confidence: position.confidence })),
        disagreement_summaries: input.disagreements.map((item) => ({ disagreement_id: item.disagreement_id, type: item.type, materiality: item.materiality, subject_ids: item.subject_ids, evidence_ids: item.evidence_ids })),
        target_disagreement_id: input.disagreements[0]?.disagreement_id ?? null,
        target_disagreement_type: selectedDisagreement?.type ?? null,
        allowed_challenge_types: [...allowedChallengeTypes],
        allowed_challenge_types_by_disagreement: Object.fromEntries(input.disagreements.map((disagreement) => [disagreement.disagreement_id, allowedChallengeTypesForDisagreement(disagreement.type)])),
        compatibility_source: PHASE5_CHALLENGE_COMPATIBILITY_SOURCE,
      },
      output_schema: phase5ChallengeGenerationSchema(this.max_challenges, allowedChallengeTypes),
      max_output_tokens: this.max_output_tokens,
      timeout_ms: 10_000,
    }, this.plan);
  }

  async generate(input: Phase5ChallengeGenerationInput, invocation = 1): Promise<readonly Challenge[]> {
    const result = await this.execute(input, invocation);
    if (result.status !== 'SUCCESS' || !result.structured_output) return [];
    return phase5ChallengeDraftsToChallenges(input, result.structured_output);
  }
}

export function phase5ChallengeGeneratorInputSeat(): z.infer<typeof Round1SeatIdSchema> {
  return 'ARES';
}
