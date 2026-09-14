import { describe, expect, it } from 'vitest';
import { deliberateOpenResearch } from './open-deliberation';
import type { ResearchOutcome } from './session';

function outcome(excerpt: string): ResearchOutcome {
  const evidence = {
    evidence: { id: 'EV-01', title: 'Animal reference', excerpt },
    provenance: { source_identity: 'en.wikipedia.org', url: 'https://en.wikipedia.org/wiki/Tiger' },
  } as ResearchOutcome['merged']['items'][number];
  return {
    execution: { status: 'ok' },
    merged: { items: [evidence] },
  } as unknown as ResearchOutcome;
}

describe('open research deliberation', () => {
  it('recognises a natural-language better/or comparison and activates five agents', () => {
    const result = deliberateOpenResearch('Hey which is better tiger or lion?', outcome('The tiger is a large solitary cat. Lions are social cats that live in prides.'));
    expect(result.agents).toHaveLength(5);
    expect(result.agents.map((a) => a.codename)).toEqual(['HERMES', 'ATHENA', 'APOLLO', 'ARES', 'HEPHAESTUS']);
    expect(result.dimensions.some((d) => d.label === 'Social / group behaviour')).toBe(true);
  });

  it('does not publish an evidence-backed answer after retrieval failure', () => {
    const failed = { execution: { status: 'search_failed' }, merged: { items: [] } } as unknown as ResearchOutcome;
    const result = deliberateOpenResearch('Which is better tiger or lion?', failed);
    expect(result.headline).toContain('Evidence-dependent');
    expect(result.caveat).toContain('could not establish');
  });
});
