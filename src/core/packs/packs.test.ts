import { describe, expect, it } from '../test/bdd';
import { routeQuestion } from '../question/model';
import { decideParticipation, participationNote, abstainedAgents, participatingAgents } from '../orchestrator/participation';
import { freightPack, openPack, packById, PACKS } from './registry';
import { packSummary } from './types';

describe('knowledge packs declare what they know and what they cannot do', () => {
  it('gives the freight pack its taxonomy, its control set and its own relevance floor', () => {
    const pack = freightPack();
    expect(pack.taxonomy_snapshot).toBe('freight-risk-atlas/taxonomy.json');
    expect(pack.min_relevance).toBe(0.34);
    expect(Object.keys(pack.lexicon).length).toBeGreaterThan(10);
    expect(pack.relevance_terms.length).toBeGreaterThan(20);
    expect(pack.supports.taxonomy_matching).toBe(true);
    expect(pack.benign_category).toBe('insolven');
  });

  it('gives the open pack no taxonomy, no control set and no relevance gate', () => {
    const pack = openPack();
    expect(pack.taxonomy_snapshot).toBeNull();
    expect(pack.governance_snapshot).toBeNull();
    expect(pack.min_relevance).toBeNull();
    expect(pack.relevance_terms.length).toBe(0);
    expect(pack.supports.taxonomy_matching).toBe(false);
    expect(pack.supports.governance_mapping).toBe(false);
    expect(pack.benign_category).toBeNull();
  });

  it('keeps the geography vocabulary in the open pack and drops the freight-only mode vocabulary', () => {
    const pack = openPack();
    expect(pack.geo_rules.length).toBeGreaterThan(0);
    expect(pack.mode_rules.length).toBe(0);
  });

  it('states a pack limit rather than leaving it to be discovered', () => {
    expect(packSummary(freightPack())).not.toContain('Limits:');
    const open = packSummary(openPack());
    expect(open).toContain('no pinned taxonomy');
    expect(open).toContain('no pinned control set');
  });

  it('refuses an unknown pack id instead of falling back to a default', () => {
    expect(() => packById('nonexistent')).toThrow();
    expect(packById('freight-risk').id).toBe('freight-risk');
    expect(Object.keys(PACKS).length).toBe(2);
  });

  it('references the live freight vocabularies rather than holding a second copy of them', async () => {
    const { FREIGHT_TERMS, CATEGORY_RULES } = await import('../integrations/fomo');
    const { PATTERN_LEXICON } = await import('../integrations/atlas');
    const pack = freightPack();
    expect(pack.relevance_terms).toBe(FREIGHT_TERMS);
    expect(pack.category_rules).toBe(CATEGORY_RULES);
    expect(pack.lexicon).toBe(PATTERN_LEXICON);
  });
});

describe('participation is decided from the question and the pack, with a reason each time', () => {
  const decide = (q: string, pack = freightPack()) => decideParticipation(routeQuestion(q), pack);

  it('keeps all seven in the room for the freight question the system was built for', () => {
    const d = decide('Are we exposed to phantom-carrier fraud in the DACH road network?');
    expect(d.length).toBe(7);
    expect(abstainedAgents(d).length).toBe(0);
    expect(participationNote(d)).toBe('All 7 agents participated.');
  });

  it('keeps the governance officer out of an astrophysics question rather than inventing an obligation', () => {
    const d = decide('What is the mass of the black hole at the centre of the Milky Way?');
    const zeus = d.find((x) => x.agent === 'governance_officer')!;
    expect(zeus.participating).toBe(false);
    expect(zeus.reason).toContain('does not cover');
    expect(zeus.reason).toContain('would be noise');
    // The analyst still participates: the freight pack does have a taxonomy, and a run that finds no
    // pattern must say so rather than never having looked.
    expect(d.find((x) => x.agent === 'risk_analyst')!.participating).toBe(true);
  });

  it('brings the governance officer in when regulation is a subdomain rather than the main domain', () => {
    const d = decide('How does GDPR affect carrier onboarding in freight tendering?');
    expect(d.find((x) => x.agent === 'governance_officer')!.participating).toBe(true);
  });

  it('stands the analyst down when the loaded pack has no taxonomy to name a pattern from', () => {
    const d = decide('Explain quantum computing.', openPack());
    const analyst = d.find((x) => x.agent === 'risk_analyst')!;
    expect(analyst.participating).toBe(false);
    expect(analyst.reason).toContain('Nothing was inferred in its place');
    expect(d.find((x) => x.agent === 'governance_officer')!.reason).toContain('nothing to map an obligation against');
    expect(participationNote(d)).toContain('5 of 7 agents participated');
  });

  it('never stands down the five agents whose work is about evidence rather than subject', () => {
    for (const q of ['Explain quantum computing.', 'What is the capital of Germany?', 'Compare GDPR and the EU AI Act.']) {
      const ids = participatingAgents(decide(q, openPack()));
      for (const agent of ['scout', 'intelligence', 'challenger', 'red_team', 'decision_engine']) {
        expect(ids.includes(agent as never)).toBe(true);
      }
    }
  });

  it('gives every decision a reason, whichever way it went', () => {
    for (const pack of [freightPack(), openPack()]) {
      for (const d of decideParticipation(routeQuestion('What changed recently in EU AI regulation?'), pack)) {
        expect(d.reason.length).toBeGreaterThan(20);
      }
    }
  });
});
