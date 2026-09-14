/**
 * EVOLUTION 5.0 Phase J. The visual model for SENTINEL, PULSE and ORBIT.
 *
 * These three reports are the system's own account of whether it can be trusted, and until now they were
 * three lists of rows - readable, but a reader had to scan every line to learn whether anything was wrong.
 * This module turns each report into geometry a glance can read, and it is a pure reduction: every segment
 * corresponds to exactly one check that the core module produced, in the order it produced it, and no
 * segment exists without one. A ring cannot show a health the report did not state.
 *
 * The arithmetic is deliberately boring. `severity` is a count, not a score: how many checks are WARNING or
 * BLOCKED. `drift` is the fraction of MATERIAL diff fields that moved - material because ORBIT already
 * marks which fields a human would act on differently, and a percentage that mixed those with
 * informational numbers would be a number that looks precise and means nothing. Neither is smoothed,
 * weighted or interpolated, because a weight nobody chose is a claim nobody made.
 */
import type { IntegrityStatus } from '../core/status';
import { overallStatus } from '../core/status';
import { ACCENT } from './tokens';

export const STATUS_ACCENT: Record<IntegrityStatus, string> = {
  VERIFIED: ACCENT.support,
  WARNING: ACCENT.caution,
  BLOCKED: ACCENT.block,
};

/** The shared shape of a SENTINEL and a PULSE check. Neither module is imported: this reads both. */
export interface IntegrityCheckLike {
  key: string;
  label: string;
  status: IntegrityStatus;
  detail: string;
}

export interface IntegritySegment {
  key: string;
  label: string;
  status: IntegrityStatus;
  detail: string;
  accent: string;
  /** Degrees, clockwise from twelve o'clock. Equal arcs: no check is drawn as more important than another. */
  start: number;
  sweep: number;
}

export interface IntegrityModel {
  status: IntegrityStatus;
  segments: IntegritySegment[];
  counts: Record<IntegrityStatus, number>;
  /** Checks that are not VERIFIED. The number a reader actually wants from a ring. */
  severity: number;
  /** Stated when there is nothing to draw, so an empty ring is never read as a clean one. */
  emptyReason: string | null;
}

const GAP_DEGREES = 2;

export function integrityModel(checks: readonly IntegrityCheckLike[], status?: IntegrityStatus): IntegrityModel {
  const counts: Record<IntegrityStatus, number> = { VERIFIED: 0, WARNING: 0, BLOCKED: 0 };
  for (const check of checks) counts[check.status] += 1;

  const sweep = checks.length === 0 ? 0 : 360 / checks.length - GAP_DEGREES;
  const segments = checks.map((check, i) => ({
    key: check.key,
    label: check.label,
    status: check.status,
    detail: check.detail,
    accent: STATUS_ACCENT[check.status],
    start: (360 / Math.max(checks.length, 1)) * i + GAP_DEGREES / 2,
    sweep,
  }));

  return {
    status: status ?? overallStatus(checks.map((c) => c.status)),
    segments,
    counts,
    severity: counts.WARNING + counts.BLOCKED,
    emptyReason:
      checks.length === 0
        ? 'This report ran no checks, so the ring shows nothing. An unchecked system is not a healthy one.'
        : null,
  };
}

/** One row of an ORBIT diff, reduced to what a lane chart needs. Reads `OrbitFieldDiff` without importing it. */
export interface DiffFieldLike {
  key: string;
  label: string;
  baseline: string;
  stressed: string;
  changed: boolean;
}

export interface DriftLane {
  key: string;
  label: string;
  baseline: string;
  stressed: string;
  changed: boolean;
  material: boolean;
  accent: string;
}

export interface DriftModel {
  lanes: DriftLane[];
  material_count: number;
  material_changed: number;
  /** 0..1 over material fields only. Null when the scenario compared no material field at all. */
  drift: number | null;
  note: string;
}

/**
 * ORBIT's own `materially_changed` flag is the verdict; this needs to know which individual fields carry
 * it, and `OrbitFieldDiff` does not say. Rather than invent a second opinion, the caller passes the same
 * key list ORBIT used, so the lanes and the verdict cannot disagree.
 */
export function driftModel(fields: readonly DiffFieldLike[], materialKeys: readonly string[]): DriftModel {
  const material = new Set(materialKeys);
  const lanes = fields.map((f) => ({
    key: f.key,
    label: f.label,
    baseline: f.baseline,
    stressed: f.stressed,
    changed: f.changed,
    material: material.has(f.key),
    accent: f.changed ? (material.has(f.key) ? ACCENT.objection : ACCENT.caution) : ACCENT.quiet,
  }));

  const materialLanes = lanes.filter((l) => l.material);
  const materialChanged = materialLanes.filter((l) => l.changed).length;

  return {
    lanes,
    material_count: materialLanes.length,
    material_changed: materialChanged,
    drift: materialLanes.length === 0 ? null : materialChanged / materialLanes.length,
    note:
      materialLanes.length === 0
        ? 'This diff compared no field a human would act on differently, so there is no drift to measure.'
        : `${materialChanged} of ${materialLanes.length} field(s) a human would act on differently moved under stress.`,
  };
}

/** An arc path on a unit-agnostic circle. Kept here so the ring component holds no geometry of its own. */
export function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(2)} ${(cy + r * Math.sin(rad)).toFixed(2)}`;
  };
  const large = sweepDeg > 180 ? 1 : 0;
  return `M ${point(startDeg)} A ${r} ${r} 0 ${large} 1 ${point(startDeg + sweepDeg)}`;
}
