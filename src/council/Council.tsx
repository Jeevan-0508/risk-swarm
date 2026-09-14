/**
 * THE COUNCIL - `/council`. A twelfth route that renders outside the console frame, in its own lazy
 * chunk, with its own stylesheet: the chamber where the deliberation this run actually produced can be
 * read one exchange at a time.
 *
 * This file is only the shell - it finds the active run and owns the stylesheet. Everything that draws
 * lives in `Chamber.tsx`, which never touches the store, so it can be rendered in a test.
 *
 * If there is no run, the chamber says so. It never seats a demo.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createAtlasMatcher, type Pattern } from '../core/integrations/atlas';
import { snapshotLoader } from '../app/lib/engine';
import { useSession } from '../app/store/session';
import { Chamber, Label } from './Chamber';
import { useMotionAllowed } from '../visual/motion';
import './council.css';
import '../visual/console.css';

/**
 * The pinned taxonomy, fetched once so the lineage zone can name the indicators nobody has looked at.
 * It is loaded here rather than inside `Chamber` for two reasons: `Chamber` stays synchronous and
 * testable, and a failed fetch must degrade to "not loaded" instead of an empty list that would read as
 * "nothing left to check". `patterns` is `null` until it really arrives, and stays `null` if it never
 * does - the zone says so in words either way.
 */
function usePatterns(active: boolean): Map<string, Pattern> | null {
  const [patterns, setPatterns] = useState<Map<string, Pattern> | null>(null);

  useEffect(() => {
    if (!active || patterns !== null) return;
    let cancelled = false;
    void createAtlasMatcher(snapshotLoader())
      .patterns()
      .then((all) => {
        if (!cancelled) setPatterns(new Map(all.map((p) => [p.id, p])));
      })
      .catch(() => {
        // Deliberately swallowed: the zone's own copy already reads as "not loaded", which is true.
      });
    return () => {
      cancelled = true;
    };
  }, [active, patterns]);

  return patterns;
}

export default function Council() {
  const { active } = useSession();
  const run = active();
  const result = run?.result ?? null;
  const patterns = usePatterns(result !== null);
  // Motion is a class, not a media query, so a reduced-motion reader and a backgrounded tab both simply
  // stop matching the animated selectors. `console.css` keeps the media query as a second mechanism.
  const motion = useMotionAllowed();

  return (
    <div className={`cn-page rs-console h-full overflow-y-auto${motion ? ' rs-motion' : ''}`}>
      <header className="mx-auto max-w-7xl px-6 pt-14 pb-8">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <Label>Risk//Swarm · the council</Label>
            <h1 className="mt-4 text-4xl font-light leading-tight tracking-tight md:text-5xl">
              Seven seats.<br />
              <span className="text-fg-dim">One transcript, on the record.</span>
            </h1>
          </div>
          <Link to="/" className="font-mono text-2xs uppercase tracking-[0.14em] text-fg-mute transition-colors hover:text-fg">
            &#8592; back to the console
          </Link>
        </div>
        {result !== null && (
          <p className="mt-6 max-w-2xl text-sm leading-relaxed text-fg-dim">
            <span className="num text-fg-mute">{result.run_id}</span> — {result.question}
          </p>
        )}
      </header>

      {result === null ? (
        <div className="mx-auto max-w-2xl px-6 pb-24">
          <div className="cn-hair p-8 text-center">
            <Label>the chamber is empty</Label>
            <p className="mt-4 text-sm leading-relaxed text-fg-dim">
              A deliberation is a record of a real investigation. There is no run loaded in this browser, so
              there is nothing to read — and the council will not seat a demonstration in its place.
            </p>
            <Link to="/new" className="mt-6 inline-block bg-fg px-4 py-2.5 font-mono text-2xs uppercase tracking-[0.14em] text-ink-900 transition-colors hover:bg-white">
              run an investigation
            </Link>
          </div>
        </div>
      ) : (
        <Chamber key={result.run_id} result={result} patterns={patterns} humanVerdict={run?.human?.verdict ?? null} />
      )}

      <footer className="mx-auto max-w-7xl px-6 pb-20 pt-4">
        <p className="text-2xs leading-relaxed text-fg-mute">
          Every exchange above was emitted by <span className="text-fg-dim">core/deliberation/coordinator.ts</span> from
          this run's own agent output, and every evidence id it cites was checked against the graph before it
          was written. This screen has no way to author an event.
        </p>
      </footer>
    </div>
  );
}
