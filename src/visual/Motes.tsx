/**
 * Evidence motes - the only particles in this console.
 *
 * One mote per evidence id the event on the cursor genuinely cited, travelling from the speaker's station
 * toward the core. An event that cited nothing draws nothing. The count is capped at five with the true
 * number printed beside the station, because a swarm of dots is not more information than a number is.
 *
 * The component takes a count, not a graph: it cannot look anything up, so it cannot show evidence that
 * was not cited.
 */
export function EvidenceMotes({ from, count, accent }: {
  from: { x: number; y: number };
  count: number;
  accent: string;
}) {
  if (count === 0) return null;
  const shown = Math.min(count, 5);
  return (
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => {
        const t = 0.24 + (i / Math.max(1, shown - 1)) * 0.52;
        return (
          <circle
            key={i}
            className="rs-mote"
            cx={from.x + (50 - from.x) * t}
            cy={from.y + (50 - from.y) * t}
            r={0.7}
            fill={accent}
            style={{ animationDelay: `${i * 90}ms` }}
          />
        );
      })}
    </svg>
  );
}
