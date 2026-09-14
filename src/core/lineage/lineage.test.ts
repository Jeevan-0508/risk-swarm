import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { investigate } from '../orchestrator/run';
import { RiskGraph } from '../domain/graph';
import { Minter, fixedClock } from '../domain/build';
import { createAtlasMatcher } from '../integrations/atlas';
import type { Evidence } from '../domain/model';
import { decisionLineage, evidenceNeeded, sourceConcentration } from './lineage';
import type { CoverageResult, Pattern } from '../integrations/atlas';

const OPTIONS = {
  loader: createFileLoader('public/snapshots'),
  run_id: 'RUN-LINEAGE',
  now: '2026-09-13T00:00:00.000Z',
  question: 'Are we exposed to phantom-carrier fraud in the DACH road network?',
  scope: { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
};
const run = () => investigate({ ...OPTIONS });

const AT = '2026-09-13T10:00:00.000Z';
const mint = () => new Minter('run-1', fixedClock(AT));
const evidence = (m: Minter, over: Partial<Parameters<Minter['evidence']>[1]> = {}) =>
  m.evidence('scout', {
    source: 'Trans.INFO', source_type: 'news', url: 'https://trans.info/example',
    title: 'Carrier insolvency wave in Germany', publication_date: '2026-09-10', retrieved_at: AT,
    claim: 'A German road carrier entered insolvency in September 2026.',
    excerpt_or_summary: 'Report of an insolvency filing.', reliability: 0.55, relevance: 0.8,
    agents_that_used_it: ['scout'], cluster_id: 'CL-1', injection_suspected: false, incident_claim: true,
    ...over,
  });

describe('Decision Lineage, over the real reference run', () => {
  it('names every hypothesis the decision actually rests on', async () => {
    const r = await run();
    const lineage = decisionLineage(r.graph, r.outputs.decision.decision);
    expect(lineage.decision_id).toBe(r.outputs.decision.decision.id);
    expect(lineage.hypotheses.map((h) => h.hypothesis.id).sort()).toEqual([...r.outputs.decision.decision.hypothesis_ids].sort());
  });

  it('resolves decision_evidence to exactly the decision\'s own cited evidence', async () => {
    const r = await run();
    const lineage = decisionLineage(r.graph, r.outputs.decision.decision);
    const cited = new Set(r.outputs.decision.evidence_cited);
    expect(lineage.decision_evidence.length).toBeGreaterThan(0);
    for (const e of lineage.decision_evidence) expect(cited.has(e.id)).toBe(true);
  });

  it('includes at least everything the analyst directly cited as supporting a hypothesis', async () => {
    const r = await run();
    const lineage = decisionLineage(r.graph, r.outputs.decision.decision);
    for (const h of lineage.hypotheses) {
      const finding = r.outputs.analyst.findings.find((f) => f.hypothesis.id === h.hypothesis.id);
      if (finding === undefined) continue;
      const ids = new Set(h.evidence.map((e) => e.id));
      for (const cited of finding.supporting_evidence_ids) expect(ids.has(cited)).toBe(true);
    }
  });

  it('never returns a node the graph does not actually contain', async () => {
    const r = await run();
    const lineage = decisionLineage(r.graph, r.outputs.decision.decision);
    for (const h of lineage.hypotheses) {
      expect(r.graph.has(h.hypothesis.id)).toBe(true);
      for (const e of h.evidence) expect(r.graph.has(e.id)).toBe(true);
      for (const o of h.observations) {
        expect(r.graph.has(o.observation.id)).toBe(true);
        for (const e of o.evidence) expect(r.graph.has(e.id)).toBe(true);
      }
    }
  });

  it('reports no hypothesis and no evidence for a decision with nothing to rest on', () => {
    const g = new RiskGraph();
    const m = mint();
    const decision = g.add(m.decision('decision_engine', {
      question: 'test', hypothesis_ids: [], headline_risk: 'none', severity_band: 'LOW', severity_score: 0,
      confidence: 0, urgency: 'ROUTINE', action_band: 'NOTE', gates_failed: [], caps_applied: [],
      rationale: ['no risk statement is made'], unresolved_objections: [], owner_role: 'n/a',
      review_by: '2026-10-01', regulatory_implications: [], decided_by: 'system_recommendation',
      confidence_blocked_reason: null, human_note: null, human_verdict: null,
    }));
    const lineage = decisionLineage(g, decision);
    expect(lineage.hypotheses).toEqual([]);
    expect(lineage.decision_evidence).toEqual([]);
  });
});

describe('Source Concentration', () => {
  it('reports no concentration at all over an empty evidence base', () => {
    expect(sourceConcentration([])).toEqual({ total_evidence: 0, by_source: [], top_source_share: 0 });
  });

  it('reports full concentration when every item resolves to the same source', () => {
    const m = mint();
    const items: Evidence[] = [evidence(m, { id: 'E-1' }), evidence(m, { id: 'E-2' }), evidence(m, { id: 'E-3' })];
    const result = sourceConcentration(items);
    expect(result.total_evidence).toBe(3);
    expect(result.by_source.length).toBe(1);
    expect(result.top_source_share).toBe(1);
  });

  it('splits share evenly across independent sources, and every share sums to 1', () => {
    const m = mint();
    const items: Evidence[] = [
      evidence(m, { id: 'E-1', url: 'https://a.example/1', source: 'A' }),
      evidence(m, { id: 'E-2', url: 'https://b.example/1', source: 'B' }),
      evidence(m, { id: 'E-3', url: 'https://c.example/1', source: 'C' }),
      evidence(m, { id: 'E-4', url: 'https://d.example/1', source: 'D' }),
    ];
    const result = sourceConcentration(items);
    expect(result.by_source.length).toBe(4);
    expect(result.top_source_share).toBe(0.25);
    expect(result.by_source.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1, 4);
  });

  it('is exactly ORBIT\'s own source-concentration stress case, for real, every run', async () => {
    const r = await run();
    const evidenceNodes = r.graph.byKind('evidence');
    const result = sourceConcentration(evidenceNodes);
    expect(result.total_evidence).toBe(evidenceNodes.length);
    expect(result.by_source.reduce((n, s) => n + s.count, 0)).toBe(evidenceNodes.length);
    expect(result.top_source_share).toBeGreaterThan(0);
    expect(result.top_source_share).toBeLessThanOrEqual(1);
  });
});

describe('Evidence Needed', () => {
  const atlas = createAtlasMatcher(createFileLoader('public/snapshots'));

  it('surfaces only unknown indicators, ranked by weight, over the real reference run', async () => {
    const r = await run();
    const lead = r.outputs.analyst.findings[0];
    if (lead === undefined) return;
    const pattern = await atlas.pattern(lead.match.pattern_id);
    const items = evidenceNeeded(lead.coverage, pattern);
    expect(items.length).toBe(lead.coverage.unknown_indicator_ids.length);
    const presentSet = new Set(lead.coverage.present_indicator_ids);
    for (const item of items) expect(presentSet.has(item.indicator_id)).toBe(false);
    for (let i = 1; i < items.length; i += 1) expect(items[i - 1]!.weight).toBeGreaterThanOrEqual(items[i]!.weight);
  });

  it('never invents an indicator: every field is copied verbatim from the pattern', () => {
    const coverage = {
      pattern_id: 'TEST-1', coverage: 0, present_weight: 0, absent_weight: 0, unknown_weight: 13,
      total_weight: 13, completeness: 0, by_phase: {}, present_indicator_ids: ['IND-1'],
      unknown_indicator_ids: ['IND-2'],
    } as unknown as CoverageResult;
    const pattern = {
      indicators: [
        { id: 'IND-1', pattern_id: 'TEST-1', phase: 'planning', signal: 'seen already', observable_in: 'TMS', weight: 5 },
        { id: 'IND-2', pattern_id: 'TEST-1', phase: 'execution', signal: 'still unknown', observable_in: 'GPS trace', weight: 8 },
      ],
    } as unknown as Pattern;
    const items = evidenceNeeded(coverage, pattern);
    expect(items).toEqual([{ indicator_id: 'IND-2', signal: 'still unknown', observable_in: 'GPS trace', weight: 8 }]);
  });
});
