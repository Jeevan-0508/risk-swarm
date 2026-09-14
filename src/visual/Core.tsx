/**
 * THE INTELLIGENCE CORE. Original geometry, built to dominate the chamber: a pulsing perimeter, a dial of
 * radial ticks, three segmented arcs turning at three rates, an inner energy field, and a point-cloud
 * globe (`CoreSphere`) behind a centre readout.
 *
 * Not an arc reactor and not a copy of anything - the shape is a dial over a ring of seats, which is what
 * the thing actually is. Nothing that moves here encodes anything: the rotations and the breath carry no
 * information at all, so a still core has lost nothing. Every claim the core makes is text, and every
 * piece of that text is an argument passed in from a real derivation. It has no state of its own.
 */
import { STATE_ACCENT } from './tokens';
import { SYSTEM_STATE_NOTE, type SystemState } from './state';
import { CoreSphere } from './CoreSphere';

/** Ticks around the dial. Every fourth is long, which is what makes a dial read as graduated. */
const TICKS = 72;

/** One segmented arc: `span` degrees of dashes starting at `start`, on radius `r`. */
function Arc({ r, start, span, accent, width, dash }: {
  r: number;
  start: number;
  span: number;
  accent: string;
  width: number;
  dash: string;
}) {
  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(50 + r * Math.cos(rad)).toFixed(3)} ${(50 + r * Math.sin(rad)).toFixed(3)}`;
  };
  const large = span > 180 ? 1 : 0;
  return (
    <path
      d={`M ${point(start)} A ${r} ${r} 0 ${large} 1 ${point(start + span)}`}
      fill="none"
      stroke={accent}
      strokeWidth={width}
      strokeDasharray={dash}
      strokeLinecap="butt"
    />
  );
}

/**
 * The core's own instrument field, in its own square SVG so the geometry is independent of the chamber's
 * size. Drawn behind the sphere and the readout.
 */
export function CoreRig({ accent, lit }: { accent: string; lit: boolean[] }) {
  return (
    <svg viewBox="0 0 100 100" className="rs-rig" aria-hidden="true">
      <defs>
        <radialGradient id="rs-field">
          <stop offset="0%" stopColor={accent} stopOpacity={0.20} />
          <stop offset="55%" stopColor={accent} stopOpacity={0.06} />
          <stop offset="100%" stopColor={accent} stopOpacity={0} />
        </radialGradient>
      </defs>

      <circle cx={50} cy={50} r={34} fill="url(#rs-field)" />

      <circle className="rs-perimeter" cx={50} cy={50} r={48} fill="none" stroke={accent} strokeWidth={0.5} opacity={0.7} />
      <circle cx={50} cy={50} r={46.4} fill="none" stroke="rgba(150,175,220,0.34)" strokeWidth={0.25} />

      <g className="rs-dial">
        {Array.from({ length: TICKS }, (_, i) => {
          const rad = ((i * (360 / TICKS) - 90) * Math.PI) / 180;
          const long = i % 4 === 0;
          const inner = long ? 41 : 43.4;
          return (
            <line
              key={i}
              x1={50 + inner * Math.cos(rad)}
              y1={50 + inner * Math.sin(rad)}
              x2={50 + 45.2 * Math.cos(rad)}
              y2={50 + 45.2 * Math.sin(rad)}
              stroke={long ? 'rgba(180,205,240,0.62)' : 'rgba(150,175,220,0.32)'}
              strokeWidth={long ? 0.5 : 0.3}
            />
          );
        })}
      </g>

      <g className="rs-orbit rs-orbit-a">
        <Arc r={38} start={12} span={104} accent={accent} width={1.1} dash="5 3" />
        <Arc r={38} start={196} span={62} accent={accent} width={1.1} dash="5 3" />
      </g>
      <g className="rs-orbit rs-orbit-b">
        <Arc r={31} start={280} span={128} accent="rgba(175,200,238,0.6)" width={0.7} dash="2 4" />
      </g>
      <g className="rs-orbit rs-orbit-c">
        <Arc r={24.5} start={60} span={210} accent={accent} width={0.55} dash="1.2 5" />
      </g>

      <circle cx={50} cy={50} r={19} fill="none" stroke="rgba(140,165,210,0.22)" strokeWidth={0.2} />

      {/* Seven data paths, one per seat, lit only where that seat has actually spoken by now. */}
      {lit.map((on, i) => {
        const rad = ((i * (360 / lit.length) - 90) * Math.PI) / 180;
        return (
          <line
            key={i}
            x1={50 + 19 * Math.cos(rad)}
            y1={50 + 19 * Math.sin(rad)}
            x2={50 + 45.5 * Math.cos(rad)}
            y2={50 + 45.5 * Math.sin(rad)}
            stroke={on ? accent : 'rgba(120,140,180,0.14)'}
            strokeWidth={on ? 0.35 : 0.18}
            opacity={on ? 0.55 : 1}
          />
        );
      })}
    </svg>
  );
}

export function Core({ state, read, total, label, sphere = true, accent: override, lit = [], event = null, note = true }: {
  state: SystemState;
  /** Exchanges read at the cursor. */
  read: number;
  /** Exchanges in the whole transcript. */
  total: number;
  /** What the count is counting. Passed in so the core never assumes it is looking at a transcript. */
  label: string;
  /**
   * The point-cloud globe behind the disc. On by default and switchable off because it is decoration:
   * anywhere the core has to sit in a small or dense space, the reading is the text, not the sphere.
   */
  sphere?: boolean;
  /** A selected seat's own accent, which takes the state's place while that seat is held. */
  accent?: string | null;
  /** One flag per seat, in ring order: whether it has spoken in the read prefix. */
  lit?: boolean[];
  /** The event on the cursor, in a few words. Printed, never inferred. */
  event?: string | null;
  /** The state's note. Off where the note is printed elsewhere on the screen instead. */
  note?: boolean;
}) {
  const accent = override ?? STATE_ACCENT[state];

  return (
    <div className="rs-core" style={{ ['--rs-accent' as string]: accent }}>
      <CoreRig accent={accent} lit={lit} />
      {sphere && <CoreSphere accent={accent} />}
      <div className="rs-core-disc" aria-hidden="true" />
      <div className="rs-core-readout">
        <div className="rs-core-state" style={{ color: accent }}>{state.replace(/_/g, ' ')}</div>
        <div className="num rs-core-count">
          {read}
          <span className="text-fg-mute">/{total}</span>
        </div>
        <div className="rs-core-label">{label}</div>
        {event !== null && <div className="rs-core-event" style={{ color: accent }}>{event}</div>}
        {note && <p className="rs-core-note">{SYSTEM_STATE_NOTE[state]}</p>}
      </div>
    </div>
  );
}
