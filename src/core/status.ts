/**
 * The three-value health status shared by every system-level report that is not itself a risk
 * finding: SENTINEL (evidence integrity), PULSE (system health) and, later, ORBIT (scenario
 * comparison). Extracted once these reports outnumbered the enum, so a fourth reporter can share it
 * rather than redefine it.
 *
 * VERIFIED - checked, and it holds. WARNING - checked, and a human should look, but nothing here
 * blocks or rewrites the investigation. BLOCKED - checked, and the record itself is unsound (a
 * bookkeeping defect, not a verdict on the risk). Absence of data to check is reported as WARNING,
 * never as VERIFIED: an unchecked thing is not a healthy thing.
 */
export type IntegrityStatus = 'VERIFIED' | 'WARNING' | 'BLOCKED';

const RANK: Record<IntegrityStatus, number> = { VERIFIED: 0, WARNING: 1, BLOCKED: 2 };

/** The worse of two statuses, so an overall status can be folded from any number of checks in any order. */
export function worseStatus(a: IntegrityStatus, b: IntegrityStatus): IntegrityStatus {
  return RANK[b] > RANK[a] ? b : a;
}

/** Folds a list of checks (or nested reports) down to the single worst status among them. */
export function overallStatus(statuses: IntegrityStatus[]): IntegrityStatus {
  return statuses.reduce((acc, s) => worseStatus(acc, s), 'VERIFIED' as IntegrityStatus);
}
