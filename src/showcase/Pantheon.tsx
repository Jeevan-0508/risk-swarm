/**
 * MEET THE AGENTS - the showcase page. Not one of the ten operational screens, and deliberately not
 * reachable from the console's sidebar: it renders outside the app frame, on its own route, from its own
 * folder, in its own lazy-loaded chunk with its own stylesheet.
 *
 * Why the separation is structural rather than a promise: the console's Screen-1 spec rules out imagery
 * of this kind, and a shared component or a shared stylesheet is how that rule would eventually erode.
 * Nothing in `src/app` imports anything from here.
 *
 * The one hard rule the page inherits from the tool: the seal at the end carries a band from a run that
 * really happened in this browser, or it carries nothing and says so. See `seal.ts`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@app/store/session';
import { PANTHEON } from './gods';
import { MOTIFS } from './Motifs';
import { sealFrom } from './seal';
import './pantheon.css';

/** Fires once per section, the first time it is genuinely in view. Never re-triggers on scroll-back. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (node === null || seen) return;

    // Content must never depend on an observer callback arriving. If there is no IntersectionObserver,
    // or the section is already on screen at mount (a deep link, a restored scroll position, a tab that
    // was hidden while loading and so never got a callback), reveal it directly.
    const onScreen = () => {
      const box = node.getBoundingClientRect();
      return box.top < (window.innerHeight || 0) && box.bottom > 0;
    };
    if (typeof IntersectionObserver === 'undefined' || onScreen()) {
      setSeen(true);
      return;
    }

    // threshold 0 with a negative bottom margin rather than a percentage of the target: a section can be
    // taller than a short window, in which case a ratio threshold is unreachable. This fires as soon as
    // any part of the section clears the bottom 15% of the viewport, at any window height.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: 0, rootMargin: '0px 0px -15% 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [seen]);

  return { ref, seen };
}

function GodSection({ index }: { index: number }) {
  const god = PANTHEON[index];
  const Motif = MOTIFS[index];
  const { ref, seen } = useInView<HTMLElement>();
  const flip = index % 2 === 1;

  return (
    <section ref={ref} className="mx-auto max-w-5xl px-6 py-16 md:py-24">
      <div className={`grid items-center gap-10 md:grid-cols-2 ${seen ? 'pn-enter' : 'opacity-0'}`}>
        <div className={flip ? 'md:order-2' : ''}>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-2xs tracking-[0.2em]" style={{ color: god.accent, opacity: 0.7 }}>
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="font-mono text-2xs uppercase tracking-[0.2em] text-fg-mute">{god.agent}</span>
          </div>
          <h2 className="mt-3 text-4xl font-light tracking-tight md:text-5xl" style={{ color: god.accent }}>{god.god}</h2>
          <div className="mt-1 font-mono text-2xs uppercase tracking-[0.18em] text-fg-mute">
            {god.domain} · {god.symbol}
          </div>
          <p className="mt-6 text-lg font-light leading-relaxed text-fg">{god.blurb}</p>
          <p className="mt-5 text-sm leading-relaxed text-fg-dim">{god.mechanism}</p>
          <p className="mt-5 text-xs italic leading-relaxed text-fg-mute">{god.pose}</p>
        </div>

        <div className={flip ? 'md:order-1' : ''}>
          <div className="hair aspect-[13/9] w-full bg-ink-900/60 p-4">
            <Motif accent={god.accent} live={seen} />
          </div>
          <p className="mt-3 text-2xs leading-relaxed text-fg-mute">{god.beat}</p>
        </div>
      </div>
    </section>
  );
}

function Seal() {
  const runs = useSession((s) => s.runs);
  const hydrate = useSession((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);

  const seal = useMemo(() => sealFrom(runs), [runs]);
  const { ref, seen } = useInView<HTMLDivElement>();

  return (
    <div ref={ref} className={`mx-auto max-w-3xl px-6 pb-6 ${seen ? 'pn-enter' : 'opacity-0'}`}>
      <div className="hair bg-ink-900/70 p-8 text-center">
        <div className="label">the seal</div>
        {seal.kind === 'real' ? (
          <>
            <div className="mt-4 text-4xl font-light tracking-tight text-fg">{seal.action_band.replace(/_/g, ' ')}</div>
            <div className="num mt-3 text-xs text-fg-dim">
              {seal.severity_band} severity · confidence{' '}
              {seal.confidence === null ? <span className="text-caution">withheld</span> : seal.confidence}
            </div>
            <p className="mx-auto mt-5 max-w-xl text-xs leading-relaxed text-fg-mute">
              Stamped from run <span className="num text-fg-dim">{seal.run_id}</span> ({seal.mode} mode,{' '}
              {seal.created_at.slice(0, 10)}) - a real investigation stored in this browser, asking:{' '}
              <span className="text-fg-dim">{seal.question}</span>
            </p>
          </>
        ) : (
          <>
            <div className="mt-4 text-2xl font-light tracking-tight text-caution">nothing to stamp</div>
            <p className="mx-auto mt-4 max-w-xl text-xs leading-relaxed text-fg-mute">{seal.reason}</p>
            <Link to="/new" className="mt-6 inline-block border border-line-bright px-3.5 py-2 font-mono text-2xs uppercase tracking-[0.14em] text-fg-dim transition-colors hover:text-fg">
              run one in the console
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function Pantheon() {
  return (
    <div className="pn-page h-full overflow-y-auto">
      <header className="mx-auto max-w-5xl px-6 pt-20 pb-6 md:pt-28">
        <div className="font-mono text-2xs uppercase tracking-[0.24em] text-fg-mute">Risk//Swarm · a story about the pipeline</div>
        <h1 className="mt-6 text-5xl font-light leading-[1.05] tracking-tight md:text-7xl">
          Seven agents.<br />
          <span className="text-fg-dim">No single oracle.</span>
        </h1>
        <p className="mt-8 max-w-2xl text-lg font-light leading-relaxed text-fg-dim">
          One question enters. Seven specialists take it apart in order - and the interesting part is what each
          of them is forbidden to do. Scroll, and the evidence moves through them.
        </p>
        <div className="pn-rule mt-12 text-line-bright" />
      </header>

      {PANTHEON.map((god, i) => (
        <div key={god.agent}>
          <GodSection index={i} />
          {i < PANTHEON.length - 1 && (
            <div className="mx-auto max-w-5xl px-6">
              <div className="pn-rule text-line" />
            </div>
          )}
        </div>
      ))}

      <div className="mx-auto max-w-5xl px-6 pt-10 pb-4">
        <div className="pn-rule text-line-bright" />
      </div>
      <Seal />

      <footer className="mx-auto max-w-3xl px-6 pb-24 pt-10 text-center">
        <p className="text-sm leading-relaxed text-fg-dim">
          This page is the story. The tool is not written in this voice, has no gods in it, and shows no
          pictures - it is a dense operator console for reading evidence and refusing bad conclusions.
        </p>
        <Link to="/" className="mt-8 inline-block bg-fg px-4 py-2.5 font-mono text-2xs uppercase tracking-[0.14em] text-ink-900 transition-colors hover:bg-white">
          open the real console
        </Link>
        <p className="mt-10 font-mono text-2xs leading-relaxed tracking-[0.1em] text-fg-mute">
          every mechanism described above is a real property of the agent named beside it. nothing on this
          page is a mock-up of a feature that does not exist.
        </p>
      </footer>
    </div>
  );
}
