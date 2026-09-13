/**
 * The pantheon's imagery, drawn as geometry rather than illustration.
 *
 * Deliberate constraint: line-drawn symbols in one stroke weight, no cartoon faces, no raster art, no
 * external image generator or commission needed to ship this page. It reads as mythic insignia, which is
 * also the only register that stays defensible next to an enterprise risk tool.
 *
 * Each motif is also the page's animation: the shapes carry the pipeline (signals -> clusters ->
 * hypothesis -> citation -> objection -> veto -> seal), so the motion is the argument, not decoration.
 */

interface MotifProps {
  accent: string;
  /** Set once the section has been scrolled into view. Every animation is gated on this. */
  live: boolean;
}

const STROKE = 1.25;

function frame(live: boolean, name: string) {
  return live ? `pn-run pn-${name}` : 'pn-idle';
}

/** HERMES - signals arrive from the edges; two fade out mid-flight, having no verifiable url. */
export function HermesMotif({ accent, live }: MotifProps) {
  const arrivals = [
    { x: 18, y: 26, delay: 0, dropped: false },
    { x: 34, y: 62, delay: 90, dropped: false },
    { x: 52, y: 20, delay: 180, dropped: true },
    { x: 66, y: 48, delay: 260, dropped: false },
    { x: 84, y: 30, delay: 340, dropped: false },
    { x: 96, y: 68, delay: 420, dropped: true },
    { x: 112, y: 40, delay: 500, dropped: false },
  ];
  return (
    <svg viewBox="0 0 130 90" className="h-full w-full" role="img" aria-label="Signals arriving; two dropped for having no verifiable source url">
      <g stroke={accent} strokeWidth={STROKE} fill="none">
        <path d="M8 78 L30 78 M14 84 L34 84" opacity="0.5" />
        <path d="M22 62 l10 -6 l10 6 l-10 6 z" opacity="0.35" />
        <path d="M14 56 q10 -10 22 -6" opacity="0.4" />
      </g>
      {arrivals.map((a, i) => (
        <circle key={i} cx={a.x} cy={a.y} r={a.dropped ? 1.6 : 2.4}
          fill={a.dropped ? 'none' : accent} stroke={accent} strokeWidth={STROKE}
          className={live ? (a.dropped ? 'pn-run pn-drift-out' : 'pn-run pn-drift-in') : 'pn-idle'}
          style={{ animationDelay: `${a.delay}ms` }} />
      ))}
    </svg>
  );
}

/** ATHENA - the signals pull into clusters; two clusters stay linked but unmerged. */
export function AthenaMotif({ accent, live }: MotifProps) {
  return (
    <svg viewBox="0 0 130 90" className="h-full w-full" role="img" aria-label="Signals clustered; two clusters linked by a dashed line, published as possible duplicates rather than merged">
      <g className={frame(live, 'settle')}>
        <circle cx="30" cy="34" r="13" fill="none" stroke={accent} strokeWidth={STROKE} opacity="0.7" />
        <circle cx="72" cy="30" r="11" fill="none" stroke={accent} strokeWidth={STROKE} opacity="0.7" />
        <circle cx="98" cy="62" r="9" fill="none" stroke={accent} strokeWidth={STROKE} opacity="0.7" />
        {[[26, 30], [34, 36], [28, 40], [72, 26], [76, 34], [68, 33], [98, 60], [101, 65]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.9" fill={accent} />
        ))}
      </g>
      <path d="M83 30 L87 30" stroke={accent} strokeWidth={STROKE} strokeDasharray="3 3" opacity="0.9"
        className={live ? 'pn-run pn-dash' : 'pn-idle'} />
      <g stroke={accent} strokeWidth={STROKE} fill="none" opacity="0.45">
        <circle cx="112" cy="20" r="7" />
        <circle cx="109.5" cy="19" r="1.4" fill={accent} />
        <circle cx="114.5" cy="19" r="1.4" fill={accent} />
        <path d="M112 22 l-2 2 h4 z" fill={accent} stroke="none" />
      </g>
    </svg>
  );
}

/** APOLLO - a target closes over the largest cluster, pre-cracked, with its falsification test marked. */
export function ApolloMotif({ accent, live }: MotifProps) {
  return (
    <svg viewBox="0 0 130 90" className="h-full w-full" role="img" aria-label="A hypothesis target with a named falsification test and a hairline crack already in it">
      <g fill="none" stroke={accent} strokeWidth={STROKE}>
        <circle cx="58" cy="45" r="26" opacity="0.35" className={live ? 'pn-run pn-close' : 'pn-idle'} />
        <circle cx="58" cy="45" r="17" opacity="0.6" className={live ? 'pn-run pn-close' : 'pn-idle'} style={{ animationDelay: '120ms' }} />
        <circle cx="58" cy="45" r="8" opacity="0.9" className={live ? 'pn-run pn-close' : 'pn-idle'} style={{ animationDelay: '240ms' }} />
        <path d="M58 27 L58 63" opacity="0.25" />
        <path id="pn-crack" d="M58 19 l4 9 l-3 6 l4 8" strokeWidth={STROKE} opacity="0.95"
          className={live ? 'pn-run pn-crack' : 'pn-idle'} />
        <path d="M96 66 L112 22" opacity="0.5" />
        <path d="M100 24 q9 18 8 40" opacity="0.4" />
        <path d="M92 45 L118 45" opacity="0.3" strokeDasharray="2 4" />
      </g>
      <text x="90" y="80" fill={accent} opacity="0.75" fontSize="7" fontFamily="monospace" letterSpacing="0.1em">FALSIFY</text>
    </svg>
  );
}

/** ZEUS - the bolt becomes a bracket, clamping only the cited half. */
export function ZeusMotif({ accent, live }: MotifProps) {
  return (
    <svg viewBox="0 0 130 90" className="h-full w-full" role="img" aria-label="A bolt landing as a citation bracket over the cited half only; the uncited half stays open">
      <g fill="none" stroke={accent} strokeWidth={STROKE}>
        <path d="M64 12 l-9 22 h8 l-7 20 l18 -26 h-8 l7 -16 z" opacity="0.9"
          className={live ? 'pn-run pn-strike' : 'pn-idle'} />
        <path d="M34 60 h-6 v22 h6" opacity="0.95" className={live ? 'pn-run pn-clamp-l' : 'pn-idle'} />
        <path d="M64 60 h6 v22 h-6" opacity="0.95" className={live ? 'pn-run pn-clamp-r' : 'pn-idle'} />
        <path d="M36 71 L62 71" opacity="0.7" />
        <path d="M78 71 L118 71" opacity="0.18" strokeDasharray="3 5" />
      </g>
      <text x="78" y="60" fill={accent} opacity="0.35" fontSize="6.5" fontFamily="monospace" letterSpacing="0.1em">NOT ESTABLISHED</text>
    </svg>
  );
}

/** ARES - the crack widens, and the named alternative is drawn beside the claim. */
export function AresMotif({ accent, live }: MotifProps) {
  return (
    <svg viewBox="0 0 130 90" className="h-full w-full" role="img" aria-label="A spear widening the crack in the claim while a second ring, the named alternative explanation, is drawn beside it">
      <g fill="none" stroke={accent} strokeWidth={STROKE}>
        <circle cx="42" cy="46" r="18" opacity="0.55" />
        <path d="M42 28 l6 11 l-5 7 l6 10" opacity="0.95" className={live ? 'pn-run pn-widen' : 'pn-idle'} />
        <circle cx="92" cy="46" r="18" strokeDasharray="4 4" opacity="0.7"
          className={live ? 'pn-run pn-draw-alt' : 'pn-idle'} />
        <path d="M112 16 L74 54" opacity="0.8" className={live ? 'pn-run pn-jab' : 'pn-idle'} />
        <path d="M104 16 h8 v8" opacity="0.8" className={live ? 'pn-run pn-jab' : 'pn-idle'} />
        <path d="M14 62 q10 8 20 4" opacity="0.4" />
        <path d="M16 60 l-4 -6 l6 -3" opacity="0.4" />
      </g>
      <text x="76" y="80" fill={accent} opacity="0.7" fontSize="6.5" fontFamily="monospace" letterSpacing="0.1em">ALTERNATIVE</text>
    </svg>
  );
}

/** HADES - the gate drops on an escalation and stamps it back down. It has no lifting mechanism. */
export function HadesMotif({ accent, live }: MotifProps) {
  return (
    <svg viewBox="0 0 130 90" className="h-full w-full" role="img" aria-label="A gate dropping across an escalation chevron and stamping it back down a band; the helm is held, not worn">
      <g fill="none" stroke={accent} strokeWidth={STROKE}>
        <path d="M44 40 l12 -12 l12 12" opacity="0.5" />
        <path d="M44 56 l12 -12 l12 12" opacity="0.25" />
        <path d="M26 34 H86" opacity="0.95" className={live ? 'pn-run pn-gate' : 'pn-idle'} />
        <path d="M26 34 v-6 M86 34 v-6" opacity="0.6" className={live ? 'pn-run pn-gate' : 'pn-idle'} />
        <path d="M40 70 h32" opacity="0.9" className={live ? 'pn-run pn-stamp' : 'pn-idle'} />
        <path d="M104 44 q-9 -14 0 -22 q9 8 0 22 z" opacity="0.7" />
        <path d="M100 44 h8 v6 h-8 z" opacity="0.5" />
        <path d="M104 50 v14" opacity="0.35" />
      </g>
      <text x="34" y="82" fill={accent} opacity="0.75" fontSize="6.5" fontFamily="monospace" letterSpacing="0.1em">CAPPED, NEVER RAISED</text>
    </svg>
  );
}

/** HEPHAESTUS - hammer meets anvil and the sparks resolve into the sealed brief. */
export function HephaestusMotif({ accent, live }: MotifProps) {
  return (
    <svg viewBox="0 0 130 90" className="h-full w-full" role="img" aria-label="A hammer striking an anvil, the sparks resolving into a sealed brief">
      <g fill="none" stroke={accent} strokeWidth={STROKE}>
        <g className={live ? 'pn-run pn-hammer' : 'pn-idle'} style={{ transformOrigin: '30px 62px' }}>
          <path d="M18 30 h20 v8 h-20 z" opacity="0.9" />
          <path d="M28 38 L30 62" opacity="0.7" />
        </g>
        <path d="M16 68 h34 l-5 8 h-24 z" opacity="0.8" />
        <path d="M22 76 h22" opacity="0.5" />
        {[[54, 44], [60, 52], [50, 56], [64, 38]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.5" fill={accent} stroke="none"
            className={live ? 'pn-run pn-spark' : 'pn-idle'} style={{ animationDelay: `${300 + i * 70}ms` }} />
        ))}
        <g className={live ? 'pn-run pn-seal-in' : 'pn-idle'}>
          <path d="M78 26 h34 v46 h-34 z" opacity="0.75" />
          <path d="M84 36 h22 M84 44 h22 M84 52 h14" opacity="0.4" />
          <circle cx="106" cy="66" r="5" opacity="0.9" />
        </g>
      </g>
    </svg>
  );
}

export const MOTIFS = [HermesMotif, AthenaMotif, ApolloMotif, ZeusMotif, AresMotif, HadesMotif, HephaestusMotif] as const;
