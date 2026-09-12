# Portfolio Integrations — Adapters, Not Copies

Each integration is a read-only adapter over a **provenanced snapshot** of the upstream repo's
published data. No upstream code is copied, and no upstream repo is modified. This mirrors the
`scripts/sync_taxonomy.py` pattern already used in `freight-risk-atlas`.

```
/integrations
  /fomo                      SignalSource
  /freight-risk-atlas        PatternMatcher      (incl. freight-fraud-taxonomy model)
  /ai-governance-control-room RegulatoryMapper
  /risk-os                   RiskRegisterSink
```

Every snapshot directory carries `provenance.json`:
`{ upstream_repo, upstream_url, commit, files[], sha256[], retrieved_at, synced_by }`
`sync.mjs --check` fails CI if the snapshot drifts from upstream or a hash mismatches. The console
shows the snapshot date on every screen that displays snapshot-derived data.

## 1. FOMO — `SignalSource`
```ts
interface SignalSource {
  querySignals(f: { geo?: string[]; categories?: string[]; windowDays: number; limit: number }): Promise<RawSignal[]>;
  provenance(): SnapshotProvenance;
}
```
Real upstream shape: `{ category, title, link, source, pub_date, severity, found_at }`, 874 signals
across 6 categories, 32 scan runs.

**Adapter safeguards (deliberate, documented):**
- `category` is *not* trusted. The upstream feed is built from OR-matched RSS queries, so the adapter
  re-derives a category by keyword check and emits `category_derived` + `category_confidence`; a
  disagreement becomes an INTELLIGENCE observation, not a silent relabel.
- `severity` upstream is heuristic; it is imported as `source_severity_hint` and never used in scoring.
- Google-News redirect links are canonicalised to the publisher host for the independence count,
  otherwise every story would look like one source (`news.google.com`).
- Missing `pub_date` ⇒ `publication_date: null`. Never inferred from `found_at`.

## 2. Freight Risk Atlas + Taxonomy — `PatternMatcher`
```ts
interface PatternMatcher {
  match(obs: Observation[], scope: Scope): PatternMatch[];   // coverage, never probability
  pattern(id: string): Pattern;
  falsePositiveGates(id: string): FalsePositiveGate[];
  countermeasures(id: string, stage?: Stage): Countermeasure[];
  regulatoryHooks(id: string): RegulatoryHook[];
}
```
Real upstream model: 12 patterns, 8 categories, 77 indicators (`phase`, `signal`, `observable_in`,
`weight`, `notes`), 31 `false_positives` (`looks_like` / `actually` / `how_to_rule_out`), 137
countermeasures, `regulatory_hooks`, `related`.

Invariants asserted in tests: coverage % is recomputed independently; `Unknown` never counts as
`Absent`; a match with ungated false positives can never reach `ESCALATE`; recommended actions are
drawn from real countermeasure ids, never generated.

## 3. AI Governance Control Room — `RegulatoryMapper`
```ts
interface RegulatoryMapper {
  requirements(f: { frameworks?: string[]; role?: Role; tier?: Tier }): Requirement[];
  controls(requirementId: string): Control[];
  cite(requirementId: string): { ref: string; citation: string; url: string };
}
```
Real upstream model: 4 frameworks / 56 requirements (`id`, `ref`, `title`, `summary`, `applies`),
29 controls, 84 evidence artefacts, 70 crosswalk links. Applicability is *derived* from `applies`,
matching the upstream design — the adapter must not store applicability on controls.

Invariant: the Governance Officer can only mark a requirement `established` when `cite()` returns a
tier-1 citation with a resolvable `url`. Paraphrase summaries are labelled as paraphrase in the brief.

## 4. RISK//OS — `RiskRegisterSink`
```ts
interface RiskRegisterSink {
  exportRisk(d: Decision, h: Hypothesis[]): RiskOsRiskJson;  // import-compatible JSON
  appetiteContext(category: string): { appetite: string; tolerance: string } | null;
}
```
Direction is **out**: RISK//SWARM ends where RISK//OS begins. A human-accepted decision exports a
risk object in the shape RISK//OS already imports, with owner role, treatment, review date and the
full evidence trail as the rationale. Note the known upstream behaviour: RISK//OS JSON import
*replaces* a programme rather than merging, so the export is a single-risk file plus a printed
instruction, not an automated push. RISK//SWARM never writes to RISK//OS itself — that would be a
consequential action, which belongs to the human.
