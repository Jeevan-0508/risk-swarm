import { z } from 'zod';
import type { ModelExecution } from '../../reasoner/types';

export const AI_RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNDETERMINED'] as const;
export const AIRiskLevel = z.enum(AI_RISK_LEVELS);
export type AIRiskLevel = z.infer<typeof AIRiskLevel>;

export const AI_RISK_CATEGORIES = [
  'safety',
  'fairness',
  'privacy',
  'security',
  'transparency',
  'human_oversight',
  'accountability',
  'robustness',
  'governance',
  'other',
] as const;
export const AIRiskCategory = z.enum(AI_RISK_CATEGORIES);
export type AIRiskCategory = z.infer<typeof AIRiskCategory>;

export const AIRiskUncertaintyLevel = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type AIRiskUncertaintyLevel = z.infer<typeof AIRiskUncertaintyLevel>;

const confidence = z.number().finite().min(0).max(1);
const text = z.string().trim().min(1).max(4000);
const shortText = z.string().trim().min(1).max(1000);

export const AIRiskUncertainty = z.object({
  level: AIRiskUncertaintyLevel,
  reasons: z.array(shortText).max(12),
}).strict();
export type AIRiskUncertainty = z.infer<typeof AIRiskUncertainty>;

export const AIRiskFinding = z.object({
  finding_id: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  statement: text,
  risk_category: AIRiskCategory,
  severity: AIRiskLevel,
  evidence_ids: z.array(z.string().trim().min(1).max(120)).min(1).max(32),
  reasoning: text,
  assumptions: z.array(shortText).max(12),
  uncertainty: AIRiskUncertainty,
  confidence,
  control_gap: text.nullable(),
  recommended_actions: z.array(shortText).max(12),
}).strict();
export type AIRiskFinding = z.infer<typeof AIRiskFinding>;

export const AIRiskEvidenceGap = z.object({
  description: text,
  impact: text,
  requested_evidence: text,
}).strict();
export type AIRiskEvidenceGap = z.infer<typeof AIRiskEvidenceGap>;

export const AIRiskConflict = z.object({
  evidence_ids: z.array(z.string().trim().min(1).max(120)).min(2).max(8),
  description: text,
  impact: text,
}).strict();
export type AIRiskConflict = z.infer<typeof AIRiskConflict>;

export const AIRiskEscalation = z.object({
  recommended: z.boolean(),
  reason: text.nullable(),
}).strict();
export type AIRiskEscalation = z.infer<typeof AIRiskEscalation>;

export const AIRiskAbstention = z.object({
  abstained: z.boolean(),
  reason: text.nullable(),
  required_evidence: z.array(shortText).max(16),
}).strict();
export type AIRiskAbstention = z.infer<typeof AIRiskAbstention>;

/** Model-controlled fields. Execution identity is attached by the runtime, never trusted from the model. */
export const AIRiskManagerModelOutput = z.object({
  assessment_status: z.enum(['ASSESSED', 'ABSTAINED']),
  executive_summary: text,
  findings: z.array(AIRiskFinding).max(16),
  overall_risk: AIRiskLevel,
  confidence,
  uncertainty: AIRiskUncertainty,
  evidence_gaps: z.array(AIRiskEvidenceGap).max(16),
  conflicting_evidence: z.array(AIRiskConflict).max(16),
  control_recommendations: z.array(shortText).max(16),
  monitoring_recommendations: z.array(shortText).max(16),
  escalation: AIRiskEscalation,
  abstention: AIRiskAbstention,
}).strict();
export type AIRiskManagerModelOutput = z.infer<typeof AIRiskManagerModelOutput>;

export interface AIRiskManagerAssessment extends AIRiskManagerModelOutput {
  readonly specialist_id: 'ai-risk-manager';
  readonly specialist_version: '1.0.0';
  readonly execution: ModelExecution;
}

export const AIRiskManagerAssessment = AIRiskManagerModelOutput.extend({
  specialist_id: z.literal('ai-risk-manager'),
  specialist_version: z.literal('1.0.0'),
  execution: z.object({
    model_called: z.boolean(),
    provider: z.string().nullable(),
    model_id: z.string().nullable(),
    status: z.enum(['SUCCESS', 'DEGRADED', 'FAILED', 'DISABLED']),
    degraded: z.boolean(),
    degraded_reason: z.string().nullable(),
    independent: z.boolean(),
  }).strict(),
}).strict();
