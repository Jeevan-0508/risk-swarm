/**
 * PHASE H - the Council under attack. Every test here is an attempt to make the deliberation layer lie,
 * and asserts that the attempt is either impossible or loudly visible. The distinction matters: some of
 * these properties are structural (there is no code path), and some are detective (SENTINEL blocks). Both
 * are stated as such rather than blurred together.
 *
 * Companion to `attacks.test.ts`, which does the same for the graph and the persistence layer.
 *
 * Note on layering: this file reads files under `src/council` as *text* to assert structural properties
 * of the UI, but imports nothing from there. A core test that imported a UI module would be the very
 * coupling the rest of this project refuses, so mutation detection here is asserted with a canonical
 * JSON comparison rather than by borrowing the Council's own digest (which `replay.test.ts` covers).
 */

/** Order-, content- and citation-sensitive canonical form of a transcript. Local on purpose - see above. */
function canonical(events: DeliberationEvent[]): string {
  return JSON.stringify(
    events.map((e) => [e.id, e.sequence, e.from_agent, e.to_agent, e.type, e.status, e.evidence_ids, e.claim_ids, e.content]),
  );
}
import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { investigate, type RunResult } from '../orchestrator/run';
import { runSentinel } from '../sentinel/sentinel';
import { runPulse } from '../pulse/pulse';
import { runDeliberation } from './coordinator';
import { serializeRun, deserializeRun } from '../persistence/serialize';
import type { DeliberationEvent } from '../domain/model';

const OPTIONS = {
  loader: createFileLoader('public/snapshots'),
  run_id: 'RUN-COUNCIL-ADV',
  now: '2026-09-13T00:00:00.000Z',
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
};

let cached: RunResult | null = null;
async function reference(): Promise<RunResult> {
  cached ??= await investigate({ ...OPTIONS });
  return cached;
}

/** Re-runs SENTINEL over a run whose transcript has been tampered with, and nothing else. */
function sentinelOver(result: RunResult, events: DeliberationEvent[]) {
  return runSentinel({
    graph: result.graph,
    snapshotFiles: result.outputs.scout.snapshot.files,
    deliberationEvents: events,
  });
}

/** The coordinator's own input, rebuilt from a completed run. It takes nothing else. */
function deliberationInput(result: RunResult) {
  return {
    run_id: result.run_id,
    graph: result.graph,
    scout: result.outputs.scout,
    intelligence: result.outputs.intelligence,
    analyst: result.outputs.analyst,
    governance: result.outputs.governance,
    challenger: result.outputs.challenger,
    red_team: result.outputs.red_team,
    decision: result.outputs.decision,
  };
}

describe('attack: fabricate a citation inside the transcript', () => {
  it('is blocked by SENTINEL, by name, when an event cites evidence the graph does not hold', async () => {
    const result = await reference();
    const real = result.deliberation.events;
    const forged: DeliberationEvent[] = [
      ...real,
      { ...real[0], id: 'FORGED-1', sequence: real.length, evidence_ids: ['EV-DOES-NOT-EXIST'] },
    ];
    const check = sentinelOver(result, forged).checks.find((c) => c.key === 'deliberation_integrity')!;
    expect(check.status).toBe('BLOCKED');
    expect(check.detail.includes('UNSUPPORTED CLAIM')).toBe(true);
    expect(check.detail.includes('EV-DOES-NOT-EXIST')).toBe(true);
  });

  it('is blocked just as loudly for a forged claim id as for a forged evidence id', async () => {
    const result = await reference();
    const real = result.deliberation.events;
    const forged: DeliberationEvent[] = [
      { ...real[0], id: 'FORGED-2', claim_ids: ['HYP-INVENTED'] },
      ...real.slice(1),
    ];
    const check = sentinelOver(result, forged).checks.find((c) => c.key === 'deliberation_integrity')!;
    expect(check.status).toBe('BLOCKED');
    expect(check.detail.includes('HYP-INVENTED')).toBe(true);
  });

  it('cannot happen from the coordinator itself: the real transcript passes the same check', async () => {
    const result = await reference();
    const check = result.sentinel.checks.find((c) => c.key === 'deliberation_integrity')!;
    expect(check.status).toBe('VERIFIED');
  });

  it('cites no evidence that no agent cited - the council cannot introduce a source of its own', async () => {
    const result = await reference();
    const agentEvidence = new Set<string>();
    for (const out of Object.values(result.outputs)) {
      for (const id of out.evidence_cited) agentEvidence.add(id);
      for (const id of out.evidence_created) agentEvidence.add(id);
    }
    const cited = new Set(result.deliberation.events.flatMap((e) => e.evidence_ids));
    expect(cited.size > 0).toBe(true);
    for (const id of cited) expect(agentEvidence.has(id)).toBe(true);
  });
});

describe('attack: mutate a sealed event', () => {
  it('is detectable on a single altered character, because the canonical form covers the words', async () => {
    const result = await reference();
    const before = canonical(result.deliberation.events);
    const tampered = result.deliberation.events.map((e, i) =>
      i === 1 ? { ...e, content: `${e.content}!` } : e,
    );
    expect(canonical(tampered)).not.toBe(before);
  });

  it('cannot be laundered through a persistence round trip - what comes back is what went in', async () => {
    const result = await reference();
    const stored = serializeRun(result, {
      mode: 'DEMO', created_at: OPTIONS.now, completed_at: OPTIONS.now, status: 'complete',
      request: null, human: null,
    });
    const back = deserializeRun(JSON.parse(JSON.stringify(stored)));
    expect(back).not.toBe(null);
    expect(canonical(back!.result.deliberation.events)).toBe(canonical(result.deliberation.events));
  });

  it('flipping an unresolved exchange to resolved is visible in PULSE\'s own counts', async () => {
    const result = await reference();
    const real = result.deliberation;
    const honest = runPulse({ ...pulseInput(result), deliberation: real });
    const laundered = {
      ...real,
      events: real.events.map((e) => ({ ...e, status: 'resolved' as const })),
      outcome: 'CONSENSUS' as const,
    };
    const lie = runPulse({ ...pulseInput(result), deliberation: laundered });
    const key = 'deliberation_health';
    const a = honest.checks.find((c) => c.key === key)!;
    const b = lie.checks.find((c) => c.key === key)!;
    // The check reads real counts off the transcript, so the two readings differ. A laundered transcript
    // is not silently accepted as identical to the honest one.
    expect(b.detail).not.toBe(a.detail);
  });
});

function pulseInput(result: RunResult) {
  return {
    intelligence: result.outputs.intelligence,
    governance: result.outputs.governance,
    challenger: result.outputs.challenger,
    red_team: result.outputs.red_team,
    decision: result.outputs.decision,
    policy: result.policy,
    sentinel: result.sentinel,
    spent: result.spent,
  };
}

describe('attack: make the UI author an event', () => {
  it('has no module under src/council that imports the coordinator or the orchestrator', async () => {
    const files = ['Chamber.tsx', 'Council.tsx', 'derive.ts', 'replay.ts', 'capability.ts', 'audio.ts', 'roster.ts'];
    for (const file of files) {
      const imports = (await Bun.file(`src/council/${file}`).text())
        .split('\n')
        .filter((l) => /^\s*import\b/.test(l));
      for (const line of imports) {
        expect(line.includes('deliberation/coordinator')).toBe(false);
        expect(line.includes('runDeliberation')).toBe(false);
        expect(line.includes('orchestrator/run') && !line.includes('import type')).toBe(false);
      }
    }
  });

  it('never constructs a DeliberationEvent: the type is imported as a type in every council module', async () => {
    const files = ['Chamber.tsx', 'derive.ts', 'replay.ts', 'capability.ts', 'audio.ts'];
    for (const file of files) {
      const source = await Bun.file(`src/council/${file}`).text();
      for (const line of source.split('\n')) {
        if (!/^\s*import\b/.test(line)) continue;
        if (!line.includes('DeliberationEvent')) continue;
        // A value import of the zod schema is the only way a UI module could parse an object into an
        // event. Requiring `import type` makes that structurally impossible, not merely discouraged.
        expect(line.includes('import type') || line.includes('type DeliberationEvent')).toBe(true);
      }
      // The two fields every event must have. Their absence as object keys means no literal event exists.
      expect(/\bfrom_agent:\s/.test(source)).toBe(false);
      expect(/\brequires_response:\s/.test(source)).toBe(false);
    }
  });

  it('has no council module that mutates the array it was handed', async () => {
    // The behavioural half of this guarantee - that the UI's only reduction of the transcript is a
    // prefix of the engine's own array - is asserted in `council/derive.test.ts`, which is allowed to
    // import the UI. What is checkable from here is that no council module calls a mutator on it.
    for (const file of ['Chamber.tsx', 'derive.ts', 'replay.ts', 'capability.ts']) {
      const source = await Bun.file(`src/council/${file}`).text();
      for (const mutator of ['.push(', '.splice(', '.unshift(', '.pop(', '.shift(', '.reverse(']) {
        expect(source.includes(`events${mutator}`)).toBe(false);
      }
    }
  });
});

describe('attack: launder a budget cut-off into agreement', () => {
  it('reports LIMIT_REACHED and never a consensus when any budget dimension is exhausted', async () => {
    const result = await reference();
    const input = deliberationInput(result);

    for (const budget of [{ max_events: 3 }, { max_rounds: 1 }, { max_agent_responses: 1 }]) {
      const report = runDeliberation(input, { budget });
      expect(report.outcome).toBe('LIMIT_REACHED');
      expect(report.limited_by).not.toBe(null);
      const terminal = report.events[report.events.length - 1];
      expect(terminal.type).toBe('resolution');
      expect(terminal.status).toBe('unresolved');
      expect(/consensus/i.test(terminal.content)).toBe(false);
    }
  });

  it('always keeps the terminal event, so a cut-off transcript can never simply stop mid-argument', async () => {
    const result = await reference();
    const input = deliberationInput(result);
    for (const max_events of [2, 3, 5, 9, 17]) {
      const report = runDeliberation(input, { budget: { max_events } });
      expect(report.events.length <= max_events).toBe(true);
      expect(report.events[report.events.length - 1].type).toBe('resolution');
    }
  });
});

describe('attack: let the narration change the recommendation', () => {
  it('imports no scoring module, so the coordinator has nothing to recompute a band with', async () => {
    const imports = (await Bun.file('src/core/deliberation/coordinator.ts').text())
      .split('\n')
      .filter((l) => /^\s*import\b/.test(l));
    for (const line of imports) {
      expect(line.includes('scoring/')).toBe(false);
      expect(line.includes('score')).toBe(false);
      expect(line.includes('policy')).toBe(false);
    }
  });

  it('produces the same decision whatever the deliberation budget - the brief is an input, not an output', async () => {
    const result = await reference();
    const input = deliberationInput(result);
    const before = JSON.stringify(result.outputs.decision);
    runDeliberation(input, { budget: { max_events: 4 } });
    runDeliberation(input);
    expect(JSON.stringify(result.outputs.decision)).toBe(before);
  });
});
