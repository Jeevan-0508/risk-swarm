/** Shared, dependency-free SWARM -> Replay -> MESH contract. No network or mutable storage. */
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v, names) => object(v) && Object.keys(v).length === names.length && names.every((k) => Object.hasOwn(v, k));
const string = (v) => typeof v === 'string' && v.length <= 20000;
const strings = (v) => Array.isArray(v) && v.length <= 500 && v.every(string);
const unique = (v) => strings(v) && new Set(v).size === v.length;
const date = (v) => string(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const fail = (error) => ({ ok: false, error });
const clone = (v) => JSON.parse(JSON.stringify(v));
const normalise = (v) => v.trim().toLowerCase().replace(/^the\s+/, '').replace(/[.!?]+$/, '');
const AGENTS = ['ATHENA', 'ARES', 'HADES'];
export const INVESTIGATION_CONTRACT_VERSION = 'swarm-investigation-snapshot.v1';

function expectedDisagreement(positions) {
  const independent = positions.filter((p) => p.status === 'independent');
  const stances = [...new Set(independent.map((p) => normalise(p.stance)))];
  return {
    independent_count: independent.length,
    distinct_stances: stances,
    agreement: independent.length < 2 ? 'inconclusive' : stances.length === 1 ? 'strong_consensus' : stances.length === independent.length ? 'split' : 'majority',
    independence_scope: 'separate_requests_not_verified_model_independence',
  };
}

/** validateCapture must call the consumer's strict swarm-research-capture.v1 parser. */
export function validateInvestigationSnapshot(value, validateCapture) {
  try {
    const seen = new Set();
    function bounded(v, depth = 0) {
      if (depth > 32) throw new Error('nesting');
      if (v && typeof v === 'object') {
        if (seen.has(v) || ![Object.prototype, Array.prototype].includes(Object.getPrototypeOf(v))) throw new Error('non-JSON');
        seen.add(v);
        for (const [k, child] of Object.entries(v)) { if (['__proto__','constructor','prototype'].includes(k)) throw new Error('unsafe'); bounded(child, depth + 1); }
        seen.delete(v);
      } else if (!['string','boolean','number'].includes(typeof v) && v !== null) throw new Error('non-JSON');
      else if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('nonfinite');
    }
    bounded(value);
    if (new TextEncoder().encode(JSON.stringify(value)).length > 2000000) return fail('Investigation exceeds 2 MB.');
  } catch { return fail('Invalid or excessive JSON structure.'); }

  if (!keys(value, ['schema_version', 'kind', 'captured_at', 'capture', 'analysis', 'outcome', 'unknowns', 'knowledge_promotion'])) return fail('Invalid investigation envelope.');
  if (value.schema_version !== INVESTIGATION_CONTRACT_VERSION || value.kind !== 'risk_swarm_investigation_snapshot' || !date(value.captured_at)) return fail('Unsupported investigation version or date.');
  try { if (typeof validateCapture !== 'function' || validateCapture(value.capture) !== true) return fail('Nested research capture failed strict validation.'); } catch { return fail('Nested research capture failed strict validation.'); }
  if (Date.parse(value.captured_at) < Date.parse(value.capture.captured_at) || Date.parse(value.capture.captured_at) < Date.parse(value.capture.research.started_at)) return fail('Capture chronology is inconsistent.');
  const sources = value.capture.research.source_records;
  if (sources.some((s) => s.data_class !== 'external_source_content' || s.role !== 'retrieved_source_record')) return fail('Synthetic or model data cannot enter source records.');
  const sourceIds = new Set(sources.map((s) => s.evidence_id));
  const candidate = value.capture.hypothesis_context?.candidate?.candidate;
  if (candidate && !Array.isArray(candidate.supporting_cases)) return fail('Malformed synthetic candidate context.');
  const syntheticIds = new Set(candidate ? [candidate.id, candidate.signature, ...candidate.supporting_cases.map((c) => c.case_id)] : []);
  const a = value.analysis;
  if (!keys(a, ['status', 'selected_source_ids', 'omitted_source_ids', 'positions', 'disagreement', 'decision', 'trace'])) return fail('Invalid analysis fields.');
  if (!['recorded', 'not_run'].includes(a.status) || !unique(a.selected_source_ids) || !unique(a.omitted_source_ids) || a.selected_source_ids.some((id) => !sourceIds.has(id)) || a.omitted_source_ids.some((id) => sourceIds.has(id))) return fail('Invalid or unresolved analysis source selection.');
  // Omitted IDs are references to unavailable historical context, never evidence in this export.
  const permittedReferences = new Set([...a.selected_source_ids, ...a.omitted_source_ids]);
  if ([...permittedReferences].some((id) => syntheticIds.has(id) || /^fraud-watch:/.test(id))) return fail('Synthetic candidate IDs cannot be cited as sources, including omitted sources.');
  const refs = (v) => unique(v) && v.every((id) => permittedReferences.has(id));
  if (!Array.isArray(a.positions) || a.positions.length > 3 || !Array.isArray(a.trace) || a.trace.length > 100) return fail('Invalid position or event list.');
  const agentIds = new Set();
  const claimIds = new Set();
  for (const p of a.positions) {
    if (!keys(p, ['agent', 'role', 'provider', 'model', 'model_revision', 'provider_version', 'status', 'stance', 'reasoning_summary', 'claims', 'evidence_ids', 'evidence_requests', 'assumptions', 'latency_ms', 'degraded_reason'])) return fail('Invalid position fields.');
    if (!AGENTS.includes(p.agent) || agentIds.has(p.agent) || !['evidence_analysis', 'adversarial_challenge', 'alternative_explanations'].includes(p.role)) return fail('Invalid or repeated epistemic agent.');
    agentIds.add(p.agent);
    if (![p.provider, p.stance, p.reasoning_summary].every(string) || !p.stance.trim() || !(p.model === null || string(p.model)) || p.model_revision !== null || p.provider_version !== null || !['independent', 'fallback', 'unavailable'].includes(p.status)) return fail('Invalid model identity or position status.');
    if (p.status === 'independent' && p.provider === 'deterministic') return fail('A deterministic fallback is not an independent model opinion.');
    if (p.status === 'independent' && permittedReferences.size === 0) return fail('No independent model opinion can be formed without source inputs.');
    if (!(p.degraded_reason === null || string(p.degraded_reason)) || !Number.isFinite(p.latency_ms) || p.latency_ms < 0 || !refs(p.evidence_ids) || !strings(p.evidence_requests) || !strings(p.assumptions)) return fail('Invalid position provenance.');
    if (!Array.isArray(p.claims) || p.claims.length > 200) return fail('Invalid claim list.');
    for (const c of p.claims) {
      if (!keys(c, ['id', 'asserted_type', 'epistemic_type', 'text', 'evidence_ids', 'verification', 'confidence'])) return fail('Invalid claim fields.');
      if (!string(c.id) || claimIds.has(c.id) || !string(c.text) || !refs(c.evidence_ids) || !['FACT', 'INFERENCE', 'HYPOTHESIS', 'UNKNOWN'].includes(c.asserted_type)) return fail('Invalid claim identity, type or citations.');
      claimIds.add(c.id);
      const type = c.asserted_type === 'FACT' ? 'INFERENCE' : c.asserted_type;
      if (c.epistemic_type !== type || c.verification !== 'unverified' || c.confidence !== null) return fail('Model assertions cannot self-verify, become facts, or manufacture confidence.');
      if (['FACT', 'INFERENCE'].includes(c.asserted_type) && c.evidence_ids.length === 0) return fail('A factual or inferential claim requires source references.');
    }
  }
  for (const e of a.trace) {
    if (!keys(e, ['at', 'kind', 'agent', 'detail']) || !date(e.at) || !string(e.kind) || !string(e.detail) || !(e.agent === null || [...AGENTS, 'ZEUS'].includes(e.agent))) return fail('Invalid historical trace event.');
    if (Date.parse(e.at) > Date.parse(value.captured_at) || Date.parse(e.at) < Date.parse(value.capture.research.started_at)) return fail('Trace event is outside the captured run.');
  }
  if (a.status === 'not_run') {
    if (a.positions.length || a.selected_source_ids.length || a.omitted_source_ids.length || a.decision !== null || a.disagreement !== null || a.trace.length) return fail('A run that did not happen cannot have model results.');
  } else {
    if (a.positions.length !== 3 || !keys(a.disagreement, ['independent_count', 'distinct_stances', 'agreement', 'independence_scope'])) return fail('Recorded analysis needs three explicit model/fallback states.');
    const expected = expectedDisagreement(a.positions);
    if (a.disagreement.independent_count !== expected.independent_count || a.disagreement.agreement !== expected.agreement || a.disagreement.independence_scope !== expected.independence_scope || JSON.stringify(a.disagreement.distinct_stances) !== JSON.stringify(expected.distinct_stances)) return fail('Disagreement does not match recorded positions.');
    const d = a.decision;
    if (!keys(d, ['data_class', 'state', 'verdict_type', 'answer', 'rationale', 'minority_view', 'unresolved', 'cited_evidence_ids', 'provider', 'model', 'model_revision', 'provider_version'])) return fail('Invalid decision proposal fields.');
    if (d.data_class !== 'model_or_policy_proposal' || !['proposed', 'abstained'].includes(d.state) || !['CONSENSUS', 'MAJORITY', 'MINORITY_PRESERVED', 'UNRESOLVED'].includes(d.verdict_type) || !string(d.answer) || !strings(d.rationale) || !(d.minority_view === null || string(d.minority_view)) || !strings(d.unresolved) || !refs(d.cited_evidence_ids) || !string(d.provider) || !(d.model === null || string(d.model)) || d.model_revision !== null || d.provider_version !== null) return fail('Invalid decision proposal metadata.');
    if (d.state !== (d.verdict_type === 'UNRESOLVED' || d.cited_evidence_ids.length === 0 ? 'abstained' : 'proposed')) return fail('Unsupported decision cannot be recorded as a proposal.');
  }
  if (!keys(value.outcome, ['status', 'correctness', 'record']) || value.outcome.status !== 'not_observed' || value.outcome.correctness !== 'unknown' || value.outcome.record !== null) return fail('This capture cannot manufacture a later outcome or correctness label.');
  if (!strings(value.unknowns) || value.knowledge_promotion !== 'prohibited') return fail('Unknowns and the no-promotion boundary must be explicit.');
  return { ok: true, value: clone(value) };
}

/** Reconstruct exactly the recorded context. It never re-runs a provider or reads current knowledge. */
export function reconstructInvestigation(snapshot) {
  const a = snapshot.analysis;
  return {
    algorithm: 'frozen-context.v1',
    question: snapshot.capture.research.question,
    source_record_ids: snapshot.capture.research.source_records.map((s) => s.evidence_id),
    consulted_source_ids: [...a.selected_source_ids],
    context_status: a.omitted_source_ids.length ? 'incomplete_omitted_sources' : 'complete_for_recorded_analysis',
    unavailable_source_ids: [...a.omitted_source_ids],
    analysis_status: a.status,
    models: a.positions.map((p) => ({ agent: p.agent, provider: p.provider, model: p.model, model_revision: p.model_revision, status: p.status })),
    disagreement: clone(a.disagreement),
    decision: clone(a.decision),
    outcome: clone(snapshot.outcome),
    unknowns: [...snapshot.unknowns],
    synthetic_context_used_as_evidence: false,
    live_provider_calls: 0,
    knowledge_promoted: false,
    limitation: 'Reconstructs recorded statements, not source truth, model internals, independent review, or decision correctness.',
  };
}

export function buildReplayInvestigationHandoff(snapshot, createdAt, validateCapture) {
  const checked = validateInvestigationSnapshot(snapshot, validateCapture);
  if (!checked.ok) throw new Error(checked.error);
  if (!date(createdAt) || Date.parse(createdAt) < Date.parse(snapshot.captured_at)) throw new Error('Invalid handoff chronology.');
  return {
    schema_version: 'risk-replay-investigation-handoff.v1', kind: 'risk_replay_investigation_handoff',
    created_at: createdAt, review_state: 'unreviewed', replay_status: 'frozen_context_reconstructed',
    snapshot: checked.value, reconstruction: reconstructInvestigation(checked.value),
  };
}

export function validateReplayInvestigationHandoff(value, validateCapture) {
  if (!keys(value, ['schema_version', 'kind', 'created_at', 'review_state', 'replay_status', 'snapshot', 'reconstruction']) || value.schema_version !== 'risk-replay-investigation-handoff.v1' || value.kind !== 'risk_replay_investigation_handoff' || !date(value.created_at) || value.review_state !== 'unreviewed' || value.replay_status !== 'frozen_context_reconstructed') return fail('Invalid investigation handoff envelope.');
  const checked = validateInvestigationSnapshot(value.snapshot, validateCapture);
  if (!checked.ok) return checked;
  if (Date.parse(value.created_at) < Date.parse(value.snapshot.captured_at)) return fail('Invalid handoff chronology.');
  // Canonical object-key order does not matter; arrays preserve the actual historical ordering.
  const canonical = (v) => JSON.stringify(v, (_, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
  if (canonical(value.reconstruction) !== canonical(reconstructInvestigation(checked.value))) return fail('Reconstruction was changed or does not match the frozen snapshot.');
  return { ok: true, value: clone(value) };
}
