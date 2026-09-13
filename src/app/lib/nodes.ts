/**
 * Read-only projections of graph nodes for display. Every function here reads fields that the engine
 * already wrote; none of them derives a score, a band or a confidence.
 */
import type { Edge, GraphNode, NodeKind } from '@core/domain/model';

export const KIND_ORDER: NodeKind[] = [
  'signal',
  'observation',
  'hypothesis',
  'evidence',
  'challenge',
  'red_team_finding',
  'decision',
  'action',
  'outcome',
  'lesson',
];

export const KIND_LABEL: Record<NodeKind, string> = {
  signal: 'Signal',
  observation: 'Observation',
  hypothesis: 'Hypothesis',
  evidence: 'Evidence',
  challenge: 'Challenge',
  red_team_finding: 'Red team',
  decision: 'Decision',
  action: 'Action',
  outcome: 'Outcome',
  lesson: 'Lesson',
};

export const EDGE_LABEL: Record<Edge['kind'], string> = {
  observed_as: 'observed as',
  supports: 'supports',
  weakens: 'weakens',
  corroborates: 'corroborates',
  based_on: 'based on',
  triggers: 'triggers',
  realised_by: 'realised by',
  derived_from: 'derived from',
  cites: 'cites',
  supersedes: 'supersedes',
};

export function nodeLabel(n: GraphNode): string {
  switch (n.kind) {
    case 'evidence':
    case 'signal':
      return n.title;
    case 'observation':
      return n.statement;
    case 'hypothesis':
      return n.statement;
    case 'challenge':
      return n.argument;
    case 'red_team_finding':
      return `${n.finding_class}: ${n.argument}`;
    case 'decision':
      return n.headline_risk;
    case 'action':
      return n.text;
    case 'outcome':
      return n.what_happened;
    case 'lesson':
      return n.rationale;
  }
}

/** Field rows for the inspector, in the order a reader needs them. Never invented, never reordered per node. */
export function nodeRows(n: GraphNode): [string, string][] {
  const rows: [string, string][] = [];
  switch (n.kind) {
    case 'evidence':
      rows.push(['Claim', n.claim]);
      rows.push(['Source', n.source]);
      rows.push(['Source type', n.source_type]);
      rows.push(['Tier', `T${n.tier}`]);
      rows.push(['Cluster', n.cluster_id ?? 'unclustered']);
      rows.push(['Reliability', n.reliability.toFixed(2)]);
      rows.push(['Relevance', n.relevance.toFixed(2)]);
      rows.push(['Published', n.publication_date ?? 'not stated']);
      rows.push(['Retrieved', n.retrieved_at]);
      rows.push(['Incident claim', n.incident_claim ? 'yes' : 'no — structural']);
      rows.push(['Injection suspected', n.injection_suspected ? 'YES' : 'no']);
      rows.push(['Used by', n.agents_that_used_it.join(', ') || 'none']);
      break;
    case 'signal':
      rows.push(['Source', n.source]);
      rows.push(['Occurred', n.occurred_at ?? 'not stated']);
      rows.push(['Geo', n.geo.join(', ') || 'none']);
      rows.push(['Mode', n.mode.join(', ') || 'none']);
      rows.push(['Category upstream', n.category_upstream]);
      rows.push(['Category re-derived', n.category_derived]);
      rows.push(['Category confidence', n.category_confidence.toFixed(2)]);
      rows.push(['Category disagreement', n.category_disagreement ? 'YES — upstream not trusted' : 'no']);
      rows.push(['Severity hint', n.source_severity_hint ?? 'none']);
      break;
    case 'observation':
      rows.push(['Method', n.method]);
      rows.push(['Computed value', String(n.computed_value)]);
      rows.push(['Window', `${n.window.from} → ${n.window.to}`]);
      rows.push(['Inputs', `${n.inputs.length} node(s)`]);
      break;
    case 'hypothesis':
      rows.push(['Status', n.status]);
      rows.push(['Falsification test', n.falsification_test]);
      rows.push(['Pattern', n.pattern_id ?? 'none']);
      rows.push(['Scope', `${n.scope.geo.join('/') || 'any'} · ${n.scope.mode.join('/') || 'any'}`]);
      break;
    case 'challenge':
      rows.push(['Target', n.target_id]);
      rows.push(['Severity', n.severity]);
      rows.push(['Basis', n.basis]);
      rows.push(['Alternative', n.alternative_explanation ?? 'none offered']);
      rows.push(['Resolution', n.resolution]);
      rows.push(['Rebuttal', n.rebuttal ?? 'none']);
      break;
    case 'red_team_finding':
      rows.push(['Target', n.target_id]);
      rows.push(['Class', n.finding_class]);
      rows.push(['Severity', n.severity]);
      rows.push(['Clears when', n.clears_when]);
      rows.push(['Resolution', n.resolution]);
      break;
    case 'decision':
      rows.push(['Band', n.action_band]);
      rows.push(['Severity', `${n.severity_band} ${n.severity_score.toFixed(3)}`]);
      rows.push(['Confidence', n.confidence === null ? `withheld — ${n.confidence_blocked_reason ?? 'reason not recorded'}` : n.confidence.toFixed(2)]);
      rows.push(['Urgency', n.urgency]);
      rows.push(['Owner', n.owner_role]);
      rows.push(['Review by', n.review_by]);
      rows.push(['Decided by', n.decided_by]);
      break;
    case 'action':
      rows.push(['Class', n.class]);
      rows.push(['Owner', n.owner_role]);
      rows.push(['Due', n.due]);
      rows.push(['Countermeasure', n.countermeasure_id ?? 'none']);
      break;
    case 'outcome':
      rows.push(['Verdict', n.verdict]);
      rows.push(['Decision', n.decision_id]);
      break;
    case 'lesson':
      rows.push(['Pattern', n.pattern_key]);
      rows.push(['Outcome', n.outcome_id]);
      rows.push(['Runs applied', String(n.runs_applied)]);
      break;
  }
  return rows;
}
