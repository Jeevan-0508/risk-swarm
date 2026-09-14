import { describe, expect, it } from '../test/bdd';
import { RiskGraph } from '../domain/graph';
import { Minter, fixedClock } from '../domain/build';
import { runSentinel } from './sentinel';
import type { SnapshotFileProvenance } from '../integrations/loader';

const AT = '2026-09-13T10:00:00.000Z';
const mint = () => new Minter('run-1', fixedClock(AT));

const goodFile: SnapshotFileProvenance = {
  upstream_path: 'data/signals.json',
  path: 'fomo/signals.json',
  bytes: 4096,
  sha256: 'a'.repeat(64),
};

const evidence = (m: Minter, over: Partial<Parameters<Minter['evidence']>[1]> = {}) =>
  m.evidence('scout', {
    source: 'Trans.INFO',
    source_type: 'news',
    url: 'https://trans.info/example',
    title: 'Carrier insolvency wave in Germany',
    publication_date: '2026-09-10',
    retrieved_at: AT,
    claim: 'A German road carrier entered insolvency in September 2026.',
    excerpt_or_summary: 'Report of an insolvency filing.',
    reliability: 0.55,
    relevance: 0.8,
    agents_that_used_it: ['scout'],
    cluster_id: 'CL-1',
    injection_suspected: false,
    incident_claim: true,
    ...over,
  });

describe('SENTINEL', () => {
  it('reports participation integrity as vacuously sound when no participation record was supplied', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001' }));
    const check = runSentinel({ graph: g, snapshotFiles: [goodFile] }).checks.find((c) => c.key === 'participation_integrity');
    expect(check?.status).toBe('VERIFIED');
    expect(check?.detail).toContain('no claim about who was allowed to speak');
  });

  it('accepts an agent that stood down and left no node behind, naming it', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001' }));
    const check = runSentinel({
      graph: g,
      snapshotFiles: [goodFile],
      participation: [
        { agent: 'scout', participating: true, reason: 'Retrieval is needed for every question.' },
        { agent: 'risk_analyst', participating: false, reason: 'The loaded pack brings no taxonomy to match a pattern against.' },
      ],
    }).checks.find((c) => c.key === 'participation_integrity');
    expect(check?.status).toBe('VERIFIED');
    expect(check?.detail).toContain('risk_analyst');
  });

  it('blocks when an agent that stood down still minted a node, because the record contradicts the graph', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001' })); // created_by 'scout'
    const check = runSentinel({
      graph: g,
      snapshotFiles: [goodFile],
      participation: [{ agent: 'scout', participating: false, reason: 'Stood down for this question.' }],
    }).checks.find((c) => c.key === 'participation_integrity');
    expect(check?.status).toBe('BLOCKED');
    expect(check?.detail).toContain('stood down but minted');
    expect(check?.node_ids).toEqual(['E-001']);
  });

  it('blocks a participation decision that states no reason, which is indistinguishable from a silent failure', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001' }));
    const check = runSentinel({
      graph: g,
      snapshotFiles: [goodFile],
      participation: [{ agent: 'governance_officer', participating: true, reason: '   ' }],
    }).checks.find((c) => c.key === 'participation_integrity');
    expect(check?.status).toBe('BLOCKED');
    expect(check?.detail).toContain('no stated reason');
  });

  it('reports VERIFIED across the board over a clean, minimal graph', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001' }));
    const report = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    expect(report.status).toBe('VERIFIED');
    expect(report.checks.every((c) => c.status === 'VERIFIED')).toBe(true);
    expect(report.checks.map((c) => c.key)).toContain('citation_validity');
  });

  it('never creates evidence or a finding: it only reads the graph it is given', () => {
    const g = new RiskGraph();
    const before = g.all().length;
    runSentinel({ graph: g, snapshotFiles: [] });
    expect(g.all().length).toBe(before);
  });

  /**
   * The next four checks are standing regression guards, not live filters: `RiskGraph` rejects an invalid
   * node on `add()` and a dangling edge on `link()`, and the `Evidence` schema rejects a blank title or a
   * blank source, so no public call can put a graph into these states. They exist so that a *future* schema
   * or graph change cannot admit one silently. Driving them therefore means mutating the objects the graph
   * handed out - which is exactly the state the guard is there to catch - rather than pretending an API
   * exists that would produce it.
   */
  it('blocks on schema integrity when a node in the graph no longer validates', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001' }));
    const clean = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    expect(clean.checks.find((c) => c.key === 'schema_integrity')!.status).toBe('VERIFIED');

    (g.all()[0] as { tier: number }).tier = 99;
    const report = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    const check = report.checks.find((c) => c.key === 'schema_integrity')!;
    expect(check.status).toBe('BLOCKED');
    expect(check.node_ids).toContain('E-001');
    expect(report.status).toBe('BLOCKED');
  });

  it('blocks on graph integrity when an edge no longer resolves at both ends', () => {
    const g = new RiskGraph();
    const m = mint();
    const a = evidence(m, { id: 'E-001' });
    const b = evidence(m, { id: 'E-002', url: 'https://trans.info/other' });
    g.add(a);
    g.add(b);
    g.link({ from: a.id, to: b.id, kind: 'corroborates', weight: 1, created_by: 'intelligence' });
    expect(runSentinel({ graph: g, snapshotFiles: [goodFile] }).checks.find((c) => c.key === 'graph_integrity')!.status).toBe('VERIFIED');

    (g.edges()[0] as { to: string }).to = 'E-404';
    const report = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    expect(report.checks.find((c) => c.key === 'graph_integrity')!.status).toBe('BLOCKED');
    expect(report.status).toBe('BLOCKED');
  });

  it('warns on provenance completeness when a citation loses a field a human would need to check it', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001' }));
    (g.all()[0] as { title: string }).title = '   ';
    const report = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    const check = report.checks.find((c) => c.key === 'provenance_completeness')!;
    expect(check.status).toBe('WARNING');
    expect(check.node_ids).toContain('E-001');
  });

  it('warns on source identity when an evidence item resolves to no identifiable publisher', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001' }));
    const node = g.all()[0] as { url: string | null; source: string };
    node.url = null;
    node.source = '';
    const report = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    const check = report.checks.find((c) => c.key === 'source_identity')!;
    expect(check.status).toBe('WARNING');
    expect(check.node_ids).toContain('E-001');
  });

  it('blocks on citation validity when a node cites an id that was never minted', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001' }));
    g.add(m.challenge('challenger', {
      id: 'C-001',
      target_id: 'H-404',
      severity: 'material',
      argument: 'This targets a hypothesis that does not exist in this run.',
      basis: 'evidence_deficiency',
      alternative_explanation: null,
      evidence_ids: ['E-001'],
      resolution: 'open',
      rebuttal: null,
    }));
    const report = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    const check = report.checks.find((c) => c.key === 'citation_validity')!;
    expect(check.status).toBe('BLOCKED');
    expect(check.node_ids).toContain('C-001');
    expect(report.status).toBe('BLOCKED');
  });

  it('blocks on evidence-chain integrity when support is circular', () => {
    const g = new RiskGraph();
    const m = mint();
    const a = g.add(m.hypothesis('risk_analyst', { id: 'H-001', statement: 'A', falsification_test: 'a real falsification test here', pattern_id: null, status: 'open', scope: { geo: [], mode: [] } }));
    const b = g.add(m.hypothesis('risk_analyst', { id: 'H-002', statement: 'B', falsification_test: 'a real falsification test here', pattern_id: null, status: 'open', scope: { geo: [], mode: [] } }));
    g.link({ from: a.id, to: b.id, kind: 'supports', weight: 1, created_by: 'risk_analyst' });
    g.link({ from: b.id, to: a.id, kind: 'supports', weight: 1, created_by: 'risk_analyst' });
    const report = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    expect(report.checks.find((c) => c.key === 'evidence_chain_integrity')!.status).toBe('BLOCKED');
  });

  it('warns on duplicate integrity when one url is minted as two evidence objects', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001' }));
    g.add(evidence(m, { id: 'E-002' }));
    const report = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    const check = report.checks.find((c) => c.key === 'duplicate_integrity')!;
    expect(check.status).toBe('WARNING');
    expect(check.node_ids.sort()).toEqual(['E-001', 'E-002']);
  });

  it('warns on evidence freshness when a publication date is after its own retrieval', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001', publication_date: '2027-01-01', retrieved_at: AT }));
    const report = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    expect(report.checks.find((c) => c.key === 'evidence_freshness')!.status).toBe('WARNING');
  });

  it('warns on an unresolved adversarial reference rather than silently dropping it', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(evidence(m, { id: 'E-001', injection_suspected: true }));
    const report = runSentinel({ graph: g, snapshotFiles: [goodFile] });
    const check = report.checks.find((c) => c.key === 'unsupported_reference')!;
    expect(check.status).toBe('WARNING');
    expect(check.node_ids).toEqual(['E-001']);
  });

  it('blocks on snapshot hash integrity when a pinned file carries a malformed hash', () => {
    const g = new RiskGraph();
    const report = runSentinel({ graph: g, snapshotFiles: [{ ...goodFile, sha256: 'not-a-real-hash' }] });
    expect(report.checks.find((c) => c.key === 'snapshot_hash_integrity')!.status).toBe('BLOCKED');
  });

  it('warns, but does not fabricate, when no snapshot provenance was available at all', () => {
    const g = new RiskGraph();
    const report = runSentinel({ graph: g, snapshotFiles: [] });
    const check = report.checks.find((c) => c.key === 'snapshot_hash_integrity')!;
    expect(check.status).toBe('WARNING');
    expect(check.detail).toContain('No snapshot provenance record was available');
  });

  it('accepts the non-cryptographic fnv1a fallback hash as well-formed, since it is labelled honestly', () => {
    const g = new RiskGraph();
    const report = runSentinel({ graph: g, snapshotFiles: [{ ...goodFile, sha256: 'fnv1a:deadbeef' }] });
    expect(report.checks.find((c) => c.key === 'snapshot_hash_integrity')!.status).toBe('VERIFIED');
  });
});
