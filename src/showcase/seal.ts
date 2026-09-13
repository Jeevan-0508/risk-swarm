/**
 * The stamp at the end of the showcase page. It carries the band from a run that actually happened on
 * this device, or it carries nothing and says so.
 *
 * This exists as its own pure function, away from the page, for one reason: a marketing page is exactly
 * where a plausible-looking fabricated number would be easiest to justify and worst to ship. There is no
 * default band, no sample band and no placeholder band anywhere in this file - the only two outcomes are
 * a real run's published band or an explicit absence.
 */

/** The narrow slice of the session store's `StoredRun` this needs. Kept structural so the store stays free to change. */
export interface SealSourceRun {
  id: string;
  mode: string;
  status: string;
  created_at: string;
  question: string;
  result: {
    outputs: { decision: { decision: { action_band: string; severity_band: string; confidence: number | null } } };
  } | null;
}

export type Seal =
  | {
      kind: 'real';
      run_id: string;
      mode: string;
      created_at: string;
      question: string;
      action_band: string;
      severity_band: string;
      /** null is a real published value here - the engine withholds confidence rather than estimating it. */
      confidence: number | null;
    }
  | { kind: 'none'; reason: string };

/**
 * Picks the most recent completed run and reads its published band. A running, stopped or failed run is
 * not eligible: a band from an unfinished run would be a half-formed number presented as a conclusion.
 */
export function sealFrom(runs: readonly SealSourceRun[]): Seal {
  const eligible = runs
    .filter((r) => r.status === 'complete' && r.result !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const latest = eligible[0];
  if (latest === undefined || latest.result === null) {
    return {
      kind: 'none',
      reason: 'No completed investigation is stored in this browser yet, so there is no band to stamp. This page will not invent one.',
    };
  }

  const decision = latest.result.outputs.decision.decision;
  return {
    kind: 'real',
    run_id: latest.id,
    mode: latest.mode,
    created_at: latest.created_at,
    question: latest.question,
    action_band: decision.action_band,
    severity_band: decision.severity_band,
    confidence: decision.confidence,
  };
}
