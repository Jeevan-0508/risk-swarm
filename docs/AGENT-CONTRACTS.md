# Agent Contracts

Every agent is a pure function `(input, tools, budget) -> AgentOutput`, schema-validated on both
sides. An agent that returns prose instead of objects fails validation and is retried once with the
validation error, then recorded as `AGENT_FAILED` — the run continues and the gap becomes an
uncertainty. No agent can silently no-op.

Shared output envelope:
```ts
interface AgentOutput<T> {
  agent: AgentId;
  run_id: string;
  findings: T[];
  evidence_created: Evidence[];      // must pass provenance validation
  evidence_cited: string[];          // must be a subset of input evidence ids
  confidence: number;                // 0-1, agent's own, never used raw in the final score
  uncertainties: string[];
  reasoning_status: 'supported' | 'partially_supported' | 'hypothesis_only' | 'insufficient_evidence';
  recommended_next_step: string | null;
  cost: { calls: number; ms: number; est_tokens: number };
}
```

---

## SCOUT
- **Objective** discover external signals relevant to the question. Discover only; never interpret.
- **Tools** `fomo.querySignals(filter)`, `fomo.runProvenance()`
- **In** `{ question, scope: { geo[], mode[], window_days }, lesson_thresholds }`
- **Out** `Signal[]` + `Evidence[]` (tier 3 news, tier 1–2 where the source is a regulator/industry body)
- **Evidence rule** every signal must carry >=1 evidence object with a real `url` and `source`. No url ⇒ signal dropped, not downgraded.
- **Budget** 40 retrievals / 1 call. **Stop** when the filtered result set is exhausted or the cap is hit (cap hit is reported as coverage gap).

## INTELLIGENCE
- **Objective** turn signals into observations: cluster, deduplicate, count *independent* sources.
- **Tools** deterministic only — `text.shingleSimilarity`, `url.canonicalHost`, `time.bucket`. **No LLM.**
- **In** `Signal[] + Evidence[]`
- **Out** `Observation[]`, `cluster_id` assignments, `duplicates_removed`, `independent_source_count`
- **Rules** two items sharing a canonical host, or >0.82 title shingle similarity within a 72 h window, are one cluster. Cluster size never counts as recurrence; only *distinct clusters across distinct time buckets* do.
- **Stop** single deterministic pass. No budget risk.

## RISK ANALYST
- **Objective** map observations onto taxonomy patterns and state falsifiable hypotheses.
- **Tools** `atlas.matchIndicators(observations)`, `atlas.pattern(id)`, `atlas.falsePositiveGates(id)`
- **Out** `Hypothesis[]` each with `falsification_test`, matched `indicator_ids` with weights and phase, and the **unresolved false-positive gates** for that pattern.
- **Hard rule** indicator coverage is reported as coverage, never as probability. `Unknown` indicators are counted as gaps, never as absent.
- **Budget** 4 calls. **Stop** when every cluster is either matched or explicitly marked unmatched.

## GOVERNANCE OFFICER
- **Objective** determine regulatory and control implications — or state that none can be established yet.
- **Tools** `acr.requirements(filter)`, `acr.controls(requirement_id)`, `atlas.regulatoryHooks(pattern_id)`
- **Out** `{ requirement_id, citation, url, applicability: 'established'|'possible'|'not_established', reasoning, control_ids[], evidence_ids[] }[]`
- **Hard rule** `established` requires a tier-1 citation naming the obligation. Anything else is at most `possible`. A missing citation forces `not_established`.
- **Budget** 3 calls.

## CHALLENGER
- **Objective** try to make each hypothesis fail on its own terms.
- **Tools** read-only graph access + `atlas.falsePositiveGates`, `intel.clusterOf`
- **Out** `Challenge[]` with `argument`, cited evidence, and an explicit `alternative_explanation`.
- **Hard rule** a challenge must name either an ungated false positive, a benign alternative explanation, or a specific evidence deficiency. "I disagree" without one of the three is invalid.
- **Budget** 3 calls, one pass per open hypothesis.

## RED TEAM
- **Objective** attack the **investigation**, not the risk. Twelve finding classes (see domain model).
- **Tools** whole-graph read + `provenance.audit()`, `graph.cycles()`, `stats.sourceConcentration()`
- **Out** `RedTeamFinding[]` + `verdict: 'pass' | 'pass_with_findings' | 'fail'`
- **Standing checks, run every time, deterministic:** fabricated evidence ids; any conclusion whose support is a single cluster; source concentration (>60 % of weight from one host); tier-5-only chains; citation-free regulatory claims; circular support edges; impact asserted without a quantified basis; missing falsification test.
- **Blocking authority** a `fail` verdict forces REWORK, and after the rework cap it caps the decision's `action_band` at `MONITOR`. The Red Team can stop an escalation; it cannot create one.

## DECISION ENGINE
- **Objective** synthesise. It is a **calculator plus a template**, not a persuader.
- **Tools** `scoring.compute(graph)` (deterministic), `riskos.exportRisk(decision)`
- **Out** one `Decision` + `Action[]` + the ten scoring factors with their inputs shown.
- **Hard rule** the engine may not invent a finding, may not resolve an objection, and may not exceed the action band the gates allow. Its narrative sentences are built from node references only.

## ORCHESTRATOR (not an agent — the runtime)
Builds a dependency plan per question, runs independent agents in parallel, decides whether evidence
is sufficient (`independent_source_count >= 2` and every open hypothesis either challenged or gated),
schedules rework when the Red Team fails the run, and enforces the safety envelope. It has no
authority to relax a gate.

## Message bus
```ts
type Message =
 | { type:'claim_for_review'; from:AgentId; to:AgentId; claim_id:string; evidence:string[] }
 | { type:'finding_broadcast'; from:AgentId; node_ids:string[] }
 | { type:'objection'; from:AgentId; to:AgentId; target_id:string; severity:Severity }
 | { type:'request_investigation'; from:AgentId; to:'scout'; gap:string; budget_hint:number }
 | { type:'task_complete'; from:AgentId; cost:Cost }
 | { type:'escalation'; from:'decision_engine'; to:'human'; decision_id:string };
```
Every message is persisted; the Live Agent Activity and Disagreement Room screens are views over
this log, not separate state.
