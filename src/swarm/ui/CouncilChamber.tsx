import { useMemo, useState, type ReactNode } from 'react';
import type { SwarmBlackboard, SwarmExecutionEvent } from '../contracts';
import { buildCouncilViewModel, type CouncilViewModel } from './view-model';
import { ChamberScene } from './CinematicChamber';
import './council-chamber.css';

function StateBadge({ children }: { readonly children: ReactNode }) {
  return <span className="swarm-state-badge">{children}</span>;
}

export function CouncilSeat({ seat, selected, onSelect }: { readonly seat: CouncilViewModel['seats'][number]; readonly selected: boolean; readonly onSelect: () => void }) {
  return (
    <button type="button" className={`swarm-seat swarm-seat-${seat.seat_id.toLowerCase()}${selected ? ' is-selected' : ''}${seat.active ? ' is-active' : ''}`} onClick={onSelect} aria-pressed={selected} aria-label={`${seat.label}, ${seat.state}`}>
      <span className="swarm-seat-glyph" aria-hidden="true">{seat.seat_id.slice(0, 1)}</span>
      <span className="swarm-seat-name">{seat.label}</span>
      <span className="swarm-seat-role">{seat.state}</span>
      {seat.position && <span className="swarm-seat-risk">{seat.position.risk_level} · {seat.position.confidence === null ? '—' : seat.position.confidence.toFixed(2)}</span>}
    </button>
  );
}

function Inspector({ model, seatId, disagreementId }: { readonly model: CouncilViewModel; readonly seatId: string | null; readonly disagreementId: string | null }) {
  const seat = model.seats.find((item) => item.seat_id === seatId);
  const disagreement = model.disagreements.find((item) => item.disagreement.disagreement_id === disagreementId);
  if (disagreement) return <aside className="swarm-inspector" aria-label="Disagreement inspector"><StateBadge>{disagreement.disagreement.status}</StateBadge><h3>{disagreement.disagreement.type}</h3><p>{disagreement.disagreement.basis}</p><p>{disagreement.disagreement.evidence_ids.length} evidence references · {disagreement.disagreement.subject_ids.length} subjects</p></aside>;
  if (!seat) return <aside className="swarm-inspector" aria-label="Council guidance"><StateBadge>{model.phase}</StateBadge><h3>AI SYNTHESIS → HUMAN REVIEW</h3><p>Choose a seat or an open disagreement to inspect the structured record. The chamber renders events; it does not invent them.</p><p className="swarm-human-boundary">HUMAN DECISION REQUIRED · {model.human_review.status}</p></aside>;
  return <aside className="swarm-inspector" aria-label={`${seat.label} inspector`}><StateBadge>{seat.state}</StateBadge><h3>{seat.label}</h3>{seat.position ? <><p>{seat.position.conclusion}</p><p>{seat.position.evidence_ids.length} evidence references · {seat.position.claims.length} claims</p><p>Execution: {seat.position.execution.status} · {seat.position.execution.executed_provider ?? 'not executed'}</p></> : <p>No structured position has been recorded for this seat.</p>}</aside>;
}

export function ProtocolTimeline({ model }: { readonly model: CouncilViewModel }) {
  return <ol className="swarm-timeline" aria-label="Protocol timeline">{model.timeline.map((item) => <li key={`${item.sequence}-${item.type}`}><span>{String(item.sequence).padStart(2, '0')}</span><strong>{item.type.replaceAll('_', ' ')}</strong><small>{item.actor}</small></li>)}</ol>;
}

export function GraphView({ model }: { readonly model: CouncilViewModel }) {
  return <section className="swarm-panel" aria-label="Graph view"><StateBadge>GRAPH</StateBadge><h2>Evidence → positions → disagreement</h2><div className="swarm-graph-list">{model.evidence.map((item) => <div key={item.evidence_id}><strong>{item.evidence_id}</strong><span>{model.seats.filter((seat) => seat.position?.evidence_ids.includes(item.evidence_id)).map((seat) => seat.seat_id).join(' · ') || 'unreferenced'}</span></div>)}</div></section>;
}

export function ForensicsView({ model }: { readonly model: CouncilViewModel }) {
  return <section className="swarm-panel" aria-label="Forensics view"><StateBadge>FORENSICS</StateBadge><h2>Safe execution metadata</h2>{model.forensics.map((item) => <div className="swarm-forensic-row" key={item.seat_id}><strong>{item.seat_id}</strong><span>{item.status}</span><span>{item.provider ?? '—'} / {item.model ?? '—'}</span><span>{item.request_id ?? '—'}</span></div>)}</section>;
}

export function ZeusSynthesisPanel({ model, state }: { readonly model: CouncilViewModel; readonly state: SwarmBlackboard }) {
  const synthesis = state.zeus_synthesis;
  return <section className="swarm-panel swarm-zeus-panel" aria-label="Zeus synthesis view"><StateBadge>{model.zeus.synthesized ? 'SYNTHESIS' : model.zeus.ready ? 'ZEUS READY' : 'DORMANT'}</StateBadge><h2>ZEUS · advisory synthesis</h2>{synthesis ? <><p>{synthesis.executive_summary}</p><p>{synthesis.material_disagreements.length} material disagreements remain visible · {synthesis.audit_summary.warning_count} Apollo warning(s)</p><div className="swarm-human-boundary">HUMAN DECISION REQUIRED · PENDING</div></> : <p>Zeus remains dormant until the deterministic readiness gate passes.</p>}</section>;
}

export function CouncilChamber({ state, events = state.execution_events, mode = 'REPLAY' }: { readonly state: SwarmBlackboard; readonly events?: readonly SwarmExecutionEvent[]; readonly mode?: 'LIVE' | 'REPLAY' }) {
  const model = useMemo(() => buildCouncilViewModel(state, events, mode), [state, events, mode]);
  const [seat, setSeat] = useState<string | null>(null);
  const [disagreement, setDisagreement] = useState<string | null>(null);
  const [visualMode, setVisualMode] = useState<'CHAMBER' | 'GRAPH' | 'FORENSICS'>('CHAMBER');
  return <main className="swarm-chamber" data-reduced-motion="auto">
    <header className="swarm-chamber-header"><div><span className="swarm-brand">RISK<span>//</span>SWARM</span><span className="swarm-overline">COUNCIL CHAMBER · {model.mode}</span></div><StateBadge>{model.protocol_state}</StateBadge></header>
    <nav className="swarm-view-switcher" aria-label="Council views">{(['CHAMBER', 'GRAPH', 'FORENSICS'] as const).map((view) => <button key={view} type="button" className={visualMode === view ? 'is-active' : ''} onClick={() => setVisualMode(view)} aria-pressed={visualMode === view}>{view}</button>)}</nav>
    {visualMode === 'CHAMBER' ? <ChamberScene model={model} onSeatSelect={(seatId) => { setSeat(seatId); setDisagreement(null); }} onCoreSelect={() => { setSeat(null); setDisagreement(null); }} /> : visualMode === 'GRAPH' ? <GraphView model={model} /> : <ForensicsView model={model} />}
    <div className="swarm-chamber-grid"><div><section className="swarm-panel"><StateBadge>DISAGREEMENTS</StateBadge><h2>Open relationships stay open</h2><div className="swarm-disagreement-list">{model.disagreements.filter((item) => item.disagreement.status !== 'RESOLVED').map((item) => <button key={item.disagreement.disagreement_id} type="button" onClick={() => { setDisagreement(item.disagreement.disagreement_id); setSeat(null); }}><strong>{item.disagreement.type}</strong><span>{item.disagreement.status} · {item.disagreement.evidence_ids.length} evidence</span></button>)}</div></section><ProtocolTimeline model={model} /></div><Inspector model={model} seatId={seat} disagreementId={disagreement} /></div>
    <ZeusSynthesisPanel model={model} state={state} />
  </main>;
}

export { buildCouncilViewModel } from './view-model';
