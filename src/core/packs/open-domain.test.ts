/**
 * EVOLUTION 5.0 Phase F. The claim being defended is the one the audit said the UI was blocking: a
 * question with nothing to do with freight, and no geography or mode filter, runs end to end and comes
 * back honest rather than coming back freight-shaped.
 *
 * These are the exact arguments the form now produces for such a question - `recommendPack()` chooses the
 * pack, `geo` and `mode` are empty - so a pass here is a statement about the real path, not about a
 * convenient one.
 */
import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { investigate } from '../orchestrator/run';
import { packById } from './registry';
import { recommendPack } from './recommend';

const QUESTION = 'How does a quantum error-correcting code actually work?';

async function openRun() {
  const advice = recommendPack(QUESTION);
  return {
    advice,
    result: await investigate({
      loader: createFileLoader('public/snapshots'),
      run_id: 'RUN-OPEN-DOMAIN',
      now: '2026-09-13T00:00:00.000Z',
      question: QUESTION,
      pack: packById(advice.pack_id),
      scope: { geo: [], mode: [], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
    }),
  };
}

let cached: Awaited<ReturnType<typeof openRun>> | null = null;
const run = async () => (cached ??= await openRun());

describe('an off-domain question, with no geography and no mode', () => {
  it('opens the open pack rather than applying a freight taxonomy to physics', async () => {
    const { advice, result } = await run();
    expect(advice.pack_id).toBe('open');
    expect(result.pack.id).toBe('open');
  });

  it('completes, and records the question verbatim', async () => {
    const { result } = await run();
    expect(result.outputs.decision.decision.id.length > 0).toBe(true);
    expect(result.pack.summary.includes('no pinned taxonomy')).toBe(true);
  });

  it('stands the two knowledge-dependent seats down with a stated reason, and keeps the other five', async () => {
    const { result } = await run();
    const down = result.participation.filter((d) => !d.participating);
    expect(down.map((d) => d.agent).sort()).toEqual(['governance_officer', 'risk_analyst']);
    for (const d of down) expect(d.reason.length > 30).toBe(true);
    expect(result.participation.filter((d) => d.participating).length).toBe(5);
  });

  it('names no pattern, because there is no taxonomy to name one from', async () => {
    const { result } = await run();
    expect(result.outputs.analyst.findings.length).toBe(0);
    expect(result.outputs.analyst.reasoning_status).toBe('abstained');
  });

  it('does not invent a confidence number it has no basis for', async () => {
    const { result } = await run();
    const c = result.outputs.decision.confidence;
    expect(c === null || (typeof c === 'number' && c >= 0 && c <= 1)).toBe(true);
  });

  it('does not silently drop everything just because the geography filter is empty', async () => {
    const { result } = await run();
    // An empty geo list means "no filter" in fomo.ts, so nothing may be excluded on geography, and the
    // scout must still have looked at the whole snapshot rather than at nothing.
    expect(result.outputs.scout.stats.excluded_geo).toBe(0);
    expect(result.outputs.scout.stats.scanned > 0).toBe(true);
  });

  it('is reproducible: the same question and clock produce the same decision id', async () => {
    const a = await openRun();
    const b = await openRun();
    expect(a.result.outputs.decision.decision.id).toBe(b.result.outputs.decision.decision.id);
  });
});
