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
| A | Agent identity layer (ARGUS/ATLAS/ORACLE/AEGIS/MERCURY/CERBERUS/VERDICT + taglines) | `src/app/lib/agents.ts` + 4 screens | |
| B | SENTINEL — evidence-integrity report, engine-side, additive field on `RunResult` | `src/core/sentinel/`, `orchestrator/run.ts` | |
| C | PULSE — system-health report over a completed `RunResult` | `src/core/pulse/` | |
| D | ORBIT — deterministic scenario mutators + baseline-vs-stressed diff | `src/core/orbit/` | |
| E | Decision Lineage, Evidence Needed, Source Concentration (pure derivations, no new agent) | `src/core/lineage/` or inline in `decision.ts` output | |
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
  CERBERUS attack board row linking to a SENTINEL check), it is referenced by a stable string key
  (e.g. `sentinel:citation_validity`), not by minting a graph node for it.
