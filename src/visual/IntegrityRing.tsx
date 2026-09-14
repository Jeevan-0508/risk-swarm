/**
 * EVOLUTION 5.0 Phase J. SENTINEL and PULSE as one mark.
 *
 * One arc per check, equal arcs, in report order, coloured by that check's own status. Nothing is
 * aggregated into a shape: the ring is the list, drawn. Hovering or focusing an arc names the check and
 * prints its detail verbatim, so the visual is a way into the text rather than a replacement for it - the
 * existing list of rows stays exactly where it was.
 *
 * There is no animation. A ring that pulsed would imply the system was being re-checked while the reader
 * watched, and it is not: this is a finished report.
 */
import { useState } from 'react';
import { SURFACE } from './tokens';
import { arcPath, integrityModel, STATUS_ACCENT, type IntegrityCheckLike } from './integrity';
import type { IntegrityStatus } from '../core/status';

interface Props {
  title: string;
  checks: readonly IntegrityCheckLike[];
  status: IntegrityStatus;
  size?: number;
}

export function IntegrityRing({ title, checks, status, size = 168 }: Props) {
  const model = integrityModel(checks, status);
  const [active, setActive] = useState<string | null>(null);
  const hovered = model.segments.find((s) => s.key === active) ?? null;
  const c = size / 2;
  const r = c - 14;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}: ${status}, ${model.severity} check(s) not verified`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke={SURFACE.hair} strokeWidth={1} />
        {model.segments.map((seg) => (
          <path
            key={seg.key}
            d={arcPath(c, c, r, seg.start, seg.sweep)}
            fill="none"
            stroke={seg.accent}
            strokeWidth={seg.key === active ? 9 : 5}
            strokeLinecap="butt"
            opacity={active === null || seg.key === active ? 1 : 0.35}
            tabIndex={0}
            aria-label={`${seg.label}: ${seg.status}`}
            onMouseEnter={() => setActive(seg.key)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(seg.key)}
            onBlur={() => setActive(null)}
          />
        ))}
        <text x={c} y={c - 2} textAnchor="middle" fill={STATUS_ACCENT[status]} fontSize={13} letterSpacing={1.5}>
          {status}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" fill={SURFACE.hairBright} fontSize={9} letterSpacing={1}>
          {checks.length} CHECKS
        </text>
      </svg>

      <div className="min-w-[14rem] flex-1">
        <div className="label">{title}</div>
        {model.emptyReason !== null ? (
          <p className="mt-2 text-2xs leading-relaxed text-caution">{model.emptyReason}</p>
        ) : hovered === null ? (
          <>
            <p className="mt-2 text-2xs leading-relaxed text-fg-dim">
              {model.counts.VERIFIED} verified · {model.counts.WARNING} warning · {model.counts.BLOCKED} blocked.
              {model.severity === 0 ? ' Every check holds.' : ' Hover or tab an arc to read the check.'}
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-xs text-fg">
              {hovered.label} <span className="num text-2xs" style={{ color: hovered.accent }}>{hovered.status}</span>
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-fg-dim">{hovered.detail}</p>
          </>
        )}
      </div>
    </div>
  );
}
