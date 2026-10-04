import type { ReasonRequest } from '../../reasoner/types';
import type { SpecialistContract } from '../contract';
import type { SpecialistEvidencePackage } from '../evidence';
import type { AIRiskManagerModelOutput } from './schema';

const OUTPUT_SHAPE = `{
  assessment_status: "ASSESSED" | "ABSTAINED",
  executive_summary: string,
  findings: [{ finding_id, statement, risk_category, severity, evidence_ids, reasoning, assumptions, uncertainty, confidence, control_gap, recommended_actions }],
  overall_risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNDETERMINED",
  confidence: number between 0 and 1,
  uncertainty: { level: "LOW" | "MEDIUM" | "HIGH", reasons: string[] },
  evidence_gaps: [{ description, impact, requested_evidence }],
  conflicting_evidence: [{ evidence_ids: string[], description, impact }],
  control_recommendations: string[],
  monitoring_recommendations: string[],
  escalation: { recommended: boolean, reason: string | null },
  abstention: { abstained: boolean, reason: string | null, required_evidence: string[] }
}`;

function evidenceBlocks(packageValue: SpecialistEvidencePackage): string[] {
  const metadata = {
    investigation_id: packageValue.investigation_id,
    domain: packageValue.domain,
    scope: packageValue.scope,
    known_uncertainties: packageValue.known_uncertainties,
    known_conflicts: packageValue.known_conflicts,
    known_gaps: packageValue.known_gaps,
    provenance_summary: packageValue.provenance_summary,
  };
  return [
    `<<<SPECIALIST_EVIDENCE_PACKAGE_JSON>>>\n${JSON.stringify(metadata)}\n<<<END_SPECIALIST_EVIDENCE_PACKAGE_JSON>>>`,
    packageValue.evidence.length === 0
      ? '<<<EVIDENCE_DATA_JSON>>>\n[]\n<<<END_EVIDENCE_DATA_JSON>>>'
      : `<<<EVIDENCE_DATA_JSON>>>\n${JSON.stringify(packageValue.evidence)}\n<<<END_EVIDENCE_DATA_JSON>>>`,
  ];
}

export function buildAiRiskManagerRequest(input: {
  readonly contract: SpecialistContract<AIRiskManagerModelOutput>;
  readonly evidencePackage: SpecialistEvidencePackage;
  readonly validate: (raw: unknown) => AIRiskManagerModelOutput;
}): ReasonRequest<AIRiskManagerModelOutput> {
  const { contract, evidencePackage } = input;
  return {
    task: `${contract.id}.assessment`,
    instruction: [
      'ROLE: AI Risk Manager.',
      `SPECIALIST CONTRACT: ${contract.id} version ${contract.version}.`,
      `MANDATE: ${contract.mandate}`,
      'AUTHORITY: ADVISORY ONLY. You may assess risk, identify control gaps, request evidence, recommend controls/monitoring/escalation, challenge assumptions, or abstain.',
      'PROHIBITIONS: Do not create, modify, delete, or re-tier evidence. Do not claim unsupported facts. Do not declare legal compliance or regulatory certainty. Do not approve or reject deployment or a final decision. Do not override Red Team, Sentinel, or publication gates. Do not suppress disagreement or uncertainty. Do not invent citations.',
      `QUESTION: ${evidencePackage.question}`,
      'REASONING DISCIPLINE: distinguish observation, inference, assumption, and recommendation. Every factual claim about the investigated system must cite supplied evidence ids. Missing evidence is an evidence gap, not evidence of absence. Preserve contradictions explicitly. If the evidence is materially insufficient, irrelevant, missing critical provenance, irreconcilable, or outside mandate, abstain.',
      `OUTPUT CONTRACT: return one JSON object only, matching this shape exactly: ${OUTPUT_SHAPE}`,
    ].join('\n'),
    schema_hint: OUTPUT_SHAPE,
    allowed_evidence_ids: evidencePackage.evidence.map((item) => item.evidence_id),
    data_blocks: evidenceBlocks(evidencePackage),
    validate: input.validate,
    // This value is required by the shared Reasoner interface, but runSpecialist discards it whenever
    // execution is not an independent SUCCESS. It is never exposed as a fallback assessment.
    fallback: () => ({
      assessment_status: 'ABSTAINED',
      executive_summary: 'UNAVAILABLE',
      findings: [],
      overall_risk: 'UNDETERMINED',
      confidence: 0,
      uncertainty: { level: 'HIGH', reasons: ['model execution unavailable'] },
      evidence_gaps: [],
      conflicting_evidence: [],
      control_recommendations: [],
      monitoring_recommendations: [],
      escalation: { recommended: false, reason: null },
      abstention: { abstained: true, reason: 'model execution unavailable', required_evidence: [] },
    }),
  };
}
