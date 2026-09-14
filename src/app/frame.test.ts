/**
 * EVOLUTION 5.0 Phase K. The frame is the one file no screen test covers: it is wired with aliases bun
 * cannot resolve, so it is read as text here. Reading source with a regex is a poor way to test logic and
 * a good way to test wiring, and wiring is exactly what breaks when a fourteenth screen is added - a nav
 * entry with no route, a route with no entry, a lazy import naming an export that was renamed.
 *
 * The accessibility assertions are the same kind of claim: that the markup a screen reader depends on is
 * present at all. Whether it reads well is not something a regex can know, and this file does not pretend
 * otherwise.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from '../core/test/bdd';

const APP = readFileSync('src/app/App.tsx', 'utf8');
const CSS = readFileSync('src/app/styles.css', 'utf8');

const navPaths = [...APP.matchAll(/\{ to: '([^']+)', n: '(\d\d)', label: '([^']+)' \}/g)].map((m) => ({
  to: m[1],
  n: m[2],
  label: m[3],
}));
const routePaths = [...APP.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);

/** Reachable only from a run, or a catch-all: deliberately absent from the sidebar. */
const UNLISTED = ['/history/:id', '*', '/council', '/pantheon'];

describe('the console frame', () => {
  it('has a nav entry for every screen and a screen for every nav entry', () => {
    expect(navPaths.length > 0).toBe(true);
    for (const entry of navPaths) {
      expect(routePaths).toContain(entry.to);
    }
    for (const path of routePaths) {
      if (UNLISTED.includes(path)) continue;
      expect(navPaths.some((e) => e.to === path)).toBe(true);
    }
  });

  it('numbers the screens consecutively from 01, so a number is a position and not a label', () => {
    expect(navPaths.map((e) => e.n)).toEqual(navPaths.map((_, i) => String(i + 1).padStart(2, '0')));
  });

  it('names every lazy screen export that it imports', () => {
    const lazyScreens = [...APP.matchAll(/import\('@app\/(screens\/[A-Za-z]+)'\)\.then\(\(m\) => \(\{ default: m\.([A-Za-z]+) \}\)\)/g)];
    expect(lazyScreens.length > 0).toBe(true);
    for (const [, modulePath, exported] of lazyScreens) {
      const source = readFileSync(`src/app/${modulePath}.tsx`, 'utf8');
      expect(source.includes(`export function ${exported}(`)).toBe(true);
    }
  });

  it('keeps a lazy screen behind a Suspense boundary inside the frame, not outside it', () => {
    const frame = APP.slice(APP.indexOf('function Frame()'), APP.indexOf('export function App()'));
    expect(frame.includes('<Suspense')).toBe(true);
    expect(frame.includes('<Outlet />')).toBe(true);
  });
});

describe('the frame at a phone width', () => {
  it('hides the sidebar below the large breakpoint and renders the same nav as a strip', () => {
    expect(APP.includes('hidden w-60 shrink-0 flex-col')).toBe(true);
    expect(APP.includes('lg:flex')).toBe(true);
    expect(APP.includes('lg:hidden')).toBe(true);
  });

  it('renders both navs from one NAV array, so they cannot disagree', () => {
    expect([...APP.matchAll(/NAV\.map\(/g)].length).toBe(2);
    expect([...APP.matchAll(/const NAV\b/g)].length).toBe(1);
  });
});

describe('the frame for a reader who is not using a mouse', () => {
  it('offers a skip link that targets a region the frame actually gives an id', () => {
    const target = /href="#([a-z-]+)"/.exec(APP);
    expect(target).not.toBe(null);
    expect(APP.includes(`id="${target![1]}"`)).toBe(true);
  });

  it('announces a running investigation in a live region rather than only visually', () => {
    expect(/role="status" aria-live="polite"/.test(APP)).toBe(true);
  });

  it('labels both navs, so two nav landmarks are distinguishable', () => {
    expect([...APP.matchAll(/aria-label="screens"/g)].length).toBe(2);
  });

  it('switches off every animation the stylesheet defines when reduced motion is asked for', () => {
    const animated = [...CSS.matchAll(/\.([a-z-]+) \{ animation:/g)].map((m) => m[1]);
    expect(animated.length > 0).toBe(true);
    const gate = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(gate.length > 0).toBe(true);
    for (const cls of animated) {
      expect(gate.includes(`.${cls}`)).toBe(true);
    }
  });
});
