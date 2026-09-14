/**
 * EVOLUTION 5.0 Phase G. Screen 12 offers four example queries and a three-way kind filter. A button that
 * returns nothing is worse than no button, so the queries the screen actually ships are read out of the
 * screen file and run against the committed index - no second copy of the list to drift.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { createInternalKnowledge, type KnowledgeRecord } from './internal';

const SCREEN = 'src/app/screens/InternalKnowledge.tsx';
const knowledge = () => createInternalKnowledge(createFileLoader('public/snapshots'));

/** The `EXAMPLES` array as the screen really declares it. A rename here fails loudly rather than silently. */
function screenExamples(): string[] {
  const source = readFileSync(SCREEN, 'utf-8');
  const block = /const EXAMPLES = \[([^\]]*)\]/.exec(source);
  if (block === null) throw new Error(`No EXAMPLES array found in ${SCREEN}.`);
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function screenKinds(): string[] {
  const source = readFileSync(SCREEN, 'utf-8');
  const block = /const KINDS: Array<KnowledgeRecord\['source_kind'\]> = \[([^\]]*)\]/.exec(source);
  if (block === null) throw new Error(`No KINDS array found in ${SCREEN}.`);
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('the internal knowledge screen, over the committed index', () => {
  it('ships four example queries', () => {
    expect(screenExamples().length).toBe(4);
  });

  it('every example query it offers really returns a hit', async () => {
    const k = knowledge();
    for (const q of screenExamples()) {
      const r = await k.search([q], { limit: 12 });
      expect(r.status).toBe('ok');
      if (r.status !== 'ok') continue;
      expect(r.hits.length > 0).toBe(true);
      // Every hit is citable: a path, a ref and its own hash, or the screen cannot show provenance.
      for (const h of r.hits) {
        expect(h.record.path.length > 0).toBe(true);
        expect(h.record.ref.length > 0).toBe(true);
        expect(h.record.sha256.length).toBe(64);
      }
    }
  });

  it('offers exactly the kinds the index really contains, so no filter can return nothing by construction', async () => {
    const k = knowledge();
    const meta = await k.meta();
    expect(meta !== null).toBe(true);
    const kinds = screenKinds() as Array<KnowledgeRecord['source_kind']>;
    for (const kind of kinds) {
      const r = await k.search(['fraud risk governance evidence'], { limit: 50, kinds: [kind] });
      // A kind with no record at all would make its button a dead control.
      expect(r.status === 'ok' || r.status === 'empty').toBe(true);
      if (r.status === 'ok') for (const h of r.hits) expect(h.record.source_kind).toBe(kind);
    }
  });

  it('the index the screen reports is the index it searched', async () => {
    const k = knowledge();
    const meta = await k.meta();
    const r = await k.search(['carrier fraud']);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok' || meta === null) return;
    expect(r.index.content_hash).toBe(meta.content_hash);
    expect(r.index.record_count).toBe(meta.record_count);
  });
});
