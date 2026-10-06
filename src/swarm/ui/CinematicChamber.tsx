import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CouncilViewModel } from './view-model';
import type { SeatId } from '../contracts';

const SEAT_POSITIONS: Readonly<Record<SeatId, [number, number, number]>> = {
  ATHENA: [0, 1.35, -4.25],
  ARES: [3.9, 1.05, -1.55],
  HADES: [2.55, 0.95, 3.25],
  APOLLO: [-2.55, 0.95, 3.25],
  ZEUS: [-3.9, 1.05, -1.55],
};

const SEAT_COLORS: Readonly<Record<SeatId, string>> = {
  ATHENA: '#72b6ff',
  ARES: '#ff6e6e',
  HADES: '#b08cff',
  APOLLO: '#63d7ba',
  ZEUS: '#f1c86b',
};

const STATUS_COLORS: Readonly<Record<string, string>> = {
  DORMANT: '#263140', ANALYZING: '#72b6ff', 'POSITION SUBMITTED': '#72b6ff', 'POSITION LOCKED': '#63d7ba',
  'DISAGREEMENT IDENTIFIED': '#f0a25e', RESPONDING: '#ff6e6e', DEFENDED: '#72b6ff', REVISED: '#63d7ba',
  'AUDIT COMPLETE': '#63d7ba', 'ZEUS READY': '#f1c86b', SYNTHESIZING: '#f1c86b', 'HUMAN REVIEW REQUIRED': '#f1c86b',
};

function seatPosition(seat: SeatId): THREE.Vector3 { return new THREE.Vector3(...SEAT_POSITIONS[seat]); }
function midpoint(a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 { return new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5); }

function Beam({ from, to, color, opacity = 0.7, width = 0.018 }: { readonly from: THREE.Vector3; readonly to: THREE.Vector3; readonly color: string; readonly opacity?: number; readonly width?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => {
    const direction = new THREE.Vector3().subVectors(to, from);
    const length = direction.length();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return { length, quaternion, position: midpoint(from, to) };
  }, [from.x, from.y, from.z, to.x, to.y, to.z]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const material = ref.current.material as THREE.MeshBasicMaterial;
    material.opacity = opacity * (0.82 + Math.sin(clock.elapsedTime * 1.4) * 0.12);
  });
  return <mesh ref={ref} position={geometry.position} quaternion={geometry.quaternion}>
    <cylinderGeometry args={[width, width, geometry.length, 8]} />
    <meshBasicMaterial color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} />
  </mesh>;
}

function Pulse({ from, to, color }: { readonly from: THREE.Vector3; readonly to: THREE.Vector3; readonly color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const progress = useRef(0);
  useFrame((_, delta) => {
    if (!ref.current) return;
    progress.current = (progress.current + delta * 0.34) % 1;
    ref.current.position.lerpVectors(from, to, progress.current);
  });
  return <mesh ref={ref}><sphereGeometry args={[0.07, 12, 12]} /><meshBasicMaterial color={color} transparent opacity={0.95} blending={THREE.AdditiveBlending} /></mesh>;
}

function Reactor({ model, onSelect }: { readonly model: CouncilViewModel; readonly onSelect: () => void }) {
  const core = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Group>(null);
  const evidenceNodes = useMemo(() => model.evidence.map((item, index) => {
    const angle = (index / Math.max(model.evidence.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radius = 1.65 + (index % 2) * 0.25;
    return { id: item.evidence_id, position: new THREE.Vector3(Math.cos(angle) * radius, 0.55 + (index % 3) * 0.16, Math.sin(angle) * radius) };
  }), [model.evidence]);
  useFrame(({ clock }) => {
    if (core.current) core.current.rotation.y += 0.0018;
    if (ring.current) ring.current.rotation.y = clock.elapsedTime * 0.08;
  });
  return <group position={[0, 0.18, 0]}>
    <mesh ref={core} onClick={onSelect}><icosahedronGeometry args={[0.78, 3]} /><meshStandardMaterial color="#b7f4ff" emissive="#1b8ca4" emissiveIntensity={1.6} roughness={0.2} metalness={0.55} /></mesh>
    <group ref={ring}>
      <mesh rotation={[Math.PI / 2.2, 0.25, 0]}><torusGeometry args={[1.18, 0.012, 8, 96]} /><meshBasicMaterial color="#63d7ba" transparent opacity={0.72} blending={THREE.AdditiveBlending} /></mesh>
      <mesh rotation={[Math.PI / 2.8, -0.45, 0.2]}><torusGeometry args={[1.52, 0.008, 8, 96]} /><meshBasicMaterial color="#72b6ff" transparent opacity={0.45} blending={THREE.AdditiveBlending} /></mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[1.9, 0.006, 8, 96]} /><meshBasicMaterial color="#f1c86b" transparent opacity={0.3} blending={THREE.AdditiveBlending} /></mesh>
    </group>
    {evidenceNodes.map((item) => <mesh key={item.id} position={item.position}><sphereGeometry args={[0.075, 10, 10]} /><meshBasicMaterial color="#b7f4ff" transparent opacity={0.9} blending={THREE.AdditiveBlending} /></mesh>)}
  </group>;
}

function SeatEntity({ seat, model, onSelect }: { readonly seat: CouncilViewModel['seats'][number]; readonly model: CouncilViewModel; readonly onSelect: () => void }) {
  const group = useRef<THREE.Group>(null);
  const color = STATUS_COLORS[seat.state] ?? SEAT_COLORS[seat.seat_id];
  const baseColor = SEAT_COLORS[seat.seat_id];
  const position = seatPosition(seat.seat_id);
  const isZeus = seat.seat_id === 'ZEUS';
  const hasRevision = seat.position_history.length > 1;
  useFrame(({ clock }) => {
    if (!group.current) return;
    const activity = seat.active ? 1 : 0.15;
    group.current.rotation.y += (isZeus ? 0.0008 : 0.0015) * activity;
    group.current.position.y = position.y + (seat.active ? Math.sin(clock.elapsedTime * 0.7 + position.x) * 0.035 : 0);
  });
  return <group ref={group} position={position} onClick={onSelect}>
    <mesh>{isZeus ? <octahedronGeometry args={[0.52, 1]} /> : <icosahedronGeometry args={[0.42, seat.active ? 2 : 1]} />}<meshStandardMaterial color={baseColor} emissive={color} emissiveIntensity={seat.active ? 1.35 : 0.12} roughness={0.3} metalness={0.72} transparent opacity={seat.active ? 0.96 : 0.6} /></mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[isZeus ? 0.78 : 0.62, hasRevision ? 0.04 : 0.018, 8, 48]} /><meshBasicMaterial color={color} transparent opacity={seat.active ? 0.76 : 0.22} blending={THREE.AdditiveBlending} /></mesh>
    {seat.state === 'AUDIT COMPLETE' && <mesh rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.92, 0.012, 8, 48]} /><meshBasicMaterial color="#63d7ba" transparent opacity={0.85} blending={THREE.AdditiveBlending} /></mesh>}
    {seat.position?.evidence_ids.map((evidenceId, index) => {
      const evidenceIndex = model.evidence.findIndex((item) => item.evidence_id === evidenceId);
      if (evidenceIndex < 0) return null;
      const angle = (evidenceIndex / Math.max(model.evidence.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = 1.65 + (evidenceIndex % 2) * 0.25;
      const evidencePosition = new THREE.Vector3(Math.cos(angle) * radius, 0.73 + (index % 3) * 0.16, Math.sin(angle) * radius);
      return <Beam key={`${seat.seat_id}-${evidenceId}`} from={evidencePosition} to={position} color="#8ce8ff" opacity={0.22} width={0.009} />;
    })}
  </group>;
}

function Relationships({ model }: { readonly model: CouncilViewModel }) {
  const positions = useMemo(() => Object.fromEntries((Object.keys(SEAT_POSITIONS) as SeatId[]).map((seat) => [seat, seatPosition(seat)])) as Record<SeatId, THREE.Vector3>, []);
  const evidenceCore = new THREE.Vector3(0, 0.18, 0);
  return <group>
    {model.disagreements.filter((item) => item.disagreement.status === 'OPEN').flatMap((item) => item.edges.map((edge) => <Beam key={`disagreement-${item.disagreement.disagreement_id}-${edge.from}-${edge.to}`} from={positions[edge.from]} to={positions[edge.to]} color="#f0a25e" opacity={0.48} width={0.028} />))}
    {model.challenges.map((challenge) => {
      const from = positions[challenge.response ? challenge.to : challenge.from];
      const to = positions[challenge.response ? challenge.from : challenge.to];
      const color = challenge.response === 'REVISE' ? '#63d7ba' : challenge.response ? '#72b6ff' : '#ff6e6e';
      return <group key={challenge.challenge_id}><Beam from={from} to={to} color={color} opacity={0.78} width={0.035} /><Pulse from={from} to={to} color={color} /></group>;
    })}
    {(model.zeus.ready || model.zeus.synthesized) && (['ATHENA', 'ARES', 'HADES', 'APOLLO'] as const).map((seat) => <Beam key={`zeus-${seat}`} from={positions[seat]} to={positions.ZEUS} color="#f1c86b" opacity={0.36} width={0.012} />)}
    {(model.zeus.ready || model.zeus.synthesized) && <Beam from={evidenceCore} to={positions.ZEUS} color="#b7f4ff" opacity={0.5} width={0.014} />}
  </group>;
}

function ChamberFallback({ model, onSeatSelect }: { readonly model: CouncilViewModel; readonly onSeatSelect: (seat: SeatId) => void }) {
  return <div className="swarm-webgl-fallback">
    <div className="swarm-fallback-void">
      <div className="swarm-fallback-orbit swarm-fallback-orbit-outer" /><div className="swarm-fallback-orbit swarm-fallback-orbit-middle" /><div className="swarm-fallback-orbit swarm-fallback-orbit-inner" />
      <div className="swarm-fallback-reactor"><span>EVIDENCE REACTOR</span><strong>{model.evidence_core.case_id ?? 'NO CASE LOADED'}</strong><small>{model.evidence_core.evidence_count} sealed evidence · {model.evidence_core.open_disagreement_count} open disagreements</small></div>
      {model.evidence.map((item, index) => <span key={item.evidence_id} className="swarm-fallback-evidence-node" style={{ left: `${50 + Math.cos((index / Math.max(model.evidence.length, 1)) * Math.PI * 2) * 20}%`, top: `${50 + Math.sin((index / Math.max(model.evidence.length, 1)) * Math.PI * 2) * 20}%` }} aria-label={item.evidence_id} />)}
      <svg className="swarm-fallback-links" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="deliberation relationships">
        {model.disagreements.filter((item) => item.disagreement.status === 'OPEN').flatMap((item) => item.edges.map((edge) => <line key={`${item.disagreement.disagreement_id}-${edge.from}-${edge.to}`} x1={model.seats.find((seat) => seat.seat_id === edge.from)?.layout.x ?? 50} y1={model.seats.find((seat) => seat.seat_id === edge.from)?.layout.y ?? 50} x2={model.seats.find((seat) => seat.seat_id === edge.to)?.layout.x ?? 50} y2={model.seats.find((seat) => seat.seat_id === edge.to)?.layout.y ?? 50} className="swarm-fallback-disagreement" />))}
        {model.challenges.map((challenge) => <line key={challenge.challenge_id} x1={model.seats.find((seat) => seat.seat_id === (challenge.response ? challenge.to : challenge.from))?.layout.x ?? 50} y1={model.seats.find((seat) => seat.seat_id === (challenge.response ? challenge.to : challenge.from))?.layout.y ?? 50} x2={model.seats.find((seat) => seat.seat_id === (challenge.response ? challenge.from : challenge.to))?.layout.x ?? 50} y2={model.seats.find((seat) => seat.seat_id === (challenge.response ? challenge.from : challenge.to))?.layout.y ?? 50} className="swarm-fallback-challenge" />)}
      </svg>
      <span className="swarm-fallback-status">WEBGL FALLBACK · STRUCTURED COUNCIL MAP</span>
    </div>
    <span className="swarm-fallback-note">The spatial renderer is unavailable in this browser context. Canonical protocol state remains available.</span>
    <div className="swarm-fallback-seat-list">{model.seats.map((seat) => <button key={seat.seat_id} type="button" onClick={() => onSeatSelect(seat.seat_id)}>{seat.label} · {seat.state}</button>)}</div>
  </div>;
}

export function ChamberScene({ model, onSeatSelect, onCoreSelect }: { readonly model: CouncilViewModel; readonly onSeatSelect: (seat: SeatId) => void; readonly onCoreSelect: () => void }) {
  return <div className="swarm-cinematic-scene">
    <Canvas dpr={[1, 1.75]} camera={{ position: [0, 7.5, 10.5], fov: 42 }} gl={{ antialias: true, alpha: true }} fallback={<ChamberFallback model={model} onSeatSelect={onSeatSelect} />}>
      <color attach="background" args={['#050810']} /><fog attach="fog" args={['#050810', 8, 20]} />
      <ambientLight intensity={0.22} color="#8ca5c7" /><pointLight position={[0, 4, 1]} intensity={2.5} distance={12} color="#4ac7d7" /><pointLight position={[-4, 2, -2]} intensity={1.5} distance={8} color="#5878ff" /><pointLight position={[4, 1, 2]} intensity={1.1} distance={7} color="#ff866e" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]}><circleGeometry args={[7.7, 96]} /><meshBasicMaterial color="#08111b" transparent opacity={0.92} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}><ringGeometry args={[3.1, 7.4, 96]} /><meshBasicMaterial color="#173144" transparent opacity={0.32} wireframe /></mesh>
      <Reactor model={model} onSelect={onCoreSelect} /><Relationships model={model} />{model.seats.map((seat) => <SeatEntity key={seat.seat_id} seat={seat} model={model} onSelect={() => onSeatSelect(seat.seat_id)} />)}
    </Canvas>
    <div className="swarm-scene-scanline" aria-hidden="true" /><div className="swarm-scene-label">SPATIAL PROTOCOL MAP · {model.mode}</div>
    <div className="swarm-scene-metrics" aria-label="Chamber metrics"><span>{model.evidence_core.evidence_count} EVIDENCE</span><span>{model.evidence_core.open_disagreement_count} OPEN DISAGREEMENTS</span><span>{model.timeline.length} EVENTS</span></div>
    <div className="swarm-seat-overlays" aria-label="Council seats">{model.seats.map((seat) => <button key={seat.seat_id} type="button" className={`swarm-seat-overlay swarm-seat-overlay-${seat.seat_id.toLowerCase()}${seat.active ? ' is-active' : ''}`} onClick={() => onSeatSelect(seat.seat_id)} aria-label={`${seat.label}, ${seat.state}`}><span className="swarm-overlay-glyph">{seat.seat_id.slice(0, 1)}</span><span><strong>{seat.label}</strong><small>{seat.state}</small></span></button>)}</div>
    <button type="button" className="swarm-reactor-overlay" onClick={onCoreSelect} aria-label="Inspect Evidence Reactor"><span>EVIDENCE REACTOR</span><strong>{model.evidence_core.case_id ?? 'NO CASE LOADED'}</strong></button>
    <div className="swarm-human-gate" aria-label="Human decision gate"><span>AI DELIBERATION</span><strong>{model.zeus.synthesized ? 'SYNTHESIS READY' : model.zeus.ready ? 'SYNTHESIS GATE READY' : 'AWAITING CERTIFIED STATE'}</strong><small>{model.evidence_core.open_disagreement_count} OPEN DISAGREEMENTS / {model.evidence_core.audit_warning_count} AUDIT WARNINGS · HUMAN DECISION {model.human_review.status}</small></div>
  </div>;
}

export { SEAT_POSITIONS };
