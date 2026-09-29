import { z } from 'zod';

/** Exact taxonomy repository revision containing the candidate-mo.v1 schema. */
export const CANDIDATE_MO_SCHEMA_SOURCE_REVISION = 'd8fa1399d849c125a91f9ea5128f1fbad40186d2';

const simSeconds = z.number().finite().nonnegative();
const classification = z.enum(['KNOWN_MO', 'MO_VARIANT', 'POTENTIAL_NEW_MO', 'EMERGING_BEHAVIOR']);

const SupportingCase = z.object({
  case_id: z.string().regex(/^MO-[0-9]+$/),
  classification,
  current_classification: classification.optional(),
  classification_reason: z.string().max(500).nullable(),
  recorded_at: simSeconds,
  case_opened_at: simSeconds,
  first_observed_at: simSeconds,
  signal_types: z.array(z.string().min(1)).min(1).refine((items) => new Set(items).size === items.length, 'signal_types must be unique'),
  related_pattern_id: z.string().regex(/^FFT-[0-9]{3}$/).nullable(),
  correlation_index: z.number().int().min(0).max(100),
  correlation_index_semantics: z.literal('synthetic_signal_index_not_probability'),
}).strict();

export const FraudWatchCandidateMO = z.object({
  schema_version: z.literal('candidate-mo.v1'),
  kind: z.literal('candidate_mo'),
  data_class: z.literal('synthetic_simulation'),
  exported_at: z.string().datetime({ offset: true }),
  simulation: z.object({
    seed: z.number().finite().int(),
    sim_time_seconds_from_genesis: simSeconds,
  }).strict(),
  source: z.object({
    repository: z.literal('Jeevan-0508/fraud-watch'),
    repository_url: z.literal('https://github.com/Jeevan-0508/fraud-watch'),
    revision: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
    authenticity: z.literal('unverified_export'),
  }).strict(),
  taxonomy: z.object({
    repository: z.literal('Jeevan-0508/freight-fraud-taxonomy'),
    version: z.string().min(1),
    source_commit: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
    snapshot_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  }).strict(),
  candidate: z.object({
    id: z.string().min(1),
    signature: z.string().min(1),
    lifecycle_state: z.enum(['DISCOVERED', 'UNDER_REVIEW', 'VALIDATED', 'REJECTED']),
    source_state: z.enum(['CANDIDATE', 'REVIEW', 'VALIDATED', 'REJECTED']),
    time_basis: z.literal('simulation_seconds_from_genesis'),
    first_seen_at: simSeconds,
    candidate_since: simSeconds,
    review_started_at: simSeconds.nullable(),
    resolved_at: simSeconds.nullable(),
    resolution_note: z.string().max(2000).nullable(),
    supporting_cases: z.array(SupportingCase).min(1),
  }).strict(),
}).strict().superRefine((document, ctx) => {
  const { candidate, simulation } = document;
  const lifecycleToSource = {
    DISCOVERED: 'CANDIDATE',
    UNDER_REVIEW: 'REVIEW',
    VALIDATED: 'VALIDATED',
    REJECTED: 'REJECTED',
  } as const;
  const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

  if (candidate.id !== `fraud-watch:${candidate.signature}`) {
    add(['candidate', 'id'], 'id must be namespaced from the candidate signature');
  }
  if (lifecycleToSource[candidate.lifecycle_state] !== candidate.source_state) {
    add(['candidate', 'source_state'], 'lifecycle_state and source_state do not correspond');
  }
  if (candidate.first_seen_at > candidate.candidate_since) {
    add(['candidate', 'first_seen_at'], 'first_seen_at is after candidate_since');
  }
  if (candidate.candidate_since > simulation.sim_time_seconds_from_genesis) {
    add(['candidate', 'candidate_since'], 'candidate_since is later than simulation time at export');
  }

  const { review_started_at: review, resolved_at: resolved } = candidate;
  if (candidate.lifecycle_state === 'DISCOVERED' && (review !== null || resolved !== null)) {
    add(['candidate', 'lifecycle_state'], 'DISCOVERED cannot carry review or resolution timestamps');
  } else if (candidate.lifecycle_state === 'UNDER_REVIEW' && (review === null || resolved !== null)) {
    add(['candidate', 'lifecycle_state'], 'UNDER_REVIEW requires review_started_at and no resolved_at');
  } else if ((candidate.lifecycle_state === 'VALIDATED' || candidate.lifecycle_state === 'REJECTED') && (review === null || resolved === null)) {
    add(['candidate', 'lifecycle_state'], 'resolved candidates require both lifecycle timestamps');
  }
  if (review !== null && (review < candidate.candidate_since || review > simulation.sim_time_seconds_from_genesis)) {
    add(['candidate', 'review_started_at'], 'review timestamp is outside candidate/export simulation time');
  }
  if (resolved !== null && (review === null || resolved < review || resolved > simulation.sim_time_seconds_from_genesis)) {
    add(['candidate', 'resolved_at'], 'resolution timestamp is inconsistent with review/export time');
  }

  const seenCaseIds = new Set<string>();
  candidate.supporting_cases.forEach((support, index) => {
    if (seenCaseIds.has(support.case_id)) add(['candidate', 'supporting_cases', index, 'case_id'], 'duplicate supporting case id');
    seenCaseIds.add(support.case_id);
    if (support.first_observed_at > support.case_opened_at) {
      add(['candidate', 'supporting_cases', index, 'first_observed_at'], 'first observation is after case opening');
    }
    if (support.case_opened_at > support.recorded_at) {
      add(['candidate', 'supporting_cases', index, 'case_opened_at'], 'case opening is after provenance was recorded');
    }
    if (support.recorded_at < candidate.candidate_since || support.recorded_at > simulation.sim_time_seconds_from_genesis) {
      add(['candidate', 'supporting_cases', index, 'recorded_at'], 'provenance time is outside candidate/export simulation time');
    }
  });
});

export type FraudWatchCandidateMO = z.infer<typeof FraudWatchCandidateMO>;
