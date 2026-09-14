/**
 * THE INTELLIGENCE CORE. Original geometry: three concentric bands, a dashed outer boundary carrying
 * tick marks for the seven seats, and a centre disc whose colour is the system state's accent.
 *
 * Not an arc reactor and not a copy of anything - the shape is a dial over a ring of seats, which is what
 * the thing actually is. The only motion is the outer band's rotation and the disc's breath, both gated
 * on `.rs-motion`, and neither encodes information: if the console is still, nothing has been lost.
 *
 * The core displays one state and one count, and both are arguments passed in from a real derivation. It
 * has no state of its own and cannot compute one.
 */
import { STATE_ACCENT } from './tokens';
import { SYSTEM_STATE_NOTE, type SystemState } from './state';

export function Core({ state, read, total, label }: {
  state: SystemState;
  /** Exchanges read at the cursor. */
  read: number;
  /** Exchanges in the whole transcript. */
  total: number;
  /** What the count is counting. Passed in so the core never assumes it is looking at a transcript. */
  label: string;
}) {
  const accent = STATE_ACCENT[state];

  return (
    <div className="rs-core" style={{ ['--rs-accent' as string]: accent }}>
      <div className="rs-core-disc" style={{ width: '132px', height: '132px' }} aria-hidden="true" />
      <div className="relative">
        <div className="font-mono text-2xs uppercase tracking-[0.22em]" style={{ color: accent }}>
          {state.replace(/_/g, ' ')}
        </div>
        <div className="num mt-3 text-4xl font-light leading-none">
          {read}
          <span className="text-fg-mute">/{total}</span>
        </div>
        <div className="mt-1.5 font-mono text-2xs uppercase tracking-[0.14em] text-fg-mute">{label}</div>
        <p className="mx-auto mt-4 max-w-[15rem] text-2xs leading-relaxed text-fg-mute">{SYSTEM_STATE_NOTE[state]}</p>
      </div>
    </div>
  );
}

/**
 * The bands and the seat ticks, as one SVG behind the stations. The tick positions are derived from the
 * station points themselves rather than recomputed, so there is exactly one ring geometry in the app -
 * `roster.ringPoint` - and a tick can never land off its seat.
 */
export function CoreField({ ticks, accent }: { ticks: Array<{ x: number; y: number; lit: boolean }>; accent: string }) {
  return (
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      <circle cx={50} cy={50} r={38} fill="none" stroke="rgba(140,165,210,0.20)" strokeWidth={0.25} strokeDasharray="1.5 2.5" />
      <circle cx={50} cy={50} r={27} fill="none" stroke="rgba(120,140,180,0.14)" strokeWidth={0.2} />
      <circle cx={50} cy={50} r={17} fill="none" stroke="rgba(120,140,180,0.10)" strokeWidth={0.2} />
      {ticks.map((t, i) => {
        const dx = (t.x - 50) / 38;
        const dy = (t.y - 50) / 38;
        return (
          <line
            key={i}
            x1={50 + dx * 30}
            y1={50 + dy * 30}
            x2={50 + dx * 35.5}
            y2={50 + dy * 35.5}
            stroke={t.lit ? accent : 'rgba(120,140,180,0.22)'}
            strokeWidth={t.lit ? 0.5 : 0.25}
          />
        );
      })}
    </svg>
  );
}
