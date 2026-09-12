import { Edge, GraphNode, type EdgeKind, type NodeKind } from './model';

export type GraphErrorCode =
  | 'INVALID_NODE'
  | 'DUPLICATE_ID'
  | 'IMMUTABLE_NODE'
  | 'DANGLING_EDGE'
  | 'SELF_EDGE'
  | 'UNKNOWN_NODE'
  | 'INVALID_EDGE';

export class GraphError extends Error {
  constructor(readonly code: GraphErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'GraphError';
  }
}

/**
 * Append-only typed risk graph. Nodes are immutable once added; a revision is a new node that
 * `supersedes` the old one, so the trail of what the system believed and when is never lost.
 */
export class RiskGraph {
  private nodes = new Map<string, GraphNode>();
  private edgeList: Edge[] = [];

  add<T extends GraphNode>(node: T): T {
    const parsed = GraphNode.safeParse(node);
    if (!parsed.success) {
      throw new GraphError('INVALID_NODE', `${node?.id ?? '<no id>'} ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const value = parsed.data;
    if (this.nodes.has(value.id)) throw new GraphError('DUPLICATE_ID', value.id);
    if (value.supersedes) {
      if (!this.nodes.has(value.supersedes)) throw new GraphError('UNKNOWN_NODE', `supersedes ${value.supersedes}`);
      this.edgeList.push({ from: value.id, to: value.supersedes, kind: 'supersedes', weight: 1, created_by: value.created_by });
    }
    this.nodes.set(value.id, value);
    return value as unknown as T;
  }

  link(edge: Edge): Edge {
    const parsed = Edge.safeParse(edge);
    if (!parsed.success) throw new GraphError('INVALID_EDGE', parsed.error.issues.map((i) => i.message).join('; '));
    const e = parsed.data;
    if (e.from === e.to) throw new GraphError('SELF_EDGE', e.from);
    if (!this.nodes.has(e.from)) throw new GraphError('DANGLING_EDGE', `from ${e.from}`);
    if (!this.nodes.has(e.to)) throw new GraphError('DANGLING_EDGE', `to ${e.to}`);
    this.edgeList.push(e);
    return e;
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  get(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  require(id: string): GraphNode {
    const n = this.nodes.get(id);
    if (!n) throw new GraphError('UNKNOWN_NODE', id);
    return n;
  }

  byKind<K extends NodeKind>(kind: K): Extract<GraphNode, { kind: K }>[] {
    return [...this.nodes.values()].filter((n): n is Extract<GraphNode, { kind: K }> => n.kind === kind);
  }

  all(): GraphNode[] {
    return [...this.nodes.values()];
  }

  edges(filter?: { from?: string; to?: string; kind?: EdgeKind }): Edge[] {
    return this.edgeList.filter(
      (e) =>
        (filter?.from === undefined || e.from === filter.from) &&
        (filter?.to === undefined || e.to === filter.to) &&
        (filter?.kind === undefined || e.kind === filter.kind),
    );
  }

  /** Nodes that support `id` (direct incoming `supports` / `corroborates` / `observed_as`). */
  supporters(id: string): GraphNode[] {
    return this.edgeList
      .filter((e) => e.to === id && (e.kind === 'supports' || e.kind === 'corroborates' || e.kind === 'observed_as'))
      .map((e) => this.require(e.from));
  }

  /** Nodes that weaken `id`. */
  weakeners(id: string): GraphNode[] {
    return this.edgeList.filter((e) => e.to === id && e.kind === 'weakens').map((e) => this.require(e.from));
  }

  /**
   * All evidence reachable as support for `id`, transitively (hypothesis <- observation <- signal
   * <- evidence). This is the only sanctioned way to answer "what is this claim actually based on".
   */
  evidenceChain(id: string): Extract<GraphNode, { kind: 'evidence' }>[] {
    const seen = new Set<string>([id]);
    const queue = [id];
    const out: Extract<GraphNode, { kind: 'evidence' }>[] = [];
    while (queue.length) {
      const current = queue.shift() as string;
      for (const e of this.edgeList) {
        const inbound = e.to === current && (e.kind === 'supports' || e.kind === 'corroborates' || e.kind === 'observed_as' || e.kind === 'cites' || e.kind === 'derived_from');
        const outbound = e.from === current && (e.kind === 'cites' || e.kind === 'derived_from');
        const next = inbound ? e.from : outbound ? e.to : null;
        if (!next || seen.has(next)) continue;
        seen.add(next);
        const node = this.require(next);
        if (node.kind === 'evidence') out.push(node);
        queue.push(next);
      }
    }
    return out;
  }

  /** Detects circular support: A supports B supports A. Returns the offending cycles. */
  cycles(kinds: EdgeKind[] = ['supports', 'corroborates', 'based_on']): string[][] {
    const adj = new Map<string, string[]>();
    for (const e of this.edgeList) {
      if (!kinds.includes(e.kind)) continue;
      adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    }
    const found: string[][] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const stack: string[] = [];
    const walk = (node: string) => {
      const s = state.get(node);
      if (s === 'done') return;
      if (s === 'visiting') {
        found.push([...stack.slice(stack.indexOf(node)), node]);
        return;
      }
      state.set(node, 'visiting');
      stack.push(node);
      for (const next of adj.get(node) ?? []) walk(next);
      stack.pop();
      state.set(node, 'done');
    };
    for (const node of adj.keys()) walk(node);
    return found;
  }

  /** True when every edge endpoint exists. Cheap invariant used by tests and the red team. */
  isIntact(): boolean {
    return this.edgeList.every((e) => this.nodes.has(e.from) && this.nodes.has(e.to));
  }

  toJSON(): { nodes: GraphNode[]; edges: Edge[] } {
    return { nodes: this.all(), edges: [...this.edgeList] };
  }

  static fromJSON(data: { nodes: GraphNode[]; edges: Edge[] }): RiskGraph {
    const g = new RiskGraph();
    for (const n of data.nodes) {
      const parsed = GraphNode.safeParse(n);
      if (!parsed.success) throw new GraphError('INVALID_NODE', `${n?.id} failed rehydration`);
      if (g.nodes.has(parsed.data.id)) throw new GraphError('DUPLICATE_ID', parsed.data.id);
      g.nodes.set(parsed.data.id, parsed.data);
    }
    for (const e of data.edges) {
      if (e.kind === 'supersedes' && g.edgeList.some((x) => x.from === e.from && x.kind === 'supersedes')) continue;
      g.link(e);
    }
    return g;
  }
}
