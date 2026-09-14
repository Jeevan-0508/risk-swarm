/**
 * THE COUNCIL's presentation layer. Purely visual: an accent, a seat on the ring, and one line of
 * character per agent. Nothing here is read by `src/core` and nothing here can change a tier, a score,
 * a gate, a cap or a band - exactly the boundary `AGENT_CODENAME` already holds in `@app/lib/agents`.
 *
 * The character lines are the same claims `showcase/gods.ts` makes, restated in the Council's own
 * clipped register rather than the showcase's mythic one. They are not imported from there on purpose:
 * the showcase keys its data by display label, the Council keys by `AgentId`, and a shared file would
 * quietly couple two pages that are allowed to diverge.
 */
import type { AgentId } from '../core/domain/model';
import { AGENT_ORDER } from '../app/lib/agents';

export interface Seat {
  /**
   * One accent per seat, deliberately off the console's semantic palette: seven hues a reader can tell
   * apart at a glance and then keep, because selecting a seat re-tints the whole chamber to it. HERMES
   * green, ATHENA blue, APOLLO cyan, ZEUS violet, ARES amber, HADES red, HEPHAESTUS gold.
   */
  accent: string;
  /** The disposition the agent argues from. A description of its real remit, not a mood. */
  trait: string;
  /** What this seat is structurally unable to do. The interesting half of the design. */
  cannot: string;
}

export const COUNCIL_SEATS: Record<AgentId, Seat> = {
  scout: {
    accent: '#3fd39a',
    trait: 'Fast, incurious about meaning.',
    cannot: 'Cannot rank, interpret or conclude. Drops any signal with no verifiable url.',
  },
  intelligence: {
    accent: '#5b9dff',
    trait: 'Precise, sceptical of coincidence.',
    cannot: 'Cannot call a model. Publishes a doubtful pair as doubtful instead of merging it.',
  },
  risk_analyst: {
    accent: '#7fd4e8',
    trait: 'Constructive, and pre-cracked.',
    cannot: 'Cannot state a hypothesis without a named falsification test.',
  },
  governance_officer: {
    accent: '#a68cff',
    trait: 'Procedural, loud only where cited.',
    cannot: 'Cannot evidence an incident, and cannot assert an obligation with no citation.',
  },
  challenger: {
    accent: '#ff8a5c',
    trait: 'Adversarial, obliged to be constructive.',
    cannot: 'Cannot merely doubt. Every objection must name an alternative explanation.',
  },
  red_team: {
    accent: '#ff5c78',
    trait: 'Worst-case, one-directional.',
    cannot: 'Cannot raise a band. Can stop an escalation and can never create one.',
  },
  decision_engine: {
    accent: '#f3c44d',
    trait: 'Quiet, arithmetic only.',
    cannot: 'Cannot hold an opinion, and cannot decide. It recommends to a human.',
  },
};

/** The seven seats in pipeline order. The ring is drawn in this order so it reads as the real sequence. */
export const COUNCIL_ORDER: readonly AgentId[] = AGENT_ORDER;

export interface RingPoint {
  x: number;
  y: number;
  /** Degrees clockwise from 12 o'clock. Kept so a label can be pushed outward along the same radius. */
  angle: number;
}

/**
 * Seat `i` of `n` on a circle in a 0-100 square, first seat at 12 o'clock, going clockwise. Pure maths
 * with no DOM and no layout read, so it renders identically on the server, in a test and on a phone.
 */
export function ringPoint(i: number, n: number, radius = 38): RingPoint {
  const angle = (360 / n) * i;
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: 50 + radius * Math.cos(rad), y: 50 + radius * Math.sin(rad), angle };
}
