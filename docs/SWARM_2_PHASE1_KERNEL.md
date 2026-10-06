# RISK//SWARM 2.0 Phase 1 — Protocol Kernel

Status: implemented as an additive, offline protocol kernel

Protocol version: `2.0.0-alpha.1`

## Scope

Phase 1 establishes the deterministic SWARM 2 protocol laws under `src/swarm/`. It does not change the legacy orchestrator, existing Council, specialists, providers, UI, Laya, Jev, or historical Phase 2B diagnostics.

**NO MODEL REASONING EXISTS IN SWARM 2 YET.**

The kernel has zero provider dependencies and makes no network calls. It can create a case, seal an immutable evidence package, accept only valid protocol events, project a blackboard, and replay the event log deterministically.

## Implemented contracts

`src/swarm/contracts/index.ts` defines:

- one authoritative `SWARM_PROTOCOL_VERSION`;
- validated/branded identifiers for cases, evidence, packages, positions, claims, challenges, revisions, findings, synthesis, human decisions, and events;
- the five stable seats and their authority mapping:
  - ATHENA, ARES, and HADES: `ADVISORY`;
  - APOLLO: `AUDIT`;
  - ZEUS: `SYNTHESIS`;
  - no seat can hold `HUMAN_DECISION` authority;
- bounded `SwarmCase` and conservative execution policy;
- evidence, claim, position, disagreement, challenge, response, revision, audit finding, synthesis, human decision, and model execution contracts;
- the discriminated `SwarmExecutionEvent` union;
- the immutable projection shape and Round 1 input shape.

`ModelExecution` rejects successful executions that were not actually called and independent, rejects fallback masquerading as successful independent execution, and rejects secret-shaped diagnostic fields such as API keys, authorization, raw prompts, raw responses, and chain-of-thought fields.

## Evidence sealing

`src/swarm/evidence/package.ts` adapts the existing provenance idea into a detached `EvidencePackage`:

- validates each item;
- bounds the package using the case policy;
- rejects duplicate evidence IDs;
- sorts items deterministically;
- computes a deterministic, explicitly non-cryptographic FNV-1a package fingerprint;
- deeply freezes the package and all nested values;
- exposes only evidence references, not the mutable legacy `RiskGraph`.

Future evidence acquisition/resealing is intentionally not implemented. A new package would require an explicit future protocol transition.

## State machine and event semantics

`src/swarm/engine/reducer.ts` implements a pure `reduceSwarmEvent(current, event)` reducer and `replaySwarmEvents(events)`.

The legal primary states are:

```text
CASE_CREATED
EVIDENCE_READY
INDEPENDENT_ANALYSIS
POSITIONS_LOCKED
DISAGREEMENTS_IDENTIFIED
CHALLENGE_ROUND
REVISIONS_LOCKED
AUDIT
SYNTHESIS
HUMAN_REVIEW
CLOSED
```

The event log is authoritative. Every event is schema-validated, versioned, case-bound, sequence-checked, duplicate-ID checked, reference-checked, authority-checked, and appended only after all validation succeeds. Sequence numbers start at one and must increase by exactly one. `CLOSED` is terminal.

Phase 1 supports case/evidence setup, Round 1 execution lifecycle, position proposals and locking, disagreement records, bounded challenge rounds, structured responses, revision lineage, deterministic audit findings, synthesis readiness, human review, human decision recording, and closure. It does not generate disagreements, challenges, audit reasoning, or synthesis content.

## Blackboard

`SwarmBlackboard` is a deeply frozen projection containing:

- the versioned case and current protocol state;
- the sealed evidence package;
- claims, positions, disagreements, challenges, responses, revisions, and audit findings;
- optional synthesis and human decision records;
- per-seat Round 1 execution state;
- the complete event history;
- audit/synthesis lifecycle flags required by the reducer.

There are no public mutation setters. A failed event leaves the previous blackboard unchanged.

## Evidence, authority, and participation rules

- Unknown evidence IDs fail validation.
- Round 1 positions must be successful independent model executions if they are proposed. Failed, unavailable, and abstained seats do not create fake positions.
- `ABSTAINED`, `UNAVAILABLE`, `FAILED`, and `REJECTED` remain distinct seat execution states.
- Round 1 includes ATHENA, ARES, HADES, and APOLLO. ZEUS cannot be a Round 1 reasoning seat.
- `POSITIONS_LOCKED` is accepted only after all four eligible seats are terminal: success, abstained, unavailable, failed, or rejected.
- `buildRound1SeatInput()` exposes only the requesting seat, case question/scope/policy, and the sealed evidence package. It does not expose positions, disagreements, challenges, or synthesis.
- Explicit position references are rejected in Round 1, providing a structural leakage barrier rather than relying on prompt wording.
- Challenges cannot target the emitting seat or an unknown position, and challenge budgets are enforced by the reducer.
- Only the challenged seat can respond. `REVISE` requires a separate revision and new immutable position; the old position remains in history.
- Zeus and Apollo cannot create `HumanDecision`. Human decisions require a non-seat human actor and are separate records.
- Synthesis contracts start and remain `human_decision_status: PENDING`.

## Tests

`src/swarm/kernel.test.ts` contains 21 pure offline tests with 326 assertions covering:

- valid end-to-end state progression;
- replay/incremental projection equality;
- illegal skips and terminal closure;
- duplicate/gapped/out-of-order sequences;
- no mutation after invalid reduction;
- deterministic evidence hash, ordering, deep immutability, duplicate rejection, and unknown citations;
- Round 1 input leakage prevention;
- terminal-seat lock barrier and truthful unavailable participation;
- failed versus abstained semantics;
- deterministic fallback rejection;
- challenge reference, budget, and response ownership rules;
- revision lineage and historical position preservation;
- seat/human authority separation;
- pending human synthesis and Zeus authority rejection;
- secret-shaped diagnostic rejection;
- Zeus Round 1 exclusion and explicit cross-position leakage rejection;
- seeded invalid event permutations and deterministic identical projections.

## Validation gates

The Phase 1 focused suite passed:

```text
21 pass
0 fail
326 expect() calls
```

The existing offline baseline also passed before implementation: `bun test` (900 tests), `bun run typecheck`, the repository's actual `bun run snapshot:check`, `bun run build`, and `git diff --check`. The requested literal `bun run check:snapshots` is not a configured script in this repository; it reports `Script not found "check:snapshots"`. No source change was made to compensate for that naming mismatch.

## Known limitations

- No seat prompts, seat executors, ModelRouter, providers, retries, model-based Apollo, debate generation, or Zeus synthesis generation exist yet.
- Semantic disagreement detection is not implemented; Phase 1 accepts typed disagreement records.
- The package fingerprint is deterministic and non-cryptographic, suitable for replay/integrity identity but not adversarial security.
- The reducer does not implement evidence acquisition or resealing.
- SWARM persistence and UI projection are intentionally deferred.
- Existing legacy Phase 2B/2B.1 worktree changes and historical diagnostics remain outside this kernel and were not modified.

## Intentionally not implemented

- intelligent agents or model calls;
- provider integration or model fallback;
- Laya or Jev;
- changes to the legacy engine, existing specialists, or existing Council;
- UI or Council chamber work;
- actual debate/challenge generation;
- model-based Apollo audit;
- Zeus synthesis generation;
- persistence, live execution, certification, commit, or push.
