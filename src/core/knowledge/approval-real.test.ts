/**
 * EVOLUTION 5.0 Phase I. `approval.test.ts` proves the gate's logic against fixtures it builds itself,
 * which proves the checker, not the system. These tests run the same gate over a delta produced by a real
 * `research()` pass and the real packs from the registry, because the failure that would actually hurt is
 * the one where the shapes agree in a fixture and diverge in production.
 */
import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { createInternalKnowledge } from '../knowledge/internal';
import { research, type ResearchDeps } from '../research/session';
import {
  PROVIDERS,
  providerById,
  type ProviderId,
  type ProviderOutcome,
  type ResearchDocument,
  type ResearchProvider,
} from '../research/providers/types';
import { openPack, packById } from '../packs/registry';
import { MIN_DISTINCT_SOURCES, approveProposal, proposeTaxonomyChange, validateProposal } from './approval';

const NOW = '2026-09-14T00:00:00.000Z';
const QUESTION = 'What happened this year in quantum error correction hardware?';

const doc = (title: string, host: string): ResearchDocument => ({
  provider: 'wikipedia',
  query: 'q',
  url: `https://${host}/${title.replace(/\s+/g, '-')}`,
  published_at: '2026-09-01T00:00:00.000Z',
  date_kind: 'published',
  retrieved_at: NOW,
  source_identity: host,
  excerpt: 'a sentence of source text long enough to count as an excerpt for normalization',
  value: null,
  via_proxy: false,
  ...{ title },
});

const stub = (id: ProviderId, outcome: ProviderOutcome): ResearchProvider => ({
  descriptor: providerById(id),
  async search() {
    return outcome;
  },
});

function deps(documents: ResearchDocument[]): ResearchDeps {
  return {
    providers: PROVIDERS.map((p) => stub(p.id, { status: 'ok', documents })),
    knowledge: createInternalKnowledge(createFileLoader('public/snapshots')),
    fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
    now: NOW,
    hash: async (t: string) => `h${t.length}`,
    clock: () => 0,
  };
}

const realDelta = async (documents: ResearchDocument[]) => {
  const outcome = await research({ question: QUESTION, proxyEnabled: false }, deps(documents));
  if (outcome.delta === null) throw new Error('this question was expected to produce a knowledge delta');
  return outcome.delta;
};

describe('the taxonomy gate, over a real research pass and the real packs', () => {
  it('produces a delta whose counts are the pass\'s own external evidence, not a fixture', async () => {
    const delta = await realDelta([doc('Surface codes at scale', 'nature.com'), doc('A logical qubit', 'arxiv.org')]);
    expect(delta.distinct_source_count).toBe(2);
    expect(delta.evidence_count >= 2).toBe(true);
    expect(delta.status).toBe('proposed');
  });

  it('refuses a real delta backed by one host repeated, at the real minimum', async () => {
    const delta = await realDelta([doc('Surface codes at scale', 'nature.com'), doc('A logical qubit', 'nature.com')]);
    expect(delta.distinct_source_count).toBe(1);

    const proposal = proposeTaxonomyChange(delta, packById('open'), NOW);
    const result = validateProposal(proposal, packById('open'));
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes(`minimum of ${MIN_DISTINCT_SOURCES}`))).toBe(true);
  });

  it('approves against the real open pack without changing the pack in the registry', async () => {
    const delta = await realDelta([doc('Surface codes at scale', 'nature.com'), doc('A logical qubit', 'arxiv.org')]);
    const pack = packById('open');
    const rulesBefore = pack.category_rules.length;

    const validation = validateProposal(proposeTaxonomyChange(delta, pack, NOW), pack);
    expect(validation.failures).toEqual([]);

    const { pack: extended, proposal } = approveProposal(proposeTaxonomyChange(delta, pack, NOW), pack, {
      by: 'Jeevan Siddhabhaktula',
      now: NOW,
      note: 'two independent hosts, and the pack pins no conflicting category',
    });

    expect(extended.category_rules.length).toBe(rulesBefore + 1);
    // The instance the gate was handed, and a fresh one from the registry factory, both unchanged.
    expect(pack.category_rules.length).toBe(rulesBefore);
    expect(openPack().category_rules.length).toBe(rulesBefore);
    expect(extended.category_rules[rulesBefore][0]).toBe(delta.domain);
    expect(proposal.status).toBe('approved');
    expect(proposal.decided_by).toBe('Jeevan Siddhabhaktula');
  });

  it('reports the freight pack\'s own pinned categories as the reason when they conflict', async () => {
    const delta = await realDelta([doc('Surface codes at scale', 'nature.com'), doc('A logical qubit', 'arxiv.org')]);
    const freight = packById('freight-risk');
    const result = validateProposal(proposeTaxonomyChange(delta, freight, NOW), freight);

    for (const failure of result.failures) {
      const named = /"([^"]+)" already belongs to category "([^"]+)"|already has a category "([^"]+)"/.exec(failure);
      if (named === null) continue;
      const category = named[2] ?? named[3];
      expect(freight.category_rules.some(([c]) => c === category)).toBe(true);
    }
  });
});
