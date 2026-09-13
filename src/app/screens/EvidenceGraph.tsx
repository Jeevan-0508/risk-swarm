/**
 * SCREEN 04 - EVIDENCE GRAPH. The audit trail made visible. Nodes are laid out by kind in the order the
 * pipeline produced them, so a reader can follow a claim from a raw signal to the decision that rests on
 * it. Reads the graph only; adds nothing to it.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { GraphNode, NodeKind } from '@core/domain/model';
import { useSession } from '@app/store/session';
import { EDGE_LABEL, KIND_LABEL, KIND_ORDER, nodeLabel, nodeRows } from '@app/lib/nodes';
import { Empty, Metric, NODE_TONE, Panel, Row, Tag } from '@app/ui/kit';

const COL_W = 188;
const NODE_H = 20;
const NODE_GAP = 6;
const PAD_Y = 34;
const BOX_W = 150;

const STROKE: Record<string, string> = {
  neutral: '#5b6472', signal: '#5b9dd9', support: '#4f9d6b', caution: '#c9903a',
  objection: '#c96b4a', block: '#c4485a', hypo: '#8b7ad1',
};

interface Placed { node: GraphNode; x: number; y: number; col: number }

export function EvidenceGraph() {
  const { active } = useSession();
  const run = active();
  const result = run?.result ?? null;
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<NodeKind>>(new Set());

  const model = useMemo(() => {
    if (result === null) return null;
    const nodes = result.graph.all();
    const present = KIND_ORDER.filter((k) => nodes.some((n) => n.kind === k));
    const visibleKinds = present.filter((k) => !hidden.has(k));
    const placed: Placed[] = [];
    visibleKinds.forEach((kind, col) => {
      nodes.filter((n) => n.kind === kind).forEach((node, i) => {
        placed.push({ node, col, x: col * COL_W + 12, y: PAD_Y + i * (NODE_H + NODE_GAP) });
      });
    });
    const byId = new Map(placed.map((p) => [p.node.id, p]));
    const edges = result.graph.edges().filter((e) => byId.has(e.from) && byId.has(e.to));
    const tallest = Math.max(...visibleKinds.map((k) => nodes.filter((n) => n.kind === k).length), 1);
    return {
      nodes, present, placed, byId, edges,
      width: Math.max(visibleKinds.length * COL_W + 24, 320),
      height: PAD_Y + tallest * (NODE_H + NODE_GAP) + 16,
      cols: visibleKinds,
    };
  }, [result, hidden]);

  if (result === null || model === null) {
    return (
      <Screen>
        <Panel title="graph"><Empty>No investigation loaded. Run one from the Command Center.</Empty></Panel>
      </Screen>
    );
  }

  const node = selected === null ? null : (result.graph.get(selected) ?? null);
  const incoming = node === null ? [] : result.graph.edges({ to: node.id });
  const outgoing = node === null ? [] : result.graph.edges({ from: node.id });
  const chain = node === null ? [] : result.graph.evidenceChain(node.id);
  const cycles = result.graph.cycles();
  const touched = new Set<string>();
  if (node !== null) {
    touched.add(node.id);
    for (const e of [...incoming, ...outgoing]) { touched.add(e.from); touched.add(e.to); }
  }

  const toggle = (k: NodeKind) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <Screen>
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Metric label="nodes" value={model.nodes.length} />
        <Metric label="edges" value={result.graph.edges().length} />
        <Metric label="cycles" value={cycles.length} tone={cycles.length === 0 ? 'support' : 'block'}
          sub={cycles.length === 0 ? 'no circular support' : 'circular reasoning present'} />
        <Metric label="kinds present" value={model.present.length} sub={`of ${KIND_ORDER.length} in the model`} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1">show</span>
        {model.present.map((k) => (
          <button key={k} onClick={() => toggle(k)}
            className={`border px-2 py-1 font-mono text-2xs uppercase tracking-[0.1em] transition-colors ${
              hidden.has(k) ? 'border-line text-fg-mute' : 'border-line-bright text-fg'}`}>
            <span className="mr-1.5 inline-block h-1.5 w-1.5 align-middle" style={{ background: hidden.has(k) ? '#3a4150' : STROKE[NODE_TONE[k]] }} />
            {KIND_LABEL[k]} {model.nodes.filter((n) => n.kind === k).length}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <Panel title="append-only graph" aside={<span className="text-2xs text-fg-mute">click a node to inspect it</span>} flush>
          <div className="overflow-auto" style={{ maxHeight: 620 }}>
            <svg width={model.width} height={model.height} className="block">
              {model.cols.map((k, i) => (
                <text key={k} x={i * COL_W + 12} y={18} className="font-mono" fontSize="9" letterSpacing="1.4"
                  fill="#6f7887">{KIND_LABEL[k].toUpperCase()}</text>
              ))}
              {model.edges.map((e, i) => {
                const a = model.byId.get(e.from)!;
                const b = model.byId.get(e.to)!;
                const x1 = a.x + BOX_W;
                const y1 = a.y + NODE_H / 2;
                const x2 = b.x;
                const y2 = b.y + NODE_H / 2;
                const lit = node !== null && (e.from === node.id || e.to === node.id);
                const dim = node !== null && !lit;
                const mid = (x1 + x2) / 2;
                return (
                  <path key={i} d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} fill="none"
                    stroke={lit ? STROKE[NODE_TONE[b.node.kind]] : '#333b48'}
                    strokeWidth={lit ? 1.4 : 0.7} opacity={dim ? 0.18 : 1}>
                    <title>{`${e.from} ${EDGE_LABEL[e.kind]} ${e.to}`}</title>
                  </path>
                );
              })}
              {model.placed.map((p) => {
                const tone = NODE_TONE[p.node.kind];
                const isSel = p.node.id === selected;
                const dim = node !== null && !touched.has(p.node.id);
                return (
                  <g key={p.node.id} onClick={() => setSelected(p.node.id === selected ? null : p.node.id)}
                    className="cursor-pointer" opacity={dim ? 0.3 : 1}>
                    <rect x={p.x} y={p.y} width={BOX_W} height={NODE_H} fill={isSel ? STROKE[tone] : '#11151c'}
                      stroke={STROKE[tone]} strokeWidth={isSel ? 1.4 : 0.8} />
                    <text x={p.x + 6} y={p.y + 13} fontSize="9" className="pointer-events-none font-mono"
                      fill={isSel ? '#0a0d12' : '#c8cdd6'}>
                      {truncate(p.node.id, 22)}
                    </text>
                    <title>{nodeLabel(p.node)}</title>
                  </g>
                );
              })}
            </svg>
          </div>
        </Panel>

        <div className="space-y-4">
          {node === null ? (
            <Panel title="inspector"><Empty>Select a node.</Empty></Panel>
          ) : (
            <>
              <Panel title="inspector" aside={<Tag tone={NODE_TONE[node.kind]}>{KIND_LABEL[node.kind]}</Tag>}>
                <p className="num text-2xs text-fg-mute">{node.id}</p>
                <p className="mt-2 text-sm leading-relaxed text-fg">{nodeLabel(node)}</p>
                <div className="mt-3 divide-y divide-line">
                  {nodeRows(node).map(([k, v]) => <Row key={k} k={k} v={v} />)}
                  <Row k="Created by" v={node.created_by} />
                  <Row k="Created at" v={node.created_at} />
                  <Row k="Supersedes" v={node.supersedes ?? 'nothing'} />
                </div>
              </Panel>

              <Panel title={`relationships · ${incoming.length + outgoing.length}`} flush>
                {incoming.length + outgoing.length === 0 ? (
                  <Empty>No edges. This node stands alone.</Empty>
                ) : (
                  <ul className="divide-y divide-line text-xs">
                    {outgoing.map((e, i) => <EdgeRow key={`o${i}`} dir="→" label={EDGE_LABEL[e.kind]} other={e.to} onPick={setSelected} />)}
                    {incoming.map((e, i) => <EdgeRow key={`i${i}`} dir="←" label={EDGE_LABEL[e.kind]} other={e.from} onPick={setSelected} />)}
                  </ul>
                )}
              </Panel>

              {node.kind !== 'evidence' && (
                <Panel title={`evidence beneath this node · ${chain.length}`} flush>
                  {chain.length === 0 ? (
                    <Empty>No evidence reachable. Nothing here is grounded.</Empty>
                  ) : (
                    <ul className="divide-y divide-line text-xs">
                      {chain.map((ev) => (
                        <li key={ev.id} className="px-4 py-2">
                          <button onClick={() => setSelected(ev.id)} className="text-left hover:text-signal">
                            <span className="num text-2xs text-fg-mute">T{ev.tier} · {ev.source}</span>
                            <span className="mt-0.5 block leading-snug text-fg-dim">{ev.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </Screen>
  );
}

function EdgeRow({ dir, label, other, onPick }: { dir: string; label: string; other: string; onPick: (id: string) => void }) {
  return (
    <li className="px-4 py-2">
      <button onClick={() => onPick(other)} className="flex w-full items-baseline gap-2 text-left hover:text-signal">
        <span className="text-fg-mute">{dir}</span>
        <span className="label shrink-0">{label}</span>
        <span className="num truncate text-2xs text-fg-dim">{other}</span>
      </button>
    </li>
  );
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-light tracking-tight">Evidence Graph</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fg-dim">
          Every node the agents wrote, in the order they wrote it. Nodes are never edited or deleted: a
          correction arrives as a new node that supersedes the old one, so the trail of what was believed
          and when survives intact.
        </p>
      </div>
      {children}
    </div>
  );
}
