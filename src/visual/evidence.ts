/**
 * EVOLUTION 5.0 Phase E - what one piece of evidence actually is, as a pure derivation over the graph
 * a completed run stored. Nothing here reads the network, and nothing here computes a property the
 * node does not carry.
 *
 * The rule this module defends: **an inspector may only print fields that exist.** The console's spec
 * asks for a content hash, a freshness verdict and a validation status on every evidence card. A graph
 * `Evidence` node carries none of the three - `content_hash` lives on `EvidenceProvenance` in
 * `core/research/normalize.ts`, which no live run calls yet - so instead of inventing them, the card
 * carries an explicit `not_recorded` list naming each absent field and why it is absent. The absence is
 * the finding; hiding the row would read as if the field had passed.
 */
import type { RiskGraph } from '../core/domain/graph';
import type { AgentId, DeliberationEvent, Evidence, GraphNode } from '../core/domain/model';

/** One relation this node genuinely has in the graph, in the direction the edge was stored. */
export interface EvidenceLink {
  edge: string;
  direction: 'from_this' | 'to_this';
  node_id: string;
  node_kind: GraphNode['kind'];
  /** The other node's own words - statement, claim or title, whichever it carries. Never paraphrased. */
  text: string;
}

/** A field the console asks for that this node does not record, with the reason it does not. */
export interface EvidenceGap {
  field: string;
  why: string;
}

/** One transcript line that cited this evidence. Read from stored events only. */
export interface EvidenceCitation {
  sequence: number;
  from_agent: AgentId;
  type: DeliberationEvent['type'];
}

export interface EvidenceCard {
  id: string;
  /** False when the id is not an evidence node in this run's graph. Everything below is then empty. */
  found: boolean;
  evidence: Evidence | null;
  /** `agents_that_used_it`, as the node recorded it. */
  used_by: AgentId[];
  /** Transcript lines citing this id, in stored order. A superset check on `used_by`, not a copy. */
  cited_in: EvidenceCitation[];
  /** Ids that supersede this node, read off `supersedes` edges pointing at it. */
  superseded_by: string[];
  links: EvidenceLink[];
  not_recorded: EvidenceGap[];
}

/**
 * Every field the console asks a card to show that a graph `Evidence` node has no place to store. Fixed
 * text, not derived: the reason is a property of the schema, not of one node, so it must read the same
 * on every card rather than looking like a per-node failure.
 */
export const EVIDENCE_GAPS: readonly EvidenceGap[] = [
  {
    field: 'content hash',
    why: 'Hashing happens in core/research/normalize.ts, on an EvidenceProvenance record. No live run reaches that path yet, so no hash was ever written to this node.',
  },
  {
    field: 'freshness verdict',
    why: 'The node stores publication_date and retrieved_at. Nothing in the engine turns those two dates into a fresh/stale judgement, so none is shown.',
  },
  {
    field: 'validation status',
    why: 'Evidence is admitted or refused at ingest; a node that exists was admitted. There is no second, post-hoc validation pass whose verdict could be reported here.',
  },
  {
    field: 'retrieval query',
    why: 'The query that produced a result is planned in core/research/plan.ts and is not carried onto the node it produced.',
  },
];

function nodeText(node: GraphNode): string {
  if ('statement' in node && typeof node.statement === 'string') return node.statement;
  if ('claim' in node && typeof node.claim === 'string') return node.claim;
  if ('title' in node && typeof node.title === 'string') return node.title;
  if ('summary' in node && typeof node.summary === 'string') return node.summary;
  return '';
}

/**
 * The card for one evidence id. `events` is the stored transcript: citations are read from it rather
 * than trusted from `agents_that_used_it`, because the two answer different questions - the node field
 * says who consumed it, the transcript says where a reader can go and see it used.
 */
export function evidenceCard(graph: RiskGraph, id: string, events: DeliberationEvent[]): EvidenceCard {
  const node = graph.get(id);
  const evidence = node !== undefined && node.kind === 'evidence' ? node : null;

  const empty: EvidenceCard = {
    id,
    found: false,
    evidence: null,
    used_by: [],
    cited_in: [],
    superseded_by: [],
    links: [],
    not_recorded: [...EVIDENCE_GAPS],
  };
  if (evidence === null) return empty;

  const links: EvidenceLink[] = [];
  for (const e of graph.edges({ from: id })) {
    const other = graph.get(e.to);
    if (other === undefined || e.kind === 'supersedes') continue;
    links.push({ edge: e.kind, direction: 'from_this', node_id: other.id, node_kind: other.kind, text: nodeText(other) });
  }
  for (const e of graph.edges({ to: id })) {
    const other = graph.get(e.from);
    if (other === undefined || e.kind === 'supersedes') continue;
    links.push({ edge: e.kind, direction: 'to_this', node_id: other.id, node_kind: other.kind, text: nodeText(other) });
  }

  return {
    id,
    found: true,
    evidence,
    used_by: evidence.agents_that_used_it,
    cited_in: events
      .filter((e) => e.evidence_ids.includes(id))
      .map((e) => ({ sequence: e.sequence, from_agent: e.from_agent, type: e.type })),
    superseded_by: graph.edges({ to: id, kind: 'supersedes' }).map((e) => e.from),
    links,
    not_recorded: [...EVIDENCE_GAPS],
  };
}

/**
 * Every evidence id cited anywhere in the transcript, in the order a reader meets it. The inspector's
 * index: it lists what the chamber actually referred to, not the whole graph, so a reader clicking
 * through it is always looking at something an agent put on the record.
 */
export function citedEvidenceIds(events: DeliberationEvent[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of events) {
    for (const id of e.evidence_ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
