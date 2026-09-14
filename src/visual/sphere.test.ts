/**
 * EVOLUTION 5.0. A particle field is the one place in this codebase where `Math.random()` would look
 * harmless, so the first test is that the cloud is reproducible - and the last is that the source contains
 * no random call at all. The rest pins the properties the renderer relies on: every point on the unit
 * sphere, every link short and unique, and a still frame available by holding the parameter constant.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from '../core/test/bdd';
import { breath, fibonacciSphere, meshLinks, project, rotate } from './sphere';

const near = (a: number, b: number, tolerance = 1e-9) => Math.abs(a - b) <= tolerance;

describe('the core sphere point cloud', () => {
  it('puts every point on the unit sphere', () => {
    for (const p of fibonacciSphere(400)) {
      expect(near(Math.hypot(p.x, p.y, p.z), 1, 1e-9)).toBe(true);
    }
  });

  it('is identical every time it is built, so two machines draw the same cloud', () => {
    expect(fibonacciSphere(120)).toEqual(fibonacciSphere(120));
  });

  it('spreads points instead of clustering: no two share a position', () => {
    const keys = new Set(fibonacciSphere(300).map((p) => `${p.x.toFixed(9)}|${p.y.toFixed(9)}|${p.z.toFixed(9)}`));
    expect(keys.size).toBe(300);
  });

  it('handles the degenerate sizes without producing NaN', () => {
    expect(fibonacciSphere(0)).toEqual([]);
    const one = fibonacciSphere(1);
    expect(one.length).toBe(1);
    expect(Number.isNaN(one[0].x)).toBe(false);
    expect(near(Math.hypot(one[0].x, one[0].y, one[0].z), 1, 1e-9)).toBe(true);
  });
});

describe('the mesh', () => {
  const cloud = fibonacciSphere(200);

  it('never joins a point to itself and never repeats a pair', () => {
    const links = meshLinks(cloud, 3, 0.3);
    const keys = new Set(links.map((l) => `${Math.min(l.a, l.b)}:${Math.max(l.a, l.b)}`));
    expect(keys.size).toBe(links.length);
    expect(links.every((l) => l.a !== l.b)).toBe(true);
  });

  it('honours the length ceiling, so the spiral cannot wrap a chord across the globe', () => {
    const links = meshLinks(cloud, 4, 0.15);
    expect(links.length > 0).toBe(true);
    expect(links.every((l) => l.length <= 0.15)).toBe(true);
  });

  it('is the same mesh every time, for the same cloud', () => {
    expect(meshLinks(cloud, 3, 0.2)).toEqual(meshLinks(cloud, 3, 0.2));
  });

  it('returns nothing rather than reaching further when no neighbour is close enough', () => {
    expect(meshLinks(cloud, 3, 0.0001)).toEqual([]);
  });
});

describe('rotation and projection', () => {
  it('keeps a point on the sphere however far it is turned', () => {
    const p = fibonacciSphere(9)[4];
    for (const yaw of [0, 0.7, 2.5, 6.28]) {
      const r = rotate(p, yaw, 0.4);
      expect(near(Math.hypot(r.x, r.y, r.z), Math.hypot(p.x, p.y, p.z), 1e-9)).toBe(true);
    }
  });

  it('is the identity at zero rotation', () => {
    const p = { x: 0.3, y: -0.5, z: 0.81 };
    const r = rotate(p, 0, 0);
    expect(near(r.x, p.x)).toBe(true);
    expect(near(r.y, p.y)).toBe(true);
    expect(near(r.z, p.z)).toBe(true);
  });

  it('draws a near point larger and further from the centre than the same point turned away', () => {
    const front = project({ x: 0.6, y: 0, z: 0.8 }, 100, 100, 80);
    const back = project({ x: 0.6, y: 0, z: -0.8 }, 100, 100, 80);
    expect(front.scale > back.scale).toBe(true);
    expect(front.x - 100 > back.x - 100).toBe(true);
    expect(front.depth > back.depth).toBe(true);
  });

  it('flips the y axis, because canvas y grows downward and the sphere\'s does not', () => {
    expect(project({ x: 0, y: 1, z: 0 }, 100, 100, 80).y < 100).toBe(true);
  });
});

describe('the breath', () => {
  it('runs the full 0..1 range across one period and returns to where it started', () => {
    expect(near(breath(0, 1000), 0)).toBe(true);
    expect(near(breath(500, 1000), 1)).toBe(true);
    expect(near(breath(1000, 1000), 0, 1e-9)).toBe(true);
  });

  it('holds still when the elapsed time is held still, which is how reduced motion is served', () => {
    expect(breath(1234, 5000)).toBe(breath(1234, 5000));
  });

  it('never divides by zero on a nonsense period', () => {
    expect(breath(500, 0)).toBe(0.5);
  });
});

describe('the visual layer\'s no-randomness rule', () => {
  it('contains no random call in either the maths or the renderer', () => {
    // Comments are stripped first: both files discuss the rule by name, which is not a call.
    const code = (file: string) => readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const file of ['src/visual/sphere.ts', 'src/visual/CoreSphere.tsx']) {
      expect(code(file).includes('Math.random')).toBe(false);
    }
  });

  it('gates the renderer on the shared motion hook rather than animating unconditionally', () => {
    const source = readFileSync('src/visual/CoreSphere.tsx', 'utf8');
    expect(source.includes('useMotionAllowed')).toBe(true);
    expect(source.includes('cancelAnimationFrame')).toBe(true);
  });
});
