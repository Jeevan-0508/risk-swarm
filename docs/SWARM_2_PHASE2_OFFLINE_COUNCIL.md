# RISK//SWARM 2.0 Phase 2 — Offline Five-Seat Council

## Status

**SWARM 2 STILL HAS NO LIVE MODEL INTELLIGENCE.**

Phase 2 is an offline protocol implementation. Every seat result and Zeus synthesis is supplied by deterministic fixtures. There are no provider adapters, API keys, network calls, model calls, or browser credential changes in this phase.

Protocol version: `2.0.0-alpha.1`

## Execution boundary

The engine owns orchestration and event emission. A seat executor returns a candidate typed result; it cannot mutate the blackboard, start another seat, select a provider, create or alter evidence, emit state transitions, close a case, or write a human decision.

`FixtureSeatExecutor` is the provider-independent Phase 2 seam. It supports successful positions, abstentions, unavailable and failed executions, rejected/malformed candidates, artificial delays, structured challenge responses, revisions, concessions, defenses, and evidence requests. It has no filesystem, network, clock, randomness, or hidden global state dependency during execution.

## Five seats and Round 1

The runtime definitions reuse the Phase 1 identities:

- ATHENA — risk analysis
- ARES — red-team challenge
- HADES — risk and controls
- APOLLO — evidence and governance audit
- ZEUS — synthesis only

Round 1 dispatches exactly ATHENA, ARES, HADES, and APOLLO. ZEUS is never a Round 1 position producer. Every Round 1 executor receives the immutable Phase 1 blind projection: its own seat identity, the case/question/scope, sealed evidence package, policy, and execution context. Other positions, challenges, revisions, synthesis, and human decisions are not in the input.

Results are collected concurrently and processed in canonical seat order: ATHENA, ARES, HADES, APOLLO. Completion timing therefore cannot change the event log or blackboard.

## Disagreement and materiality

The deterministic disagreement engine compares structured risk level, confidence, recommendation, assumptions, control-gap shape, and cited evidence shape. It does not infer unsupported causal or scope semantics from prose. Materiality rules are centralized: risk rank gaps and confidence deltas determine `MATERIAL` versus `BLOCKING`; small differences are not automatically promoted to debate.

Consensus is a derived projection (`UNANIMOUS`, `MAJORITY`, `SPLIT`, `INSUFFICIENT_PARTICIPATION`, or `NO_COMPARABLE_POSITION`). Unavailable, abstained, failed, and rejected seats are not votes. A single successful position cannot create consensus, and minority position IDs remain explicit.

## Challenges and privacy

The planner sorts disagreements deterministically by evidence interpretation, risk rating, assumptions, controls, recommendation, and confidence. It uses mandate-sensitive challenger preferences and respects both the one-round policy and `max_challenges` budget. Zeus is excluded from challenge planning.

Challenge input contains only the sealed package, the challenged seat's own prior position, the challenge, and the necessary opposing claim/position excerpt. It does not contain a council transcript or unrelated positions.

Responses are structured as `DEFEND`, `REVISE`, `CONCEDE`, `REQUEST_EVIDENCE`, or `ABSTAIN`. Response ownership, citations, case identity, and challenge references are validated. Evidence requests are recorded only; no retrieval occurs and the sealed package is never mutated.

## Revision and concession history

`REVISE` and `CONCEDE` create a new position with explicit revision, triggering challenge, triggering response, changed claims, retained claims, and reason. The original position remains queryable. A concession is therefore visible as history rather than being rewritten as if the seat always held its final view.

## Apollo deterministic verifier

Apollo's verification pass is deterministic and model-free. The protocol validates package hash/immutability, evidence references, event and position references, response/revision lineage, execution truth, authority boundaries, missing-seat truth, unresolved disagreement preservation, evidence-request preservation, and unsupported-consensus conditions. Blocking findings are required in the Zeus brief; warnings remain disclosed rather than being mislabeled as corruption.

## Zeus fixture synthesis

`FixtureSynthesisExecutor` receives final positions only, plus participation, disagreements, challenge outcomes, revision history, audit findings, and evidence requests. Superseded positions remain in explicit history but are not presented as current positions. Synthesis validation rejects fabricated evidence, dropped material minority positions or disagreements, false participation, authority escalation, and suppression of blocking findings. Every accepted brief ends with `human_decision_status = PENDING` and the runner stops at `HUMAN_REVIEW`.

## Timeline and replay

`projectTimeline` is a pure read-only projection of the event log. It returns sequence, event ID, event type, actor, timestamp, and state-after entries for future chamber visualization. No UI, JSX, CSS, or animation is included. The reducer remains the authoritative replay mechanism; identical inputs, IDs, timestamps, policy, and fixtures produce identical events, blackboard, audit, and synthesis.

## Golden scenarios

The fixture catalog covers:

`SUPPORTED_RISK`, `EVIDENCE_STARVATION`, `CONTRADICTION`, `ONE_SEAT_UNAVAILABLE`, `HOSTILE_EVIDENCE`, `FALSE_CONSENSUS`, `MAJORITY_WRONG_MINORITY_SUPPORTED`, `REVISION_AFTER_CHALLENGE`, `DEFENDED_POSITION`, and `CONCEDED_POSITION`.

The adversarial cases preserve unsupported consensus warnings, supported minority evidence, hostile evidence as data, truthful unavailable-seat state, contradiction, response lineage, and human-review containment.

## Known limitations

- The fixture executor deliberately does not model provider transport or model output quality; those belong to a later model-router phase.
- Causal and scope disagreement remain unresolved unless future structured fields make them safely comparable.
- Evidence requests do not retrieve or reseal evidence in Phase 2.
- The timeline projection is data-only and intentionally has no presentation layer.
- The protocol is alpha-versioned and remains additive to the legacy production architecture.
