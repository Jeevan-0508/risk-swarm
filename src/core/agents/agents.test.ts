import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { createHarness, BudgetExceededError, RunAbortedError } from './harness';
import { runScout } from './scout';
import { runIntelligence } from './intelligence';
import { runAnalyst, type AnalystFinding } from './analyst';
import { runGovernance } from './governance';
import { runChallenger } from './challenger';
import { runRedTeam } from './redteam';
import { runDecision } from './decision';
import { computeScore, type EvidenceRef } from '../scoring/score';
import { DEFAULT_POLICY } from '../scoring/policy';

const NOW = '2026-09-13T00:00:00.000Z';
const SCOPE = { geo: ['DE', 'AT', 'CH'], mode: ['road'], from: '2024-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' };
const loader = () => createFileLoader('public/snapshots');
const harness = (budget?: Parameters<typeof createHarness>[0]['budget']) => createHarness({ loader: loader(), run_id: 'RUN-T', now: NOW, budget });

async function throughAnalyst() {
  const h = harness();
  const scout = await runScout(h.ctx, { question: 'Q', scope: SCOPE });
  const intel = runIntelligence(h.ctx, {
    signals: scout.findings.map((f) => f.signal),
    evidence: scout.findings.map((f) => f.evidence),
    window: { from: SCOPE.from, to: SCOPE.to },
  });
  const analyst = await runAnalyst(h.ctx, {
    question: 'Q',
    signals: intel.clustered_signals,
    evidence: intel.clustered_evidence,
    observations: intel.findings,
    scope: { geo: SCOPE.geo, mode: SCOPE.mode },
    clusterOf: Object.fromEntries(intel.clustered_signals.map((s) => [s.id, s.cluster_id ?? ''])),
  });
  return { h, scout, intel, analyst };
}

describe('scout', () => {
  it('emits one evidence object per signal and never a signal without one', async () => {
    const { scout } = await throughAnalyst();
    expect(scout.findings.length).toBeGreaterThan(0);
    for (const f of scout.findings) {
      expect(f.signal.evidence_ids).toEqual([f.evidence.id]);
      expect(f.evidence.url).not.toBeNull();
      expect(f.evidence.incident_claim).toBe(true);
    }
  });

  it('declares what it excluded, so a wrong exclusion is visible rather than silent', async () => {
    const { scout } = await throughAnalyst();
    expect(scout.stats.excluded_low_relevance).toBeGreaterThan(0);
    expect(scout.uncertainties.join(' ')).toContain('not freight-related');
  });

  it('does not judge the risk: its confidence is retrieval coverage only', async () => {
    const { scout } = await throughAnalyst();
    expect(scout.confidence).toBeLessThanOrEqual(1);
    expect(scout.findings.every((f) => f.evidence.tier >= 1)).toBe(true);
  });
});

describe('intelligence', () => {
  it('counts publishers, not articles', async () => {
    const { scout, intel } = await throughAnalyst();
    expect(intel.independent_source_count).toBeLessThan(scout.findings.length);
    expect(intel.independent_source_count).toBe(8);
  });

  it('records cluster membership as a revision rather than mutating the scout node', async () => {
    const { scout, intel } = await throughAnalyst();
    expect(intel.clustered_signals[0].supersedes).toBe(scout.findings[0].signal.id);
    expect(scout.findings[0].signal.cluster_id).toBeNull();
  });

  it('never claims corroboration it cannot show', async () => {
    const { intel } = await throughAnalyst();
    const statement = intel.findings.map((o) => o.statement).join(' ');
    expect(statement).toContain('independent publisher');
    expect(intel.confidence).toBe(1); // deterministic arithmetic, not a view about the risk
  });
});

describe('risk analyst', () => {
  it('gives every hypothesis a falsification test', async () => {
    const { analyst } = await throughAnalyst();
    expect(analyst.findings.length).toBeGreaterThan(0);
    for (const f of analyst.findings) expect(f.hypothesis.falsification_test.length).toBeGreaterThan(40);
  });

  it('cannot reach "supported" when no operational indicator has been assessed', async () => {
    const { analyst } = await throughAnalyst();
    expect(analyst.unknown_indicator_share).toBe(1);
    for (const f of analyst.findings) expect(f.hypothesis.status).toBe('insufficient_evidence');
    expect(analyst.confidence).toBeLessThanOrEqual(0.6);
  });

  it('labels the pattern link as a topic match and says so in its uncertainties', async () => {
    const { analyst } = await throughAnalyst();
    for (const f of analyst.findings) expect(f.match.basis).toBe('lexical_topic_match');
    expect(analyst.uncertainties.join(' ')).toContain('lexical topic match');
  });
});

describe('governance officer', () => {
  it('caps a management standard below "established" however it is proposed', async () => {
    const h = harness();
    const gov = await runGovernance(h.ctx, {
      question: 'Q', hypotheses: [], affects_counterparty: true, automated_action: false, model_used: false, unresolved_objections: 0,
    });
    const iso = gov.implications.find((i) => i.requirement_id === 'ISO42001-6.1.4');
    expect(iso?.applicability).toBe('possible');
    expect(iso?.reasoning).toContain('capped');
  });

  it('emits regulator evidence that cannot evidence an incident', async () => {
    const h = harness();
    const gov = await runGovernance(h.ctx, {
      question: 'Q', hypotheses: [], affects_counterparty: true, automated_action: false, model_used: false, unresolved_objections: 0,
    });
    const evidence = gov.findings.flatMap((f) => (f.evidence ? [f.evidence] : []));
    expect(evidence.length).toBeGreaterThan(0);
    for (const e of evidence) {
      expect(e.tier).toBe(1);
      expect(e.incident_claim).toBe(false);
    }
  });

  it('raises the automated-decision obligation only when a human is out of the loop', async () => {
    const h = harness();
    const withHuman = await runGovernance(h.ctx, { question: 'Q', hypotheses: [], affects_counterparty: true, automated_action: false, model_used: false, unresolved_objections: 0 });
    const without = await runGovernance(h.ctx, { question: 'Q', hypotheses: [], affects_counterparty: true, automated_action: true, model_used: false, unresolved_objections: 0 });
    expect(withHuman.implications.some((i) => i.requirement_id === 'GDPR-22')).toBe(false);
    expect(without.implications.some((i) => i.requirement_id === 'GDPR-22')).toBe(true);
  });
});

describe('challenger', () => {
  const base = (findings: AnalystFinding[], over: Partial<Parameters<typeof runChallenger>[1]> = {}) => ({
    findings, evidence: [], independent_source_count: 4, possible_duplicate_pairs: 0, cluster_count: 4,
    recurrence_buckets: 3, window_buckets: 10, benign_category_share: 0, min_independent_sources: 2, ...over,
  });

  it('blocks when the policy minimum of independent sources is not met', async () => {
    const { h, analyst } = await throughAnalyst();
    const out = runChallenger(h.ctx, base(analyst.findings, { independent_source_count: 1 }));
    const blocking = out.findings.filter((c) => c.severity === 'blocking');
    expect(blocking.some((c) => c.basis === 'evidence_deficiency')).toBe(true);
  });

  it('turns every unruled-out taxonomy gate into a named benign alternative', async () => {
    const { h, analyst } = await throughAnalyst();
    const out = runChallenger(h.ctx, base(analyst.findings));
    const gated = out.findings.filter((c) => c.basis === 'ungated_false_positive');
    expect(gated.length).toBe(analyst.findings.reduce((n, f) => n + f.gates.length, 0));
    for (const c of gated) expect(c.alternative_explanation).not.toBeNull();
  });

  it('argues the insolvency explanation when most surviving signals are insolvency events', async () => {
    const { h, analyst } = await throughAnalyst();
    const out = runChallenger(h.ctx, base(analyst.findings, { benign_category_share: 0.58 }));
    expect(out.findings.some((c) => c.alternative_explanation?.includes('Insolvency-driven'))).toBe(true);
  });
});

describe('red team', () => {
  const input = (over: Partial<Parameters<typeof runRedTeam>[1]>): Parameters<typeof runRedTeam>[1] => ({
    findings: [], signals: [], evidence: [], challenges: [], cluster_count: 3, known_node_ids: [],
    unknown_indicator_share: 0, benign_category_share: 0, ...over,
  });

  it('fails the run when a citation points at an id that does not exist', async () => {
    const { h, analyst } = await throughAnalyst();
    const out = runRedTeam(h.ctx, input({ findings: analyst.findings, known_node_ids: [] }));
    expect(out.verdict).toBe('fail');
    expect(out.findings.some((f) => f.finding_class === 'hallucination' && f.severity === 'blocking')).toBe(true);
  });

  it('blocks a conclusion drawn from one event cluster', async () => {
    const { h, analyst } = await throughAnalyst();
    const known = analyst.findings.flatMap((f) => [f.hypothesis.id, ...f.supporting_evidence_ids]);
    const out = runRedTeam(h.ctx, input({ findings: analyst.findings, known_node_ids: known, cluster_count: 1 }));
    expect(out.findings.some((f) => f.finding_class === 'same_source_echo' && f.severity === 'blocking')).toBe(true);
  });

  it('detects a claim that is transitively its own evidence', async () => {
    const h = harness();
    const out = runRedTeam(h.ctx, input({ support_edges: [{ from: 'H-001', to: 'H-002' }, { from: 'H-002', to: 'H-001' }] }));
    expect(out.findings.some((f) => f.finding_class === 'circular_reasoning')).toBe(true);
  });

  it('states what would clear every finding it raises', async () => {
    const { h, analyst } = await throughAnalyst();
    const out = runRedTeam(h.ctx, input({ findings: analyst.findings, unknown_indicator_share: 1 }));
    expect(out.findings.length).toBeGreaterThan(0);
    for (const f of out.findings) expect(f.clears_when.length).toBeGreaterThan(10);
  });

  it('passes cleanly only when nothing matched, and says a pass is not a proof', async () => {
    const h = harness();
    const out = runRedTeam(h.ctx, input({}));
    expect(out.verdict).toBe('pass');
    expect(out.uncertainties.join(' ')).toContain('no known defect');
  });
});

describe('scoring seam the governance officer must not be able to game', () => {
  it('ignores regulatory citations when counting independent sources', () => {
    const ref = (id: string, incident: boolean, identity: string): EvidenceRef => ({
      id, tier: incident ? 3 : 1, relevance: 0.8, cluster_id: `C-${id}`, source_identity: identity, incident_claim: incident, injection_suspected: false,
    });
    const withCitations = computeScore({
      evidence: [ref('E-1', true, 'trans.info'), ref('E-2', false, 'eur-lex.europa.eu'), ref('E-3', false, 'gdpr-info.eu')],
      cluster_count: 1, possible_duplicate_pairs: 0, recurrence_buckets: 1, window_buckets: 4,
      pattern: { severity: 'high', unknown_share: 1 }, scope_breadth: 0.5, newest_evidence_at: NOW, now: NOW,
      regulatory_deadline_days: null, agent_positions: [], challenges: [], red_team: [], evidence_conflicts: 0,
      ungated_false_positives: 0, total_false_positive_gates: 2, circular_support_count: 0, declared_uncertainties: 1,
      reversibility: 'hard_to_reverse', policy: DEFAULT_POLICY,
    });
    expect(withCitations.independent_evidence_count).toBe(1);
    expect(withCitations.action_band).not.toBe('ESCALATE');
  });
});

describe('decision engine', () => {
  it('never attaches a preventive control to a run held below targeted investigation', async () => {
    const { h, analyst, intel } = await throughAnalyst();
    const dec = await runDecision(h.ctx, {
      question: 'Q', findings: analyst.findings, evidence: intel.clustered_evidence, challenges: [], red_team: [],
      implications: [], agent_positions: [{ agent: 'scout', reasoning_status: 'supported', confidence: 0.5 }],
      cluster_count: intel.clusters.length, possible_duplicate_pairs: 0, recurrence_buckets: 1,
      window_buckets: intel.window_buckets, scope_breadth: 0.5, evidence_conflicts: 0, ungated_false_positives: 5,
      total_false_positive_gates: 5, circular_support_count: 0, declared_uncertainties: 8, reversibility: 'hard_to_reverse',
      regulatory_deadline_days: null,
    });
    expect(dec.decision.action_band === 'ESCALATE').toBe(false);
    expect(dec.actions.every((a) => a.class !== 'responsive')).toBe(true);
    for (const a of dec.actions) expect(a.countermeasure_id === null || a.countermeasure_id.startsWith(analyst.findings[0].match.pattern_id)).toBe(true);
  });

  it('names a role as owner and never invents a person', async () => {
    const { h, analyst, intel } = await throughAnalyst();
    const dec = await runDecision(h.ctx, {
      question: 'Q', findings: analyst.findings, evidence: intel.clustered_evidence, challenges: [], red_team: [],
      implications: [], agent_positions: [], cluster_count: intel.clusters.length, possible_duplicate_pairs: 0,
      recurrence_buckets: 1, window_buckets: intel.window_buckets, scope_breadth: 0.5, evidence_conflicts: 0,
      ungated_false_positives: 0, total_false_positive_gates: 0, circular_support_count: 0, declared_uncertainties: 0,
      reversibility: 'reversible', regulatory_deadline_days: null,
    });
    expect(dec.decision.owner_role).toMatch(/[A-Za-z]/);
    expect(dec.decision.decided_by).toBe('system_recommendation');
    expect(dec.decision.human_verdict).toBeNull();
    expect(new Date(dec.decision.review_by).getTime()).toBeGreaterThan(new Date(NOW).getTime());
  });

  it('builds its rationale only from facts already in the record', async () => {
    const { h, analyst, intel } = await throughAnalyst();
    const dec = await runDecision(h.ctx, {
      question: 'Q', findings: analyst.findings, evidence: intel.clustered_evidence, challenges: [], red_team: [],
      implications: [], agent_positions: [], cluster_count: intel.clusters.length, possible_duplicate_pairs: 0,
      recurrence_buckets: 1, window_buckets: intel.window_buckets, scope_breadth: 0.5, evidence_conflicts: 0,
      ungated_false_positives: 5, total_false_positive_gates: 5, circular_support_count: 0, declared_uncertainties: 3,
      reversibility: 'hard_to_reverse', regulatory_deadline_days: null,
    });
    const text = dec.decision.rationale.join(' ');
    expect(text).toContain(analyst.findings[0].match.pattern_id);
    expect(text).toContain('not its occurrence here');
  });
});

describe('budget and kill switch', () => {
  it('stops the run when the retrieval budget is exhausted instead of continuing quietly', async () => {
    const h = harness({ retrieval: 2 });
    await expect(runScout(h.ctx, { question: 'Q', scope: SCOPE })).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('aborts between phases once the kill switch is thrown', async () => {
    const h = harness();
    h.abort('operator stopped the run');
    await expect(runScout(h.ctx, { question: 'Q', scope: SCOPE })).rejects.toBeInstanceOf(RunAbortedError);
  });
});
