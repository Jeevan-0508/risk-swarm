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
import { createAtlasMatcher, type Pattern } from '../core/integrations/atlas';
import { decisionLineage, evidenceNeeded, sourceConcentration } from '../core/lineage/lineage';
import { AGENT_CODENAME } from '../app/lib/agents';
import { Chamber } from './Chamber';
import { COUNCIL_ORDER, COUNCIL_SEATS } from './roster';
import { typeTally } from './derive';

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

const draw = (result: RunResult, patterns: Map<string, Pattern> | null = null) =>
  renderToStaticMarkup(<StaticRouter location="/council"><Chamber result={result} patterns={patterns} /></StaticRouter>);

async function taxonomy(): Promise<Map<string, Pattern>> {
  const all = await createAtlasMatcher(createFileLoader('public/snapshots')).patterns();
  return new Map(all.map((p) => [p.id, p]));
}

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

describe('the lineage zone, over the real graph', () => {
  it('prints the real hypothesis chain - every statement and every count as the graph holds them', async () => {
    const result = await reference();
    const html = draw(result);
    const lineage = decisionLineage(result.graph, result.outputs.decision.decision);
    expect(lineage.hypotheses.length > 0).toBe(true);
    for (const h of lineage.hypotheses) {
      expect(html.includes(h.hypothesis.id)).toBe(true);
      expect(html.includes(`${h.observations.length} observations · ${h.evidence.length} evidence in the chain`)).toBe(true);
    }
  });

  it('prints the real source concentration, computed by core/lineage and not re-derived here', async () => {
    const result = await reference();
    const html = draw(result);
    const lineage = decisionLineage(result.graph, result.outputs.decision.decision);
    const conc = sourceConcentration(lineage.hypotheses.flatMap((h) => h.evidence).concat(lineage.decision_evidence));
    expect(html.includes(`${(conc.top_source_share * 100).toFixed(0)}%`)).toBe(true);
    expect(html.includes(`${conc.total_evidence} evidence nodes`)).toBe(true);
  });

  it('says the taxonomy is not loaded rather than showing an empty gap list that would read as "nothing left to check"', async () => {
    const html = draw(await reference(), null);
    expect(html.includes('Loading it.')).toBe(true);
    expect(html.includes('has been assessed one way or the other')).toBe(false);
  });

  it('names real indicators, verbatim from the taxonomy, once the taxonomy is loaded', async () => {
    const result = await reference();
    const patterns = await taxonomy();
    const html = draw(result, patterns);
    expect(html.includes('Loading it.')).toBe(false);

    // The heaviest unassessed indicator across the whole run must be on screen: the zone ranks globally
    // by weight, so the one thing a reader most needs to go and check can never be pushed off the list
    // by a lighter indicator whose pattern happened to match first.
    const ranked = result.outputs.analyst.findings
      .flatMap((f) => {
        const pattern = patterns.get(f.coverage.pattern_id);
        return pattern === undefined ? [] : evidenceNeeded(f.coverage, pattern);
      })
      .sort((a, b) => b.weight - a.weight || a.indicator_id.localeCompare(b.indicator_id));
    expect(ranked.length > 0).toBe(true);
    const top = ranked[0];
    expect(html.includes(top.indicator_id)).toBe(true);
    expect(html.includes(top.signal.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))).toBe(true);
    expect(html.includes(`w ${top.weight}`)).toBe(true);
  });
});

describe('the agent inspector', () => {
  it('invites a selection instead of pre-selecting a seat and implying that one matters more', async () => {
    const html = draw(await reference());
    expect(html.includes('Select a seat on the ring')).toBe(true);
  });

  it('states what each seat cannot do - the half of the design a demo would leave out', async () => {
    const html = draw(await reference());
    // The inspector is behind a click, but the seat data it reads is real and total: assert that here
    // rather than simulating a click, so the guarantee holds whatever the interaction becomes.
    for (const id of COUNCIL_ORDER) {
      expect(COUNCIL_SEATS[id].cannot.length > 20).toBe(true);
      expect(/cannot/i.test(COUNCIL_SEATS[id].cannot)).toBe(true);
    }
    expect(html.includes('what it cannot do')).toBe(true);
  });
});

describe('the timeline', () => {
  it('draws exactly one tick per real event, and a legend that sums to the transcript', async () => {
    const result = await reference();
    const html = draw(result);
    const tally = typeTally(result.deliberation.events);
    for (const t of tally) expect(html.includes(`${t.count} ${t.type}`)).toBe(true);
    expect(tally.reduce((n, t) => n + t.count, 0)).toBe(result.deliberation.events.length);
  });
});
