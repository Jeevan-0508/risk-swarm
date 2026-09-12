/**
 * RISK//OS adapter - the export sink.
 *
 * RISK//SWARM ends where RISK//OS begins. This adapter produces an import-shaped candidate risk from
 * a human-accepted decision. It deliberately does not write anywhere: pushing a risk into a live
 * register is a consequential action and belongs to the human.
 *
 * Fields that only the receiving programme can know (owner id, workstream) are emitted as null with
 * explicit instructions, rather than being invented to make the file look complete.
 */
import type { Decision, SeverityBand } from '../domain/model';

export type RiskOsCategory =
  | 'delivery' | 'technology' | 'vendor' | 'regulatory' | 'financial' | 'operational' | 'people' | 'security' | 'data' | 'reputational';
export type RiskOsStrategy = 'mitigate' | 'transfer' | 'avoid' | 'accept';
export type RiskOsStatus = 'open' | 'monitoring' | 'escalated' | 'closed' | 'accepted' | 'materialised';
export type RiskOsEvidenceConfidence = 'anecdotal' | 'indicative' | 'measured' | 'verified';
export type RiskOsLikert = 1 | 2 | 3 | 4 | 5;

export interface RiskOsRiskCandidate {
  schema: 'riskos.risk-candidate';
  schema_version: '1.0';
  exported_by: 'RISK//SWARM';
  exported_at: string;
  source_investigation: { run_id: string; decision_id: string; question: string };
  risk: {
    ref: string;
    title: string;
    description: string;
    category: RiskOsCategory;
    status: RiskOsStatus;
    strategy: RiskOsStrategy;
    dateIdentified: string;
    reviewDate: string;
    inherentImpact: RiskOsLikert;
    evidenceConfidence: RiskOsEvidenceConfidence;
    tags: string[];
    ownerId: null;
    workstreamId: null;
  };
  actions: Array<{ text: string; ownerRole: string; due: string; class: string }>;
  evidence_trail: Array<{ id: string; source: string; tier: number; url: string | null; claim: string }>;
  unresolved_objections: string[];
  import_instructions: string[];
}

const IMPACT_OF_BAND: Record<SeverityBand, RiskOsLikert> = { LOW: 2, MEDIUM: 3, HIGH: 4, CRITICAL: 5 };

const STATUS_OF_BAND: Record<Decision['action_band'], RiskOsStatus> = {
  NOTE: 'open',
  MONITOR: 'monitoring',
  TARGETED_INVESTIGATION: 'monitoring',
  ESCALATE: 'escalated',
};

const STRATEGY_OF_BAND: Record<Decision['action_band'], RiskOsStrategy> = {
  NOTE: 'accept',
  MONITOR: 'accept',
  TARGETED_INVESTIGATION: 'mitigate',
  ESCALATE: 'mitigate',
};

/**
 * Confidence maps to evidence confidence conservatively: this system observes external reporting, so
 * it can reach 'indicative' or 'measured' but never claims 'verified' about another organisation.
 */
export function evidenceConfidenceOf(confidence: number | null, independentSources: number): RiskOsEvidenceConfidence {
  if (confidence === null || independentSources < 2) return 'anecdotal';
  if (confidence >= 0.6 && independentSources >= 3) return 'measured';
  return 'indicative';
}

export interface ExportInput {
  decision: Decision;
  actions: Array<{ text: string; owner_role: string; due: string; class: string }>;
  evidence: Array<{ id: string; source: string; tier: number; url: string | null; claim: string }>;
  independent_sources: number;
  category?: RiskOsCategory;
  now?: string;
}

export interface RiskRegisterSink {
  exportRisk(input: ExportInput): RiskOsRiskCandidate;
}

export function createRiskOsSink(): RiskRegisterSink {
  return {
    exportRisk({ decision, actions, evidence, independent_sources, category = 'vendor', now }) {
      const exported_at = now ?? new Date().toISOString();
      return {
        schema: 'riskos.risk-candidate',
        schema_version: '1.0',
        exported_by: 'RISK//SWARM',
        exported_at,
        source_investigation: { run_id: decision.run_id, decision_id: decision.id, question: decision.question },
        risk: {
          ref: `SWARM-${decision.id}`,
          title: decision.headline_risk,
          description: decision.rationale.join(' '),
          category,
          status: STATUS_OF_BAND[decision.action_band],
          strategy: STRATEGY_OF_BAND[decision.action_band],
          dateIdentified: decision.created_at,
          reviewDate: decision.review_by,
          inherentImpact: IMPACT_OF_BAND[decision.severity_band],
          evidenceConfidence: evidenceConfidenceOf(decision.confidence, independent_sources),
          tags: ['risk-swarm', ...decision.hypothesis_ids],
          ownerId: null,
          workstreamId: null,
        },
        actions: actions.map((a) => ({ text: a.text, ownerRole: a.owner_role, due: a.due, class: a.class })),
        evidence_trail: evidence,
        unresolved_objections: decision.unresolved_objections,
        import_instructions: [
          'Map ownerId to a real RISK//OS owner and workstreamId to a real workstream before import.',
          'RISK//OS JSON import replaces a programme rather than merging, so add this risk through the register UI rather than importing this file wholesale.',
          'Probability is intentionally absent: this investigation measured evidence and coverage, not likelihood.',
        ],
      };
    },
  };
}
