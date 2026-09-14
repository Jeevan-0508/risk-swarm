import jkLogo from '../assets/jk-logo.png';
import { Suspense, lazy, useEffect } from 'react';
import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import { useSession } from '@app/store/session';
import { MODE_NOTE, type Mode } from '@app/lib/engine';
import { Dot, Tag } from '@app/ui/kit';
import { CommandCenter } from '@app/screens/CommandCenter';
import { NewInvestigation } from '@app/screens/NewInvestigation';
import { AgentConsole } from '@app/screens/AgentConsole';
import { DisagreementRoom } from '@app/screens/DisagreementRoom';
import { AgentPerformance } from '@app/screens/AgentPerformance';
import { DecisionBrief } from '@app/screens/DecisionBrief';
import { History } from '@app/screens/History';
import { CaseFile } from '@app/screens/CaseFile';
import { Provenance } from '@app/screens/Provenance';
import { EvidenceGraph } from '@app/screens/EvidenceGraph';
import { RedTeam } from '@app/screens/RedTeam';

/**
 * The showcase page is lazy so it never enters the console's bundle, and it lives outside `Frame` so it
 * has no sidebar, no mode switch and no nav entry. It is reachable only by url, on purpose: it is a story
 * about the system, not a screen of it.
 */
const Pantheon = lazy(() => import('../showcase/Pantheon'));

/*
 * Four leaf screens are lazy because each is the only reader of a subtree nothing else imports - the
 * eight retrieval providers, the ORBIT scenario runner, the approval workflow, the knowledge index
 * reader. Loading them on first paint charges every visitor for screens most never open. The router
 * frame and the command centre stay eager: a spinner on the screen you landed on is a worse trade.
 */
const InternalKnowledge = lazy(() => import('@app/screens/InternalKnowledge').then((m) => ({ default: m.InternalKnowledge })));
const Research = lazy(() => import('@app/screens/Research').then((m) => ({ default: m.Research })));
const KnowledgeDelta = lazy(() => import('@app/screens/KnowledgeDelta').then((m) => ({ default: m.KnowledgeDelta })));
const ScenarioRoom = lazy(() => import('@app/screens/ScenarioRoom').then((m) => ({ default: m.ScenarioRoom })));

/**
 * THE COUNCIL is lazy and frameless for the same reasons, plus one of its own: it has its own visual
 * identity (its own stylesheet, its own ring layout), and rendering it inside the console frame would
 * make it look like a twelfth dense screen instead of the chamber it is. Reachable from the sidebar,
 * unlike the showcase, because it reads a real run's real transcript.
 */
const Council = lazy(() => import('../council/Council'));

const NAV: Array<{ to: string; n: string; label: string }> = [
  { to: '/', n: '01', label: 'Command Center' },
  { to: '/new', n: '02', label: 'New Investigation' },
  { to: '/console', n: '03', label: 'Agent Console' },
  { to: '/graph', n: '04', label: 'Evidence Graph' },
  { to: '/disagreement', n: '05', label: 'Disagreement Room' },
  { to: '/redteam', n: '06', label: 'Red Team' },
  { to: '/brief', n: '07', label: 'Decision Brief' },
  { to: '/history', n: '08', label: 'History' },
  { to: '/agents', n: '09', label: 'Agent Performance' },
  { to: '/provenance', n: '10', label: 'Knowledge & Provenance' },
  { to: '/orbit', n: '11', label: 'Scenario Room' },
  { to: '/knowledge', n: '12', label: 'Internal Knowledge' },
  { to: '/research', n: '13', label: 'Research' },
  { to: '/knowledge-delta', n: '14', label: 'Knowledge Delta' },
];

const MODES: Mode[] = ['DEMO', 'SNAPSHOT', 'LIVE'];

function ModeSwitch() {
  const { mode, setMode } = useSession();
  return (
    <div className="flex items-center gap-3">
      <span className="label">mode</span>
      <div className="flex hair">
        {MODES.map((m) => (
          <button key={m} onClick={() => setMode(m)} title={MODE_NOTE[m]}
            className={`px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.12em] transition-colors ${
              mode === m ? 'bg-fg text-ink-900' : 'text-fg-mute hover:text-fg'}`}>
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}

function KillSwitch() {
  const { control, stop } = useSession();
  if (!control) return <span className="label">idle</span>;
  return (
    <button onClick={() => stop('stopped by the operator')}
      className="flex items-center gap-2 border border-block/60 px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.14em] text-block transition-colors hover:bg-block hover:text-ink-900">
      <Dot tone="block" pulse />
      stop run
    </button>
  );
}

/**
 * The nav, twice. Below `lg` the sidebar would leave a phone about eighty pixels for the screen itself,
 * so it is replaced by a horizontally scrollable strip of the same entries under the header. Two
 * renderings of one `NAV` array rather than a drawer: a drawer needs open/closed state, and state that
 * can disagree with the route is a bug waiting for a narrow window.
 */
function NavStrip() {
  return (
    <nav aria-label="screens" className="flex gap-1 overflow-x-auto hair-b bg-ink-800 px-4 py-2 lg:hidden">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          title={item.label}
          className={({ isActive }) =>
            `shrink-0 px-2 py-1 font-mono text-2xs uppercase tracking-[0.12em] transition-colors ${
              isActive ? 'bg-fg text-ink-900' : 'text-fg-mute hover:text-fg'
            }`
          }
        >
          {item.n}
        </NavLink>
      ))}
    </nav>
  );
}

function Frame() {
  const { runs, live, running } = useSession();
  const location = useLocation();
  return (
    <div className="flex h-full">
      <a
        href="#screen"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-fg focus:px-3 focus:py-1.5 focus:font-mono focus:text-2xs focus:uppercase focus:tracking-[0.14em] focus:text-ink-900"
      >
        skip to the screen
      </a>
      <aside className="hidden w-60 shrink-0 flex-col hair-r border-r border-line bg-ink-800 lg:flex">
        <div className="hair-b px-5 py-5">
          <div className="flex items-center gap-2">
            <div className="font-mono text-sm font-medium tracking-[0.2em] text-fg">RISK<span className="text-signal">//</span>SWARM</div>
            <a href="https://github.com/Jeevan-0508" target="_blank" rel="noopener" title="Jeevan Siddhabhaktula" className="ml-auto shrink-0"><img src={jkLogo} alt="JK" className="h-[26px] w-[26px] rounded-full object-cover opacity-90" /></a>
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-fg-mute">Where AI agents disagree before humans decide.</p>
        </div>
        <nav aria-label="screens" className="flex-1 overflow-y-auto py-2">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-baseline gap-3 px-5 py-2 text-sm transition-colors ${
                  isActive ? 'border-l-2 border-signal bg-ink-700 pl-[18px] text-fg' : 'border-l-2 border-transparent text-fg-dim hover:text-fg'}`}>
              <span className="num text-2xs text-fg-mute">{item.n}</span>
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="hair-t px-5 py-3">
          <div className="label">investigations</div>
          <div className="num mt-1 text-lg font-light">{runs.length}</div>
        </div>
        <div className="hair-t px-5 py-3">
          <Link to="/council" className="block text-2xs uppercase tracking-[0.14em] text-fg-mute transition-colors hover:text-fg">
            The Council &#8599;
          </Link>
          <Link to="/pantheon" className="mt-2 block text-2xs uppercase tracking-[0.14em] text-fg-mute transition-colors hover:text-fg">
            Meet the Agents &#8599;
          </Link>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <NavStrip />
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 hair-b bg-ink-800 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <span className="kicker">{NAV.find((n) => n.to === location.pathname)?.label ?? 'Command Center'}</span>
            <span role="status" aria-live="polite">
              {running && <Tag tone="signal"><Dot tone="signal" pulse /> {live.length}/7 phases</Tag>}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <ModeSwitch />
            <KillSwitch />
          </div>
        </header>
        <div id="screen" className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {/* One boundary for all framed screens: a lazy screen must not blank the sidebar with it. */}
          <Suspense fallback={<span className="label">loading the screen</span>}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

export function App() {
  const hydrate = useSession((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route
          path="/council"
          element={
            <Suspense fallback={<div className="grid h-full place-items-center"><span className="label">loading</span></div>}>
              <Council />
            </Suspense>
          }
        />
        <Route
          path="/pantheon"
          element={
            <Suspense fallback={<div className="grid h-full place-items-center"><span className="label">loading</span></div>}>
              <Pantheon />
            </Suspense>
          }
        />
        <Route element={<Frame />}>
          <Route path="/" element={<CommandCenter />} />
          <Route path="/new" element={<NewInvestigation />} />
          <Route path="/console" element={<AgentConsole />} />
          <Route path="/graph" element={<EvidenceGraph />} />
          <Route path="/disagreement" element={<DisagreementRoom />} />
          <Route path="/redteam" element={<RedTeam />} />
          <Route path="/brief" element={<DecisionBrief />} />
          <Route path="/history" element={<History />} />
          {/* A detail view of screen 08, deliberately absent from NAV: it is only reachable from a run. */}
          <Route path="/history/:id" element={<CaseFile />} />
          <Route path="/agents" element={<AgentPerformance />} />
          <Route path="/provenance" element={<Provenance />} />
          <Route path="/orbit" element={<ScenarioRoom />} />
          <Route path="/knowledge" element={<InternalKnowledge />} />
          <Route path="/research" element={<Research />} />
          <Route path="/knowledge-delta" element={<KnowledgeDelta />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
