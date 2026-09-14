/**
 * The console's visual vocabulary, as data.
 *
 * Colour lives here rather than only in CSS because SVG strokes and gradients are set from TypeScript,
 * and one palette in two places drifts. `console.css` mirrors these as custom properties; nothing else
 * may define a console colour.
 *
 * The palette is deliberately narrow: a near-black environment, one hairline, and six accents that each
 * mean exactly one thing. A seventh accent would be decoration, and decoration is what makes a serious
 * instrument look like a toy.
 */
import type { SystemState } from './state';

export const SURFACE = {
  void: '#05070a',
  graphite: '#0a0d12',
  glass: 'rgba(18, 24, 33, 0.62)',
  hair: 'rgba(120, 140, 180, 0.16)',
  hairBright: 'rgba(140, 165, 210, 0.34)',
} as const;

export const ACCENT = {
  signal: '#4d8dff',
  support: '#3fb98a',
  caution: '#e0a33c',
  objection: '#e2603f',
  block: '#d6425b',
  hypothesis: '#8b7bd8',
  quiet: '#66707e',
} as const;

/**
 * Each state's accent. CHALLENGED and the two terminal states are the only ones that shift the whole
 * core's colour, because they are the only three a reader must not miss.
 */
export const STATE_ACCENT: Record<SystemState, string> = {
  IDLE: ACCENT.quiet,
  RESEARCHING: ACCENT.signal,
  ANALYZING: ACCENT.signal,
  DELIBERATING: ACCENT.hypothesis,
  CHALLENGED: ACCENT.objection,
  RECONCILING: ACCENT.caution,
  DECISION_READY: ACCENT.support,
  HUMAN_REVIEW: ACCENT.caution,
  RESOLVED: ACCENT.support,
};

/** The ring geometry, in percent of the chamber box. One radius, seven stations, twelve o'clock first. */
export const RING = {
  radius: 37,
  centre: { x: 50, y: 50 },
  /** Concentric bands drawn inside the ring. Three, because a fourth stops reading as structure. */
  bands: [0.42, 0.62, 0.84],
} as const;

export function ringPointAt(index: number, count: number): { x: number; y: number } {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return {
    x: RING.centre.x + Math.cos(angle) * RING.radius,
    y: RING.centre.y + Math.sin(angle) * RING.radius,
  };
}
