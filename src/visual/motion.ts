/**
 * When the console is allowed to move.
 *
 * Two gates, both hard: a reader who asked for reduced motion gets none, and a hidden tab gets none
 * either - an animation loop running behind a background tab is a battery cost with no viewer. Both are
 * queried live rather than read once at mount, because either can change while the page is open.
 */
import { useEffect, useState } from 'react';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** SSR-safe: with no `window` there is no motion to permit, and the tests render on the server. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function documentHidden(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'hidden';
}

/** True only when motion is both wanted and worth spending. Everything animated is gated on this. */
export function motionAllowed(): boolean {
  return !prefersReducedMotion() && !documentHidden();
}

export function useMotionAllowed(): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const sync = () => setAllowed(motionAllowed());
    sync();
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    media.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      media.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return allowed;
}

/**
 * Visual timings, in milliseconds. These change how the console looks and nothing else: no engine
 * result, no replay ordering and no derived state reads any of them.
 */
export const MOTION = {
  /** One agent's activation flash. */
  activate: 420,
  /** A beam travelling between two stations. */
  beam: 620,
  /** An evidence mote arriving at the core. */
  mote: 900,
  /** The core's idle breath. Slow on purpose - a fast pulse reads as activity that is not happening. */
  breath: 4200,
} as const;
