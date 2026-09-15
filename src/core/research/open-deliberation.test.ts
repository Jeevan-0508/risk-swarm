import { describe, expect, it } from '../test/bdd';
import { deliberateOpenResearch } from './open-deliberation';
import type { ResearchOutcome } from './session';

function outcome(excerpt: string): ResearchOutcome {
  const evidence = {
    evidence: { id: 'EV-01', title: 'Animal reference', excerpt_or_summary: excerpt, url: 'https://en.wikipedia.org/wiki/Tiger' },
    provenance: { source_identity: 'en.wikipedia.org' },
  } as unknown as ResearchOutcome['merged']['items'][number];
  return {
    execution: { status: 'ok' },
    merged: { items: [evidence] },
  } as unknown as ResearchOutcome;
}

/** Titles carry a singular mention of each side, since the fallback combat dimension looks for that in the corpus; the excerpts carry the plural, directional sentences the scoring itself is tested against. */
function multiItemOutcome(excerpts: string[]): ResearchOutcome {
  const items = excerpts.map((excerpt, i) => ({
    evidence: { id: `EV-0${i + 1}`, title: i % 2 === 0 ? 'Tiger reference' : 'Lion reference', excerpt_or_summary: excerpt, url: 'https://en.wikipedia.org/wiki/Tiger' },
    provenance: { source_identity: 'en.wikipedia.org' },
  })) as unknown as ResearchOutcome['merged']['items'];
  return { execution: { status: 'ok' }, merged: { items } } as unknown as ResearchOutcome;
}

describe('open research deliberation', () => {
  it('recognises a natural-language better/or comparison and activates five agents', () => {
    const result = deliberateOpenResearch('Hey which is better tiger or lion?', outcome('The tiger is a large solitary cat. Lions are social cats that live in prides.'));
    expect(result.agents).toHaveLength(5);
    expect(result.agents.map((a) => a.codename)).toEqual(['HERMES', 'ATHENA', 'APOLLO', 'ARES', 'HEPHAESTUS']);
    expect(result.dimensions.some((d) => d.label === 'Social / group behaviour')).toBe(true);
  });

  it("attributes each dimension to whichever side the evidence names alone, or names as ahead in a direct comparison", () => {
    const result = deliberateOpenResearch(
      'Hey which is better tiger or lion?',
      multiItemOutcome([
        'Tigers can outweigh lions by over a hundred pounds and are generally more powerful in a one-on-one fight.',
        'Lions live in prides while tigers are typically solitary.',
      ]),
    );
    const combat = result.dimensions.find((d) => d.label === 'Combat / physical capability');
    const social = result.dimensions.find((d) => d.label === 'Social / group behaviour');
    expect(combat?.winner).toBe('tiger');
    expect(social?.winner).toBe('lion');
    expect(result.headline.toLowerCase()).not.toContain('context-dependent');
  });

  it('does not publish an evidence-backed answer after retrieval failure', () => {
    const failed = { execution: { status: 'search_failed' }, merged: { items: [] } } as unknown as ResearchOutcome;
    const result = deliberateOpenResearch('Which is better tiger or lion?', failed);
    expect(result.headline).toContain('Evidence-dependent');
    expect(result.caveat).toContain('could not establish');
  });
});
