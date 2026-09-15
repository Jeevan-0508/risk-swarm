import type { CouncilResult } from '@core/council/types';

/**
 * Decision ownership for the Research screen.
 *
 * The legacy open-research pipeline (HERMES/ATHENA/APOLLO/ARES/HEPHAESTUS) always
 * produces a decision — it always has, and that behaviour must not change when
 * Council Mode is off. But when the Evolution 6.0 Olympian Council runs
 * alongside it over the same evidence, the Council's verdict is the
 * authoritative final answer; the legacy decision becomes that pipeline's own
 * research-pass analysis, kept for context and provenance, not a competing
 * verdict. This module holds the (tiny, branch-only) logic that decides how
 * the legacy panel should present itself given that.
 */

export function isCouncilAuthoritative(council: CouncilResult | null): boolean {
  return council !== null;
}

export function swarmDecisionPanelTitle(council: CouncilResult | null): string {
  return isCouncilAuthoritative(council) ? 'research pass analysis (legacy pipeline, not the final verdict)' : 'SWARM DECISION';
}
