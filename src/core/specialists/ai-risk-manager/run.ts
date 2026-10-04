import type { Reasoner } from '../../reasoner/types';
import { assertSpecialistContract } from '../contract';
import type { SpecialistEvidencePackage } from '../evidence';
import { runSpecialist } from '../run';
import { validateSpecialistOutput, SpecialistValidationError } from '../validation';
import { AI_RISK_MANAGER_CONTRACT } from './contract';
import { buildAiRiskManagerRequest } from './prompt';
import { type AIRiskManagerAssessment, type AIRiskManagerModelOutput } from './schema';
import type { SpecialistRun } from '../execution';

function validateAiRiskManagerOutput(raw: unknown, packageValue: SpecialistEvidencePackage): AIRiskManagerModelOutput {
  const checked = validateSpecialistOutput(raw, AI_RISK_MANAGER_CONTRACT, packageValue);
  const value = checked.value;
  const findingIds = new Set<string>();
  for (const finding of value.findings) {
    if (findingIds.has(finding.finding_id)) throw new SpecialistValidationError(`duplicate finding id: ${finding.finding_id}`);
    findingIds.add(finding.finding_id);
  }
  if (value.assessment_status === 'ABSTAINED') {
    if (value.abstention.abstained !== true || value.abstention.reason === null) throw new SpecialistValidationError('abstention status must include an abstention reason');
    if (value.overall_risk !== 'UNDETERMINED') throw new SpecialistValidationError('abstention must use overall risk UNDETERMINED');
  } else if (value.abstention.abstained || value.abstention.reason !== null) {
    throw new SpecialistValidationError('assessed output cannot claim abstention');
  }
  if (packageValue.evidence.length === 0 && value.assessment_status === 'ASSESSED') {
    if (value.overall_risk !== 'UNDETERMINED' || value.findings.length > 0) throw new SpecialistValidationError('empty evidence cannot produce a risk finding');
  }
  if (!packageValue.provenance_summary.all_items_have_provenance && value.assessment_status === 'ASSESSED') {
    throw new SpecialistValidationError('missing provenance requires abstention');
  }
  return value;
}

export interface RunAiRiskManagerInput {
  readonly evidencePackage: SpecialistEvidencePackage;
  readonly reasoner?: Reasoner;
  readonly now?: () => string;
  readonly clock?: () => number;
}

/** One bounded model call over the immutable SWARM evidence projection. */
export async function runAiRiskManager(input: RunAiRiskManagerInput): Promise<SpecialistRun<AIRiskManagerAssessment>> {
  assertSpecialistContract(AI_RISK_MANAGER_CONTRACT);
  const result = await runSpecialist<AIRiskManagerModelOutput>({
    contract: AI_RISK_MANAGER_CONTRACT,
    evidencePackage: input.evidencePackage,
    reasoner: input.reasoner,
    now: input.now,
    clock: input.clock,
    validateOutput: (raw) => validateAiRiskManagerOutput(raw, input.evidencePackage),
    buildRequest: ({ contract, evidencePackage }) => buildAiRiskManagerRequest({ contract, evidencePackage, validate: (raw) => validateAiRiskManagerOutput(raw, evidencePackage) }),
  });
  if (result.assessment === null) return result as SpecialistRun<AIRiskManagerAssessment>;
  const assessment: AIRiskManagerAssessment = {
    ...result.assessment,
    specialist_id: 'ai-risk-manager',
    specialist_version: '1.0.0',
    execution: result.execution,
  };
  return { ...result, assessment };
}
