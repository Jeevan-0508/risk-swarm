import type { SpecialistContract } from '../contract';
import { SPECIALIST_PROHIBITIONS, SPECIALIST_ACTIONS } from '../contract';
import { AIRiskManagerModelOutput } from './schema';

export const AI_RISK_MANAGER_CONTRACT: SpecialistContract<typeof AIRiskManagerModelOutput._type> = {
  id: 'ai-risk-manager',
  version: '1.0.0',
  name: 'AI Risk Manager',
  description: 'An advisory specialist that assesses AI-system risk over a bounded SWARM evidence package.',
  mandate: 'Assess evidenced AI-system risks, control gaps, uncertainty, evidence needs, and proportionate recommendations.',
  allowed_actions: [...SPECIALIST_ACTIONS],
  prohibited_actions: [...SPECIALIST_PROHIBITIONS],
  required_inputs: ['question', 'domain', 'immutable evidence package'],
  optional_inputs: ['scope', 'known uncertainties', 'known conflicts', 'known evidence gaps'],
  output_schema: AIRiskManagerModelOutput,
  authority: {
    allowed_actions: [...SPECIALIST_ACTIONS],
    prohibited_actions: [...SPECIALIST_PROHIBITIONS],
    decision_authority: 'ADVISORY_ONLY',
  },
  evidence_policy: {
    receives_projection: true,
    may_create_evidence: false,
    may_modify_evidence: false,
    may_change_evidence_tier: false,
    citations_must_resolve: true,
  },
  abstention_policy: {
    allowed: true,
    distinct_from_unavailable: true,
    minimum_evidence: 'NO_HARD_MINIMUM',
    reasons: ['insufficient evidence', 'irrelevant evidence', 'missing provenance', 'irreconcilable contradiction', 'outside mandate'],
  },
};
