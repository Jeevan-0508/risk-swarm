# RISK//SWARM 2.0 Phase 6A — Zeus Synthesis

Status: offline architecture and fixture validation complete. No provider execution was performed and no external certification is claimed.

## Role and authority

Zeus is the fifth stable seat: Risk Lead / Synthesizer. It receives the final certified deliberation state and produces an evidence-backed decision brief for a human reviewer. It is advisory, does not vote, does not redo Round 1, and cannot approve or reject deployment, close a case, claim legal or regulatory compliance, or override human review.

Every valid `ZeusSynthesisBrief` requires `human_decision_required: true`, `human_decision_status: PENDING`, and an authority statement that leaves final decision authority with the designated human reviewer. The protocol transitions to `HUMAN_REVIEW`; it never enters `CLOSED` automatically.

## Canonical input

`buildZeusInput` creates the versioned `ZEUS_INPUT_V1` contract from the SWARM blackboard. It contains the case, sealed evidence metadata, final positions, revisions, pre/post challenge disagreements, challenges, responses, minority positions, Apollo findings, evidence requests, readiness, and a null human decision. It excludes credentials, authorization headers, provider hidden reasoning, `reasoning_content`, and uncertified output.

Final positions are selected by seat lineage, so a revision retains its Round 1 source through `Revision`. Disagreements are first-class records with type, status, participating seats, position/evidence references, challenge/response history, revision effects, and remaining uncertainty. Minority positions are explicit structured records; they are not inferred solely from a vote count.

The input fingerprint is deterministic over the canonical structured input. Object key insertion order does not affect the stable serialization used by the fingerprint.

## Output and validation

The provider-facing Zeus body requires executive summary, decision context, material risks, control assessment, evidence assessment, areas of agreement, material disagreements, minority positions, uncertainties, assumptions, evidence gaps, advisory options, next actions, escalations, Apollo audit summary, bounded synthesis confidence, and canonical source IDs. SWARM then injects the deterministic case/seat identity, execution metadata, exact authority boundary, `PENDING` human status, and system-computed synthesis fingerprint into the canonical `ZeusSynthesisBrief`.

Validation is fail-closed in this order: schema/DTO, source references, semantic authority, disagreement preservation, minority preservation, audit preservation, then protocol reduction. Unknown evidence, position, disagreement, or audit IDs are rejected. An output that claims unanimous consensus while material open disagreements exist is rejected. Apollo warnings must remain visible. An output is never completed by fallback text or heroic JSON repair.

## Readiness and protocol events

`assessZeusReadiness` is the single deterministic gate. It checks sealed evidence integrity, four successful accounted-for seats, Round 1 blindness, locked positions, complete challenge/revision lifecycle, disagreement reevaluation, completed Apollo audit, no blocking audit finding, correct `AUDIT` state, and intact human authority.

Phase 6 adds replayable events:

`ZEUS_SYNTHESIS_REQUESTED → ZEUS_SYNTHESIS_STARTED → ZEUS_SYNTHESIS_COMPLETED → HUMAN_REVIEW_REQUIRED`

`ZEUS_SYNTHESIS_FAILED` is available for a fail-closed future execution path. The bounded future budget is exactly one Zeus request, with retry and fallback disabled. The Phase 6A fixture uses zero provider requests.

## Durable artifact and replay

`buildZeusArtifact` persists readiness, the input manifest and fingerprint, structured synthesis and fingerprint, validation results, authority/minority/disagreement/audit attestations, event sequence, one-request ledger, and null human decision. `replayZeusArtifact` reconstructs the input, synthesis, authority boundary, and human-review-required state without provider access or process memory. Hidden reasoning is never persisted.

## Phase 6B preparation

The provider-neutral prompt is versioned as `ZEUS_PHASE6_SYNTHESIS_V1`. A future live harness may project the same input through the existing ModelRouter/ModelRuntime seam to xAI/Grok, but must perform a preflight, enforce the one-request budget before transport, retain sanitized execution metadata, and require the same DTO, semantic, source-reference, authority, preservation, and protocol validators. This mission intentionally does not execute that request.

## Offline result

The sanitized Phase 6A fixture represents four final positions, four open material disagreements, two admitted challenges, Apollo DEFEND, Hades REVISE, one revision, zero Apollo blockers, one Apollo warning, and a pending human decision. Offline tests cover positive synthesis, false-consensus rejection, unknown-source rejection, authority rejection, input fingerprinting, durable artifact replay, request budget, and zero provider calls.
