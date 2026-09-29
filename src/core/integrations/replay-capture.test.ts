import { describe, expect, it } from '../test/bdd';
import type { ResearchOutcome } from '../research/session';
import { buildSwarmReplayCapture, SwarmReplayCapture } from './replay-capture';
import { FraudWatchCandidateMO } from './fraud-watch-candidate';

const NOW = '2026-09-29T12:00:00.000Z';

const candidate = FraudWatchCandidateMO.parse({
  schema_version: 'candidate-mo.v1',
  kind: 'candidate_mo',
  data_class: 'synthetic_simulation',
  exported_at: NOW,
  simulation: { seed: 42, sim_time_seconds_from_genesis: 4.5 },
  source: {
    repository: 'Jeevan-0508/fraud-watch',
    repository_url: 'https://github.com/Jeevan-0508/fraud-watch',
    revision: null,
    authenticity: 'unverified_export',
  },
  taxonomy: {
    repository: 'Jeevan-0508/freight-fraud-taxonomy',
    version: '1.0.0',
    source_commit: null,
    snapshot_sha256: null,
  },
  candidate: {
    id: 'fraud-watch:SIG-001',
    signature: 'SIG-001',
    lifecycle_state: 'DISCOVERED',
    source_state: 'CANDIDATE',
    time_basis: 'simulation_seconds_from_genesis',
    first_seen_at: 1,
    candidate_since: 2,
    review_started_at: null,
    resolved_at: null,
    resolution_note: null,
    supporting_cases: [{
      case_id: 'MO-1',
      classification: 'POTENTIAL_NEW_MO',
      classification_reason: null,
      recorded_at: 3,
      case_opened_at: 2,
      first_observed_at: 1,
      signal_types: ['route_deviation'],
      related_pattern_id: null,
      correlation_index: 4,
      correlation_index_semantics: 'synthetic_signal_index_not_probability',
    }],
  },
});

function researchOutcome(overrides: Record<string, unknown> = {}): ResearchOutcome {
  return {
    run_id: 'RES-20260929120000',
    now: NOW,
    routed: { query: 'Do public sources report route deviations?', intent: 'open' },
    plan: {},
    execution: {
      started_at: NOW,
      status: 'partial',
      attempts: [
        { dimension: 'background', provider: 'news_rss', query: 'route deviation freight', status: 'ok', reason: null, returned: 2, retained: 1, ms: 12 },
        { dimension: 'background', provider: 'openalex', query: 'route deviation freight', status: 'unavailable', reason: 'blocked', returned: 0, retained: 0, ms: 4 },
      ],
    },
    external: {
      items: [{
        evidence: { id: 'E-EXT-1', url: 'https://news.example/report', title: 'A report describes a shipment route change', excerpt_or_summary: 'The publisher reported a route change.', injection_suspected: false },
        provenance: { provider: 'news_rss', source_identity: 'news.example', query: 'route deviation freight', content_hash: 'fnv1a:12345678', retrieved_at: NOW, stated_date: '2026-09-28', date_kind: 'published', via_proxy: false },
        quality: { source_type: 'news', caveats: ['Press reporting is not proof of the event.'] },
      }],
      dropped: [],
    },
    internal_outcome: { status: 'ok', hits: [{ record: { id: 'KB-1' }, score: 1, matched_terms: ['route'] }] },
    merged: { items: [{ evidence: { id: 'INTERNAL-1' } }] },
    ...overrides,
  } as unknown as ResearchOutcome;
}

describe('SWARM replay capture', () => {
  it('exports only external source records and keeps retrieval failures visible', () => {
    const capture = buildSwarmReplayCapture({
      outcome: researchOutcome(),
      question: 'Do public sources report route deviations?',
      capturedAt: NOW,
    });

    expect(capture.research.source_records).toHaveLength(1);
    expect(capture.research.source_records[0]?.evidence_id).toBe('E-EXT-1');
    expect(capture.research.source_records[0]?.data_class).toBe('external_source_content');
    expect(capture.research.attempts[1]?.status).toBe('unavailable');
    expect(capture.research.internal_search).toEqual({ status: 'ok', hit_count: 1, content_exported: false });
    expect(capture.hypothesis_context).toBeNull();
    expect(capture.excluded_outputs).toEqual({ model_conclusions: true, internal_knowledge_content: true, knowledge_promotion: true });
    expect('answer' in capture.research).toBe(false);
  });

  it('keeps an attached Fraud Watch candidate in an isolated hypothesis field', () => {
    const capture = buildSwarmReplayCapture({
      outcome: researchOutcome(),
      question: 'Could independent reporting support this hypothesis?',
      capturedAt: NOW,
      candidate,
    });

    expect(capture.hypothesis_context?.data_class).toBe('synthetic_simulation');
    expect(capture.hypothesis_context?.role).toBe('hypothesis_context_only');
    expect(capture.hypothesis_context?.authenticity).toBe('unverified_export');
    expect(capture.research.source_records.every((record) => record.data_class === 'external_source_content')).toBe(true);
    expect(capture.research.source_records.some((record) => record.evidence_id.startsWith('MO-'))).toBe(false);
  });

  it('rejects duplicate source ids and impossible retrieval counts', () => {
    const valid = buildSwarmReplayCapture({
      outcome: researchOutcome(),
      question: 'Question?',
      capturedAt: NOW,
    });
    const duplicate = {
      ...valid,
      research: { ...valid.research, source_records: [...valid.research.source_records, ...valid.research.source_records] },
    };
    const impossibleAttempt = {
      ...valid,
      research: { ...valid.research, attempts: [{ ...valid.research.attempts[0]!, returned: 0, retained: 1 }] },
    };

    expect(SwarmReplayCapture.safeParse(duplicate).success).toBe(false);
    expect(SwarmReplayCapture.safeParse(impossibleAttempt).success).toBe(false);
  });
});
