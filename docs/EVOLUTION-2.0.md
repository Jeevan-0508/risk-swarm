# EVOLUTION 2.0 — build plan

Standing mandate from the user's "RISK//SWARM — EVOLUTION 2.0" spec: autonomous execution, no
implementation-decision questions, stop only for a non-negotiable-principle conflict or an
incompatible architecture change. This doc is the cross-session anchor — read it before resuming.

## Ground rules carried over from 1.0 (still binding)
- UI is a pure renderer over `RunResult`. A new value goes into the engine (`RunResult` or a node),
  never computed inside a screen component.
- `domain/model.ts` / `domain/graph.ts` additions must be additive-only: no existing node shape,
  the append-only guarantee, or a citation/graph-integrity guard may change.
- `scoring/score.ts` caps and the action-band ladder are not to be weakened. `scoring/policy.ts`
  stays tighten-only.
- Never fabricate evidence, citations, metrics, confidence or activity. Show UNKNOWN instead.
- Agent identity layer is UI-only. Technical `AgentId` values (`scout`, `intelligence`, ...) and
  their contracts are unchanged; codenames/taglines are a presentation layer over them.

## Phase map

| Phase | What | Where | Status |
|---|---|---|---|
| A | Agent identity layer (HERMES/ATHENA/APOLLO/ZEUS/ARES/HADES/HEPHAESTUS + taglines) | `src/app/lib/agents.ts` + 4 screens | **done** (`148ad21`, renamed to match Pantheon `1266d81`+1) |
| B | SENTINEL — evidence-integrity report, engine-side, additive field on `RunResult` | `src/core/sentinel/`, `orchestrator/run.ts` | **done** (`854d20a`, bugfixes `7ca294b`/`c71d95f`) |
| C | PULSE — system-health report over a completed `RunResult` | `src/core/pulse/` | **done** (`0bfbb51`) |
| D | ORBIT — deterministic scenario mutators + baseline-vs-stressed diff | `src/core/orbit/` | **done** (`e1d2a1c`) |
| E | Decision Lineage, Evidence Needed, Source Concentration (pure derivations, no new agent) | `src/core/lineage/` or inline in `decision.ts` output | next |
| F | Run Comparison / "What Changed?" diff engine (reused by ORBIT and by repeat-investigation) | `src/core/compare/` | |
| G | New/updated UI screens: Deliberation Room, Decision Lineage, Evidence Needed, Run Comparison,
    Source Concentration, upgraded Evidence Graph/Red Team/Governance/Provenance, Human Decision
    Workspace polish, Outcome+Calibration polish, Command Center redesign, Run Replay | `src/app/screens/*` | |
| H | Adversarial audit: new tests for every new boundary (SENTINEL, PULSE, ORBIT, lineage, compare) | `src/core/adversarial/attacks.test.ts` + module tests | |
| I | README rewrite for 2.0; final unaided "product test" self-check | `README.md` | |

Each phase: implement -> `tsc -b --noEmit` -> `bun test` -> `bun run build` -> browser sanity check
for UI phases -> commit -> push. Pages redeploys automatically on push.

## Design notes carried forward from the audit (2026-09-13)

- `RunResult` (`src/core/orchestrator/run.ts`) already carries `graph`, `outputs` (all 7 agents),
  `policy`, `attempts`, `rework_history`, `log`, `spent`, `benign_category_share`. SENTINEL/PULSE
  reports are new sibling fields (`sentinel`, `pulse`), computed once at the end of `investigate()`,
  pure functions of the already-assembled graph + outputs — no new agent phase, no new budget spend.
- `RiskGraph` already has `isIntact()`, `cycles()`, `evidenceChain()` — SENTINEL's graph-integrity
  and evidence-chain checks call these directly rather than reimplementing them.
- `ingest/sanitize.ts` already has `sourceIdentity`, `isAggregator`, `INJECTION_PATTERN_NAMES` —
  SENTINEL's provenance/source-identity/injection checks reuse these, not new regexes.
- `redteam.ts`'s check #1 ("Fabricated references") already does citation-existence checking scoped
  to the *decision chain* (challenges + findings). SENTINEL's citation check is broader: every
  evidence/challenge/finding/decision node's `evidence_ids` against `graph.has()`, framed as a
  system-health signal (VERIFIED/WARNING/BLOCKED) rather than a red-team finding that can trigger
  rework. The two must not duplicate each other's severity semantics — red team can still force
  rework; SENTINEL never does (per spec: "does not create evidence, only validates").
- PULSE's "high agreement + low evidence diversity must be flagged" reads `disagreement_index`,
  `independent_evidence_count`, and cluster count already in `ScoreResult`/`IntelligenceOutput` —
  no recomputation, just a rule over existing numbers.
- ORBIT's scenario mutators operate on the *signal set* fed to `investigate()` (via `options.signals`,
  the same seam LIVE mode already uses) or on `indicatorStates` / `lessons`, so a scenario is "run
  `investigate()` twice with a controlled input delta", never a hand-edited `RunResult`.
- Agent screens currently importing `AGENT_LABEL`/`AGENT_REMIT`: `CommandCenter.tsx`,
  `AgentConsole.tsx`, `AgentPerformance.tsx`, `DisagreementRoom.tsx`. `RedTeam.tsx` and
  `DecisionBrief.tsx` reference agents structurally, not by label lookup — codename badges there
  are additive, not a rename.

## Open questions this doc resolves so nobody has to ask mid-build
- Codename vs technical label: codename is the primary, larger label in every UI surface; the
  existing technical name (`SCOUT`, `RED TEAM`, ...) stays as a secondary line — the domain/API
  vocabulary is unchanged, this is presentation only.
- SENTINEL/PULSE reports live on `RunResult`, not as new `GraphNode` kinds — they describe the
  investigation, they are not evidence, a hypothesis, or a decision the graph's append-only
  provenance chain needs to reference by id. If a later phase needs one to be citable (e.g. a
  HADES attack board row linking to a SENTINEL check), it is referenced by a stable string key
  (e.g. `sentinel:citation_validity`), not by minting a graph node for it.


## Phase A/B, closed out (2026-09-13)

- **Phase A**: `AGENT_CODENAME` / `AGENT_TAGLINE` added to `src/app/lib/agents.ts`, wired into
  CommandCenter, AgentConsole, AgentPerformance, DisagreementRoom. Codename is the primary label,
  the existing technical name is secondary. `RedTeam.tsx` / `DecisionBrief.tsx` do not look up
  `AGENT_LABEL` and were left alone — a HADES/HEPHAESTUS badge there is future cosmetic work, not
  required for the identity layer to be genuinely present in the product. Renamed from the original
  ARGUS/ATLAS/ORACLE/AEGIS/MERCURY/CERBERUS/VERDICT set once the Pantheon showcase (below) picked
  actual Olympians for the same seven agents — MERCURY was the Roman name for the god the showcase
  separately assigned to a different agent (Hermes -> scout), so the two layers now agree on one
  mythology instead of clashing.
- **Phase B**: `src/core/sentinel/sentinel.ts` (`runSentinel`), 10 checks, VERIFIED/WARNING/BLOCKED,
  wired into `RunResult.sentinel` inside `investigate()`, rendered on the Knowledge & Provenance
  screen. `ScoutOutput.snapshot` widened with `files: SnapshotFileProvenance[]` so SENTINEL's
  snapshot-hash check reads real synced hashes, not a re-fetch. 10 new tests
  (`src/core/sentinel/sentinel.test.ts`), 197/197 total, tsc clean, build clean, pushed to `main`.
  **Not yet done for SENTINEL**: the adversarial-audit pass the spec asks for at the end (fabricated
  id specifically targeting SENTINEL's own checks, a poisoned snapshot file list, a graph built to
  pass schema/graph integrity but fail citation validity in a stealthier way) — planned for phase H,
  not duplicated per-phase.
- **Post-push browser verification caught two real bugs SENTINEL going live surfaced, both fixed in
  `7ca294b`**: (1) `serialize.ts` never round-tripped `RunResult.sentinel` through localStorage, so
  every rehydrated run crashed the whole Provenance render on `result.sentinel.status` being
  undefined — `STORE_VERSION` bumped 1->2, a pre-SENTINEL stored record is now dropped rather than
  patched, matching the existing append-only persistence policy. (2) `intelligence.ts` put cluster
  ids (never minted as graph nodes — only `Cluster.member_ids` are) into two `Observation.inputs`
  arrays, which SENTINEL correctly read as 24 dangling citations; fixed at the source, those
  observations now cite the real member signals. A regression test runs SENTINEL over the actual
  `investigate()` output (not a hand-built graph) and pins the one legitimate remaining WARNING
  (`duplicate_integrity`, two governance citations sharing a framework-level eur-lex URL — real, not
  a defect). **Lesson for every future phase**: a hand-built minimal test graph proves the checker's
  logic works but cannot prove the checker is *true of the real system* — run every new checker over
  a real `investigate()` output at least once before calling a phase verified, not just its own unit
  tests. 200/200 after this fix, tsc clean, build clean, browser-confirmed rendering.

## Phase C, closed out (2026-09-13)

- **PULSE**: `src/core/pulse/pulse.ts` (`runPulse`), 9 checks (`record_integrity`, `source_diversity`,
  `evidence_volume`, `governance_coverage`, `red_team_outcome`, `unresolved_blockers`,
  `budget_utilization`, `retrieval_health`, `outcome_history`), same VERIFIED/WARNING/BLOCKED shape as
  SENTINEL, wired into `RunResult.pulse` inside `investigate()`. A shared `src/core/status.ts` now
  exports `IntegrityStatus`/`worseStatus`/`overallStatus`, so SENTINEL and PULSE both point at one enum
  instead of redefining it a second time, per the note this doc left for itself. `Harness` (`agents/
  harness.ts`) now also returns `budget` (the resolved cap), so PULSE's budget-utilization check reads a
  real value rather than needing a second argument threaded through `investigate()`.
- Shipped on Command Center immediately (a `PULSE · system health` panel), not deferred to phase G, per
  this doc's own instruction. `STATUS_TONE` added to `app/ui/kit.tsx` and Provenance's SENTINEL panel
  was refactored onto it, so there is exactly one status-to-tone map for both reports.
- Persistence lesson from Phase B applied proactively this time: `pulse` was added to `StoredRunSchema`
  and `STORE_VERSION` bumped 2->3 in the *same* commit that added the field, not discovered as a crash
  afterwards. 12 new tests (`pulse.test.ts`) including one run over a real `investigate()` output,
  pinning the exact 9-check ordering - the standing lesson from Phase B, applied again, passed cleanly
  on the first attempt. 214/214 total after this phase, tsc clean, build clean, browser-verified
  (Command Center's panel and Provenance's refactored panel both confirmed live). Pushed as `0bfbb51`.

## Phase D, closed out (2026-09-13)

- **ORBIT**: `src/core/orbit/orbit.ts` (`runScenario`), a "what would this look like under stress"
  tool. It runs `investigate()` twice - once against the real signal set, once against a deterministic
  mutation of it - and diffs the two published `RunResult`s over 10 named fields (action band, severity
  band, urgency, confidence, independent-evidence count, disagreement index, gates failed, red-team
  verdict, SENTINEL status, PULSE status). It never hand-edits a `RunResult`; the only lever is
  `InvestigateOptions.signals`, the same seam LIVE mode already uses, wrapped around whatever source the
  caller already supplied.
- **Scope decision, made without asking**: shipped 5 scenarios that are each a pure `RawSignal[]`
  transform - `source_drought`, `source_concentration`, `duplicate_amplification`, `evidence_poisoning`,
  `false_positive_wave`. A fuller catalogue (regulatory change, delayed governance update, operational-
  data availability) would need either the `lessons` seam or per-pattern indicator ids that only exist
  *after* the analyst has matched a pattern - a materially bigger seam than "mutate the signal list",
  and genuinely a different feature (stress-testing a hypothetical indicator answer, not a hypothetical
  evidence set). Deferred, not dropped; the fix for a future session is to accept a resolved
  `pattern_id` (from a prior baseline run) as an argument rather than trying to predict it.
- Synthetic signals for `evidence_poisoning`/`false_positive_wave` are built by calling the real,
  exported `toRawSignal()` over a synthetic `UpstreamSignal` - injection detection, category
  derivation and freight-relevance are computed by the actual ingestion code, never hand-set, so the
  scenario tests the real pipeline's real classifiers. `false_positive_wave`'s titles are guarded by a
  module-load assertion that they still derive to the benign category (`BENIGN_CATEGORY`, exported from
  `orchestrator/run.ts` for this reuse) - this guard fired once during development (one title's phrasing
  didn't match the keyword rule) and was the intended catch, not a bug.
- UI: a new screen, `src/app/screens/ScenarioRoom.tsx` (nav `11`, route `/orbit`) - pick a scenario, run
  it, see the baseline-vs-stressed diff table. It always stresses the fixed reference investigation
  (`DEMO_INPUT`), not an arbitrary stored run, because `InvestigateOptions.loader` is not serialisable
  and reconstructing "this exact past run's own options" is a separate feature `StoredRun` doesn't
  support yet - noted here rather than silently faked with the wrong scope.
- Test file `orbit.test.ts`: 8 tests, every one of them runs a real `investigate()` twice (the module's
  own nature makes the Phase B/C "run it over the real thing, not just a fixture" lesson automatic here)
  - including one that asserts SENTINEL actually flags the injected signal as `unsupported_reference`
  (WARNING) on the stressed run while the baseline stays VERIFIED on that same check, proving the
  scenario exercises a real downstream detector, not just a signal-count change. 222/222 total after
  this phase, tsc clean, build clean. Browser-verified live: ran `evidence_poisoning` (band held at
  MONITOR, independent-source count rose 8->9 because the injected signal's own source identity counts
  as one more nominally-independent publisher - a real and useful thing for this tool to have surfaced)
  and `source_drought` (band moved MONITOR->TARGETED_INVESTIGATION, confidence resolved from withheld to
  0.368, red team fail->pass - a large, sensible, materially-changed result). Pushed as `e1d2a1c`.

## Unplanned insertion: Case File (2026-09-13)

Asked for directly, so it jumped the queue ahead of Phase E: History was a list of rows with no way to
open one. A stored run is now openable as a case file at `/history/:id` - a detail view of screen 08 with
no NAV entry, because it is only reachable from a run.

- `src/core/casefile/casefile.ts` builds the model and renders one self-contained HTML document. It is a
  projection: every figure is copied from the run, and the ticket-ready brief is `renderBrief`'s output
  verbatim in an appendix rather than a second renderer of the same facts.
- Agent naming is passed in as a `roster` argument rather than known in core, because a codename is a
  presentation concern and `src/core` is not allowed to hold one. That keeps the boundary constraint
  intact and lets `agentLines`/`agentUncertainties` stay the single source of "what an agent said".
- Downloads: `.html`, `.doc` (the same document, Word opens it directly - no converter, no dependency),
  `.md` (the brief), `.json` (the whole model), and PDF through the browser's own print pipeline via a
  hidden iframe. A PDF library would have cost more than the whole app weighs.
- `completed_at` is now stamped on every run that settles, so "asked at" and "result at" are both real.
  It was added as `nullable().default(null)` on the same precedent as `request`, deliberately *without* a
  `STORE_VERSION` bump: a record written before this existed still parses with the stamp left null, and
  the case file prints "not recorded" rather than inventing a duration. Two tests hold that line.
- 241/241 tests, tsc clean, build clean. Browser-verified: an old pre-tracking record reads "time not
  recorded", a fresh run reads `-> 17:25 · 7.6s`, and the generated document was checked as a real file
  (7 sections, 4 tables, 25 blocks, no script tag, no `undefined`, balanced markup).

## Next session: Phase E (Decision Lineage, Evidence Needed, Source Concentration)

All three are pure derivations over data `RunResult` already carries - no new agent, no new engine
computation, per the phase map's own description. Likely home: a `src/core/lineage/` module (or three
small sibling files if that reads better once written) exporting one function per concept, consumed by
new screens in phase G; nothing stops a minimal panel shipping immediately the way SENTINEL/PULSE/ORBIT
did, if there is an obvious screen to attach to (Decision Brief is the obvious one for lineage and
evidence-needed; Provenance or a new Source Concentration panel for the third).

- **Decision Lineage**: "why did the system conclude this" as a chain, not a paragraph. `RiskGraph`
  already has `evidenceChain(id)` (`domain/graph.ts:100`), which walks backward from a node through
  `supports`/`corroborates`/`based_on` edges to the evidence at the root. For each id in
  `decision.hypothesis_ids`, call `graph.evidenceChain(id)` and assemble an ordered list: decision ->
  hypothesis -> observation(s) -> evidence. This is close to free: the graph already does the walk,
  lineage just needs to call it per hypothesis and shape the result for display.
- **Evidence Needed**: "what would change the band" as a concrete ask, not a vague caveat.
  `AnalystOutput`'s `coverage: CoverageResult` (`integrations/atlas.ts:94`) already carries
  `unknown_indicator_ids` and `absent_weight` - the indicators nobody has looked at, weighted. Evidence
  Needed is: for the lead hypothesis's matched pattern, look up each unknown indicator's real text via
  `atlas.pattern(patternId)` (already the pattern object AnalystOutput's coverage was computed against)
  and surface it as "this indicator, worth this much weight, is still unknown" - ranked by weight, so the
  highest-leverage missing evidence is first. No new indicator taxonomy, no invented weights.
- **Source Concentration**: how much of the evidence base is really independent voices vs. one loud one.
  `IntelligenceOutput.clusters` and the signals underneath already carry `publisher`/`source_identity`
  (same fields ORBIT's `source_concentration` scenario groups by). This is the *permanent, every-run*
  version of that same grouping - share of evidence weight (or signal count) held by the top publisher,
  computed once per run and displayed, not just something a stress test can reveal. Reuse the grouping
  logic ORBIT already wrote rather than reimplementing it a second time; if it needs to move to a shared
  location for that reuse, `src/core/lineage/` or a new tiny `src/core/concentration.ts` both work -
  decide by whichever avoids a circular import, not by trying to predict every future caller.
- None of the three needs a new `IntegrityStatus`-shaped enum; they are numbers, ranked lists and
  chains, not health checks. Reuse `STATUS_TONE`/`BAND_TONE`/`SEVERITY_TONE` from `app/ui/kit.tsx` for
  whatever coloring the eventual screens need, rather than adding a fourth tone map.
