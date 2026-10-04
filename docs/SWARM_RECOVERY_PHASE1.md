# RISK//SWARM Recovery Phase 1

## 1. Baseline

- Branch: `main`
- Baseline HEAD: `a537a11302b096fac66e7a1c6655a0d5045fcc48`
- Primary audit present: `docs/SWARM_FORENSIC_AUDIT.md` (pre-existing, intentionally left uncommitted)
- CI/runtime Bun pin: `1.3.14`; local Bun verified at `1.3.14`
- Baseline install: `bun install --frozen-lockfile` passed
- Baseline tests: 69 files, 863 tests, 863 passed, 0 failed, 0 skipped, approximately 6.27s
- Baseline typecheck, snapshot check, and build: passed

The working tree contained the audit report as an untracked pre-existing file before implementation. It was preserved and is not part of the recovery commits.

## 2. Files changed

Changes are limited to the existing routing, research, reasoner, scoring, persistence, UI-state rendering, tests, and documentation seams:

- Core routing and publication: `src/core/orchestrator/route.ts`, `src/core/orchestrator/run.ts`, related tests, and `src/core/persistence/serialize.ts`.
- Research truth: question model/planner, provider types/registry, execution/session composition, and their tests.
- Model truth: reasoner execution metadata, fallback handling, agent/council propagation, and scoring filters.
- Existing UI semantics: route hand-off and blocked/publication labels only; no screens or visual system were added or redesigned.
- Naming/quarantine documentation: deterministic deliberation, model Council, Council replay, and System-1 quarantine comments.
- Runtime documentation: `README.md`, `docs/HANDOFF.md`, and this report.

No specialist agents, Calypso integration, MESH integration, provider, screen, or visual-branding system was added.

## 3. Routing repair

`routeToPipeline()` is now the authoritative core boundary. `investigate()` evaluates the typed question and pack before creating the execution harness or touching retrieval.

- A general/open question with an open pack routes to research.
- A freight-domain question with the freight pack routes to investigation.
- Direct open-pack calls into `investigate()` fail with `InvestigationRoutingError` instead of silently entering freight retrieval.
- The existing operator override is explicit and carried as `routeOverride: 'freight'`; test fixtures that intentionally exercise freight stages with an open pack now state that intent.

Tests cover the planet, phantom-carrier, and EU AI-governance shapes plus direct core invocation.

## 4. Query preservation repair

`ResearchPlan` now carries `original_question`, `normalized_question`, `intent`, `domain`, `geography`, `entities`, and `keywords` as first-class fields. Non-comparison retrieval seeds are derived from the question's content terms, with only generic filler removed. The planner no longer reduces the phantom-carrier question to `Germany`.

The planner test verifies that generated dimensions retain `phantom-carrier`, `fraud`, and `germany` concepts while comparison handling remains unchanged.

## 5. Geography repair

Boundary-aware hint matching now recognizes `EU`, `European Union`, `Germany`, `DE`, `German`, and `Europe`. The matcher uses whole-term boundaries, so unrelated substrings are not treated as geography.

Tests cover explicit EU and European Union wording, Germany/DE/German wording, and Europe.

## 6. Publication gate

`RunResult` now separates the completed assessment from its publication state:

```text
analysis_status: COMPLETE
publication.publishability: PUBLISHABLE | BLOCKED | UNAVAILABLE
publication.publication_blockers: string[]
```

Open blocking Red Team findings and Sentinel checks with `BLOCKED` status become publication blockers. Warnings remain non-blocking. The decision graph and forensic outputs remain available, but the UI labels the result as blocked rather than presenting it as an approved publication.

The canonical freight run proves `COMPLETE + BLOCKED` with an open Red Team blocker.

## 7. Execution-status model

Model-backed reasoners now expose structured execution metadata: whether a model was called, provider, model id, status, degraded state/reason, and independence. The statuses are `SUCCESS`, `DEGRADED`, `FAILED`, and `DISABLED`.

The metadata propagates through analyst and model-Council positions/verdicts. A successful model answer is the only result marked independent.

## 8. Fallback semantics

Deterministic fallbacks remain available for continuity, but they carry explicit non-independent execution metadata. Missing keys are `DISABLED` with `model_called: false`; malformed output, provider errors, timeouts, and validation failures are degraded and never independent.

The reasoner tests cover valid output, missing key, empty HTTP 200 content, provider errors, malformed JSON, invalid structured output, fabricated citations, and timeout handling.

## 9. Disagreement semantics

Scoring and model-Council independence checks now exclude abstained, degraded, failed, and disabled positions from independent model disagreement. Deterministic freight contention remains available to the existing score as a separate deterministic signal; it is not represented as successful independent model disagreement.

Regression coverage verifies that abstained/degraded positions do not change confidence variance or agreement calculations.

## 10. Retrieval/provider repair

Provider outcomes preserve the existing compatibility status and now add explicit execution status:

`ANSWERED`, `EMPTY`, `UNAVAILABLE`, `FAILED`, `RATE_LIMITED`, or `TIMED_OUT`.

One bounded retry is allowed for transient 429, 5xx, and non-timeout network failures. Invalid content, malformed JSON, validation failures, and timeouts are not retried as if they were transient success opportunities. Provider identity remains attached to attempts, events, and documents.

Tests prove HTTP failure, malformed JSON, unavailable/CORS-like failure, valid empty response, one transient retry, and bounded 5xx retry exhaustion.

## 11. Proxy repair

Proxy use is now explicit. A provider receives the proxy when it declares `requires_proxy`, or when its provider id is in the operator-supplied proxy allow-list. Enabling the proxy no longer routes every provider through it.

The news provider remains proxy-only by descriptor. Session tests cover proxy disabled, explicit Wikipedia proxying, and the existing news proxy path while preserving source identity and proxy provenance.

## 12. Council terminology cleanup

Internal comments now use precise conceptual names:

- `MODEL_COUNCIL`: optional model-backed Olympian positions and verdict.
- `DETERMINISTIC_DELIBERATION`: post-run transcript synthesis over stored freight outputs.
- `COUNCIL_REPLAY`: pure replay of the stored transcript.

No Council redesign or branding change was made. The comments explicitly state that deterministic deliberation is not live multi-agent dialogue.

## 13. Adversarial inventory

The runtime inventory under Bun 1.3.14 is:

- Guard layer: 16 test cases across 15 named attack descriptions; attack 7 contains two test cases.
- Council layer: 14 adversarial test cases.
- Total: 30 adversarial test cases.
- Result: 30 passed, 0 failed, 0 skipped.

The documentation now describes the distinction rather than treating the 15 named guard descriptions as 16 separate attack narratives.

## 14. Failure-injection results

The existing and expanded suites cover the requested failure classes: unavailable provider, invalid/missing model credentials, HTTP 200 with empty content, provider error inside HTTP 200, timeout, malformed JSON, invalid structured output, fabricated citation, retrieval failure, 429, 5xx, zero evidence, one-source evidence, contradictory evidence, model-seat failure, multiple-seat failure, abstention, disabled seat, budget exhaustion, and blocking Red Team findings.

Observed behavior is fail-closed: block, degrade, abstain, or return unavailable. No failure path was changed to manufacture confidence.

## 15. Golden path A — freight

Real input: `What evidence exists for phantom-carrier fraud in Germany?`

- Route: `investigation` with the freight pack.
- Evidence: 11 pinned snapshot findings in the executed run.
- Provenance: graph intact and traceable.
- Deterministic stages: scout, intelligence, analyst, governance, challenger, Red Team, decision, Sentinel, Pulse, and deliberation completed.
- Red Team: `fail` with an open blocking finding.
- Publication: `analysis_status = COMPLETE`, `publishability = BLOCKED`, one blocker.
- Retrieval mode: snapshot-backed; no live external retrieval was substituted for the pinned freight source.
- Model mode: deterministic; no model key or independent model seat was required.

## 16. Golden path B — AI governance

Real input: `What are the main AI governance risks of deploying an autonomous recruitment agent in the EU?`

- Route: `research`.
- Domain: `ai governance`.
- Geography: `EU`.
- Original question: preserved exactly in `ResearchPlan.original_question`.
- Provider execution: fixture-backed providers returned `ANSWERED` statuses; 14 normalized evidence items were retained.
- Freight assumptions: absent; the selected open pack has `taxonomy_matching = false`.
- Retrieval mode: deterministic injected fixtures for this verification, not a claim of live internet availability.
- Model mode: not required; no fake specialist reasoning was introduced.

## 17. Golden path C — general

Real input: `What is the largest planet in the solar system?`

- Route: `research`.
- Domain: `general`.
- Geography: none.
- Original question: preserved exactly in `ResearchPlan.original_question`.
- Provider execution: fixture-backed providers returned `ANSWERED` statuses; 12 normalized evidence items were retained.
- Freight assumptions: absent; the open pack was used only to demonstrate the research boundary.
- Retrieval mode: deterministic injected fixtures for this verification.
- Model mode: not required; no specialist freight reasoning was invoked.

## 18. Test results

Post-repair verification:

- `bun test`: 69 files, 873 tests, 873 passed, 0 failed, 0 skipped, 5727 expectations, approximately 5.13s.
- `bun run typecheck`: passed.
- `bun run snapshot:check`: passed — 3 sources, 4 files.
- `bun run build`: passed — 171 modules transformed.
- `git diff --check`: passed; only line-ending normalization warnings were reported by Git on Windows.

The suite executed under the repository-pinned Bun version, not a README-derived count.

## 19. Remaining known defects

- Live public retrieval remains environment-dependent. CORS, provider outages, rate limits, malformed upstream content, and empty results are now exposed rather than hidden, but this phase does not make those services universally available.
- Research relevance is improved at the seed level, not upgraded into a full semantic search engine.
- `UNAVAILABLE` is part of the publication vocabulary, while the current freight canonical run demonstrates `BLOCKED`; live research provider unavailability is represented at provider/execution level.
- `src/core/system1`, Laya/JEV adapters, and showcase/pantheon material remain in the repository as quarantined compatibility/experimental paths. They were not deleted or refactored, and the normal application path does not depend on them.
- Historical evolution documents retain historical counts by design; current runtime claims are corrected in the README, handoff, and this report.

## 20. Phase-2 readiness

Phase 1 exit gates are satisfied. The truthful spine is ready for a separately scoped Phase 2 specialist only after a new request and design review. Phase 2 must preserve the repaired routing, publication, execution-status, provenance, and failure semantics; it must not be inferred from the presence of the quarantined System-1 code.

## Capability matrix

| Capability | Status | Proof | Limitation |
|---|---|---|---|
| Core investigation routing | WORKING | Route tests and direct `InvestigationRoutingError` test | Explicit diagnostic freight override remains available by design |
| Original-question preservation | WORKING | Planner fields and phantom-carrier seed tests | Query expansion still uses deterministic lexical terms |
| Geography extraction | WORKING | EU, European Union, Germany, DE, German, Europe tests | Hint vocabulary is finite and intentionally conservative |
| Publication gate | WORKING | Canonical run returns `COMPLETE + BLOCKED` with blocker | Existing decision record remains available for forensic inspection |
| Model execution truth | WORKING | Success/disabled reasoner metadata assertions | Deterministic roles are expected to be `DISABLED`, not model seats |
| Fallback honesty | WORKING | Missing key, timeout, malformed/invalid output tests | Fallback content remains available, but is explicitly non-independent |
| Disagreement filtering | WORKING | Scoring regression and Council execution-status propagation | Deterministic contention remains a separate legacy score signal |
| Provider execution status | WORKING | Provider status mapping and failure-injection tests | Upstream providers can still be unavailable |
| Bounded retry | WORKING | 429 retry and 5xx exhaustion tests | One retry is deliberately conservative |
| Proxy boundary | WORKING | Explicit provider allow-list and news proxy tests | Proxy availability itself is external |
| Non-Vite core portability | WORKING | Bun reasoner/provider tests without Vite globals | Browser bundling remains verified separately by build |
| Council semantic separation | WORKING | Precise comments and existing structural tests | Broad file renaming was intentionally avoided |
| System-1 quarantine | WORKING | Explicit quarantine status and no normal app import | Future production ownership is undecided |
| Live external retrieval | PARTIAL | Provider adapters and explicit failure statuses | Golden research checks use injected fixtures, not guaranteed live services |
| Phase-1 build/test gates | WORKING | 873-test suite, typecheck, snapshot check, production build | None identified in this verification |

**Phase 1 status: COMPLETE.**
