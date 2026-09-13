import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import { useSession } from '@app/store/session';
import { MODE_NOTE, type Mode } from '@app/lib/engine';
import { Dot, Tag } from '@app/ui/kit';
import { CommandCenter } from '@app/screens/CommandCenter';
import { NewInvestigation } from '@app/screens/NewInvestigation';
import { AgentConsole } from '@app/screens/AgentConsole';
import { DisagreementRoom } from '@app/screens/DisagreementRoom';
import { EvidenceGraph } from '@app/screens/EvidenceGraph';
import { RedTeam } from '@app/screens/RedTeam';

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

function Frame({ children }: { children: React.ReactNode }) {
  const { runs, live } = useSession();
  const location = useLocation();
  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col hair-r border-r border-line bg-ink-800">
        <div className="hair-b px-5 py-5">
          <div className="font-mono text-sm font-medium tracking-[0.2em] text-fg">RISK<span className="text-signal">//</span>SWARM</div>
          <p className="mt-2 text-2xs leading-relaxed text-fg-mute">Where AI agents disagree before humans decide.</p>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
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
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-6 hair-b bg-ink-800 px-6 py-3">
          <div className="flex items-center gap-4">
            <span className="kicker">{NAV.find((n) => n.to === location.pathname)?.label ?? 'Command Center'}</span>
            {live.length > 0 && <Tag tone="signal"><Dot tone="signal" pulse /> {live.length}/7 phases</Tag>}
          </div>
          <div className="flex items-center gap-6">
            <ModeSwitch />
            <KillSwitch />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </main>
    </div>
  );
}

const Stub = ({ name }: { name: string }) => (
  <div className="hair bg-ink-800 p-10 text-center text-sm text-fg-mute">{name} — next slice.</div>
);

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Frame>
        <Routes>
          <Route path="/" element={<CommandCenter />} />
          <Route path="/new" element={<NewInvestigation />} />
          <Route path="/console" element={<AgentConsole />} />
          <Route path="/graph" element={<EvidenceGraph />} />
          <Route path="/disagreement" element={<DisagreementRoom />} />
          <Route path="/redteam" element={<RedTeam />} />
          <Route path="/brief" element={<Stub name="Decision Brief" />} />
          <Route path="/history" element={<Stub name="History" />} />
          <Route path="/agents" element={<Stub name="Agent Performance" />} />
          <Route path="/provenance" element={<Stub name="Knowledge & Provenance" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Frame>
    </BrowserRouter>
  );
}
