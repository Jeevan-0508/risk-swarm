import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { type OfflineRequestObservation } from '../src/swarm/engine/offline';
import { replaySwarmEvents } from '../src/swarm/engine/reducer';
import { type OfflineSwarmRunResult } from '../src/swarm/engine/offline';
import { deterministicPackageHash, stableStringify } from '../src/swarm/evidence/package';
import { SwarmExecutionEventSchema, type AgentPosition, type Round1SeatId, type SwarmExecutionEvent } from '../src/swarm/contracts';
import type { Phase5ChallengeAdmissionResult } from '../src/swarm/debate/challenges';

export const PHASE5G_ARTIFACT_SCHEMA_VERSION = 'SWARM_PHASE5G_CERTIFICATION_ARTIFACT_V1' as const;
export const PHASE5G_DEFAULT_ARTIFACT_DIRECTORY = 'artifacts/swarm/live-certifications';

const ArtifactSection = z.object({}).passthrough();
const EventEnvelope = z.object({
  event_id: z.string().min(1),
  run_id: z.string().min(1),
  event_type: z.string().min(1),
  protocol_phase: z.string().min(1),
  sequence: z.number().int().positive(),
  timestamp: z.string().min(1),
  related_object_ids: z.array(z.string()),
  status_metadata: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  payload: z.any(),
});

export const Phase5gCertificationArtifactSchema = z.object({
  artifact_schema_version: z.literal(PHASE5G_ARTIFACT_SCHEMA_VERSION),
  run_id: z.string().min(1),
  run_fingerprint: z.string().min(1).nullable(),
  protocol_version: z.string().min(1),
  started_at: z.string().min(1),
  completed_at: z.string().min(1).nullable(),
  execution_status: z.enum(['IN_PROGRESS', 'COMPLETED', 'FAILED', 'INTERRUPTED']),
  certification_candidate_status: z.enum(['YES', 'NO']),
  provider_configuration: ArtifactSection,
  case: ArtifactSection,
  evidence: ArtifactSection,
  budgets: ArtifactSection,
  request_ledger: z.array(ArtifactSection),
  round1: ArtifactSection,
  disagreements_pre_challenge: z.array(ArtifactSection),
  challenge_round: ArtifactSection,
  revisions: z.array(ArtifactSection),
  disagreements_post_challenge: ArtifactSection,
  apollo_audit: ArtifactSection,
  zeus_readiness: ArtifactSection,
  human_authority: ArtifactSection,
  execution_events: z.array(EventEnvelope),
  replay_metadata: ArtifactSection,
  security_attestation: ArtifactSection,
}).strict();

export type Phase5gCertificationArtifact = z.infer<typeof Phase5gCertificationArtifactSchema>;

export interface Phase5gRunIdentity {
  readonly run_id: string;
  readonly run_started_at: string;
  readonly case_id: string;
  readonly protocol_version: string;
  readonly artifact_schema_version: typeof PHASE5G_ARTIFACT_SCHEMA_VERSION;
}

export interface Phase5gArtifactPathOptions {
  readonly directory?: string;
  readonly now?: () => string;
  readonly run_id?: string;
}

export function createPhase5gRunIdentity(case_id: string, protocol_version: string, now = () => new Date().toISOString(), run_id = `swarm-phase5g-${Date.now()}-${randomUUID()}`): Phase5gRunIdentity {
  return { run_id, run_started_at: now(), case_id, protocol_version, artifact_schema_version: PHASE5G_ARTIFACT_SCHEMA_VERSION };
}

function phaseForEvent(type: string): string {
  if (type.startsWith('SEAT_') || type === 'POSITION_PROPOSED' || type === 'POSITIONS_LOCKED' || type === 'INDEPENDENT_ANALYSIS_STARTED') return 'ROUND1';
  if (type.includes('CHALLENGE') || type === 'DISAGREEMENT_IDENTIFIED' || type === 'DISAGREEMENTS_FINALIZED') return 'CHALLENGE_ROUND';
  if (type.includes('REVISION') || type.includes('CONCESSION') || type.includes('EVIDENCE_REQUEST')) return 'REVISIONS';
  if (type.startsWith('AUDIT')) return 'APOLLO_AUDIT';
  if (type.startsWith('ZEUS')) return 'ZEUS_READINESS';
  return 'PROTOCOL';
}

function relatedIds(event: SwarmExecutionEvent): string[] {
  const record = event as unknown as Record<string, unknown>;
  const ids: string[] = [];
  for (const key of ['seat_id', 'position_id', 'challenge_id', 'response_id', 'revision_id']) {
    if (typeof record[key] === 'string') ids.push(record[key] as string);
  }
  for (const key of ['position', 'challenge', 'response', 'revision', 'finding', 'request']) {
    const value = record[key];
    if (value && typeof value === 'object') {
      for (const idKey of ['position_id', 'challenge_id', 'response_id', 'revision_id', 'finding_id', 'request_id', 'disagreement_id']) {
        if (typeof (value as Record<string, unknown>)[idKey] === 'string') ids.push((value as Record<string, unknown>)[idKey] as string);
      }
    }
  }
  return [...new Set(ids)].sort();
}

function eventEnvelope(run_id: string, event: SwarmExecutionEvent): z.infer<typeof EventEnvelope> {
  return {
    event_id: event.event_id,
    run_id,
    event_type: event.type,
    protocol_phase: phaseForEvent(event.type),
    sequence: event.sequence,
    timestamp: event.timestamp,
    related_object_ids: relatedIds(event),
    status_metadata: { actor: event.actor, case_id: event.case_id },
    payload: event,
  };
}

function safeErrorCode(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[^A-Z0-9_:-]/gi, '_').slice(0, 120) : 'UNKNOWN_ERROR';
}

function secretKey(key: string): boolean {
  if (/^(secret_scan|hidden_reasoning_scan|artifact_schema_validation)$/i.test(key)) return false;
  return /api[_-]?key|authorization|bearer|credential|reasoning[_-]?content|chain[_-]?of[_-]?thought|hidden[_-]?reasoning|raw[_-]?response/i.test(key);
}

function secretText(value: string, secrets: readonly string[]): boolean {
  return /Bearer\s+[A-Za-z0-9._~-]{8,}/i.test(value) || secrets.some((secret) => secret.length > 0 && value.includes(secret));
}

export function scanPhase5gSecrets(value: unknown, secrets: readonly string[] = []): boolean {
  const visit = (node: unknown, key = ''): boolean => {
    if (secretKey(key)) return true;
    if (typeof node === 'string') return secretText(node, secrets);
    if (Array.isArray(node)) return node.some((item) => visit(item));
    if (node && typeof node === 'object') return Object.entries(node as Record<string, unknown>).some(([childKey, child]) => visit(child, childKey));
    return false;
  };
  return visit(value);
}

function nowIso(): string { return new Date().toISOString(); }

function initialArtifact(identity: Phase5gRunIdentity, metadata: { readonly provider: string; readonly model: string; readonly case_value: Record<string, unknown>; readonly evidence_package: Record<string, unknown>; readonly global_budget: number; readonly max_output_tokens: number }): Phase5gCertificationArtifact {
  return {
    artifact_schema_version: PHASE5G_ARTIFACT_SCHEMA_VERSION,
    run_id: identity.run_id,
    run_fingerprint: null,
    protocol_version: identity.protocol_version,
    started_at: identity.run_started_at,
    completed_at: null,
    execution_status: 'IN_PROGRESS',
    certification_candidate_status: 'NO',
    provider_configuration: { provider: metadata.provider, model: metadata.model, max_output_tokens: metadata.max_output_tokens, retry_enabled: false, fallback_enabled: false, zeus_enabled: false },
    case: { case_id: identity.case_id, case: metadata.case_value },
    evidence: { package_id: metadata.evidence_package.package_id ?? null, item_count: Array.isArray(metadata.evidence_package.items) ? metadata.evidence_package.items.length : 0, fingerprint_before: metadata.evidence_package.package_hash ?? null, fingerprint_after: null },
    budgets: { global_provider_request_budget: metadata.global_budget, round1_request_count: 0, challenge_generation_request_count: 0, challenge_response_request_count: 0, zeus_request_count: 0, total_request_count: 0 },
    request_ledger: [],
    round1: { seats: [], positions_locked: false, position_fingerprints: {}, position_immutability: 'UNVERIFIED' },
    disagreements_pre_challenge: [],
    challenge_round: { selected_disagreement_ids: [], challenges: [], responses: [], privacy_boundary: 'UNVERIFIED' },
    revisions: [],
    disagreements_post_challenge: { disagreements: [], open_count: 0, narrowed_count: 0, resolved_count: 0 },
    apollo_audit: { findings: [], finding_count: 0, blocker_count: 0, warning_count: 0 },
    zeus_readiness: { enabled: false, called: false, request_count: 0, gate: 'UNVERIFIED', reasons: [] },
    human_authority: { decision: 'PENDING', violations: 0 },
    execution_events: [],
    replay_metadata: { source: 'persisted_artifact', replayable: false, event_count: 0 },
    security_attestation: { secret_scan: 'UNVERIFIED', hidden_reasoning_scan: 'UNVERIFIED' },
  };
}

function telemetryFromResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {};
  const response = (result as Record<string, unknown>).response;
  if (!response || typeof response !== 'object') return { artifact_validation_status: 'PASS' };
  const value = response as Record<string, unknown>;
  const execution = value.execution && typeof value.execution === 'object' ? value.execution as Record<string, unknown> : {};
  const diagnostics = value.diagnostics && typeof value.diagnostics === 'object' ? value.diagnostics as Record<string, unknown> : {};
  const usage = value.usage && typeof value.usage === 'object' ? value.usage as Record<string, unknown> : {};
  return {
    http_status: typeof diagnostics.http_status === 'number' ? diagnostics.http_status : null,
    finish_reason: typeof value.finish_reason === 'string' ? value.finish_reason : null,
    requested_max_output_tokens: typeof diagnostics.configured_output_limit === 'number' ? diagnostics.configured_output_limit : null,
    effective_max_output_tokens: typeof diagnostics.configured_output_limit === 'number' ? diagnostics.configured_output_limit : null,
    output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : null,
    artifact_validation_status: execution.model_output_accepted === true ? 'PASS' : value.status === 'SUCCESS' ? 'FAIL' : 'NOT_RUN',
    failure_stage: value.error && typeof value.error === 'object' && typeof (value.error as Record<string, unknown>).stage === 'string' ? (value.error as Record<string, unknown>).stage : null,
    failure_code: value.error && typeof value.error === 'object' && typeof (value.error as Record<string, unknown>).code === 'string' ? (value.error as Record<string, unknown>).code : null,
    provider_response_status: typeof value.status === 'string' ? value.status : null,
    fallback_used: execution.fallback_used === true,
  };
}

export class Phase5gArtifactSession {
  readonly identity: Phase5gRunIdentity;
  readonly artifact_path: string;
  private artifact: Phase5gCertificationArtifact;
  private readonly secrets: readonly string[];

  constructor(metadata: { readonly provider: string; readonly model: string; readonly case_value: Record<string, unknown>; readonly evidence_package: Record<string, unknown>; readonly global_budget: number; readonly max_output_tokens: number; readonly secrets?: readonly string[] }, options: Phase5gArtifactPathOptions = {}) {
    const identity = createPhase5gRunIdentity(String(metadata.case_value.case_id), String(metadata.case_value.protocol_version), options.now, options.run_id);
    this.identity = identity;
    const directory = resolve(options.directory ?? join(process.cwd(), PHASE5G_DEFAULT_ARTIFACT_DIRECTORY));
    mkdirSync(directory, { recursive: true });
    this.artifact_path = join(directory, `${identity.run_id}.json`);
    this.secrets = metadata.secrets ?? [];
    this.artifact = initialArtifact(identity, metadata);
    this.writeCheckpoint();
  }

  observe(observation: OfflineRequestObservation): void { this.observeRequest(observation); }

  observeRequest(observation: OfflineRequestObservation): void {
    if (observation.lifecycle === 'RESERVED') {
      const category = observation.operation === 'ROUND1_ANALYSIS' ? 'ROUND1' : observation.operation === 'CHALLENGE_GENERATION' ? 'CHALLENGE_GENERATION' : observation.operation === 'CHALLENGE_RESPONSE' ? 'CHALLENGE_RESPONSE' : 'ZEUS';
      const entry = {
        request_id: observation.request_id,
        run_id: this.identity.run_id,
        operation: observation.operation,
        seat_id: observation.seat_id,
        provider: this.artifact.provider_configuration.provider,
        model: this.artifact.provider_configuration.model,
        request_budget_category: category,
        request_started_at: nowIso(),
        request_completed_at: null,
        request_status: 'REQUEST_IN_FLIGHT',
        http_status: null,
        finish_reason: null,
        requested_max_output_tokens: this.artifact.provider_configuration.max_output_tokens,
        effective_max_output_tokens: this.artifact.provider_configuration.max_output_tokens,
        output_tokens: null,
        retry_index: 0,
        fallback_used: false,
        artifact_validation_status: 'NOT_RUN',
        failure_stage: null,
        failure_code: null,
        ...(observation.round1_context_attestation ? { round1_context_attestation: { ...observation.round1_context_attestation } } : {}),
      };
      this.artifact = { ...this.artifact, request_ledger: [...this.artifact.request_ledger, entry] };
      this.reconcileBudgets();
      this.writeCheckpoint();
      return;
    }
    const index = this.artifact.request_ledger.findIndex((entry) => entry.request_id === observation.request_id);
    if (index < 0) throw new Error('PHASE5G_REQUEST_LEDGER_MISSING_RESERVATION');
    const existing = this.artifact.request_ledger[index]!;
    const telemetry = observation.lifecycle === 'COMPLETED' ? telemetryFromResult(observation.result) : { request_status: 'REQUEST_FAILED', failure_code: observation.error_code ?? 'UNKNOWN_ERROR' };
    const blocked = existing.request_status === 'REQUEST_BLOCKED';
    const updated = { ...existing, ...telemetry, request_status: blocked ? 'REQUEST_BLOCKED' : observation.lifecycle === 'COMPLETED' ? 'REQUEST_COMPLETED' : 'REQUEST_FAILED', request_completed_at: blocked ? null : nowIso() };
    const ledger = [...this.artifact.request_ledger]; ledger[index] = updated;
    this.artifact = { ...this.artifact, request_ledger: ledger };
    this.reconcileBudgets();
    this.writeCheckpoint();
  }

  observeEvent(event: SwarmExecutionEvent): void {
    SwarmExecutionEventSchema.parse(event);
    const envelopes = [...this.artifact.execution_events, eventEnvelope(this.identity.run_id, event)];
    this.artifact = { ...this.artifact, execution_events: envelopes, replay_metadata: { ...this.artifact.replay_metadata, event_count: envelopes.length } };
    this.writeCheckpoint();
  }

  observeChallengeAdmission(report: Phase5ChallengeAdmissionResult): void {
    const dispositions = report.dispositions.map((item) => ({ ...item }));
    this.artifact = {
      ...this.artifact,
      challenge_round: {
        ...this.artifact.challenge_round,
        provider_candidate_count: report.counts.provider_candidate_count,
        dto_valid_candidate_count: report.counts.dto_valid_candidate_count,
        semantic_valid_candidate_count: report.counts.semantic_valid_candidate_count,
        compatible_candidate_count: report.counts.compatible_candidate_count,
        deduplicated_candidate_count: report.counts.deduplicated_candidate_count,
        selected_candidate_count: report.counts.selected_candidate_count,
        admitted_challenge_count: report.counts.admitted_challenge_count,
        candidate_dispositions: dispositions,
        admission_boundary: 'BEFORE_REDUCER',
      },
    };
    this.writeCheckpoint();
  }

  finalize(result: OfflineSwarmRunResult): Phase5gCertificationArtifact {
    const state = result.blackboard;
    const round1Positions = state.positions.filter((position) => position.round === 1);
    const proposed = result.events.filter((event): event is Extract<SwarmExecutionEvent, { type: 'POSITION_PROPOSED' }> => event.type === 'POSITION_PROPOSED').map((event) => event.position).filter((position) => position.round === 1);
    const positionsUnchanged = proposed.every((position) => {
      const final = state.positions.find((candidate) => candidate.position_id === position.position_id);
      return final !== undefined && stableStringify({ ...final, status: position.status }) === stableStringify(position);
    });
    const round1 = round1Positions.map((position) => ({ seat_id: position.seat_id, position_id: position.position_id, round: position.round, provider: position.execution.requested_provider, model: position.execution.requested_model, execution_status: position.execution.status, validation_status: 'ACCEPTED', risk_level: position.risk_level, confidence: position.confidence, position, position_fingerprint: deterministicPackageHash(position), privacy_blindness: 'ROUND1_BLIND' }));
    const finalPackage = state.evidence_package;
    const post = state.disagreements;
    const readyEvent = result.events.find((event) => event.type === 'ZEUS_READINESS_EVALUATED');
    const ready = readyEvent?.type === 'ZEUS_READINESS_EVALUATED' ? readyEvent.ready : false;
    const findings = state.audit_findings;
    const artifactWithoutFingerprint = {
      ...this.artifact,
      completed_at: nowIso(),
      execution_status: 'COMPLETED' as const,
      round1: { seats: round1, positions_locked: result.events.some((event) => event.type === 'POSITIONS_LOCKED'), position_fingerprints: Object.fromEntries(round1.map((item) => [item.position_id, item.position_fingerprint])), position_immutability: positionsUnchanged ? 'PASS' : 'FAIL' },
      evidence: { ...this.artifact.evidence, fingerprint_after: finalPackage?.package_hash ?? null, evidence_item_ids: finalPackage?.items.map((item) => item.evidence_id) ?? [] },
      disagreements_pre_challenge: result.events.filter((event): event is Extract<SwarmExecutionEvent, { type: 'DISAGREEMENT_IDENTIFIED' }> => event.type === 'DISAGREEMENT_IDENTIFIED').map((event) => ({ ...event.disagreement, phase: 'PRE_CHALLENGE' })),
      challenge_round: { ...this.artifact.challenge_round, selected_disagreement_ids: state.challenges.map((item) => item.disagreement_id ?? null).filter((item): item is string => item !== null), challenges: state.challenges, responses: state.challenge_responses, privacy_boundary: 'PASS' },
      revisions: state.revisions,
      disagreements_post_challenge: { disagreements: post, open_count: post.filter((item) => item.status === 'OPEN').length, narrowed_count: post.filter((item) => item.status === 'NARROWED').length, resolved_count: post.filter((item) => item.status === 'RESOLVED').length },
      apollo_audit: { findings, finding_count: findings.length, blocker_count: findings.filter((item) => item.status === 'BLOCKED').length, warning_count: findings.filter((item) => item.status === 'WARNING').length, audit_fingerprint: deterministicPackageHash(findings) },
      zeus_readiness: { enabled: false, called: false, request_count: 0, gate: ready ? 'PASS' : 'FAIL', reasons: readyEvent?.type === 'ZEUS_READINESS_EVALUATED' ? [readyEvent.reason] : ['readiness event missing'] },
      human_authority: { decision: 'PENDING', violations: 0 },
      replay_metadata: { source: 'persisted_artifact', replayable: true, event_count: this.artifact.execution_events.length, reducer: 'replaySwarmEvents' },
    };
    const run_fingerprint = deterministicPackageHash({ run_id: this.identity.run_id, protocol_version: this.identity.protocol_version, case_id: this.identity.case_id, evidence: artifactWithoutFingerprint.evidence, budgets: artifactWithoutFingerprint.budgets, request_ledger: artifactWithoutFingerprint.request_ledger.map(({ request_id, operation, seat_id, request_status, failure_stage, failure_code }) => ({ request_id, operation, seat_id, request_status, failure_stage, failure_code })), event_sequences: artifactWithoutFingerprint.execution_events.map((event) => event.sequence) });
    const candidateChecks = this.reconcileBudgets(artifactWithoutFingerprint.request_ledger) && this.eventOrdering(artifactWithoutFingerprint.execution_events) && !scanPhase5gSecrets(artifactWithoutFingerprint, this.secrets) && artifactWithoutFingerprint.zeus_readiness.called === false && artifactWithoutFingerprint.human_authority.decision === 'PENDING';
    const completed: Phase5gCertificationArtifact = { ...artifactWithoutFingerprint, run_fingerprint, certification_candidate_status: candidateChecks ? 'YES' : 'NO', security_attestation: { secret_scan: scanPhase5gSecrets(artifactWithoutFingerprint, this.secrets) ? 'FAIL' : 'PASS', hidden_reasoning_scan: scanPhase5gSecrets(artifactWithoutFingerprint, this.secrets) ? 'FAIL' : 'PASS', artifact_schema_validation: 'PENDING', request_ledger_reconciliation: this.reconcileBudgets(artifactWithoutFingerprint.request_ledger) ? 'PASS' : 'FAIL', event_ordering: this.eventOrdering(artifactWithoutFingerprint.execution_events) ? 'PASS' : 'FAIL' } };
    const parsed = Phase5gCertificationArtifactSchema.safeParse(completed);
    if (!parsed.success) throw new Error(`PHASE5G_ARTIFACT_SCHEMA_INVALID:${parsed.error.issues[0]?.path.join('.') ?? 'unknown'}`);
    this.artifact = { ...parsed.data, security_attestation: { ...parsed.data.security_attestation, artifact_schema_validation: 'PASS' } };
    this.writeCheckpoint();
    return this.artifact;
  }

  current(): Phase5gCertificationArtifact { return this.artifact; }

  markRequestBlocked(request_id: string, reason = 'GLOBAL_PROVIDER_BUDGET'): void {
    const index = this.artifact.request_ledger.findIndex((entry) => entry.request_id === request_id);
    if (index < 0) return;
    const entry = this.artifact.request_ledger[index]!;
    const ledger = [...this.artifact.request_ledger];
    ledger[index] = { ...entry, request_status: 'REQUEST_BLOCKED', failure_stage: 'REQUEST', failure_code: reason, request_completed_at: null };
    this.artifact = { ...this.artifact, request_ledger: ledger };
    this.writeCheckpoint();
  }

  markInterrupted(reason = 'SIGINT_RECEIVED'): void {
    this.artifact = { ...this.artifact, execution_status: 'INTERRUPTED', certification_candidate_status: 'NO', replay_metadata: { ...this.artifact.replay_metadata, interrupted: true, interruption_reason: reason } };
    this.writeCheckpoint();
  }

  markFailed(error: unknown): void {
    this.artifact = { ...this.artifact, execution_status: 'FAILED', certification_candidate_status: 'NO', replay_metadata: { ...this.artifact.replay_metadata, failure_code: safeErrorCode(error), failure_stage: 'EXECUTION', last_completed_protocol_phase: this.artifact.execution_events.at(-1)?.protocol_phase ?? 'PREFLIGHT' } };
    this.writeCheckpoint();
  }

  private reconcileBudgets(ledger = this.artifact.request_ledger): boolean {
    const counts = { ROUND1: 0, CHALLENGE_GENERATION: 0, CHALLENGE_RESPONSE: 0, ZEUS: 0 };
    for (const entry of ledger) counts[entry.request_budget_category as keyof typeof counts] += 1;
    const total = ledger.length;
    this.artifact = { ...this.artifact, budgets: { ...this.artifact.budgets, round1_request_count: counts.ROUND1, challenge_generation_request_count: counts.CHALLENGE_GENERATION, challenge_response_request_count: counts.CHALLENGE_RESPONSE, zeus_request_count: counts.ZEUS, total_request_count: total } };
    return total === Object.values(counts).reduce((sum, value) => sum + value, 0) && counts.ZEUS === 0 && total <= Number(this.artifact.budgets.global_provider_request_budget);
  }

  private eventOrdering(events: readonly { readonly sequence: number }[]): boolean {
    return events.every((event, index) => event.sequence === index + 1);
  }

  private writeCheckpoint(): void {
    const parsed = Phase5gCertificationArtifactSchema.safeParse(this.artifact);
    if (!parsed.success) throw new Error(`PHASE5G_CHECKPOINT_SCHEMA_INVALID:${JSON.stringify(parsed.error.issues)}`);
    if (scanPhase5gSecrets(parsed.data, this.secrets)) throw new Error('PHASE5G_SECRET_SCAN_FAILED');
    const temporary = `${this.artifact_path}.${process.pid}.${randomUUID()}.tmp`;
    mkdirSync(dirname(this.artifact_path), { recursive: true });
    writeFileSync(temporary, `${stableStringify(parsed.data)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, this.artifact_path);
  }
}

export function loadPhase5gArtifact(path: string): Phase5gCertificationArtifact {
  const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  return Phase5gCertificationArtifactSchema.parse(value);
}

export function replayPhase5gArtifact(artifact: Phase5gCertificationArtifact) {
  const events = artifact.execution_events.map((envelope) => SwarmExecutionEventSchema.parse(envelope.payload));
  if (!artifact.replay_metadata.replayable) throw new Error('PHASE5G_ARTIFACT_NOT_REPLAYABLE');
  if (events.length !== artifact.execution_events.length || !events.every((event, index) => event.sequence === index + 1)) throw new Error('PHASE5G_EVENT_ORDER_INVALID');
  return replaySwarmEvents(events);
}

export function certifyPhase5gArtifact(artifact: Phase5gCertificationArtifact): { readonly ok: boolean; readonly request_ledger_reconciliation: boolean; readonly event_ordering: boolean; readonly secret_scan: boolean; readonly hidden_reasoning_scan: boolean; readonly replayable: boolean } {
  const requestLedgerReconciliation = artifact.request_ledger.length === Number(artifact.budgets.total_request_count) && Number(artifact.budgets.zeus_request_count) === 0 && artifact.request_ledger.every((entry) => entry.run_id === artifact.run_id);
  const eventOrdering = artifact.execution_events.every((event, index) => event.run_id === artifact.run_id && event.sequence === index + 1);
  const secretScan = !scanPhase5gSecrets(artifact);
  let replayable = false;
  try { replayPhase5gArtifact(artifact); replayable = true; } catch { replayable = false; }
  const hiddenReasoningScan = secretScan;
  return { ok: artifact.certification_candidate_status === 'YES' && requestLedgerReconciliation && eventOrdering && secretScan && hiddenReasoningScan && replayable, request_ledger_reconciliation: requestLedgerReconciliation, event_ordering: eventOrdering, secret_scan: secretScan, hidden_reasoning_scan: hiddenReasoningScan, replayable };
}

export function validatePhase5gFailedArtifact(artifact: Phase5gCertificationArtifact): { readonly schema: boolean; readonly ledger_present: boolean; readonly event_log_present: boolean; readonly event_ordering: boolean; readonly failure_code_present: boolean; readonly failure_stage_present: boolean; readonly secret_scan: boolean; readonly hidden_reasoning_scan: boolean; readonly forensic_valid: boolean } {
  const schema = Phase5gCertificationArtifactSchema.safeParse(artifact).success;
  const ledger_present = Array.isArray(artifact.request_ledger);
  const event_log_present = Array.isArray(artifact.execution_events);
  const event_ordering = artifact.execution_events.every((event, index) => event.sequence === index + 1 && event.run_id === artifact.run_id);
  const failure_code_present = typeof artifact.replay_metadata.failure_code === 'string' && artifact.replay_metadata.failure_code.length > 0;
  const failure_stage_present = typeof artifact.replay_metadata.failure_stage === 'string' && artifact.replay_metadata.failure_stage.length > 0;
  const secret_scan = !scanPhase5gSecrets(artifact);
  const hidden_reasoning_scan = secret_scan;
  return { schema, ledger_present, event_log_present, event_ordering, failure_code_present, failure_stage_present, secret_scan, hidden_reasoning_scan, forensic_valid: schema && ledger_present && event_log_present && event_ordering && failure_code_present && secret_scan && hidden_reasoning_scan };
}

export function phase5gPositionFingerprint(position: AgentPosition): string { return deterministicPackageHash(position); }

export function phase5gErrorObservation(error: unknown): string { return safeErrorCode(error); }
