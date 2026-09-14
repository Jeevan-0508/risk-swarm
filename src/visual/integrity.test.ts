/**
 * EVOLUTION 5.0 Phase J. A ring can lie in exactly two ways: by drawing a check that the report did not
 * produce, and by drawing a health the report did not state. Both are tested here against fixtures, and
 * then against the real SENTINEL and PULSE reports of the reference run - because a fixture proves the
 * reduction's arithmetic, never that it matches what the engine actually emits.
 */
import { describe, expect, it } from '../core/test/bdd';
import { createFileLoader } from '../core/integrations/loader.node';
import { investigate } from '../core/orchestrator/run';
import { MATERIAL_DIFF_KEYS } from '../core/orbit/orbit';
import { overallStatus, type IntegrityStatus } from '../core/status';
import { arcPath, driftModel, integrityModel, STATUS_ACCENT, type DiffFieldLike, type IntegrityCheckLike } from './integrity';

const check = (key: string, status: IntegrityStatus): IntegrityCheckLike => ({
  key,
  label: key.replace(/_/g, ' '),
  status,
  detail: `detail for ${key}`,
});

const REFERENCE = {
  run_id: 'RUN-VISUAL-J',
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  scope: {
    geo: ['DE', 'AT', 'CH'],
    mode: ['road'],
    from: '2024-09-01T00:00:00.000Z',
    to: '2026-09-01T00:00:00.000Z',
  },
  now: '2026-09-13T00:00:00.000Z',
};

describe('the integrity ring model', () => {
  it('draws exactly one segment per check, in report order', () => {
    const model = integrityModel([check('a', 'VERIFIED'), check('b', 'WARNING'), check('c', 'BLOCKED')]);
    expect(model.segments.map((s) => s.key)).toEqual(['a', 'b', 'c']);
    expect(model.counts).toEqual({ VERIFIED: 1, WARNING: 1, BLOCKED: 1 });
    expect(model.severity).toBe(2);
  });

  it('gives every check an equal arc, so no check is drawn as more important than another', () => {
    const model = integrityModel([check('a', 'VERIFIED'), check('b', 'VERIFIED'), check('c', 'VERIFIED'), check('d', 'VERIFIED')]);
    const sweeps = new Set(model.segments.map((s) => s.sweep));
    expect(sweeps.size).toBe(1);
    expect(model.segments[1].start - model.segments[0].start).toBe(90);
  });

  it('reports an empty ring as unchecked rather than clean', () => {
    const model = integrityModel([]);
    expect(model.segments).toEqual([]);
    expect(model.emptyReason).not.toBe(null);
    expect(model.severity).toBe(0);
  });

  it('prefers the report\'s own overall status over recomputing one', () => {
    const model = integrityModel([check('a', 'VERIFIED')], 'BLOCKED');
    expect(model.status).toBe('BLOCKED');
  });

  it('folds to the same status the core folder would, when none is given', () => {
    const checks = [check('a', 'VERIFIED'), check('b', 'WARNING')];
    expect(integrityModel(checks).status).toBe(overallStatus(checks.map((c) => c.status)));
  });

  it('gives each of the three statuses its own accent, and no other', () => {
    const accents = Object.values(STATUS_ACCENT);
    expect(new Set(accents).size).toBe(3);
    expect(Object.keys(STATUS_ACCENT).sort()).toEqual(['BLOCKED', 'VERIFIED', 'WARNING']);
  });

  it('emits a valid single-arc path with no NaN, at any angle', () => {
    for (const start of [0, 90, 179, 181, 359]) {
      const d = arcPath(100, 100, 80, start, 40);
      expect(d.includes('NaN')).toBe(false);
      expect(d.startsWith('M ')).toBe(true);
    }
  });
});

describe('the drift model', () => {
  const fields: DiffFieldLike[] = [
    { key: 'action_band', label: 'action band', baseline: 'MONITOR', stressed: 'ESCALATE', changed: true },
    { key: 'confidence', label: 'confidence', baseline: 'withheld', stressed: 'withheld', changed: false },
    { key: 'disagreement_index', label: 'disagreement index', baseline: '10', stressed: '40', changed: true },
  ];

  it('measures drift over material fields only', () => {
    const model = driftModel(fields, ['action_band', 'confidence']);
    expect(model.material_count).toBe(2);
    expect(model.material_changed).toBe(1);
    expect(model.drift).toBe(0.5);
  });

  it('marks a changed informational field without letting it move the drift figure', () => {
    const model = driftModel(fields, ['confidence']);
    expect(model.drift).toBe(0);
    expect(model.lanes.find((l) => l.key === 'disagreement_index')?.changed).toBe(true);
    expect(model.lanes.find((l) => l.key === 'disagreement_index')?.material).toBe(false);
  });

  it('says there is nothing to measure rather than reporting zero drift, when no material field was compared', () => {
    const model = driftModel(fields, []);
    expect(model.drift).toBe(null);
    expect(model.note.includes('no field a human would act on')).toBe(true);
  });

  it('keeps every field as a lane, changed or not', () => {
    expect(driftModel(fields, MATERIAL_DIFF_KEYS).lanes.map((l) => l.key)).toEqual(fields.map((f) => f.key));
  });
});

describe('the ring over the real reference run', () => {
  it('matches SENTINEL and PULSE as the engine actually emitted them', async () => {
    const result = await investigate({ ...REFERENCE, loader: createFileLoader('public/snapshots') });

    for (const report of [result.sentinel, result.pulse]) {
      const model = integrityModel(report.checks, report.status);
      expect(model.segments.length).toBe(report.checks.length);
      expect(model.segments.map((s) => s.key)).toEqual(report.checks.map((c) => c.key));
      expect(model.status).toBe(report.status);
      expect(model.counts.VERIFIED + model.counts.WARNING + model.counts.BLOCKED).toBe(report.checks.length);
      expect(model.severity).toBe(report.checks.filter((c) => c.status !== 'VERIFIED').length);
      expect(model.emptyReason).toBe(null);
      for (const segment of model.segments) {
        expect(segment.detail).toBe(report.checks.find((c) => c.key === segment.key)!.detail);
      }
    }
  });

  it('reads the same material keys ORBIT uses for its own verdict', () => {
    expect(MATERIAL_DIFF_KEYS.length > 0).toBe(true);
    expect(MATERIAL_DIFF_KEYS.includes('action_band')).toBe(true);
    expect(MATERIAL_DIFF_KEYS.includes('disagreement_index')).toBe(false);
  });
});
