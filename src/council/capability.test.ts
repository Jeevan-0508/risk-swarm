/**
 * The command bar, tested for the property that makes it safe to ship: it either reads real data or it
 * says `Capability unavailable.` There is no third behaviour, and no answer is ever composed from
 * anything other than this run's own stored output.
 */
import { describe, expect, it } from '../core/test/bdd';
import { createFileLoader } from '../core/integrations/loader.node';
import { investigate, type RunResult } from '../core/orchestrator/run';
import { createAtlasMatcher, type Pattern } from '../core/integrations/atlas';
import { AGENT_CODENAME, AGENT_ORDER } from '../app/lib/agents';
import { COMMAND_HELP, UNAVAILABLE, routeCommand } from './capability';
import { transcriptDigest } from './replay';

let cached: RunResult | null = null;
async function reference(): Promise<RunResult> {
  cached ??= await investigate({
    loader: createFileLoader('public/snapshots'),
    run_id: 'RUN-COUNCIL-CMD',
    now: '2026-09-13T00:00:00.000Z',
    question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
    scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  });
  return cached;
}

async function ctx(withPatterns = false) {
  const result = await reference();
  let patterns: Map<string, Pattern> | null = null;
  if (withPatterns) {
    const all = await createAtlasMatcher(createFileLoader('public/snapshots')).patterns();
    patterns = new Map(all.map((p) => [p.id, p]));
  }
  return { result, patterns };
}

describe('anything the router cannot really do is refused, in those exact words', () => {
  it('refuses an unknown verb, an empty line and whitespace alike', async () => {
    const c = await ctx();
    for (const input of ['', '   ', 'summarise', 'explain why', 'predict the loss', 'sudo escalate', 'why']) {
      const out = routeCommand(input, c);
      expect(out.kind).toBe('unavailable');
      if (out.kind === 'unavailable') expect(out.message).toBe('Capability unavailable.');
    }
    expect(UNAVAILABLE).toBe('Capability unavailable.');
  });

  it('refuses a known verb with a missing or nonsense argument rather than guessing one', async () => {
    const c = await ctx();
    for (const input of ['who', 'who nobody', 'find', 'node', 'goto', 'goto -1', 'goto abc', 'goto 99999']) {
      expect(routeCommand(input, c).kind).toBe('unavailable');
    }
  });

  it('never answers a refusal with anything but the fixed message - no hint, no partial result', async () => {
    const c = await ctx();
    const out = routeCommand('forecast', c);
    expect(out).toEqual({ kind: 'unavailable', message: UNAVAILABLE });
  });
});

describe('every answer is a projection of this run\'s own stored output', () => {
  it('reports the outcome, event count and round count the coordinator actually recorded', async () => {
    const c = await ctx();
    const out = routeCommand('outcome', c);
    expect(out.kind).toBe('answer');
    if (out.kind !== 'answer') return;
    const text = out.lines.join('\n');
    expect(text.includes(c.result.deliberation.outcome.replace(/_/g, ' '))).toBe(true);
    expect(text.includes(`${c.result.deliberation.events.length} exchanges`)).toBe(true);
    expect(text.includes(`${c.result.deliberation.rounds_used} rounds`)).toBe(true);
  });

  it('reports the band and withholds confidence exactly as the engine did', async () => {
    const c = await ctx();
    const d = c.result.outputs.decision.decision;
    const out = routeCommand('band', c);
    if (out.kind !== 'answer') throw new Error('expected an answer');
    const text = out.lines.join('\n');
    expect(text.includes(d.action_band.replace(/_/g, ' '))).toBe(true);
    expect(text.includes(d.headline_risk)).toBe(true);
    if (d.confidence === null) {
      expect(text.includes('confidence withheld')).toBe(true);
      expect(/confidence 0\./.test(text)).toBe(false);
    } else {
      expect(text.includes(d.confidence.toFixed(2))).toBe(true);
    }
  });

  it('prints every unresolved objection verbatim, and never summarises them away', async () => {
    const c = await ctx();
    const open = c.result.outputs.decision.decision.unresolved_objections;
    const out = routeCommand('objections', c);
    if (out.kind !== 'answer') throw new Error('expected an answer');
    if (open.length === 0) {
      expect(out.lines).toEqual(['No objection was left unresolved.']);
    } else {
      expect(out.lines).toEqual(open);
    }
  });

  it('answers `who` for all seven seats, and says the decision engine casts no position', async () => {
    const c = await ctx();
    for (const id of AGENT_ORDER) {
      const byId = routeCommand(`who ${id}`, c);
      const byCodename = routeCommand(`who ${AGENT_CODENAME[id]}`, c);
      expect(byId.kind).toBe('answer');
      expect(JSON.stringify(byCodename)).toBe(JSON.stringify(byId));
      if (byId.kind !== 'answer') continue;
      expect(byId.lines[0].includes(AGENT_CODENAME[id])).toBe(true);
      expect(byId.lines.some((l) => l.startsWith('cannot: '))).toBe(true);
    }
    const engine = routeCommand('who hephaestus', c);
    if (engine.kind !== 'answer') throw new Error('expected an answer');
    expect(engine.lines.some((l) => l.includes('Casts no position'))).toBe(true);
  });

  it('finds only exchanges that really contain the text, and says so plainly when none do', async () => {
    const c = await ctx();
    const first = c.result.deliberation.events[0];
    const word = first.content.split(/\s+/).find((w) => w.length > 5) ?? first.content;
    const hit = routeCommand(`find ${word}`, c);
    if (hit.kind !== 'answer') throw new Error('expected an answer');
    const expected = c.result.deliberation.events.filter((e) => e.content.toLowerCase().includes(word.toLowerCase()));
    expect(hit.lines.length).toBe(expected.length);

    const miss = routeCommand('find zzzznotinthetranscript', c);
    if (miss.kind !== 'answer') throw new Error('expected an answer');
    expect(miss.lines.length).toBe(1);
    expect(miss.lines[0].includes('Nothing in the transcript')).toBe(true);
  });

  it('looks a node up in the real graph, and reports a miss as a miss', async () => {
    const c = await ctx();
    const node = c.result.graph.all()[0];
    const found = routeCommand(`node ${node.id}`, c);
    if (found.kind !== 'answer') throw new Error('expected an answer');
    expect(found.lines[0].includes(node.id)).toBe(true);
    expect(found.lines[0].includes(node.kind)).toBe(true);

    const missing = routeCommand('node NODE-THAT-DOES-NOT-EXIST', c);
    if (missing.kind !== 'answer') throw new Error('expected an answer');
    expect(missing.lines[0].includes('No node with id')).toBe(true);
  });

  it('says the taxonomy is not loaded rather than reporting no gaps, then names real indicators once it is', async () => {
    const without = routeCommand('gaps', await ctx(false));
    if (without.kind !== 'answer') throw new Error('expected an answer');
    expect(without.lines[0].includes('not loaded')).toBe(true);

    const c = await ctx(true);
    const with_ = routeCommand('gaps', c);
    if (with_.kind !== 'answer') throw new Error('expected an answer');
    expect(with_.lines[0].includes('not loaded')).toBe(false);
    const weights = with_.lines.map((l) => Number.parseInt(l.replace(/^w/, ''), 10));
    for (let i = 1; i < weights.length; i += 1) expect(weights[i - 1] >= weights[i]).toBe(true);
  });

  it('reports the digest that replay.ts computes, and labels it non-cryptographic', async () => {
    const c = await ctx();
    const out = routeCommand('digest', c);
    if (out.kind !== 'answer') throw new Error('expected an answer');
    expect(out.lines[0]).toBe(transcriptDigest(c.result.deliberation.events));
    expect(out.lines[1].includes('non-cryptographic')).toBe(true);
  });

  it('lists only verbs it really implements, and every one of them answers', async () => {
    const c = await ctx(true);
    const verbs = COMMAND_HELP.map((l) => l.split(/\s+/)[0]);
    expect(verbs.length > 10).toBe(true);
    const args: Record<string, string> = { who: 'ares', find: 'a', node: c.result.graph.all()[0].id, goto: '0' };
    for (const verb of verbs) {
      const out = routeCommand(`${verb} ${args[verb] ?? ''}`.trim(), c);
      expect(out.kind).not.toBe('unavailable');
    }
  });
});

describe('the router is read-only', () => {
  it('moves the cursor only to a real exchange, and changes nothing else', async () => {
    const c = await ctx();
    const before = JSON.stringify(c.result.deliberation.events);
    const out = routeCommand('goto 3', c);
    expect(out.kind).toBe('cursor');
    if (out.kind === 'cursor') {
      expect(out.cursor).toBe(3);
      expect(out.lines[0].includes(c.result.deliberation.events[3].content)).toBe(true);
    }
    expect(JSON.stringify(c.result.deliberation.events)).toBe(before);
  });

  it('is deterministic: the same command over the same run answers identically twice', async () => {
    const c = await ctx(true);
    for (const input of ['outcome', 'band', 'count', 'sources', 'lineage', 'gaps', 'open', 'gates']) {
      expect(JSON.stringify(routeCommand(input, c))).toBe(JSON.stringify(routeCommand(input, c)));
    }
  });
});
