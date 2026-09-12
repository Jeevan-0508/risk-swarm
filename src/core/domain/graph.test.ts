import { describe, expect, it } from '../test/bdd';
import { RiskGraph, GraphError } from './graph';
import { Minter, fixedClock } from './build';

const AT = '2026-09-13T10:00:00.000Z';
const mint = () => new Minter('run-1', fixedClock(AT));

const newsEvidence = (m: Minter, over: Partial<Parameters<Minter['evidence']>[1]> = {}) =>
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

describe('RiskGraph', () => {
  it('derives tier from source_type and refuses caller-supplied tiers', () => {
    const m = mint();
    expect(newsEvidence(m).tier).toBe(3);
    expect(m.evidence('governance_officer', { ...structuredClone(newsEvidence(m)), source_type: 'regulator' } as never).tier).toBe(1);
    expect(m.evidence('risk_analyst', { ...structuredClone(newsEvidence(m)), source_type: 'llm_reasoning' } as never).tier).toBe(5);
  });

  it('rejects invalid nodes with a useful message', () => {
    const g = new RiskGraph();
    expect(() => g.add({ id: 'E-001', kind: 'evidence' } as never)).toThrow(GraphError);
    try {
      g.add({ id: 'E-001', kind: 'evidence' } as never);
    } catch (e) {
      expect((e as GraphError).code).toBe('INVALID_NODE');
    }
  });

  it('is append-only: duplicate ids are refused', () => {
    const g = new RiskGraph();
    const m = mint();
    const e = newsEvidence(m, { id: 'E-001' });
    g.add(e);
    expect(() => g.add(e)).toThrow(/DUPLICATE_ID/);
  });

  it('records a supersedes edge and keeps the superseded node readable', () => {
    const g = new RiskGraph();
    const m = mint();
    const first = g.add(newsEvidence(m, { id: 'E-001' }));
    const revised = g.add(newsEvidence(m, { id: 'E-002', relevance: 0.4, supersedes: 'E-001' }));
    expect(g.get('E-001')).toBeDefined();
    expect(g.edges({ from: revised.id, kind: 'supersedes' })).toHaveLength(1);
    expect(first.relevance).toBe(0.8);
  });

  it('refuses dangling and self edges', () => {
    const g = new RiskGraph();
    const m = mint();
    g.add(newsEvidence(m, { id: 'E-001' }));
    expect(() => g.link({ from: 'E-001', to: 'H-404', kind: 'supports', weight: 1, created_by: 'scout' })).toThrow(/DANGLING_EDGE/);
    expect(() => g.link({ from: 'E-001', to: 'E-001', kind: 'supports', weight: 1, created_by: 'scout' })).toThrow(/SELF_EDGE/);
  });

  it('walks the transitive evidence chain of a hypothesis', () => {
    const g = new RiskGraph();
    const m = mint();
    const ev = g.add(newsEvidence(m, { id: 'E-001' }));
    const sig = g.add(
      m.signal('scout', {
        id: 'S-001',
        title: 'Insolvency filing',
        source: 'Trans.INFO',
        occurred_at: '2026-09-10',
        geo: ['DE'],
        mode: ['road'],
        category_upstream: 'Corporate Insolvency',
        category_derived: 'Corporate Insolvency',
        category_confidence: 0.9,
        category_disagreement: false,
        source_severity_hint: 'medium',
        evidence_ids: [ev.id],
        cluster_id: 'CL-1',
      }),
    );
    const obs = g.add(
      m.observation('intelligence', {
        id: 'O-001',
        statement: '1 independent cluster in the window',
        method: 'cluster count',
        inputs: [sig.id],
        computed_value: 1,
        window: { from: '2026-08-15', to: '2026-09-13' },
      }),
    );
    const hyp = g.add(
      m.hypothesis('risk_analyst', {
        id: 'H-001',
        statement: 'Insolvency-driven carrier substitution risk is rising in DE',
        falsification_test: 'No further independent insolvency clusters within 30 days',
        pattern_id: 'FFT-012',
        status: 'open',
        scope: { geo: ['DE'], mode: ['road'] },
      }),
    );
    g.link({ from: ev.id, to: sig.id, kind: 'corroborates', weight: 1, created_by: 'scout' });
    g.link({ from: sig.id, to: obs.id, kind: 'observed_as', weight: 1, created_by: 'intelligence' });
    g.link({ from: obs.id, to: hyp.id, kind: 'supports', weight: 2, created_by: 'risk_analyst' });

    expect(g.evidenceChain(hyp.id).map((e) => e.id)).toEqual(['E-001']);
    expect(g.supporters(hyp.id).map((n) => n.id)).toEqual(['O-001']);
    expect(g.isIntact()).toBe(true);
  });

  it('detects circular support', () => {
    const g = new RiskGraph();
    const m = mint();
    const a = g.add(m.hypothesis('risk_analyst', { id: 'H-001', statement: 'A', falsification_test: 'test A here', pattern_id: null, status: 'open', scope: { geo: [], mode: [] } }));
    const b = g.add(m.hypothesis('risk_analyst', { id: 'H-002', statement: 'B', falsification_test: 'test B here', pattern_id: null, status: 'open', scope: { geo: [], mode: [] } }));
    g.link({ from: a.id, to: b.id, kind: 'supports', weight: 1, created_by: 'risk_analyst' });
    g.link({ from: b.id, to: a.id, kind: 'supports', weight: 1, created_by: 'risk_analyst' });
    expect(g.cycles().length).toBeGreaterThan(0);
  });

  it('round-trips through JSON without losing edges', () => {
    const g = new RiskGraph();
    const m = mint();
    const ev = g.add(newsEvidence(m, { id: 'E-001' }));
    const hyp = g.add(m.hypothesis('risk_analyst', { id: 'H-001', statement: 'A', falsification_test: 'test A here', pattern_id: null, status: 'open', scope: { geo: [], mode: [] } }));
    g.link({ from: ev.id, to: hyp.id, kind: 'supports', weight: 1, created_by: 'risk_analyst' });
    const back = RiskGraph.fromJSON(JSON.parse(JSON.stringify(g.toJSON())));
    expect(back.all()).toHaveLength(2);
    expect(back.edges({ kind: 'supports' })).toHaveLength(1);
    expect(back.evidenceChain('H-001').map((e) => e.id)).toEqual(['E-001']);
  });

  it('rejects a hypothesis with no falsification test', () => {
    const m = mint();
    expect(() =>
      m.hypothesis('risk_analyst', { statement: 'A', falsification_test: 'none', pattern_id: null, status: 'open', scope: { geo: [], mode: [] } }),
    ).toThrow();
  });
});
