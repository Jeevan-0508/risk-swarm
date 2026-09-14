import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { investigate } from '../orchestrator/run';
import { deserializeRun, memoryStore, serializeRun, webStorageStore, STORE_VERSION } from './serialize';

const NOW = '2026-09-13T00:00:00.000Z';
const ENVELOPE = { mode: 'SNAPSHOT', created_at: NOW, completed_at: NOW, status: 'complete', request: null, human: null };

const run = () =>
  investigate({
    loader: createFileLoader('public/snapshots'),
    run_id: 'RUN-P',
    now: NOW,
    question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
    scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
  });

class FakeStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

describe('run persistence', () => {
  it('round-trips a run without losing a node, an edge or a verdict', async () => {
    const r = await run();
    const back = deserializeRun(JSON.parse(JSON.stringify(serializeRun(r, ENVELOPE))));
    expect(back).not.toBeNull();
    expect(back!.result.graph.all().length).toBe(r.graph.all().length);
    expect(back!.result.graph.edges().length).toBe(r.graph.edges().length);
    expect(back!.result.outputs.decision.decision.action_band).toBe(r.outputs.decision.decision.action_band);
    expect(back!.result.outputs.decision.decision.confidence).toBeNull();
  });

  it('keeps the rehydrated graph append-only rather than handing back a plain object', async () => {
    const r = await run();
    const back = deserializeRun(serializeRun(r, ENVELOPE))!;
    expect(back.result.graph.isIntact()).toBe(true);
    expect(back.result.graph.cycles().length).toBe(0);
    expect(() => back.result.graph.add(back.result.graph.all()[0]!)).toThrow();
  });

  it('discards a record it cannot validate instead of repairing it', () => {
    expect(deserializeRun({ store_version: STORE_VERSION })).toBeNull();
    expect(deserializeRun(null)).toBeNull();
    expect(deserializeRun({ ...{}, store_version: 99 })).toBeNull();
  });

  it('round-trips SENTINEL\'s own report rather than dropping it silently', async () => {
    const r = await run();
    const back = deserializeRun(serializeRun(r, ENVELOPE))!;
    expect(back.result.sentinel.status).toBe(r.sentinel.status);
    expect(back.result.sentinel.checks.length).toBe(r.sentinel.checks.length);
  });

  it('keeps a record written before completion was tracked, with the stamp left null', async () => {
    const r = await run();
    const record = serializeRun(r, ENVELOPE) as Record<string, unknown>;
    delete record.completed_at;
    const back = deserializeRun(record);
    expect(back).not.toBeNull();
    expect(back!.record.completed_at).toBeNull();
  });

  it('round-trips the completion stamp beside the ask, so a duration can be read back', async () => {
    const r = await run();
    const back = deserializeRun(serializeRun(r, { ...ENVELOPE, completed_at: '2026-09-13T00:00:05.000Z' }))!;
    expect(back.record.created_at).toBe(NOW);
    expect(back.record.completed_at).toBe('2026-09-13T00:00:05.000Z');
  });

  it('drops a pre-SENTINEL record instead of rendering it with a missing field', async () => {
    const r = await run();
    const record = serializeRun(r, ENVELOPE) as Record<string, unknown>;
    delete record.sentinel;
    const stale = { ...record, store_version: 1 };
    expect(deserializeRun(stale)).toBeNull();
  });

  it('round-trips PULSE\'s own report rather than dropping it silently', async () => {
    const r = await run();
    const back = deserializeRun(serializeRun(r, ENVELOPE))!;
    expect(back.result.pulse.status).toBe(r.pulse.status);
    expect(back.result.pulse.checks.length).toBe(r.pulse.checks.length);
  });

  it('drops a pre-PULSE record instead of rendering it with a missing field', async () => {
    const r = await run();
    const record = serializeRun(r, ENVELOPE) as Record<string, unknown>;
    delete record.pulse;
    const stale = { ...record, store_version: 2 };
    expect(deserializeRun(stale)).toBeNull();
  });

  it('round-trips the Council\'s own transcript rather than dropping it silently', async () => {
    const r = await run();
    const back = deserializeRun(serializeRun(r, ENVELOPE))!;
    expect(back.result.deliberation.outcome).toBe(r.deliberation.outcome);
    expect(back.result.deliberation.events.length).toBe(r.deliberation.events.length);
  });

  it('drops a pre-Council record instead of rendering it with a missing field', async () => {
    const r = await run();
    const record = serializeRun(r, ENVELOPE) as Record<string, unknown>;
    delete record.deliberation;
    const stale = { ...record, store_version: 3 };
    expect(deserializeRun(stale)).toBeNull();
  });

  it('round-trips the pack and the participation record, so an abstention survives a reload', async () => {
    const r = await run();
    const back = deserializeRun(serializeRun(r, ENVELOPE))!;
    expect(back.result.pack).toEqual(r.pack);
    expect(back.result.participation).toEqual(r.participation);
  });

  it('drops a pre-pack record instead of rendering it with a missing field', async () => {
    const r = await run();
    const record = serializeRun(r, ENVELOPE) as Record<string, unknown>;
    delete record.pack;
    delete record.participation;
    const stale = { ...record, store_version: 4 };
    expect(deserializeRun(stale)).toBeNull();
  });

  /**
   * The guard that should have existed already. `deserializeRun` casts its way to a `RunResult`, so when
   * `pack` and `participation` were added to the engine the compiler said nothing and the rehydrated
   * object quietly lost two required fields - which blanked the Council on any reloaded run. Enumerating
   * the real result's own keys means the next field added to `RunResult` fails here, loudly, instead of
   * on a screen.
   */
  it('rehydrates every top-level field a real RunResult has - no field can be added and forgotten', async () => {
    const r = await run();
    const back = deserializeRun(serializeRun(r, ENVELOPE))!;
    const missing = Object.keys(r).filter((k) => (back.result as unknown as Record<string, unknown>)[k] === undefined);
    expect(missing).toEqual([]);
  });

  it('drops a corrupt row from web storage without taking the good ones with it', async () => {
    const r = await run();
    const storage = new FakeStorage();
    const store = webStorageStore(storage);
    store.save(serializeRun(r, ENVELOPE));
    storage.setItem('risk-swarm:run:BROKEN', '{not json');
    storage.setItem('risk-swarm:run:WRONG', JSON.stringify({ store_version: 1 }));
    const rows = store.list();
    expect(rows.length).toBe(1);
    expect(rows[0]!.run_id).toBe('RUN-P');
    expect(storage.getItem('risk-swarm:run:BROKEN')).toBeNull();
  });

  it('records the human ruling separately from the system recommendation', async () => {
    const r = await run();
    const record = serializeRun(r, { ...ENVELOPE, human: { verdict: 'overridden', band: 'ESCALATE', note: 'known offender', at: NOW } });
    const back = deserializeRun(record)!;
    expect(back.record.human!.band).toBe('ESCALATE');
    expect(back.result.outputs.decision.decision.action_band).toBe('MONITOR');
  });

  it('replaces a run in place on re-save and removes it on request', async () => {
    const r = await run();
    const store = memoryStore();
    store.save(serializeRun(r, ENVELOPE));
    store.save(serializeRun(r, { ...ENVELOPE, status: 'stopped' }));
    expect(store.list().length).toBe(1);
    expect(store.list()[0]!.status).toBe('stopped');
    store.remove('RUN-P');
    expect(store.list().length).toBe(0);
  });
});
