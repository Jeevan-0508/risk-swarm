import { DEFAULT_SWARM_POLICY, SwarmCaseSchema, type SwarmCase, type SwarmPolicy, type SwarmScope, SWARM_PROTOCOL_VERSION, type SwarmCaseId } from './index';

export interface CreateSwarmCaseInput {
  readonly case_id: SwarmCaseId;
  readonly question: string;
  readonly scope: SwarmScope;
  readonly created_at: string;
  readonly created_by: string;
  readonly policy?: Partial<SwarmPolicy>;
}

export function createSwarmCase(input: CreateSwarmCaseInput): SwarmCase {
  return SwarmCaseSchema.parse({
    case_id: input.case_id,
    protocol_version: SWARM_PROTOCOL_VERSION,
    question: input.question,
    scope: input.scope,
    created_at: input.created_at,
    created_by: input.created_by,
    policy: { ...DEFAULT_SWARM_POLICY, ...(input.policy ?? {}) },
    status: 'CASE_CREATED',
  });
}
