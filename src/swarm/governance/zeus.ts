import {
  ZeusReadinessSchema,
  ZeusSynthesisBodySchema,
  ZeusSynthesisBriefSchema,
  ZeusSynthesisInputSchema,
  ZEUS_AUTHORITY_CONTRACT,
  ZEUS_SYNTHESIS_OUTPUT_LIMITS,
  ROUND1_SEAT_IDS,
  type ZeusDisagreementView,
  type ZeusMinorityPosition,
  type ZeusMinorityPositionReference,
  type ZeusReadiness,
  type ZeusExecutionMetadata,
  type ZeusSynthesisBody,
  type ZeusSynthesisBrief,
  type ZeusSynthesisInput,
  type SwarmBlackboard,
} from '../contracts';
import { currentPositions } from '../debate/disagreements';
import { deterministicPackageHash, stableStringify, verifyEvidencePackageHash } from '../evidence/package';
import { fail } from './verifier';

export const ZEUS_PROMPT_VERSION = 'ZEUS_PHASE6_SYNTHESIS_V2' as const;
export const ZEUS_SYNTHESIS_REQUEST_BUDGET = 1 as const;

const FORBIDDEN_AUTHORITY = /\b(?:approve|approves|approval|reject|rejects|rejection)\s+(?:of\s+)?(?:deployment|release|the\s+decision)\b|\b(?:deployment|release)\s+(?:approved|rejected)\b|\bclose\s+the\s+case|\blegal(?:ly)?\s+compliant\b|\b(?:fully\s+)?compliant\b|\bcompliance\s+(?:is\s+)?(?:confirmed|declared|certified)\b|\bregulatory\s+cert(?:if|ainty)|claim\s+regulator\s+approval|final\s+decision/i;
const FALSE_CONSENSUS = /\b(?:unanimous|full|complete)\s+consensus\b|\ball\s+(?:seats|agents)\s+agree|no\s+(?:material\s+)?disagreement/i;

export interface ZeusReadinessReport extends ZeusReadiness {
  readonly reason: string;
}

export const ZEUS_REFERENCE_CLASSES = ['POSITION', 'DISAGREEMENT', 'EVIDENCE', 'AUDIT_FINDING'] as const;
export type ZeusReferenceClass = (typeof ZEUS_REFERENCE_CLASSES)[number];

export interface ZeusReferenceNormalization {
  readonly path: string;
  readonly reference_class: ZeusReferenceClass;
  readonly emitted_value: string;
  readonly canonical_value: string;
}

export interface ZeusAllowedReferenceSets {
  readonly position_ids: ReadonlySet<string>;
  readonly disagreement_ids: ReadonlySet<string>;
  readonly evidence_ids: ReadonlySet<string>;
  readonly audit_finding_ids: ReadonlySet<string>;
  readonly counts: Readonly<Record<ZeusReferenceClass, number>>;
}

function immutableSet(values: readonly string[]): ReadonlySet<string> {
  const set = new Set(values);
  return Object.freeze({
    get size() { return set.size; },
    has(value: string) { return set.has(value); },
    entries() { return set.entries(); },
    keys() { return set.keys(); },
    values() { return set.values(); },
    forEach(callback: (value: string, value2: string, set: ReadonlySet<string>) => void) { set.forEach((value) => callback(value, value, this)); },
    [Symbol.iterator]() { return set[Symbol.iterator](); },
  }) as ReadonlySet<string>;
}

function uniqueCanonical(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** The only source-identity catalog Zeus is allowed to reference. It is built
 * from the exact canonical input and exposes no mutating Set operations. */
export function buildZeusAllowedReferenceSets(input: ZeusSynthesisInput): ZeusAllowedReferenceSets {
  const positions = uniqueCanonical(input.final_positions.map((position) => position.position_id));
  const disagreements = uniqueCanonical(input.post_challenge_disagreements.map((item) => item.disagreement_id));
  const evidence = uniqueCanonical(input.evidence_metadata.map((item) => item.evidence_id));
  const findings = uniqueCanonical(input.audit_findings.map((finding) => finding.finding_id));
  return Object.freeze({
    position_ids: immutableSet(positions),
    disagreement_ids: immutableSet(disagreements),
    evidence_ids: immutableSet(evidence),
    audit_finding_ids: immutableSet(findings),
    counts: Object.freeze({ POSITION: positions.length, DISAGREEMENT: disagreements.length, EVIDENCE: evidence.length, AUDIT_FINDING: findings.length }),
  });
}

export interface ZeusReferenceResolution {
  readonly value: unknown;
  readonly normalizations: readonly ZeusReferenceNormalization[];
}

function safeReferenceValue(value: string): string {
  return value.length <= 160 && /^[A-Za-z0-9._:-]+$/.test(value) ? value : 'REDACTED';
}

function classSet(catalog: ZeusAllowedReferenceSets, referenceClass: ZeusReferenceClass): ReadonlySet<string> {
  if (referenceClass === 'POSITION') return catalog.position_ids;
  if (referenceClass === 'DISAGREEMENT') return catalog.disagreement_ids;
  if (referenceClass === 'EVIDENCE') return catalog.evidence_ids;
  return catalog.audit_finding_ids;
}

function referenceFailure(path: string, value: unknown, referenceClass: ZeusReferenceClass, catalog: ZeusAllowedReferenceSets): never {
  const safe = typeof value === 'string' ? safeReferenceValue(value) : 'REDACTED';
  fail(referenceClass === 'EVIDENCE' ? 'UNKNOWN_EVIDENCE' : 'UNKNOWN_REFERENCE', `Unknown ${referenceClass.toLowerCase()} reference at ${path}`, {
    UNKNOWN_REFERENCE_PATH: path,
    UNKNOWN_REFERENCE_VALUE: safe,
    REFERENCE_CLASS: referenceClass,
    ALLOWED_REFERENCE_COUNT: catalog.counts[referenceClass],
  });
}

function resolveReference(value: unknown, path: string, referenceClass: ZeusReferenceClass, catalog: ZeusAllowedReferenceSets, normalizations: ZeusReferenceNormalization[]): string {
  if (typeof value !== 'string') return value as string;
  const allowed = classSet(catalog, referenceClass);
  if (allowed.has(value)) return value;
  const trimmed = value.trim();
  const candidates = [...allowed].filter((candidate) => candidate.toLowerCase() === trimmed.toLowerCase());
  if (candidates.length === 1) {
    const canonical = candidates[0]!;
    normalizations.push({ path, reference_class: referenceClass, emitted_value: value, canonical_value: canonical });
    return canonical;
  }
  referenceFailure(path, value, referenceClass, catalog);
}

function resolveList(parent: Record<string, unknown>, key: string, path: string, referenceClass: ZeusReferenceClass, catalog: ZeusAllowedReferenceSets, normalizations: ZeusReferenceNormalization[]): void {
  const values = parent[key];
  if (!Array.isArray(values)) return;
  const resolved = values.map((value, index) => resolveReference(value, `${path}[${index}]`, referenceClass, catalog, normalizations));
  const seen = new Set<string>();
  for (const [index, value] of resolved.entries()) {
    if (typeof value === 'string' && seen.has(value)) fail('DUPLICATE_REFERENCE', `Duplicate ${referenceClass.toLowerCase()} reference at ${path}[${index}]`, { UNKNOWN_REFERENCE_PATH: path, REFERENCE_CLASS: referenceClass, ALLOWED_REFERENCE_COUNT: catalog.counts[referenceClass] });
    if (typeof value === 'string') seen.add(value);
  }
  parent[key] = resolved;
}

/** Resolves all Zeus-generated source references against one immutable catalog.
 * Formatting-only case/whitespace changes are recorded; all other unknowns
 * fail closed and never become a SynthesisBrief. */
export function resolveZeusReferences(output: unknown, input: ZeusSynthesisInput): ZeusReferenceResolution {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return { value: output, normalizations: [] };
  const value = JSON.parse(JSON.stringify(output)) as Record<string, unknown>;
  const catalog = buildZeusAllowedReferenceSets(input);
  const normalizations: ZeusReferenceNormalization[] = [];
  resolveList(value, 'source_position_ids', '$.source_position_ids', 'POSITION', catalog, normalizations);
  resolveList(value, 'source_disagreement_ids', '$.source_disagreement_ids', 'DISAGREEMENT', catalog, normalizations);
  resolveList(value, 'source_evidence_ids', '$.source_evidence_ids', 'EVIDENCE', catalog, normalizations);
  resolveList(value, 'source_audit_finding_ids', '$.source_audit_finding_ids', 'AUDIT_FINDING', catalog, normalizations);
  const risks = value.material_risks;
  if (Array.isArray(risks)) risks.forEach((risk, index) => { if (risk && typeof risk === 'object' && !Array.isArray(risk)) { const item = risk as Record<string, unknown>; resolveList(item, 'source_position_ids', `$.material_risks[${index}].source_position_ids`, 'POSITION', catalog, normalizations); resolveList(item, 'source_evidence_ids', `$.material_risks[${index}].source_evidence_ids`, 'EVIDENCE', catalog, normalizations); } });
  const controls = value.control_assessment;
  if (Array.isArray(controls)) controls.forEach((control, index) => { if (control && typeof control === 'object' && !Array.isArray(control)) { const item = control as Record<string, unknown>; resolveList(item, 'source_position_ids', `$.control_assessment[${index}].source_position_ids`, 'POSITION', catalog, normalizations); resolveList(item, 'source_evidence_ids', `$.control_assessment[${index}].source_evidence_ids`, 'EVIDENCE', catalog, normalizations); } });
  const evidenceAssessment = value.evidence_assessment;
  if (evidenceAssessment && typeof evidenceAssessment === 'object' && !Array.isArray(evidenceAssessment)) resolveList(evidenceAssessment as Record<string, unknown>, 'evidence_ids', '$.evidence_assessment.evidence_ids', 'EVIDENCE', catalog, normalizations);
  const disagreements = value.material_disagreements;
  if (Array.isArray(disagreements)) {
    const seen = new Set<string>();
    disagreements.forEach((item, index) => { if (item && typeof item === 'object' && !Array.isArray(item)) { const record = item as Record<string, unknown>; record.disagreement_id = resolveReference(record.disagreement_id, `$.material_disagreements[${index}].disagreement_id`, 'DISAGREEMENT', catalog, normalizations); if (typeof record.disagreement_id === 'string' && seen.has(record.disagreement_id)) fail('DUPLICATE_REFERENCE', `Duplicate disagreement reference at $.material_disagreements[${index}].disagreement_id`, { UNKNOWN_REFERENCE_PATH: '$.material_disagreements', REFERENCE_CLASS: 'DISAGREEMENT', ALLOWED_REFERENCE_COUNT: catalog.counts.DISAGREEMENT }); if (typeof record.disagreement_id === 'string') seen.add(record.disagreement_id); } });
  }
  const minorities = value.minority_positions;
  if (Array.isArray(minorities)) {
    const seen = new Set<string>();
    minorities.forEach((item, index) => { if (item && typeof item === 'object' && !Array.isArray(item)) { const record = item as Record<string, unknown>; record.position_id = resolveReference(record.position_id, `$.minority_positions[${index}].position_id`, 'POSITION', catalog, normalizations); if (typeof record.position_id === 'string' && seen.has(record.position_id)) fail('DUPLICATE_REFERENCE', `Duplicate position reference at $.minority_positions[${index}].position_id`, { UNKNOWN_REFERENCE_PATH: '$.minority_positions', REFERENCE_CLASS: 'POSITION', ALLOWED_REFERENCE_COUNT: catalog.counts.POSITION }); if (typeof record.position_id === 'string') seen.add(record.position_id); } });
  }
  const audit = value.audit_summary;
  if (audit && typeof audit === 'object' && !Array.isArray(audit)) {
    const record = audit as Record<string, unknown>;
    resolveList(record, 'finding_ids', '$.audit_summary.finding_ids', 'AUDIT_FINDING', catalog, normalizations);
    resolveList(record, 'citation_failures', '$.audit_summary.citation_failures', 'AUDIT_FINDING', catalog, normalizations);
    resolveList(record, 'evidence_integrity_findings', '$.audit_summary.evidence_integrity_findings', 'AUDIT_FINDING', catalog, normalizations);
    resolveList(record, 'authority_findings', '$.audit_summary.authority_findings', 'AUDIT_FINDING', catalog, normalizations);
  }
  const execution = value.execution;
  if (execution && typeof execution === 'object' && !Array.isArray(execution)) (execution as Record<string, unknown>).reference_normalizations = normalizations;
  return { value, normalizations };
}

function eventHas(state: SwarmBlackboard, type: string): boolean {
  return state.execution_events.some((event) => event.type === type);
}

/** One deterministic readiness gate for the future live Zeus request. */
export function assessZeusReadiness(state: SwarmBlackboard): ZeusReadinessReport {
  const required_inputs_present: Record<string, boolean> = {
    case: Boolean(state.case),
    sealed_evidence: Boolean(state.evidence_package && verifyEvidencePackageHash(state.evidence_package)),
    positions_locked: eventHas(state, 'POSITIONS_LOCKED'),
    required_seats_accounted: ROUND1_SEAT_IDS.every((seat) => state.seat_execution_state[seat].status === 'SUCCESS'),
    round1_blindness: state.positions.filter((position) => position.round === 1).every((position) => position.position_references.length === 0),
    challenge_lifecycle_complete: eventHas(state, 'REVISIONS_LOCKED') && eventHas(state, 'DISAGREEMENTS_REEVALUATED'),
    revisions_locked: eventHas(state, 'REVISIONS_LOCKED'),
    disagreements_reevaluated: eventHas(state, 'DISAGREEMENTS_REEVALUATED'),
    apollo_audit_complete: state.audit_completed && eventHas(state, 'POST_CHALLENGE_AUDIT_COMPLETED'),
    human_authority_intact: state.human_decision === null && Boolean(state.case?.policy.require_human_review),
    no_blocking_audit_finding: state.audit_findings.every((finding) => finding.status !== 'BLOCKED'),
    correct_protocol_state: state.state === 'AUDIT',
  };
  const blockers = Object.entries(required_inputs_present).filter(([, present]) => !present).map(([name]) => `required input missing: ${name}`);
  const warnings = state.audit_findings.filter((finding) => finding.status === 'WARNING').map((finding) => finding.detail);
  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    required_inputs_present,
    human_authority_intact: true,
    reason: blockers.length === 0 ? 'Zeus synthesis inputs are complete; final human authority remains pending.' : blockers.join('; '),
  };
}

function disagreementView(state: SwarmBlackboard, disagreement: SwarmBlackboard['disagreements'][number]): ZeusDisagreementView {
  const challenges = state.challenges.filter((challenge) => challenge.disagreement_id === disagreement.disagreement_id);
  const challengeIds = new Set(challenges.map((challenge) => challenge.challenge_id));
  const responses = state.challenge_responses.filter((response) => challengeIds.has(response.challenge_id));
  const responseIds = new Set(responses.map((response) => response.response_id));
  const revisions = state.revisions.filter((revision) => responseIds.has(revision.triggering_response_id));
  return {
    disagreement_id: disagreement.disagreement_id,
    type: disagreement.type,
    status: disagreement.status,
    participating_seats: Object.keys(disagreement.positions_by_seat) as ZeusDisagreementView['participating_seats'],
    position_ids: [...disagreement.subject_ids].filter((id) => id.startsWith('position-')) as ZeusDisagreementView['position_ids'],
    evidence_ids: [...disagreement.evidence_ids],
    materiality: disagreement.materiality,
    basis: disagreement.basis,
    challenge_ids: challenges.map((challenge) => challenge.challenge_id),
    response_ids: responses.map((response) => response.response_id),
    revision_ids: revisions.map((revision) => revision.revision_id),
    remaining_uncertainty: disagreement.unresolved ? 'The disagreement remains open after the bounded challenge round.' : 'No remaining uncertainty was recorded for this disagreement.',
  };
}

function preChallengeDisagreements(state: SwarmBlackboard): SwarmBlackboard['disagreements'] {
  return state.execution_events
    .filter((event): event is Extract<typeof event, { type: 'DISAGREEMENT_IDENTIFIED' }> => event.type === 'DISAGREEMENT_IDENTIFIED')
    .map((event) => event.disagreement);
}

function minorityPositions(state: SwarmBlackboard, disagreements: readonly ZeusDisagreementView[]): ZeusMinorityPosition[] {
  const open = disagreements.filter((item) => item.status === 'OPEN' || item.status === 'NARROWED');
  const positions = currentPositions(state);
  return positions.map((position) => {
    const related = open.filter((item) => item.position_ids.includes(position.position_id));
    return {
      seat_ids: [position.seat_id],
      position_summary: position.conclusion,
      evidence_ids: [...position.evidence_ids],
      disagreement_ids: related.map((item) => item.disagreement_id),
      why_it_matters: related.length > 0 ? `The ${position.seat_id} position remains part of an open material disagreement and must stay visible to the human reviewer.` : `The ${position.seat_id} position is retained as a source position rather than being reduced to a vote.`,
    };
  });
}

function compactText(value: string, maximum: number = ZEUS_SYNTHESIS_OUTPUT_LIMITS.concise_text): string {
  const normalized = value.trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1).trimEnd()}…`;
}

function uniqueLimited<T>(values: readonly T[], maximum: number, key: (value: T) => string = (value) => String(value)): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const identity = key(value);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(value);
    if (result.length === maximum) break;
  }
  return result;
}

function minorityReference(input: ZeusSynthesisInput, minority: ZeusMinorityPosition): ZeusMinorityPositionReference {
  const seatId = minority.seat_ids[0]!;
  const matching = input.final_positions.find((position) => position.seat_id === seatId && position.conclusion === minority.position_summary)
    ?? input.final_positions.find((position) => position.seat_id === seatId);
  if (!matching) throw new Error('ZEUS_MINORITY_POSITION_REFERENCE_UNAVAILABLE');
  return { position_id: matching.position_id, seat_id: matching.seat_id };
}

function inputWithoutFingerprint(state: SwarmBlackboard, readiness: ZeusReadiness): Omit<ZeusSynthesisInput, 'input_fingerprint'> {
  if (!state.case || !state.evidence_package) throw new Error('ZEUS_INPUT_REQUIRES_SEALED_CASE');
  const final = currentPositions(state);
  const pre = preChallengeDisagreements(state).map((item) => disagreementView(state, item));
  const post = state.disagreements.map((item) => disagreementView(state, item));
  return {
    input_version: 'ZEUS_INPUT_V1',
    case: state.case,
    evidence_metadata: state.evidence_package.items.map(({ evidence_id, source_type, source_identity, title, tier, relevance, reliability, integrity_hash }) => ({ evidence_id, source_type, source_identity, title, tier, relevance, reliability, integrity_hash })),
    final_positions: final,
    revisions: [...state.revisions],
    pre_challenge_disagreements: pre,
    post_challenge_disagreements: post,
    challenges: [...state.challenges],
    challenge_responses: [...state.challenge_responses],
    minority_positions: minorityPositions(state, post),
    audit_findings: [...state.audit_findings],
    evidence_requests: [...state.evidence_requests],
    abstentions: [],
    readiness,
    human_decision: null,
  };
}

export function buildZeusInput(state: SwarmBlackboard, readiness = assessZeusReadiness(state)): ZeusSynthesisInput {
  if (!readiness.ready) fail('INVALID_TRANSITION');
  const base = inputWithoutFingerprint(state, readiness);
  return ZeusSynthesisInputSchema.parse({ ...base, input_fingerprint: deterministicPackageHash(base) });
}

export interface ZeusSynthesisExecutor {
  synthesize(input: ZeusSynthesisInput): Promise<unknown>;
}

export class FixtureZeusSynthesisExecutor implements ZeusSynthesisExecutor {
  constructor(private readonly build: (input: ZeusSynthesisInput) => unknown = defaultZeusSynthesis) {}
  async synthesize(input: ZeusSynthesisInput): Promise<unknown> { return this.build(input); }
}

function auditSummary(input: ZeusSynthesisInput) {
  const findingIds = input.audit_findings.map((finding) => finding.finding_id);
  const warnings = input.audit_findings.filter((finding) => finding.status === 'WARNING');
  const blockers = input.audit_findings.filter((finding) => finding.status === 'BLOCKED');
  return {
    finding_ids: findingIds,
    blocker_count: blockers.length,
    warning_count: warnings.length,
    citation_failures: input.audit_findings.filter((finding) => /citation/i.test(finding.check_id)).map((finding) => finding.finding_id),
    evidence_integrity_findings: input.audit_findings.filter((finding) => /evidence|integrity/i.test(finding.check_id)).map((finding) => finding.finding_id),
    authority_findings: input.audit_findings.filter((finding) => /authority/i.test(finding.check_id)).map((finding) => finding.finding_id),
    summary: compactText(warnings.length > 0 ? `${warnings.length} Apollo warning(s) remain visible; no warning is treated as proof of safety.` : 'Apollo found no warnings in the certified input.', ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text),
  };
}

export interface ZeusExecutionOverrides {
  readonly provider_requested?: string | null;
  readonly model_requested?: string | null;
  readonly provider_executed?: string | null;
  readonly model_executed?: string | null;
  readonly request_id?: string | null;
  readonly finish_reason?: string | null;
  readonly output_tokens?: number | null;
}

export function systemZeusExecution(input: ZeusSynthesisInput, overrides: ZeusExecutionOverrides = {}, reference_normalizations: ReadonlyArray<ZeusExecutionMetadata['reference_normalizations'][number]> = []): ZeusExecutionMetadata {
  return {
    seat_id: 'ZEUS',
    provider_requested: overrides.provider_requested ?? null,
    model_requested: overrides.model_requested ?? null,
    provider_executed: overrides.provider_executed ?? null,
    model_executed: overrides.model_executed ?? null,
    request_id: overrides.request_id ?? null,
    prompt_version: ZEUS_PROMPT_VERSION,
    prompt_fingerprint: deterministicPackageHash(ZEUS_PROMPT_VERSION),
    input_fingerprint: input.input_fingerprint,
    output_validation: 'PASS',
    finish_reason: overrides.finish_reason ?? null,
    output_tokens: overrides.output_tokens ?? null,
    fallback_used: false,
    retry_index: 0,
    reference_normalizations: [...reference_normalizations],
  };
}

function synthesisBody(value: ZeusSynthesisBrief | ZeusSynthesisBody): ZeusSynthesisBody {
  if ('synthesis_id' in value) {
    const { synthesis_id: _synthesisId, case_id: _caseId, seat_id: _seatId, human_decision_required: _humanDecisionRequired, authority_statement: _authorityStatement, execution: _execution, synthesis_fingerprint: _fingerprint, human_decision_status: _humanDecisionStatus, ...body } = value;
    return body;
  }
  return value;
}

/** Integrity is over the canonical semantic body only. Runtime provenance is
 * verified separately and cannot change the synthesis identity. */
export function zeusSynthesisFingerprint(value: ZeusSynthesisBrief | ZeusSynthesisBody): string {
  return deterministicPackageHash(synthesisBody(value));
}

/** Sanitized offline golden synthesis. It is a fixture adapter, never a model fallback. */
export function defaultZeusSynthesis(input: ZeusSynthesisInput): ZeusSynthesisBrief {
  const open = input.post_challenge_disagreements.filter((item) => (item.status === 'OPEN' || item.status === 'NARROWED') && item.materiality !== 'MINOR');
  const evidenceIds = uniqueLimited(input.evidence_metadata.map((item) => item.evidence_id), ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_evidence_items);
  const positions = input.final_positions;
  const risks = positions.flatMap((position) => position.risk_findings.map((finding) => ({ statement: compactText(finding.statement), risk_level: finding.risk_level, uncertainty: compactText(finding.uncertainty), source_position_ids: [position.position_id], source_evidence_ids: uniqueLimited(finding.evidence_ids, ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item) })));
  const fallbackRisks = positions.map((position) => ({ statement: compactText(position.conclusion), risk_level: position.risk_level, uncertainty: compactText(position.uncertainties[0] ?? 'Uncertainty was not supplied.'), source_position_ids: [position.position_id], source_evidence_ids: uniqueLimited(position.evidence_ids, ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item) }));
  const materialRisks = uniqueLimited(risks.length > 0 ? risks : fallbackRisks, ZEUS_SYNTHESIS_OUTPUT_LIMITS.risk_items, (risk) => `${risk.statement}:${risk.source_position_ids[0]}`);
  const controls = uniqueLimited(positions.flatMap((position) => position.control_gaps.map((gap) => ({ statement: compactText(gap.statement), effectiveness: 'UNVERIFIED' as const, gaps: [compactText(gap.uncertainty)], source_position_ids: [position.position_id], source_evidence_ids: uniqueLimited(gap.evidence_ids, ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_ids_per_item) }))), ZEUS_SYNTHESIS_OUTPUT_LIMITS.control_items, (control) => `${control.statement}:${control.source_position_ids[0]}`);
  const evidenceQuality = input.evidence_metadata.length === 0 ? 'INSUFFICIENT' as const : input.evidence_metadata.every((item) => item.reliability >= 0.8) ? 'MIXED' as const : 'WEAK' as const;
  const uncertainties = uniqueLimited(positions.flatMap((position) => position.uncertainties.map((item) => compactText(item))), ZEUS_SYNTHESIS_OUTPUT_LIMITS.uncertainty_items);
  const assumptions = uniqueLimited(positions.flatMap((position) => position.assumptions.map((item) => compactText(item))), ZEUS_SYNTHESIS_OUTPUT_LIMITS.assumption_items);
  const evidenceGaps = uniqueLimited(input.evidence_requests.map((request) => compactText(request.request)), ZEUS_SYNTHESIS_OUTPUT_LIMITS.evidence_gap_items);
  const body: ZeusSynthesisBody = {
    executive_summary: compactText(`The certified deliberation contains ${positions.length} final seat positions and ${open.length} unresolved material disagreement(s). This is bounded decision support for a human reviewer, not a consensus vote.`, ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text),
    decision_context: compactText(input.case.question, ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text),
    material_risks: materialRisks,
    control_assessment: controls,
    evidence_assessment: {
      summary: compactText(`The synthesis references ${input.evidence_metadata.length} sealed evidence item(s); quality metadata is preserved without fabricating certainty.`, ZEUS_SYNTHESIS_OUTPUT_LIMITS.executive_text),
      quality: evidenceQuality,
      evidence_ids: evidenceIds,
      gaps: evidenceGaps,
    },
    areas_of_agreement: ['Accepted seats supplied structured, independent positions; this procedural agreement does not erase substantive disagreement.'],
    material_disagreements: open.map((item) => ({ disagreement_id: item.disagreement_id, status: item.status as 'OPEN' | 'NARROWED', materiality: item.materiality as 'MATERIAL' | 'BLOCKING' })),
    minority_positions: uniqueLimited(input.minority_positions.map((minority) => minorityReference(input, minority)), ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_position_items, (item) => item.position_id),
    uncertainties,
    assumptions,
    evidence_gaps: evidenceGaps,
    decision_options: ['Collect identified evidence gaps before relying on disputed claims.', 'Review named control gaps and Apollo warnings before deciding.', 'Escalate unresolved material disagreements to the designated human reviewer.'],
    recommended_next_actions: ['Review each disagreement by canonical ID and source position.', 'Verify Apollo warnings and control evidence.', 'Record the human decision separately from this advisory synthesis.'],
    escalations: open.length > 0 ? ['Human review is required because material disagreements remain open.'] : [],
    audit_summary: auditSummary(input),
    confidence: open.length > 0 || input.evidence_requests.length > 0 ? 0.65 : 0.8,
    source_position_ids: uniqueLimited(positions.map((position) => position.position_id), ZEUS_SYNTHESIS_OUTPUT_LIMITS.source_position_items),
    source_disagreement_ids: open.map((item) => item.disagreement_id),
    source_evidence_ids: evidenceIds,
    source_audit_finding_ids: input.audit_findings.map((finding) => finding.finding_id),
  };
  return canonicalizeZeusSynthesis(body, input, {
    provider_requested: 'offline-fixture',
    model_requested: 'fixture-zeus',
    provider_executed: 'offline-fixture',
    model_executed: 'fixture-zeus',
    request_id: 'offline-zeus-synthesis-1',
    finish_reason: 'fixture',
  });
}

function validateZeusSemanticBody(value: ZeusSynthesisBody, input: ZeusSynthesisInput): void {
  for (const disagreement of value.material_disagreements) {
    const source = input.post_challenge_disagreements.find((item) => item.disagreement_id === disagreement.disagreement_id);
    if (!source || source.status !== disagreement.status || source.materiality !== disagreement.materiality) fail('UNKNOWN_REFERENCE');
  }
  for (const minority of value.minority_positions) {
    const source = input.final_positions.find((item) => item.position_id === minority.position_id);
    if (!source || source.seat_id !== minority.seat_id) fail('UNKNOWN_REFERENCE');
  }
  const open = input.post_challenge_disagreements.filter((item) => (item.status === 'OPEN' || item.status === 'NARROWED') && item.materiality !== 'MINOR');
  const outputOpen = new Set(value.material_disagreements.map((item) => item.disagreement_id));
  if (open.some((item) => !outputOpen.has(item.disagreement_id))) fail('AUTHORITY_VIOLATION');
  if (open.length > 0 && FALSE_CONSENSUS.test(JSON.stringify({ executive_summary: value.executive_summary, decision_context: value.decision_context, areas_of_agreement: value.areas_of_agreement, material_disagreements: value.material_disagreements, minority_positions: value.minority_positions }))) fail('AUTHORITY_VIOLATION');
  if (input.minority_positions.some((expected) => {
    const reference = minorityReference(input, expected);
    return !value.minority_positions.some((actual) => stableStringify(actual) === stableStringify(reference));
  })) fail('AUTHORITY_VIOLATION');
  const warnings = input.audit_findings.filter((finding) => finding.status === 'WARNING');
  if (warnings.some((finding) => !value.audit_summary.finding_ids.includes(finding.finding_id)) || value.audit_summary.warning_count !== warnings.length) fail('AUTHORITY_VIOLATION');
  if (value.audit_summary.blocker_count !== input.audit_findings.filter((finding) => finding.status === 'BLOCKED').length) fail('AUTHORITY_VIOLATION');
  if (FORBIDDEN_AUTHORITY.test(JSON.stringify(value))) fail('AUTHORITY_VIOLATION');
}

export function validateZeusSynthesis(output: unknown, input: ZeusSynthesisInput): ZeusSynthesisBrief {
  const initial = ZeusSynthesisBriefSchema.safeParse(output);
  if (!initial.success) fail('SCHEMA_ERROR');
  const resolved = resolveZeusReferences(initial.data, input);
  const parsed = ZeusSynthesisBriefSchema.safeParse(resolved.value);
  if (!parsed.success) fail('SCHEMA_ERROR');
  const value = parsed.data;
  if (value.case_id !== input.case.case_id) fail('UNKNOWN_REFERENCE', 'Zeus case identity does not match canonical input', { UNKNOWN_REFERENCE_PATH: '$.case_id', UNKNOWN_REFERENCE_VALUE: safeReferenceValue(value.case_id), REFERENCE_CLASS: 'CASE', ALLOWED_REFERENCE_COUNT: 1 });
  if (value.execution.input_fingerprint !== input.input_fingerprint) fail('UNKNOWN_REFERENCE', 'Zeus input fingerprint does not match canonical input', { UNKNOWN_REFERENCE_PATH: '$.execution.input_fingerprint', UNKNOWN_REFERENCE_VALUE: safeReferenceValue(value.execution.input_fingerprint), REFERENCE_CLASS: 'INPUT_FINGERPRINT', ALLOWED_REFERENCE_COUNT: 1 });
  const expectedSynthesisId = `zeus-synthesis-${input.case.case_id}`;
  if (value.synthesis_id !== expectedSynthesisId) fail('UNKNOWN_REFERENCE', 'Zeus synthesis identity is not deterministic', { UNKNOWN_REFERENCE_PATH: '$.synthesis_id', UNKNOWN_REFERENCE_VALUE: safeReferenceValue(value.synthesis_id), REFERENCE_CLASS: 'SYNTHESIS_ID', ALLOWED_REFERENCE_COUNT: 1 });
  validateZeusSemanticBody(synthesisBody(value), input);
  if (!value.human_decision_required || value.human_decision_status !== 'PENDING' || JSON.stringify(value.authority_statement) !== JSON.stringify(ZEUS_AUTHORITY_CONTRACT)) fail('AUTHORITY_VIOLATION');
  if (value.synthesis_fingerprint !== zeusSynthesisFingerprint(value)) fail('ZEUS_SYNTHESIS_FINGERPRINT_MISMATCH', 'Zeus synthesis fingerprint does not match the canonical synthesis body');
  return value;
}

/** Converts an untrusted provider body into the canonical SWARM-owned
 * synthesis envelope. Provider metadata is rejected/ignored before this seam;
 * all identity, authority, provenance, and integrity fields are injected here. */
export function canonicalizeZeusSynthesis(output: unknown, input: ZeusSynthesisInput, executionOverrides: ZeusExecutionOverrides = {}): ZeusSynthesisBrief {
  const initial = ZeusSynthesisBodySchema.safeParse(output);
  if (!initial.success) fail('SCHEMA_ERROR');
  const resolved = resolveZeusReferences(initial.data, input);
  const parsed = ZeusSynthesisBodySchema.safeParse(resolved.value);
  if (!parsed.success) fail('SCHEMA_ERROR');
  validateZeusSemanticBody(parsed.data, input);
  const execution = systemZeusExecution(input, executionOverrides, resolved.normalizations);
  const canonicalWithoutFingerprint = {
    synthesis_id: `zeus-synthesis-${input.case.case_id}` as ZeusSynthesisBrief['synthesis_id'],
    case_id: input.case.case_id,
    seat_id: 'ZEUS' as const,
    ...parsed.data,
    human_decision_required: true as const,
    authority_statement: { ...ZEUS_AUTHORITY_CONTRACT },
    execution,
    human_decision_status: 'PENDING' as const,
  };
  const canonical = { ...canonicalWithoutFingerprint, synthesis_fingerprint: zeusSynthesisFingerprint(parsed.data) };
  const checked = ZeusSynthesisBriefSchema.safeParse(canonical);
  if (!checked.success) fail('SCHEMA_ERROR');
  return checked.data;
}

/** Explicit conversion seam for a future provider adapter. It is intentionally
 * validation-backed: untrusted provider-shaped data cannot become a domain
 * synthesis by conversion alone. */
export function convertZeusSynthesis(output: unknown, input: ZeusSynthesisInput): ZeusSynthesisBrief {
  const isCanonical = output && typeof output === 'object' && !Array.isArray(output) && 'synthesis_fingerprint' in output;
  return isCanonical ? validateZeusSynthesis(output, input) : canonicalizeZeusSynthesis(output, input);
}

export function zeusPrompt(): string {
  return `${ZEUS_PROMPT_VERSION}: Produce only the bounded Zeus synthesis body. Synthesize; do not restate agent reports. Source identity belongs to deterministic SWARM state: never create, infer, rename, or fabricate source IDs. Use canonical source IDs: positions, disagreements, evidence, and Apollo findings. Preserve every material unresolved disagreement and minority position; do not duplicate rationale. Stay within strict schema limits. Include no chain-of-thought, invented citations, compliance declaration, deployment approval/rejection, or final authority. Do not emit synthesis_id, case_id, execution metadata, timestamps, request IDs, provider/model identity, input or synthesis fingerprints, or protocol/event identity; SWARM injects them after validation. Human authority and human_decision_required=true are enforced by SWARM. Return only the structured body.`;
}

export function verifyZeusInput(input: unknown): ZeusSynthesisInput {
  return ZeusSynthesisInputSchema.parse(input);
}

export function verifyZeusReadiness(readiness: unknown): ZeusReadiness {
  return ZeusReadinessSchema.parse(readiness);
}

export function sourceIdsFromZeusInput(input: ZeusSynthesisInput): { positions: string[]; disagreements: string[]; evidence: string[]; audit: string[] } {
  const allowed = buildZeusAllowedReferenceSets(input);
  return {
    positions: [...allowed.position_ids],
    disagreements: [...allowed.disagreement_ids],
    evidence: [...allowed.evidence_ids],
    audit: [...allowed.audit_finding_ids],
  };
}

export function zeusInputFingerprint(input: Omit<ZeusSynthesisInput, 'input_fingerprint'>): string {
  return deterministicPackageHash(input);
}
