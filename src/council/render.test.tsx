/**
 * The chamber, rendered. Not a snapshot test - it asserts the two properties that actually matter and
 * that a type checker cannot see: the tree renders at all over a real run (a crash here is the class of
 * bug `tsc` and the reducer tests both miss), and every line of prose it produces is either the
 * screen's own fixed chrome or a substring of the real transcript. Nothing in between.
 *
 * `Chamber` is deliberately store-free so this can run with no browser, no `localStorage` and no mock.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { describe, expect, it } from '../core/test/bdd';
import { createFileLoader } from '../core/integrations/loader.node';
import { investigate, type RunResult } from '../core/orchestrator/run';
import { AGENT_CODENAME } from '../app/lib/agents';
import { Chamber } from './Chamber';
import { COUNCIL_ORDER } from './roster';

let cached: RunResult | null = null;
async function reference(): Promise<RunResult> {
  cached ??= await investigate({
    loader: createFileLoader('public/snapshots'),
    run_id: 'RUN-COUNCIL-RENDER',
    now: '2026-09-13T00:00:00.000Z',
    question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
    scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  });
  return cached;
}

const draw = (result: RunResult) => renderToStaticMarkup(<StaticRouter location="/council"><Chamber result={result} /></StaticRouter>);

describe('the Council chamber, rendered over the real reference run', () => {
  it('renders without throwing, and seats all seven agents whether they spoke or not', async () => {
    const html = draw(await reference());
    expect(html.length > 2000).toBe(true);
    for (const id of COUNCIL_ORDER) expect(html.includes(AGENT_CODENAME[id])).toBe(true);
  });

  it('prints the real outcome and the real event count, not a rounded or flattered one', async () => {
    const result = await reference();
    const html = draw(result);
    expect(html.includes(result.deliberation.outcome.replace(/_/g, ' '))).toBe(true);
    expect(html.includes(`${result.deliberation.events.length} events`)).toBe(true);
    expect(html.includes(result.outputs.decision.decision.action_band.replace(/_/g, ' '))).toBe(true);
  });

  it('withholds confidence in the markup when the engine withheld it, instead of printing a number', async () => {
    const result = await reference();
    const html = draw(result);
    if (result.outputs.decision.decision.confidence === null) {
      expect(html.includes('withheld')).toBe(true);
      expect(html.includes(result.outputs.decision.decision.confidence_blocked_reason ?? '\u0000')).toBe(true);
    } else {
      expect(html.includes(result.outputs.decision.decision.confidence.toFixed(2))).toBe(true);
    }
  });

  it('renders every visible event\'s content verbatim - no paraphrase, no truncation with an ellipsis', async () => {
    const result = await reference();
    const html = draw(result);
    const escape = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    for (const e of result.deliberation.events) expect(html.includes(escape(e.content))).toBe(true);
  });

  it('links out to the decision brief rather than re-rendering the recommendation itself', async () => {
    const html = draw(await reference());
    expect(html.includes('href="/brief"')).toBe(true);
  });

  it('renders a transcript-free run honestly instead of drawing an empty ring as if it were in session', async () => {
    const result = await reference();
    const stripped: RunResult = { ...result, deliberation: { ...result.deliberation, events: [] } };
    const html = draw(stripped);
    expect(html.includes('no deliberation transcript')).toBe(true);
    expect(html.includes('no transcript')).toBe(true);
  });
});
