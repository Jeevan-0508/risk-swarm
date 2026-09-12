# Scoring — Transparent, Explainable, Gated

No opaque "AI score". Every number below is computed from graph nodes by pure functions, and the UI
shows the inputs next to the output. Three published results: **SEVERITY**, **CONFIDENCE**,
**URGENCY**. They are never multiplied into one number, because they answer different questions.

## 1. Tier weights (fixed, not agent-chosen)

| Tier | Source type | Reliability weight |
|---|---|---|
| 1 | official regulatory / government | 1.00 |
| 2 | established industry / security body | 0.80 |
| 3 | reputable news | 0.55 |
| 4 | portfolio knowledge base (taxonomy / atlas / control room) | 0.70 |
| 5 | LLM reasoning | **0.00** |

Tier 4 sits above news because it is versioned, cited and reviewable — but it is *structural*
knowledge, not incident proof, so it can never satisfy the independent-source gate on its own.
`injection_suspected` applies a x0.5 penalty and is shown in the brief.

## 2. The ten factors (each 0–1, each explainable)

| # | Factor | Computation |
|---|---|---|
| 1 | `evidence_strength` | Σ over *distinct clusters* of `reliability × relevance`, normalised by a 5-cluster reference; cluster-internal duplicates add nothing |
| 2 | `source_reliability` | weight-mean tier reliability of supporting evidence |
| 3 | `signal_recurrence` | distinct time buckets (7-day) containing an independent cluster ÷ buckets in window |
| 4 | `independent_evidence_count` | count of distinct clusters with distinct canonical hosts (raw integer, also normalised) |
| 5 | `potential_impact` | taxonomy pattern severity × scope breadth (geo × mode × stage), stated as a modelled upper bound |
| 6 | `time_sensitivity` | recency decay of the newest independent cluster, plus regulatory deadline proximity if a tier-1 requirement has a dated obligation |
| 7 | `false_positive_risk` | `0.4×ungated_fp_ratio + 0.3×duplicate_ratio + 0.2×single_cluster_dependence + 0.1×circularity` |
| 8 | `agent_agreement` | share of agents whose `reasoning_status` supports the lead hypothesis |
| 9 | `agent_disagreement` | see Disagreement Index below |
| 10 | `uncertainty` | weighted share of taxonomy indicators for the matched pattern whose state is `Unknown`, plus declared agent uncertainties |

## 3. Disagreement Index (0–100, higher = less settled)

```
DI = 30×conflicting_findings_norm
   + 25×evidence_conflict_norm
   + 25×confidence_variance_norm      // stdev of agent confidences, /0.35 cap
   + 20×unresolved_objection_norm     // material=1, blocking=2 weights
```
DI is a *published feature*, not a defect. A high DI with a MONITOR decision is a correct outcome.
The Disagreement Room screen renders each term with its contributing nodes.

## 4. Composite results

```
CONFIDENCE_raw = 0.34×evidence_strength + 0.22×source_reliability
               + 0.18×signal_recurrence + 0.16×independence_norm + 0.10×agent_agreement
CONFIDENCE     = clamp01( CONFIDENCE_raw × (1 − 0.5×false_positive_risk) × (1 − 0.4×uncertainty) )

SEVERITY  = potential_impact × exposure_breadth      -> LOW / MEDIUM / HIGH / CRITICAL bands
URGENCY   = f(SEVERITY band, time_sensitivity, reversibility) -> ROUTINE / ELEVATED / IMMEDIATE
```

## 5. Hard caps (the false-positive defence, in code, not in a prompt)

| Condition | Effect |
|---|---|
| `independent_evidence_count < 2` | `CONFIDENCE <= 0.35`, action band capped at `MONITOR` |
| all support is tier 5 | `CONFIDENCE = 0`, hypothesis rendered as hypothesis only |
| any tier-4-only support for an incident claim | `CONFIDENCE <= 0.45` (structure is not an incident) |
| any unresolved `blocking` red-team finding | no numeric confidence published; state `BLOCKED` |
| `false_positive_risk > 0.6` | action band capped at `NOTE` |
| ungated false positives remain for the matched pattern | those gates are printed in the brief verbatim |

## 6. Action band ladder

`NOTE -> MONITOR -> TARGETED_INVESTIGATION -> ESCALATE`

**ESCALATE requires all of:** `CONFIDENCE >= 0.60` **and** `independent_evidence_count >= 3` **and**
zero blocking findings **and** `false_positive_risk < 0.40` **and** >=1 tier-1 or tier-2 evidence
object. Fail any one and the band drops one step, with the failed gate named in the brief.

Repetition is not evidence: five agents restating one hypothesis moves nothing, because every
confidence term is computed over clusters and tiers, never over agent count.

## 7. Learning loop influence

A `Lesson` may only emit a bounded `ScoringPolicyDelta`:
```ts
interface ScoringPolicyDelta {
  pattern_key: string;                       // e.g. "FFT-002|DE"
  min_independent_sources?: 2|3|4;           // may only increase
  fp_risk_multiplier?: number;               // 1.0–1.5, may only tighten
  required_min_tier?: 1|2;                   // may only tighten
  expires_after_runs?: number;
}
```
Lessons can only make the system **more** conservative. A lesson can never lower a gate, so the
learning loop cannot be poisoned into producing escalations. Every active delta is listed on the
Command Center with the outcome that created it.
