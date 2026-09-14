import { describe, expect, it } from '../test/bdd';
import { createFileLoader } from '../integrations/loader.node';
import { createHarness, BudgetExceededError, RunAbortedError } from './harness';
import { runScout } from './scout';
import { runIntelligence } from './intelligence';
import { runAnalyst, type AnalystFinding } from './analyst';
import { runGovernance } from './governance';
import { runChallenger } from './challenger';
import { RED_TEAM_CHECKS, runRedTeam } from './redteam';
import { runDecision } from './decision';
import { computeScore, type EvidenceRef } from '../scoring/score';
import { DEFAULT_POLICY } from '../scoring/policy';
import { RedTeamClass } from '../domain/model';
import type { SignalSource } from '../integrations/fomo';

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

  it('never mistakes its own run-level sentinel for a fabricated citation', () => {
    // No hypothesis exists, so the challenger raises its "spike, not a trend" objection against the
    // fallback target 'run' - a real challenge, correctly built, that was never meant to resolve to a
    // node. The red team must not flag itself for citing its own placeholder.
    const h = harness();
    const challenge = runChallenger(h.ctx, {
      findings: [], evidence: [], independent_source_count: 4, possible_duplicate_pairs: 0, cluster_count: 4,
      recurrence_buckets: 1, window_buckets: 8, benign_category_share: 0, min_independent_sources: 2,
    }).findings[0];
    expect(challenge.target_id).toBe('run');
    const out = runRedTeam(h.ctx, input({ challenges: [challenge], known_node_ids: [] }));
    expect(out.findings.some((f) => f.finding_class === 'hallucination')).toBe(false);
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

  /**
   * One test per remaining check class. A check list that names twelve defects but only ever proves three
   * of them is a claim, not a guard, so every class below is driven to its own finding and asserted by
   * class - not merely counted.
   */
  const ev = (h: ReturnType<typeof harness>, over: Partial<Parameters<typeof h.ctx.minter.evidence>[1]> = {}) =>
    h.ctx.minter.evidence('scout', {
      source: 'Trans.INFO',
      source_type: 'news',
      url: 'https://trans.info/example',
      title: 'Carrier insolvency wave in Germany',
      publication_date: '2026-09-10',
      retrieved_at: NOW,
      claim: 'A German road carrier entered insolvency.',
      excerpt_or_summary: 'Report of an insolvency filing.',
      reliability: 0.55,
      relevance: 0.8,
      agents_that_used_it: ['scout'],
      cluster_id: 'CL-1',
      injection_suspected: false,
      incident_claim: true,
      ...over,
    });

  const classes = (out: ReturnType<typeof runRedTeam>) => out.findings.map((f) => f.finding_class);

  it('flags source concentration when one publisher supplies most of the incident record', () => {
    const h = harness();
    const evidence = [ev(h, { id: 'E-1' }), ev(h, { id: 'E-2', url: 'https://trans.info/b' }), ev(h, { id: 'E-3', url: 'https://trans.info/c' })];
    const out = runRedTeam(h.ctx, input({ evidence }));
    expect(classes(out)).toContain('confirmation_bias');
    expect(out.findings.find((f) => f.finding_class === 'confirmation_bias')!.severity).toBe('material');
  });

  it('does not flag concentration when no single publisher passes the threshold', () => {
    const h = harness();
    const evidence = [
      ev(h, { id: 'E-1' }),
      ev(h, { id: 'E-2', source: 'Verkehrsrundschau', url: 'https://trans.info/b' }),
      ev(h, { id: 'E-3', source: 'BAG', url: 'https://trans.info/c' }),
    ];
    expect(classes(runRedTeam(h.ctx, input({ evidence })))).not.toContain('confirmation_bias');
  });

  it('blocks a chain whose incident evidence carries no evidential weight at all', async () => {
    const { h, analyst } = await throughAnalyst();
    const known = analyst.findings.flatMap((f) => [f.hypothesis.id, ...f.supporting_evidence_ids]);
    const out = runRedTeam(h.ctx, input({
      findings: analyst.findings, known_node_ids: known,
      evidence: [ev(h, { id: 'E-9', source_type: 'llm_reasoning', url: null })],
    }));
    const weak = out.findings.find((f) => f.finding_class === 'weak_source_chain')!;
    expect(weak.severity).toBe('blocking');
  });

  it('downgrades to material when the record is real reporting but no regulator or industry body', async () => {
    const { h, analyst } = await throughAnalyst();
    const known = analyst.findings.flatMap((f) => [f.hypothesis.id, ...f.supporting_evidence_ids]);
    const out = runRedTeam(h.ctx, input({ findings: analyst.findings, known_node_ids: known, evidence: [ev(h, { id: 'E-8' })] }));
    expect(out.findings.find((f) => f.finding_class === 'weak_source_chain')!.severity).toBe('material');
  });

  it('flags one incident url minted as two evidence objects', () => {
    const h = harness();
    const out = runRedTeam(h.ctx, input({ evidence: [ev(h, { id: 'E-1' }), ev(h, { id: 'E-2' })] }));
    expect(classes(out)).toContain('duplicate_evidence');
  });

  it('blocks a regulator-tier claim that carries no resolvable citation', () => {
    const h = harness();
    const out = runRedTeam(h.ctx, input({ evidence: [ev(h, { id: 'E-1', source_type: 'regulator', url: null, incident_claim: false })] }));
    const f = out.findings.find((x) => x.finding_class === 'regulatory_misinterpretation')!;
    expect(f.severity).toBe('blocking');
  });

  it('flags a magnitude that names no basis, and leaves one that does alone', () => {
    const h = harness();
    const flagged = runRedTeam(h.ctx, input({ quantified_claims: [{ node_id: 'H-001', text: 'losses of about 4 million', has_basis: false }] }));
    expect(classes(flagged)).toContain('impact_overestimate');
    expect(flagged.findings.find((f) => f.finding_class === 'impact_overestimate')!.target_id).toBe('H-001');
    const clean = runRedTeam(h.ctx, input({ quantified_claims: [{ node_id: 'H-001', text: 'losses of about 4 million', has_basis: true }] }));
    expect(classes(clean)).not.toContain('impact_overestimate');
  });

  it('blocks a hypothesis whose falsification test is too thin to run', async () => {
    const { h, analyst } = await throughAnalyst();
    const known = analyst.findings.flatMap((f) => [f.hypothesis.id, ...f.supporting_evidence_ids]);
    (analyst.findings[0]!.hypothesis as { falsification_test: string }).falsification_test = 'ask around';
    const out = runRedTeam(h.ctx, input({ findings: analyst.findings, known_node_ids: known }));
    const f = out.findings.find((x) => x.finding_class === 'unsupported_claim')!;
    expect(f.severity).toBe('blocking');
    expect(f.target_id).toBe(analyst.findings[0]!.hypothesis.id);
  });

  it('argues ordinary commercial distress when half the surviving signals are insolvencies', async () => {
    const { h, analyst } = await throughAnalyst();
    const known = analyst.findings.flatMap((f) => [f.hypothesis.id, ...f.supporting_evidence_ids]);
    expect(classes(runRedTeam(h.ctx, input({ findings: analyst.findings, known_node_ids: known, benign_category_share: 0.5 })))).toContain('normal_variation');
    expect(classes(runRedTeam(h.ctx, input({ findings: analyst.findings, known_node_ids: known, benign_category_share: 0.49 })))).not.toContain('normal_variation');
  });

  it('blocks a conclusion drawn where almost no indicator was measured', async () => {
    const { h, analyst } = await throughAnalyst();
    const known = analyst.findings.flatMap((f) => [f.hypothesis.id, ...f.supporting_evidence_ids]);
    const out = runRedTeam(h.ctx, input({ findings: analyst.findings, known_node_ids: known, unknown_indicator_share: 0.81 }));
    expect(out.findings.find((f) => f.finding_class === 'missing_evidence')!.severity).toBe('blocking');
    expect(classes(runRedTeam(h.ctx, input({ findings: analyst.findings, known_node_ids: known, unknown_indicator_share: 0.8 })))).not.toContain('missing_evidence');
  });

  it('flags a pattern linked to this network only by shared vocabulary', async () => {
    const { h, analyst } = await throughAnalyst();
    const known = analyst.findings.flatMap((f) => [f.hypothesis.id, ...f.supporting_evidence_ids]);
    const lexical = analyst.findings.filter((f) => f.match.basis === 'lexical_topic_match' && f.coverage.completeness === 0);
    expect(lexical.length).toBeGreaterThan(0);
    const out = runRedTeam(h.ctx, input({ findings: analyst.findings, known_node_ids: known }));
    expect(out.findings.filter((f) => f.finding_class === 'correlation_as_causation').length).toBe(lexical.length);
  });

  it('states what would clear every finding it raises', async () => {
    const { h, analyst } = await throughAnalyst();
    const out = runRedTeam(h.ctx, input({ findings: analyst.findings, unknown_indicator_share: 1 }));
    expect(out.findings.length).toBeGreaterThan(0);
    for (const f of out.findings) expect(f.clears_when.length).toBeGreaterThan(10);
  });

  it('publishes a named check list that matches the number of checks it actually ran', async () => {
    const h = harness();
    const out = runRedTeam(h.ctx, input({}));
    expect(RED_TEAM_CHECKS.length).toBe(out.checks_run);
    const classes = RED_TEAM_CHECKS.map((c) => c.finding_class);
    expect(new Set(classes).size).toBe(classes.length);
    expect(new Set(classes)).toEqual(new Set(RedTeamClass.options));
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

describe('SCOUT reports retrieval failure rather than absorbing it', () => {
  // R14. Before this, a run in which every feed was blocked produced the same SCOUT output as a run in
  // which the feeds were read and the world was quiet: findings were empty either way.
  const failingSource = (readable: number, failed: number): SignalSource => ({
    provenance: async () => ({ key: 'live', upstream_repo: 'live retrieval', upstream_url: 'https://example.org', commit: null, note: 'test', files: [] }),
    querySignals: async () => ({
      signals: [],
      stats: {
        scanned: 0, excluded_no_url: 0, excluded_undated: 0, excluded_out_of_window: 0, excluded_low_relevance: 0,
        excluded_geo: 0, excluded_category: 0, category_disagreements: 0, returned: 0, truncated_by_limit: false,
      },
      provenance: { key: 'live', upstream_repo: 'live retrieval', upstream_url: 'https://example.org', commit: null, note: 'test', files: [] },
      retrieval: {
        sources_attempted: readable + failed,
        sources_read: readable,
        sources_failed: failed,
        failures: Array.from({ length: failed }, (_, i) => ({ source_key: `s${i}`, kind: 'blocked' as const, reason: 'The browser blocked this request.' })),
      },
    }),
  });

  it('names SEARCH_FAILED when every source failed, and does not advise widening the window', async () => {
    const h = createHarness({ loader: loader(), run_id: 'RUN-T', now: NOW, signals: failingSource(0, 2) });
    const out = await runScout(h.ctx, { question: 'Q', scope: SCOPE });
    expect(out.findings.length).toBe(0);
    expect(out.retrieval!.sources_read).toBe(0);
    expect(out.uncertainties.some((u) => u.includes('SEARCH_FAILED'))).toBe(true);
    expect(out.uncertainties.some((u) => u.includes('retrieval did not happen'))).toBe(true);
    expect(out.recommended_next_step).toContain('Restore source access');
    expect(out.reasoning_status).toBe('insufficient_evidence');
  });

  it('calls partial coverage partial instead of reporting a clean read', async () => {
    const h = createHarness({ loader: loader(), run_id: 'RUN-T', now: NOW, signals: failingSource(1, 1) });
    const out = await runScout(h.ctx, { question: 'Q', scope: SCOPE });
    expect(out.uncertainties.some((u) => u.includes('1 of 2 source(s) failed'))).toBe(true);
    expect(out.uncertainties.some((u) => u.includes('SEARCH_FAILED'))).toBe(false);
  });

  it('has no retrieval report at all when the source is a pinned snapshot, which cannot fail', async () => {
    const out = await runScout(harness().ctx, { question: 'Q', scope: SCOPE });
    expect(out.retrieval).toBeNull();
    expect(out.uncertainties.some((u) => u.includes('SEARCH_FAILED'))).toBe(false);
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
