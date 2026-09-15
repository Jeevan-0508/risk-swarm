import { describe, expect, it } from '../test/bdd';
import { comparisonParts, deliberateOpenResearch } from './open-deliberation';
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

describe('comparisonParts recognises a bare "A or B" and generic "X vs Y", without any domain list', () => {
  it('extracts the two sides of the live Mercury/Jupiter question, typo and all', () => {
    expect(comparisonParts('which planet has largest diameter in solarsyatem mercury or jupiter ?')).toEqual(['mercury', 'jupiter']);
  });

  it('extracts a bare "A or B" with no adjective and no vs/versus', () => {
    expect(comparisonParts('tiger or lion')).toEqual(['tiger', 'lion']);
    expect(comparisonParts('iPhone or Samsung')).toEqual(['iPhone', 'Samsung']);
  });

  it('extracts a bare "A or B" followed by a prepositional phrase, not just at the end of the sentence', () => {
    expect(comparisonParts('Germany or France for GDP')).toEqual(['Germany', 'France']);
  });

  it('keeps working on generic "X vs Y" for names this system has never seen before', () => {
    expect(comparisonParts('Tesla vs BMW')).toEqual(['Tesla', 'BMW']);
    expect(comparisonParts('Bitcoin vs gold')).toEqual(['Bitcoin', 'gold']);
    expect(comparisonParts('John Cena vs Undertaker')).toEqual(['John Cena', 'Undertaker']);
  });

  it('does not treat an incidental "or" in an ordinary sentence as a comparison', () => {
    expect(comparisonParts('should I email John or call him instead')).toBe(null);
    expect(comparisonParts('What is the capital of Germany?')).toBe(null);
  });
});

describe('the legacy decision layer agrees with the new intent classifier instead of contradicting it', () => {
  const planets = (excerpts: string[]) =>
    ({
      execution: { status: 'ok' },
      merged: { items: excerpts.map((excerpt, i) => ({
        evidence: { id: `EV-0${i + 1}`, title: i === 0 ? 'Jupiter' : 'Mercury', excerpt_or_summary: excerpt, url: 'https://en.wikipedia.org/wiki/Jupiter' },
        provenance: { source_identity: 'en.wikipedia.org' },
      })) },
    }) as unknown as ResearchOutcome;

  it('no longer says the live Mercury/Jupiter question is an unsupported comparison shape', () => {
    const result = deliberateOpenResearch(
      'which planet has largest diameter in solarsyatem mercury or jupiter ?',
      planets(['Jupiter is the largest planet in the Solar System by diameter.', 'Mercury is the smallest planet in the Solar System.']),
    );
    expect(result.dimensions.some((d) => d.reason.includes('not a supported comparison shape'))).toBe(false);
  });

  it('still does not fabricate a winner for a recognised comparison when the evidence does not establish one - an evidence gap is reported, not invented', () => {
    const result = deliberateOpenResearch(
      'which planet has largest diameter in solarsyatem mercury or jupiter ?',
      planets(['Jupiter is the largest planet in the Solar System by diameter.', 'Mercury is the smallest planet in the Solar System.']),
    );
    expect(result.dimensions.every((d) => d.winner === 'context-dependent' || d.winner === 'evidence-dependent')).toBe(true);
    expect(result.dimensions.some((d) => d.reason.includes('does not establish a single objective winner'))).toBe(true);
  });

  it('recognises a bare "tiger or lion" comparison and still resolves per-dimension winners from directional evidence', () => {
    const result = deliberateOpenResearch(
      'tiger or lion',
      multiItemOutcome([
        'Tigers can outweigh lions by over a hundred pounds and are generally more powerful in a one-on-one fight.',
        'Lions live in prides while tigers are typically solitary.',
      ]),
    );
    expect(result.dimensions.some((d) => d.reason.includes('not a supported comparison shape'))).toBe(false);
  });

  it('keeps rejecting a genuinely non-comparative question as an unsupported comparison shape', () => {
    const result = deliberateOpenResearch('What is the capital of Germany?', outcome('Berlin is the capital of Germany.'));
    expect(result.dimensions.some((d) => d.reason.includes('not a supported comparison shape'))).toBe(true);
  });

  it('preserves an already-working generic "X vs Y" freight comparison unchanged', () => {
    const result = deliberateOpenResearch(
      'Carrier A vs Carrier B',
      outcome('Carrier A reported a 98% on-time delivery rate this quarter.'),
    );
    expect(result.dimensions.some((d) => d.reason.includes('not a supported comparison shape'))).toBe(false);
  });

  it('does not need the question rewritten or corrected to recognise the comparison - the exact original wording, typo included, is what is matched', () => {
    const LIVE = 'which planet has largest diameter in solarsyatem mercury or jupiter ?';
    expect(comparisonParts(LIVE)).toEqual(['mercury', 'jupiter']);
    expect(comparisonParts(LIVE.replace('solarsyatem', 'solar system'))).toEqual(['mercury', 'jupiter']);
  });
});
