/**
 * THE CORE SPHERE. A rotating point-cloud globe behind the intelligence core.
 *
 * Canvas 2D and about six hundred points - no three.js, no shader, no new dependency. A wireframe sphere
 * is 40 lines of trigonometry (`sphere.ts`) and importing a 3D engine to draw one would be the kind of
 * weight that makes a page slow for a decoration.
 *
 * Three rules it keeps, because a moving centrepiece is the easiest place in a console to start lying:
 *
 *   - **It encodes nothing.** The rotation and the breath carry no information whatsoever, and this is
 *     stated rather than implied. A reader must never have to wonder whether the sphere is telling them
 *     something they missed. Its one honest signal is colour, which is the system state's own accent - the
 *     same accent the core text beside it already prints in words.
 *   - **It stops when asked.** `useMotionAllowed()` gates both reduced motion and a hidden tab. With
 *     motion off the sphere is drawn once, held still, rather than removed: a still globe is a deliberate
 *     object, an absent one looks like a broken screen.
 *   - **It is deterministic.** Every point and every link comes from the golden-angle spiral, so there is
 *     no `Math.random()` anywhere in it and two machines draw the identical cloud.
 */
import { useEffect, useRef } from 'react';
import { fibonacciSphere, meshLinks, project, rotate, breath } from './sphere';
import { useMotionAllowed } from './motion';

/**
 * Two clouds, not one. The dots are dense because density is what makes a shell read as a shell, and the
 * filament mesh is built from a sparser cloud because linking 1500 points is O(n^2) work at import time
 * for a wireframe nobody would be able to see through. Both are the same deterministic spiral.
 */
const DOTS = 1500;
const MESH_POINTS = 420;
const NEIGHBOURS = 3;
/** Links longer than this are the spiral wrapping across the globe, and they read as noise. */
const MAX_LINK = 0.2;
const SPIN_PERIOD_MS = 42_000;
const BREATH_PERIOD_MS = 5200;
/**
 * Limb brightening. A hollow shell of points is densest along its silhouette, so the rim is where the
 * light is - the exponent is high because a gentle falloff reads as a flat disc of confetti instead.
 */
const LIMB_POWER = 8;

const CLOUD = fibonacciSphere(DOTS);
const MESH_CLOUD = fibonacciSphere(MESH_POINTS);
const MESH = meshLinks(MESH_CLOUD, NEIGHBOURS, MAX_LINK);

/** The nearest dots mix towards this, which is what gives the shell a lit edge rather than a flat blue. */
const HIGHLIGHT = [215, 240, 255] as const;

/** `#rrggbb` to three channels, so one accent token can drive strokes, fills and the highlight mix. */
function channels(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const n = Number.parseInt(value.length === 3 ? value.replace(/(.)/g, '$1$1') : value, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function CoreSphere({ accent, size = 320 }: { accent: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const motion = useMotionAllowed();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const [ar, ag, ab] = channels(accent);
    const cx = size / 2;
    const cy = size / 2;

    const draw = (elapsed: number) => {
      const yaw = (elapsed / SPIN_PERIOD_MS) * Math.PI * 2;
      const pitch = Math.sin(yaw / 3) * 0.32;
      const pulse = breath(elapsed, BREATH_PERIOD_MS);
      const radius = (size / 2) * (0.74 + pulse * 0.022);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      // Additive, so overlapping marks brighten each other the way emitted light does.
      ctx.globalCompositeOperation = 'lighter';

      const dots = CLOUD.map((p) => project(rotate(p, yaw, pitch), cx, cy, radius));
      const mesh = MESH_CLOUD.map((p) => project(rotate(p, yaw, pitch), cx, cy, radius));
      /** How far out a projected point sits, 0 at the centre of the disc and 1 at the silhouette. */
      const limbOf = (x: number, y: number) => (Math.hypot(x - cx, y - cy) / (radius * 1.02)) ** LIMB_POWER;

      for (const link of MESH) {
        const a = mesh[link.a];
        const b = mesh[link.b];
        const depth = (a.depth + b.depth) / 2;
        const limb = limbOf((a.x + b.x) / 2, (a.y + b.y) / 2);
        const alpha = Math.min(
          0.95,
          (0.06 + Math.max(0, depth + 1) * 0.05 + limb * 0.3) * (1 - link.length / MAX_LINK) ** 0.4 * 1.8,
        );
        if (alpha <= 0.004) continue;
        ctx.strokeStyle = `rgba(${ar}, ${ag}, ${ab}, ${alpha.toFixed(3)})`;
        ctx.lineWidth = depth > 0 ? 0.7 : 0.45;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (const p of dots) {
        const near = (p.depth + 1) / 2;
        const limb = limbOf(p.x, p.y);
        const alpha = Math.min(1, (0.06 + near * 0.42 + limb * 0.55) * 1.5);
        const r = 0.35 + near * 0.75 + limb * 0.5;
        const mix = near * 0.45;
        const cr = Math.round(ar * (1 - mix) + HIGHLIGHT[0] * mix);
        const cg = Math.round(ag * (1 - mix) + HIGHLIGHT[1] * mix);
        const cb = Math.round(ab * (1 - mix) + HIGHLIGHT[2] * mix);
        // The bloom first, so the bright core always lands on top of its own halo. Done as a second
        // wider mark rather than a canvas blur filter: `ctx.filter` is not supported everywhere, and an
        // unsupported filter fails by drawing nothing at all.
        if (alpha > 0.35) {
          ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${(alpha * 0.16).toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // A single soft halo, drawn last so it sits over the mesh without washing the points out.
      const halo = ctx.createRadialGradient(cx, cy, radius * 0.55, cx, cy, radius * 1.16);
      halo.addColorStop(0, `rgba(${ar}, ${ag}, ${ab}, 0)`);
      halo.addColorStop(0.72, `rgba(${ar}, ${ag}, ${ab}, ${(0.05 + pulse * 0.03).toFixed(3)})`);
      halo.addColorStop(1, `rgba(${ar}, ${ag}, ${ab}, 0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
    };

    if (!motion) {
      // One frame, held. A quarter turn in so the mesh reads as a sphere rather than a flat disc.
      draw(SPIN_PERIOD_MS / 8);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const loop = (now: number) => {
      draw(now - start);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [accent, size, motion]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      aria-hidden="true"
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: `${size}px`, height: `${size}px` }}
    />
  );
}
