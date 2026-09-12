import { describe, expect, it } from '../test/bdd';
import { clusterItems, comparePair, dice, jaccard, recurrenceBuckets, timeBucket, wordShingles, type Clusterable } from './cluster';

const item = (id: string, title: string, source: string, occurred_at: string | null): Clusterable => ({
  id,
  title,
  source_identity: source,
  occurred_at,
});

describe('similarity primitives', () => {
  it('scores identical and disjoint titles at the extremes', () => {
    const a = wordShingles('Major insolvencies hit record in Germany');
    expect(jaccard(a, a)).toBe(1);
    expect(jaccard(a, wordShingles('Cargo theft ring dismantled in Poland'))).toBe(0);
  });

  it('dice rewards shared content tokens', () => {
    expect(dice(new Set(['betz', 'insolvency']), new Set(['betz', 'insolvency', 'germany']))).toBeCloseTo(0.8, 5);
    expect(dice(new Set<string>(), new Set(['x']))).toBe(0);
  });
});

describe('comparePair', () => {
  it('merges the same headline republished by another outlet', () => {
    const v = comparePair(
      item('S-1', 'Betz insolvency exposes structural weaknesses in Germany transport market', 'trans.info', '2026-04-10'),
      item('S-2', 'Betz insolvency exposes structural weaknesses in Germany transport market', 'verkehrsrundschau.de', '2026-04-10'),
    );
    expect(v.same).toBe(true);
    expect(v.reason).toBe('near_duplicate');
  });

  it('merges two outlets reporting one event in different words, within the window', () => {
    const v = comparePair(
      item('S-1', 'Betz insolvency shakes German freight market', 'trans.info', '2026-04-10T08:00:00Z'),
      item('S-2', 'German freight market shaken by Betz insolvency', 'dvz.de', '2026-04-11T09:00:00Z'),
    );
    expect(v.same).toBe(true);
    expect(v.reason).toBe('same_event_candidate');
  });

  it('keeps different events apart even when the vocabulary overlaps', () => {
    const v = comparePair(
      item('S-1', 'Major insolvencies hit record in Germany', 'trans.info', '2026-02-12'),
      item('S-2', 'German freight sector faces insolvency risks', 'trans.info', '2024-11-29'),
    );
    expect(v.same).toBe(false);
  });

  it('will not merge on wording alone when the reports are months apart', () => {
    const v = comparePair(
      item('S-1', 'Betz insolvency shakes German freight market', 'trans.info', '2026-04-10'),
      item('S-2', 'German freight market shaken by Betz insolvency', 'dvz.de', '2025-01-10'),
    );
    expect(v.same).toBe(false);
  });

  it('will not merge when a date is missing, because the window cannot be established', () => {
    const v = comparePair(
      item('S-1', 'Betz insolvency shakes German freight market', 'trans.info', null),
      item('S-2', 'German freight market shaken by Betz insolvency', 'dvz.de', '2026-04-11'),
    );
    expect(v.same).toBe(false);
  });
});

describe('clusterItems', () => {
  const items = [
    item('S-1', 'Betz insolvency exposes structural weaknesses in Germany transport market', 'trans.info', '2026-04-10T07:00:00Z'),
    item('S-2', 'Betz insolvency exposes structural weaknesses in Germany transport market', 'msn-publisher.de', '2026-04-10T11:00:00Z'),
    item('S-3', 'German freight market shaken by Betz insolvency', 'dvz.de', '2026-04-11T09:00:00Z'),
    item('S-4', 'Cargo theft ring dismantled at Hamburg truck stop', 'verkehrsrundschau.de', '2026-04-18T09:00:00Z'),
  ];

  it('collapses a republished headline into one cluster with one independent source', () => {
    const r = clusterItems(items.slice(0, 2));
    expect(r.clusters).toHaveLength(1);
    expect(r.duplicates_removed).toBe(1);
    expect(r.independent_source_count).toBe(1);
    expect(r.clusters[0].source_identities).toHaveLength(2);
    expect(r.clusters[0].reason).toBe('near_duplicate');
  });

  it('reports a near-threshold pair as a possible duplicate instead of silently merging it', () => {
    const r = clusterItems(items.slice(0, 3));
    expect(r.clusters).toHaveLength(2);
    expect(r.possible_duplicate_pairs).toHaveLength(1);
    expect(r.possible_duplicate_pairs[0]).toMatchObject({ a: 'S-1', b: 'S-3' });
    expect(r.independent_source_count).toBe(2);
  });

  it('counts genuinely separate events as separate independent sources', () => {
    const r = clusterItems(items);
    expect(r.clusters).toHaveLength(3);
    expect(r.independent_source_count).toBe(3);
    expect(r.assignment['S-4']).toBe('CL-003');
    expect(r.possible_duplicate_pairs.some((p) => p.b === 'S-4')).toBe(false);
  });

  it('does not inflate independence when one publisher files many stories', () => {
    const r = clusterItems([
      item('S-1', 'Major insolvencies hit record in Germany', 'trans.info', '2026-02-12'),
      item('S-2', 'German freight sector faces insolvency risks', 'trans.info', '2024-11-29'),
      item('S-3', 'Germany truck transport faces structural crisis', 'trans.info', '2025-08-29'),
    ]);
    expect(r.clusters).toHaveLength(3);
    expect(r.independent_source_count).toBe(1);
  });

  it('is deterministic for a given input order', () => {
    expect(JSON.stringify(clusterItems(items))).toBe(JSON.stringify(clusterItems(items)));
  });

  it('handles an empty input without inventing a cluster', () => {
    const r = clusterItems([]);
    expect(r.clusters).toEqual([]);
    expect(r.independent_source_count).toBe(0);
    expect(r.duplicates_removed).toBe(0);
  });
});

describe('recurrence', () => {
  it('buckets by fixed windows and ignores repeated coverage inside one bucket', () => {
    expect(timeBucket('2026-01-01T00:00:00Z')).toBe('B0');
    expect(timeBucket('2026-01-09T00:00:00Z')).toBe('B1');
    expect(timeBucket(null)).toBeNull();
    expect(timeBucket('not-a-date')).toBeNull();
    const r = clusterItems([
      item('S-1', 'Cargo theft at Hamburg truck stop', 'a.de', '2026-01-02T09:00:00Z'),
      item('S-2', 'Trailer stolen near Leipzig depot', 'b.de', '2026-01-05T09:00:00Z'),
      item('S-3', 'Phantom carrier collected load in Bavaria', 'c.de', '2026-03-01T09:00:00Z'),
    ]);
    expect(recurrenceBuckets(r.clusters)).toHaveLength(2);
  });
});
