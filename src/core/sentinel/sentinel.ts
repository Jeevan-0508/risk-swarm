/**
 * SENTINEL - the evidence-integrity layer. It is not another risk analyst: it never creates evidence,
 * never argues about the risk, and never sends work back for rework. It only answers one question -
 * "is the record this run produced internally sound?" - and reports VERIFIED / WARNING / BLOCKED per
 * check, over the graph the seven agents already built.
 *
 * A BLOCKED check here is a defect in the investigation's own bookkeeping (a citation that resolves
 * to nothing, an edge to a node that was never minted, a node that no longer parses). It is a
 * different failure mode from a red-team finding, which argues about whether the *conclusion* holds.
 * The two must never be conflated: SENTINEL failing does not make a hypothesis wrong, and a hypothesis
 * being wrong does not make the record unsound.
 */
import { RiskGraph } from '../domain/graph';
import { GraphNode, type Evidence, type DeliberationEvent } from '../domain/model';
import { sourceIdentity } from '../ingest/sanitize';
import type { SnapshotFileProvenance } from '../integrations/loader';
import { overallStatus, type IntegrityStatus } from '../status';

/** SENTINEL's own name for the shared status enum. Kept as an alias, not a redefinition, so a caller that
 *  already imports `SentinelStatus` sees no change. */
export type SentinelStatus = IntegrityStatus;

export interface SentinelCheck {
  key: string;
  label: string;
  status: SentinelStatus;
  detail: string;
  /** Nodes the finding is about, for click-through. Empty when the check is run-wide, not node-wide. */
  node_ids: string[];
}

export interface SentinelReport {
  /** The worst status of any check. A run publishes regardless; this is a trust record, not a gate. */
  status: SentinelStatus;
  checks: SentinelCheck[];
}

/** Every id one node legitimately refers to another node by, gathered once so a dangling one cannot hide. */
function referencedIds(node: GraphNode): string[] {
  const ids: string[] = [];
  if (node.supersedes) ids.push(node.supersedes);
  switch (node.kind) {
    case 'signal':
      ids.push(...node.evidence_ids);
      break;
    case 'observation':
      ids.push(...node.inputs);
      break;
    case 'challenge':
    case 'red_team_finding':
      ids.push(node.target_id, ...node.evidence_ids);
      break;
    case 'decision':
      ids.push(...node.hypothesis_ids);
      for (const r of node.regulatory_implications) ids.push(...r.evidence_ids);
      break;
    case 'action':
      ids.push(node.decision_id);
      break;
    case 'outcome':
      ids.push(node.decision_id, ...node.useful_evidence_ids, ...node.misleading_evidence_ids);
      break;
    case 'lesson':
      ids.push(node.outcome_id);
      break;
    case 'hypothesis':
    case 'evidence':
      break;
  }
  return ids;
}

export interface SentinelInput {
  graph: RiskGraph;
  /** The pinned-snapshot hash record as synced (from `ScoutOutput.snapshot.files`), not re-fetched here. */
  snapshotFiles: SnapshotFileProvenance[];
  /** The Council's transcript, if this run generated one. Optional so every existing caller (all 15 of
   *  them, none built for a Council) still compiles unchanged; defaults to no events, not a missing report. */
  deliberationEvents?: DeliberationEvent[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const FNV1A_FALLBACK = /^fnv1a:[0-9a-f]{8}$/;

export function runSentinel(input: SentinelInput): SentinelReport {
  const nodes = input.graph.all();
  const known = new Set(nodes.map((n) => n.id));
  const checks: SentinelCheck[] = [];
  const push = (c: SentinelCheck) => checks.push(c);

  // 1. Schema integrity: every node re-validated against the model it was minted under. The graph
  //    rejects an invalid node on `add()`, so this is a standing regression guard, not a live filter -
  //    it exists so a future schema change cannot silently admit something the rest of the system
  //    no longer understands.
  const invalidNodes = nodes.filter((n) => !GraphNode.safeParse(n).success);
  push({
    key: 'schema_integrity',
    label: 'Schema integrity',
    status: invalidNodes.length === 0 ? 'VERIFIED' : 'BLOCKED',
    detail: invalidNodes.length === 0
      ? `${nodes.length} node(s) validate against the current schema.`
      : `${invalidNodes.length} node(s) no longer validate against the schema that should have minted them.`,
    node_ids: invalidNodes.map((n) => n.id),
  });

  // 2. Graph integrity: every edge resolves at both ends.
  const intact = input.graph.isIntact();
  push({
    key: 'graph_integrity',
    label: 'Graph integrity',
    status: intact ? 'VERIFIED' : 'BLOCKED',
    detail: intact
      ? `${input.graph.edges().length} edge(s) recorded, every endpoint resolves to a real node.`
      : 'One or more edges reference a node that does not exist in this run.',
    node_ids: [],
  });

  // 3. Evidence-chain integrity: no node is, transitively, its own support.
  const cycles = input.graph.cycles();
  push({
    key: 'evidence_chain_integrity',
    label: 'Evidence-chain integrity',
    status: cycles.length === 0 ? 'VERIFIED' : 'BLOCKED',
    detail: cycles.length === 0
      ? 'No node supports itself transitively; every support chain terminates.'
      : `${cycles.length} circular support chain(s) found: a conclusion citing itself as its own evidence.`,
    node_ids: [...new Set(cycles.flat())],
  });

  // 4. Citation validity: every id one node names by reference actually exists as a node in this run.
  const danglingBy: string[] = [];
  const danglingDetail: string[] = [];
  for (const n of nodes) {
    for (const ref of referencedIds(n)) {
      if (!known.has(ref)) {
        danglingBy.push(n.id);
        danglingDetail.push(`${n.id} -> ${ref}`);
      }
    }
  }
  push({
    key: 'citation_validity',
    label: 'Citation validity',
    status: danglingDetail.length === 0 ? 'VERIFIED' : 'BLOCKED',
    detail: danglingDetail.length === 0
      ? 'Every cited id in this run resolves to a real node.'
      : `${danglingDetail.length} citation(s) reference a node that was never minted: ${danglingDetail.slice(0, 3).join(', ')}${danglingDetail.length > 3 ? ', …' : ''}.`,
    node_ids: [...new Set(danglingBy)],
  });

  const evidence: Evidence[] = input.graph.byKind('evidence');

  // 5. Provenance completeness: the fields a citation needs to be checked by a human are all present.
  const incompleteProvenance = evidence.filter((e) => e.retrieved_at.trim().length === 0 || e.title.trim().length === 0 || e.claim.trim().length === 0);
  push({
    key: 'provenance_completeness',
    label: 'Provenance completeness',
    status: incompleteProvenance.length === 0 ? 'VERIFIED' : 'WARNING',
    detail: incompleteProvenance.length === 0
      ? `${evidence.length} evidence item(s) carry a retrieval timestamp, title and claim.`
      : `${incompleteProvenance.length} evidence item(s) are missing a retrieval timestamp, title or claim.`,
    node_ids: incompleteProvenance.map((e) => e.id),
  });

  // 6. Evidence freshness: nothing is dated after the moment it was retrieved.
  const badDates = evidence.filter((e) => e.publication_date !== null && Date.parse(e.publication_date) > Date.parse(e.retrieved_at));
  push({
    key: 'evidence_freshness',
    label: 'Evidence freshness',
    status: badDates.length === 0 ? 'VERIFIED' : 'WARNING',
    detail: badDates.length === 0
      ? 'No evidence claims a publication date after its own retrieval.'
      : `${badDates.length} evidence item(s) claim a publication date after they were retrieved.`,
    node_ids: badDates.map((e) => e.id),
  });

  // 7. Duplicate integrity: the same url should never be minted as more than one evidence object.
  const byUrl = new Map<string, Evidence[]>();
  for (const e of evidence) if (e.url) byUrl.set(e.url, [...(byUrl.get(e.url) ?? []), e]);
  const dupGroups = [...byUrl.values()].filter((g) => g.length > 1);
  push({
    key: 'duplicate_integrity',
    label: 'Duplicate integrity',
    status: dupGroups.length === 0 ? 'VERIFIED' : 'WARNING',
    detail: dupGroups.length === 0
      ? 'No url is minted as more than one evidence object.'
      : `${dupGroups.length} url(s) minted more than once, inflating the apparent volume of support: ${dupGroups.map((g) => g[0]!.url).slice(0, 2).join(', ')}${dupGroups.length > 2 ? ', …' : ''}.`,
    node_ids: dupGroups.flat().map((e) => e.id),
  });

  // 8. Source identity: every evidence item resolves to an identifiable publisher, not a bare host.
  const unidentified = evidence.filter((e) => sourceIdentity(e.url, e.source) === 'unknown-source');
  push({
    key: 'source_identity',
    label: 'Source identity',
    status: unidentified.length === 0 ? 'VERIFIED' : 'WARNING',
    detail: unidentified.length === 0
      ? 'Every evidence item resolves to a stable, identifiable source.'
      : `${unidentified.length} evidence item(s) resolve to no identifiable source at all.`,
    node_ids: unidentified.map((e) => e.id),
  });

  // 9. Unsupported / adversarial reference: retrieved text that tried to behave like an instruction.
  //    It is already halved in reliability by the scorer; SENTINEL's job is only to surface that it is
  //    still in the record, unresolved, so a human can see it rather than infer it from a smaller number.
  const suspect = evidence.filter((e) => e.injection_suspected);
  push({
    key: 'unsupported_reference',
    label: 'Unsupported / adversarial reference',
    status: suspect.length === 0 ? 'VERIFIED' : 'WARNING',
    detail: suspect.length === 0
      ? 'No retrieved item was flagged as instruction-shaped text.'
      : `${suspect.length} evidence item(s) contained instruction-shaped text. Reliability was halved; the item was not removed.`,
    node_ids: suspect.map((e) => e.id),
  });

  // 10. Snapshot hash integrity: the pinned-snapshot provenance record itself is well-formed. This
  //     checks the shape of the hash record carried into this run, not live bytes over the network -
  //     re-verifying bytes against the upstream repo is `scripts/sync-snapshots.mjs --check`'s job, in CI.
  const malformedFiles = input.snapshotFiles.filter(
    (f) => f.bytes <= 0 || f.path.trim().length === 0 || !(HEX64.test(f.sha256) || FNV1A_FALLBACK.test(f.sha256)),
  );
  push({
    key: 'snapshot_hash_integrity',
    label: 'Snapshot hash integrity',
    status: input.snapshotFiles.length === 0 ? 'WARNING' : malformedFiles.length === 0 ? 'VERIFIED' : 'BLOCKED',
    detail: input.snapshotFiles.length === 0
      ? 'No snapshot provenance record was available to check.'
      : malformedFiles.length === 0
        ? `${input.snapshotFiles.length} pinned snapshot file(s) carry a well-formed hash record.`
        : `${malformedFiles.length} pinned snapshot file(s) carry a malformed hash record.`,
    node_ids: [],
  });

  // 11. Deliberation integrity: every evidence/claim id the Council's own transcript cites must
  //     resolve to a real node in this run's graph, exactly like check 4 for the seven agents themselves.
  //     The coordinator already filters every reference at generation time, so this should stay VERIFIED
  //     on every real run - it exists to catch a future regression in that filter, not today's behavior.
  const deliberationEvents = input.deliberationEvents ?? [];
  const unsupportedBy: string[] = [];
  const unsupportedDetail: string[] = [];
  for (const ev of deliberationEvents) {
    for (const ref of [...ev.evidence_ids, ...ev.claim_ids]) {
      if (!known.has(ref)) {
        unsupportedBy.push(ev.id);
        unsupportedDetail.push(`${ev.id} -> ${ref}`);
      }
    }
  }
  push({
    key: 'deliberation_integrity',
    label: 'Deliberation integrity',
    status: unsupportedDetail.length === 0 ? 'VERIFIED' : 'BLOCKED',
    detail: unsupportedDetail.length === 0
      ? `${deliberationEvents.length} deliberation event(s) cite only ids that resolve to a real node.`
      : `UNSUPPORTED CLAIM: ${unsupportedDetail.length} deliberation event(s) cite an id that was never minted: ${unsupportedDetail.slice(0, 3).join(', ')}${unsupportedDetail.length > 3 ? ', …' : ''}.`,
    node_ids: [...new Set(unsupportedBy)],
  });

  const status = overallStatus(checks.map((c) => c.status));
  return { status, checks };
}
