/**
 * THE CORE SPHERE, as maths.
 *
 * A point cloud on a sphere, rotated and projected to 2D. It is here rather than inside the canvas
 * component for one reason: `Math.random()` is banned in this codebase and a particle field is exactly
 * where it would sneak in. Every point comes from the golden-angle (Fibonacci) spiral instead, which
 * spreads n points evenly over a sphere with no randomness at all - so the same n gives the same cloud on
 * every machine, every reload, and a test can assert it.
 *
 * The links are the same discipline. A wireframe of "nearby" points looks random and is not: a point is
 * joined to a fixed number of its nearest neighbours by index, computed once, so the mesh is a property of
 * n and nothing else.
 *
 * Nothing here reads a run, a state or a clock. Rotation is a parameter the caller passes in, so a still
 * frame is just rotation held constant - which is exactly what reduced motion needs.
 */

/** The golden angle. Two consecutive points on the spiral are this far apart in longitude. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * n points spread evenly over the unit sphere. Deterministic: index i always lands in the same place.
 */
export function fibonacciSphere(n: number): Point3[] {
  if (n <= 0) return [];
  const points: Point3[] = [];
  for (let i = 0; i < n; i += 1) {
    // Latitude marches linearly from +1 to -1 so the spiral covers the poles as densely as the equator.
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * i;
    points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius });
  }
  return points;
}

export interface Link {
  a: number;
  b: number;
  /** Chord length on the unit sphere. The renderer fades a long link, so the mesh reads as depth. */
  length: number;
}

const distance = (p: Point3, q: Point3) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);

/**
 * Joins each point to its `perNode` nearest neighbours, deduplicated. O(n²) on purpose: it runs once for a
 * few hundred points, and an approximate structure would make the mesh depend on insertion order.
 */
export function meshLinks(points: readonly Point3[], perNode: number, maxLength = Infinity): Link[] {
  const seen = new Set<string>();
  const links: Link[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const neighbours = points
      .map((p, j) => ({ j, d: distance(points[i], p) }))
      .filter((c) => c.j !== i && c.d <= maxLength)
      .sort((a, b) => (a.d === b.d ? a.j - b.j : a.d - b.d))
      .slice(0, perNode);

    for (const n of neighbours) {
      const key = i < n.j ? `${i}:${n.j}` : `${n.j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ a: i, b: n.j, length: n.d });
    }
  }

  return links;
}

/** Rotation about Y then X. Two axes are enough for a sphere and the third would only cost frames. */
export function rotate(p: Point3, yaw: number, pitch: number): Point3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p.x * cy - p.z * sy;
  const z1 = p.x * sy + p.z * cy;

  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = p.y * cp - z1 * sp;
  const z2 = p.y * sp + z1 * cp;

  return { x: x1, y: y2, z: z2 };
}

export interface Projected {
  x: number;
  y: number;
  /** -1 at the far pole, +1 at the near one. The renderer uses it for size, alpha and draw order. */
  depth: number;
  scale: number;
}

/**
 * Weak perspective: near points sit slightly larger and further out. `FOCAL` is deliberately shallow -
 * a strong perspective on a wireframe globe reads as a fisheye lens rather than depth.
 */
const FOCAL = 2.6;

export function project(p: Point3, cx: number, cy: number, radius: number): Projected {
  const scale = FOCAL / (FOCAL - p.z);
  return { x: cx + p.x * radius * scale, y: cy - p.y * radius * scale, depth: p.z, scale };
}

/**
 * The breath, as one number in 0..1. A caller passes elapsed milliseconds; holding it constant holds the
 * sphere still, which is how reduced motion is served without a second code path.
 */
export function breath(elapsedMs: number, periodMs: number): number {
  if (periodMs <= 0) return 0.5;
  return (1 - Math.cos((elapsedMs / periodMs) * Math.PI * 2)) / 2;
}
