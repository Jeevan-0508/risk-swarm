import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from './loader.node';
import { createAtlasMatcher } from './atlas';

const atlas = createAtlasMatcher(createFileLoader('public/snapshots'));

describe('atlas adapter over the real taxonomy', () => {
  it('exposes the upstream model counts it claims to use', async () => {
    const meta = await atlas.meta();
    const patterns = await atlas.patterns();
    expect(patterns).toHaveLength(12);
    expect(meta.indicator_count).toBe(77);
    expect(patterns.reduce((n, p) => n + p.indicators.length, 0)).toBe(77);
    expect(patterns.reduce((n, p) => n + p.false_positives.length, 0)).toBe(31);
    expect(patterns.reduce((n, p) => n + p.countermeasures.length, 0)).toBe(meta.countermeasure_count);
  });

  it('gives every indicator, gate and countermeasure a stable id', async () => {
    const p = await atlas.pattern('FFT-002');
    expect(p.indicators[0].id).toBe('FFT-002-i01');
    expect(p.false_positives[0].id).toBe('FFT-002-fp1');
    expect(p.countermeasures.some((c) => c.id.startsWith('FFT-002-cm-detective-'))).toBe(true);
    expect(new Set(p.indicators.map((i) => i.id)).size).toBe(p.indicators.length);
  });

  it('matches a German fake-carrier headline to the phantom carrier pattern, as a topic only', async () => {
    const matches = await atlas.matchLexical([
      { id: 'S-1', text: 'GPS-Tracker entlarvt Fake-Frachtführer in Köln' },
      { id: 'S-2', text: 'Traditionsspeditionen insolvent: Betz-Pleite zeigt strukturelle Schwächen' },
    ]);
    const phantom = matches.find((m) => m.pattern_id === 'FFT-002');
    expect(phantom).toBeDefined();
    expect(phantom?.item_ids).toEqual(['S-1']);
    expect(phantom?.basis).toBe('lexical_topic_match');
    expect(phantom?.caveat).toContain('not that it occurred');
  });

  it('returns no match rather than a weak one when nothing is mentioned', async () => {
    expect(await atlas.matchLexical([{ id: 'S-1', text: 'Low water levels on the Rhine slow barge traffic' }])).toEqual([]);
  });

  it('orders matches by corroboration and is deterministic', async () => {
    const items = [
      { id: 'S-1', text: 'phantom carrier collected the load' },
      { id: 'S-2', text: 'fake carrier used a scheinfirma' },
      { id: 'S-3', text: 'seal tampering found at delivery' },
    ];
    const a = await atlas.matchLexical(items);
    expect(a[0].pattern_id).toBe('FFT-002');
    expect(JSON.stringify(a)).toBe(JSON.stringify(await atlas.matchLexical(items)));
  });

  it('treats unrecorded indicators as unknown, never as absent', async () => {
    const cov = await atlas.coverage('FFT-002', {});
    expect(cov.coverage).toBe(0);
    expect(cov.completeness).toBe(0);
    expect(cov.unknown_weight).toBe(cov.total_weight);
    expect(cov.absent_weight).toBe(0);
    expect(cov.unknown_indicator_ids).toHaveLength((await atlas.pattern('FFT-002')).indicators.length);
  });

  it('recomputes coverage from indicator weights independently', async () => {
    const p = await atlas.pattern('FFT-001');
    const states = Object.fromEntries(p.indicators.map((i, idx) => [i.id, idx === 0 ? 'present' : idx === 1 ? 'absent' : 'unknown'] as const));
    const cov = await atlas.coverage('FFT-001', states);
    const expectedPresent = p.indicators[0].weight;
    const expectedAbsent = p.indicators[1].weight;
    expect(cov.present_weight).toBe(expectedPresent);
    expect(cov.absent_weight).toBe(expectedAbsent);
    expect(cov.coverage).toBeCloseTo(expectedPresent / p.total_indicator_weight, 4);
    expect(cov.completeness).toBeCloseTo((expectedPresent + expectedAbsent) / p.total_indicator_weight, 4);
    expect(cov.present_weight + cov.absent_weight + cov.unknown_weight).toBe(cov.total_weight);
  });

  it('splits coverage by detection phase so post-event weight is visible', async () => {
    const cov = await atlas.coverage('FFT-001', {});
    const total = (['pre_award', 'in_transit', 'post_event'] as const).reduce((n, ph) => n + cov.by_phase[ph].unknown, 0);
    expect(total).toBe(cov.total_weight);
  });

  it('serves false-positive gates and stage-filtered countermeasures', async () => {
    const gates = await atlas.falsePositiveGates('FFT-001');
    expect(gates.length).toBeGreaterThan(0);
    expect(gates[0].how_to_rule_out.length).toBeGreaterThan(10);
    const detective = await atlas.countermeasures('FFT-001', 'detective');
    expect(detective.every((c) => c.class === 'detective')).toBe(true);
    expect((await atlas.regulatoryHooks('FFT-001')).some((h) => h.instrument === 'CMR Convention')).toBe(true);
  });

  it('refuses an unknown pattern id', async () => {
    await expect(atlas.pattern('FFT-999')).rejects.toThrow(/UNKNOWN_PATTERN/);
  });
});
