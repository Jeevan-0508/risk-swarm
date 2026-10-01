import { z } from 'zod';
import type { ResearchOutcome } from '../research/session';
import { FraudWatchCandidateMO } from './fraud-watch-candidate';

const isoDateTime = z.string().datetime({ offset: true });
const provider = z.enum(['wikipedia', 'wikidata', 'openalex', 'crossref', 'hackernews', 'worldbank', 'duckduckgo', 'news_rss']);

const SourceRecord = z.object({
  evidence_id: z.string().min(1),
  data_class: z.literal('external_source_content'),
  role: z.literal('retrieved_source_record'),
  provider,
  source_identity: z.string().min(1),
  source_type: z.enum(['regulator', 'industry_body', 'news', 'portfolio_kb', 'academic', 'statistical_body', 'reference_work']),
  query: z.string(),
  url: z.string().url().refine((value) => /^https?:\/\//i.test(value), 'HTTP(S) source URL required'),
  title: z.string(),
  excerpt: z.string(),
  content_hash: z.string().min(1),
  content_hash_algorithm: z.enum(['sha256', 'fnv1a']),
  retrieved_at: isoDateTime,
  stated_date: z.string().nullable(),
  date_kind: z.enum(['published', 'revised', 'indexed', 'observed', 'unknown']),
  via_proxy: z.boolean(),
  caveats: z.array(z.string()),
  injection_suspected: z.boolean(),
}).strict();

const Attempt = z.object({
  dimension: z.string(),
  provider,
  query: z.string(),
  status: z.enum(['ok', 'empty', 'search_failed', 'unavailable', 'skipped_budget']),
  reason: z.string().nullable(),
  returned: z.number().int().nonnegative(),
  retained: z.number().int().nonnegative(),
  ms: z.number().finite().nonnegative(),
}).strict();

const DroppedSource = z.object({
  reason: z.enum(['no_location', 'empty_text']),
  title: z.string(),
  detail: z.string(),
}).strict();

export const SwarmReplayCapture = z.object({
  schema_version: z.literal('swarm-research-capture.v1'),
  kind: z.literal('risk_swarm_research_capture'),
  captured_at: isoDateTime,
  source: z.object({
    repository: z.literal('Jeevan-0508/risk-swarm'),
    revision: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
  }).strict(),
  research: z.object({
    run_id: z.string().min(1),
    question: z.string(),
    question_origin: z.literal('operator_supplied'),
    started_at: isoDateTime,
    retrieval_status: z.enum(['ok', 'partial', 'search_failed', 'limit_reached']),
    attempts: z.array(Attempt),
    source_records: z.array(SourceRecord),
    dropped_sources: z.array(DroppedSource),
    internal_search: z.object({
      status: z.enum(['not_run', 'ok', 'empty', 'unavailable']),
      hit_count: z.number().int().nonnegative(),
      content_exported: z.literal(false),
    }).strict(),
  }).strict(),
  hypothesis_context: z.object({
    data_class: z.literal('synthetic_simulation'),
    role: z.literal('hypothesis_context_only'),
    authenticity: z.literal('unverified_export'),
    candidate: FraudWatchCandidateMO,
  }).strict().nullable(),
  excluded_outputs: z.object({
    model_conclusions: z.literal(true),
    internal_knowledge_content: z.literal(true),
    knowledge_promotion: z.literal(true),
  }).strict(),
  integrity_note: z.literal('Fingerprints cover normalized excerpt text (or title); the algorithm may be non-cryptographic. They do not establish source authenticity, factual truth, source independence, or claim entailment.'),
}).strict().superRefine((capture, ctx) => {
  if (Date.parse(capture.captured_at) < Date.parse(capture.research.started_at)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['captured_at'], message: 'capture cannot precede research start' });
  }
  const ids = new Set<string>();
  capture.research.source_records.forEach((record, index) => {
    if (ids.has(record.evidence_id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['research', 'source_records', index, 'evidence_id'], message: 'source evidence ids must be unique' });
    }
    ids.add(record.evidence_id);
    if (Date.parse(record.retrieved_at) > Date.parse(capture.captured_at)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['research', 'source_records', index, 'retrieved_at'], message: 'retrieval cannot follow capture' });
    }
  });
  for (const [index, attempt] of capture.research.attempts.entries()) {
    if (attempt.retained > attempt.returned) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['research', 'attempts', index, 'retained'], message: 'retained cannot exceed returned' });
    }
  }
});

export type SwarmReplayCapture = z.infer<typeof SwarmReplayCapture>;

export interface BuildSwarmReplayCaptureInput {
  outcome: ResearchOutcome;
  question: string;
  capturedAt: string;
  candidate?: z.infer<typeof FraudWatchCandidateMO> | null;
  sourceRevision?: string | null;
}

/**
 * Portable, review-only snapshot for the SWARM → REPLAY handoff. Only externally retrieved,
 * normalized source records are exported; internal knowledge, derived answers, and model opinions
 * are deliberately omitted. The optional Fraud Watch file is stored in its own hypothesis-only
 * field and can never be emitted as a source record.
 */
export function buildSwarmReplayCapture(input: BuildSwarmReplayCaptureInput): SwarmReplayCapture {
  const { outcome } = input;
  const status = outcome.internal_outcome?.status ?? 'not_run';
  const internalHitCount = outcome.internal_outcome?.status === 'ok' ? outcome.internal_outcome.hits.length : 0;
  const capture = {
    schema_version: 'swarm-research-capture.v1' as const,
    kind: 'risk_swarm_research_capture' as const,
    captured_at: input.capturedAt,
    source: {
      repository: 'Jeevan-0508/risk-swarm' as const,
      // The browser build does not embed a verifiable source revision.
      revision: input.sourceRevision ?? null,
    },
    research: {
      run_id: outcome.run_id,
      question: input.question,
      question_origin: 'operator_supplied' as const,
      started_at: outcome.execution.started_at,
      retrieval_status: outcome.execution.status,
      attempts: outcome.execution.attempts,
      source_records: (outcome.external?.items ?? []).map(({ evidence, provenance, quality }) => ({
        evidence_id: evidence.id,
        data_class: 'external_source_content' as const,
        role: 'retrieved_source_record' as const,
        provider: provenance.provider,
        source_identity: provenance.source_identity,
        source_type: quality.source_type,
        query: provenance.query,
        url: evidence.url!,
        title: evidence.title,
        excerpt: evidence.excerpt_or_summary,
        content_hash: provenance.content_hash,
        content_hash_algorithm: provenance.content_hash.startsWith('fnv1a:') ? 'fnv1a' : 'sha256',
        retrieved_at: provenance.retrieved_at,
        stated_date: provenance.stated_date,
        date_kind: provenance.date_kind,
        via_proxy: provenance.via_proxy,
        caveats: quality.caveats,
        injection_suspected: evidence.injection_suspected,
      })),
      dropped_sources: outcome.external?.dropped ?? [],
      internal_search: {
        status: status as 'not_run' | 'ok' | 'empty' | 'unavailable',
        hit_count: internalHitCount,
        content_exported: false as const,
      },
    },
    hypothesis_context: input.candidate == null ? null : {
      data_class: 'synthetic_simulation' as const,
      role: 'hypothesis_context_only' as const,
      authenticity: 'unverified_export' as const,
      candidate: input.candidate,
    },
    excluded_outputs: {
      model_conclusions: true as const,
      internal_knowledge_content: true as const,
      knowledge_promotion: true as const,
    },
    integrity_note: 'Fingerprints cover normalized excerpt text (or title); the algorithm may be non-cryptographic. They do not establish source authenticity, factual truth, source independence, or claim entailment.' as const,
  };

  return SwarmReplayCapture.parse(capture);
}
