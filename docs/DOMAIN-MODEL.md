# Domain Model & Investigation State Machine

## 1. The graph, not the transcript

Shared risk memory is a typed, append-only graph. Nodes are immutable once created; revision creates
a new node that `supersedes` the old one. Nothing is stored as free conversation.

```
SIGNAL --observed_as--> OBSERVATION --supports--> HYPOTHESIS <--weakens-- CHALLENGE
   ^                                                  |                      ^
   |                                                  |                      |
EVIDENCE --corroborates--> SIGNAL                     |               RED_TEAM_FINDING
                                                      v
                                                  DECISION --triggers--> ACTION
                                                      |                     |
                                                      v                     v
                                                   OUTCOME <--realised_by---+
                                                      |
                                                      v
                                                   LESSON --adjusts--> (future SCORING_POLICY)
```

## 2. Node types

Common envelope on every node: `id`, `kind`, `created_at`, `created_by` (agent id or `human`),
`run_id`, `supersedes?`, `tier` (source hierarchy level 1–5), `provenance`.

### EVIDENCE  (the only node that may carry a factual claim)
```ts
interface Evidence {
  id: string;                 // E-031
  source: string;             // "Bundesamt für Logistik" | "Trans.INFO" | "freight-fraud-taxonomy"
  source_type: 'regulator' | 'industry_body' | 'news' | 'portfolio_kb' | 'llm_reasoning';
  tier: 1 | 2 | 3 | 4 | 5;    // derived from source_type, not agent-chosen
  url: string | null;
  title: string;
  publication_date: string | null;   // ISO, null = unknown (never guessed)
  retrieved_at: string;              // ISO
  claim: string;                     // the single assertion this evidence supports
  excerpt_or_summary: string;        // UntrustedText for tiers 1-3
  reliability: number;               // 0-1, from tier + source track record + injection flags
  relevance: number;                 // 0-1, to the investigation question
  agents_that_used_it: string[];
  cluster_id: string | null;         // set by INTELLIGENCE; same cluster = NOT independent
  injection_suspected: boolean;
}
```
Tier 5 (`llm_reasoning`) evidence is legal to create but **cannot raise confidence**: the scorer
gives it weight 0 and the brief renders it as *hypothesis*, visually distinct from fact.

### SIGNAL
An external occurrence with a time and a place. `{ id, title, source, occurred_at, geo[], mode[],
category, category_derived, category_confidence, evidence_ids[], cluster_id }`.
`category_derived` exists because the upstream FOMO feed labels by OR-matched search, so the adapter
re-derives the category by keyword check and records disagreement rather than trusting the label.

### OBSERVATION
A deterministic statement computed over signals — a count, a rate, a cluster, a delta.
`{ id, statement, method, inputs: signal_ids[], computed_value, window }`. Never model-generated.

### HYPOTHESIS
`{ id, statement, proposed_by, supporting: [{node_id, weight}], weakening: [...], status:
'open'|'supported'|'insufficient_evidence'|'refuted'|'blocked', falsification_test: string }`.
A hypothesis without a stated falsification test is invalid and rejected at creation.

### CHALLENGE  (Challenger) / RED_TEAM_FINDING (Red Team)
`{ id, target_id, class, severity: 'note'|'material'|'blocking', argument, evidence_ids[],
resolution: 'open'|'accepted'|'rebutted', rebuttal? }`
Red-team classes: `hallucination`, `unsupported_claim`, `weak_source_chain`, `duplicate_evidence`,
`same_source_echo`, `confirmation_bias`, `circular_reasoning`, `correlation_as_causation`,
`normal_variation`, `regulatory_misinterpretation`, `impact_overestimate`, `missing_evidence`.
A `blocking` finding cannot be cleared by another agent — only by new evidence or a human override
that is itself recorded as a node.

### DECISION / ACTION / OUTCOME / LESSON
`Decision { id, hypothesis_ids[], severity, confidence, urgency, action_band, owner_role,
review_by, rationale, unresolved_objections[], decided_by: 'system_recommendation'|'human',
human_note? }`
`Action { id, decision_id, text, owner_role, due, source: countermeasure_id? }`
`Outcome { id, decision_id, what_happened, verdict: 'correct'|'false_positive'|'false_negative'|
'partially_correct', useful_evidence_ids[], misleading_evidence_ids[], agent_scorecard }`
`Lesson { id, outcome_id, pattern_key, rule: ScoringPolicyDelta, rationale }`

## 3. Investigation state machine

```
DRAFT -> SCOPED -> DISCOVERY -> CORRELATION -> ANALYSIS -> GOVERNANCE -> CHALLENGE -> RED_TEAM
                        ^                                                              |
                        |                                                              v
                        +----------------- REWORK (<=2) <---------------- blocking findings?
                                                                                       |no
                                                                                       v
   CLOSED <- OUTCOME_RECORDED <- DECIDED <- AWAITING_HUMAN <- DECISION_DRAFTED <--------+

any state --kill--> KILLED        any state --budget--> HALTED_BUDGET
DECISION_DRAFTED --blocking unresolved after 2 reworks--> AWAITING_HUMAN (action_band capped)
```
Transitions are a table, not scattered `if`s, and every transition is appended to a run journal with
timestamp, trigger, and budget snapshot. Illegal transitions throw in tests.

## 4. Traceability guarantee

For every sentence in the executive brief the UI can answer: *which node produced this, which
evidence supports it, at what tier, and which objections touch it.* A brief line with no node id
cannot be rendered — the renderer takes nodes, never strings.
