# SWARM 2.0 Phase 5 — Adversarial Deliberation

Status: offline protocol implementation complete; live Phase 5 certification not run.

## Scope

Phase 5 adds one bounded adversarial round after independent Round 1 positions:

`POSITIONS_LOCKED → DISAGREEMENTS_IDENTIFIED → CHALLENGE_ROUND → REVISIONS_LOCKED → AUDIT`

The Phase 5 offline entry point stops at `AUDIT`. It does not call Zeus, produce a synthesis brief, make a human decision, perform external research, or make a provider/network request.

## Challenge ownership and budgets

ARES is the sole primary challenger. Challenges are deterministic by disagreement priority and are routed only to ATHENA, HADES, or APOLLO. The hard Phase 5 bounds are:

- one challenge round;
- at most two challenges per disagreement;
- at most six total challenges;
- at most three challenges per target seat.

Runtime-owned IDs, case/round references, target position, evidence references, and the requested action are validated before a challenge is emitted. Challenge responses are strict and support `DEFEND`, `REVISE`, `CONCEDE`, `REQUEST_EVIDENCE`, and `ABSTAIN`.

## Privacy and lineage

The response input contains the responding seat's own position, the directed challenge, and the sealed evidence package. It does not contain a peer-position collection, peer reasoning, or Zeus context. Round 1 positions are never mutated. Revisions reference the old position, triggering challenge, triggering response, and an explicit revision lineage. Concession records are retained. Evidence requests remain open or unresolved; no external research is triggered.

Invalid or unavailable responses are recorded as a truthful contained `ABSTAIN` protocol outcome after a response-failure event. No fabricated revision, parser completion, retry, fallback, or consensus is introduced. Successful independent positions and prior events remain preserved.

## Post-challenge audit

After revisions are locked, disagreements are re-evaluated. Original disagreement IDs and event history remain auditable; a disagreement can be `OPEN`, `NARROWED`, or `RESOLVED`. The offline path then runs Apollo's deterministic audit, records a post-challenge audit completion event, and emits a Zeus readiness gate only. `HUMAN_DECISION` remains `PENDING`.

## Provider-neutral seam

The Phase 5 challenge-generation seam is provider-neutral and uses the existing `ModelRouter`/`ModelRuntime` structured-output path through `ModelChallengeGenerator`. The offline golden path uses deterministic fixture executors only, so this implementation made zero live provider calls. Response execution continues through the existing provider-neutral `SeatExecutor` seam.

## Golden fixture result

The Phase 5 golden fixture exercises meaningful behavior: ARES targets ATHENA, HADES, and APOLLO; ATHENA revises severity, HADES revises control language, APOLLO requests additional evidence, and at least one material disagreement remains open for human review. Replay is deterministic and no synthesis event is present.

## Historical Phase 4B facts preserved

The user-supplied Phase 4B operational certification remains historical and unchanged. It recorded four successful xAI/Grok 4.7 Council seat calls at a bounded 4096-token output budget, with HTTP 200/stop responses, strict JSON schema acceptance, DTO/semantic/position/seat validation, preserved evidence fingerprint, Round 1 blindness, three open material disagreements, Apollo audit with zero blockers and one warning, Zeus off, and human decision pending. Phase 5 does not rewrite or reinterpret that live record.

## Phase 5C live certification preparation

Preparation is complete for two isolated, manually gated diagnostics. The diagnostics are deliberately not a full adversarial round and do not invoke Zeus:

1. ARES challenge generation uses the sealed synthetic Phase 4B payment-review case, captured Round 1 artifacts, the deterministic disagreement graph, and exactly one bounded model request.
2. ATHENA challenge response uses one deterministic valid challenge and exactly one bounded model request containing only ATHENA's own position, the directed challenge, and the sealed evidence package.

Both paths use the existing `ModelRouter → ModelRuntime → XaiProviderAdapter` seam, provider `xai`, model `grok-4.7`, strict production schemas, and `SWARM_COUNCIL_MAX_OUTPUT_TOKENS=4096`. The request guard requires the effective budget to equal 4096, the serialized request to carry 4096, and the Phase 5C request budget to remain one. Truncation is rejected as `RESPONSE_TRUNCATED / OUTPUT_TOKEN_LIMIT`; there is no retry or fallback. Diagnostics report only sanitized structural and classification fields, fingerprints, and boundary flags.

The independent authorization gates are `SWARM_LIVE_CHALLENGE_CONFIRM=YES` and `SWARM_LIVE_CHALLENGE_RESPONSE_CONFIRM=YES`. Without the relevant gate or credential, the corresponding diagnostic remains `NOT_RUN` and makes zero requests. The offline Phase 5C tests cover one-request accounting, serialized token budget, strict schemas, truncation rejection, malformed output rejection, target/evidence/authority boundaries, privacy boundaries, confirmation blocking, and secret-safe reporting.

Current preparation status:

- Phase 5 offline protocol: `PASS`.
- ARES challenge-generation diagnostic: `READY`, live execution `NOT_RUN`.
- ATHENA challenge-response diagnostic: `READY`, live execution `NOT_RUN`.
- Full four-seat live adversarial round: `NOT_RUN`.
- Zeus invocation and synthesis: `NOT_RUN`.
- Live/network/model calls during preparation: `0`.

## Certification boundary

This is an offline protocol phase. A separate, explicitly authorized live certification preparation phase is required before any provider call. No live network, live provider, or real model call was made here.

## Phase 5C.1 ARES live challenge semantic-rejection forensics

The first authorized ARES challenge-generation diagnostic is preserved as a failed certification result. It made exactly one xAI/Grok 4.7 request: HTTP 200, `finish_reason=stop`, `output_tokens=500`, configured/effective output budget 4096, strict structured extraction and JSON/DTO validation passed. The model output contained three schema-valid drafts targeting ATHENA, HADES, and APOLLO, with reported challenge types `ASSUMPTION`, `ASSUMPTION`, and `CONFIDENCE`. No raw provider body, credential, authorization header, hidden reasoning, or model prose was persisted in the repository.

The exact three rejected DTOs were not captured. Therefore candidate-specific target IDs, disagreement IDs, and evidence references from that live result are intentionally not reconstructed. The historical telemetry proves the first failing diagnostic condition: the Phase 5C harness required `converted.length === 1` before it evaluated semantic validity, while the provider-facing schema permits up to six drafts and the generation instruction permits at most one challenge per eligible target seat. The old report consequently conflated collection cardinality with per-challenge semantic validation and labelled conversion/protocol failure without safe candidate-level reasons.

The canonical enum sets are aligned: `ASSUMPTION` and `CONFIDENCE` are valid disagreement and challenge vocabulary. A `CONFIDENCE` challenge is compatible only with a `CONFIDENCE` disagreement; the live capture did not retain each draft's disagreement ID, so that candidate-specific relationship is not asserted as a historical fact. No unknown evidence reference, invented target ID, fixture mismatch, or runtime-identity spoof was proven from the sanitized capture. Runtime-owned challenge ID, case ID, round, and challenger identity remain supplied by the conversion layer; target and evidence selections remain existence-checked against the sealed artifact.

The smallest repair is observability and truthful classification, not acceptance: offline diagnostics now emit per-candidate target/type/DTO/semantic/failure/protocol fields and rule-level checks, distinguish `MODEL_EXECUTION_STATUS=SUCCESS` from `ARTIFACT_VALIDATION_STATUS=REJECTED`, and report `FINAL_CERTIFICATION_STATUS=FAIL` whenever no valid challenge collection is protocol-acceptable. Multiple schema-valid drafts remain subject to the existing duplicate-disagreement protocol boundary; unknown IDs, incompatible target relationships, unknown evidence, authority violations, truncation, retry, and fallback remain rejected or disabled.

Recorded outcome:

- `HTTP/provider execution = PASS`.
- `finish_reason = stop` and `output_tokens = 500`.
- `DTO schema validation = PASS`.
- `semantic validation = FAIL` in the historical harness result.
- `challenge accepted = false`.
- `LIVE_ARES_CHALLENGE_CERTIFICATION = FAIL` until a future explicitly authorized diagnostic succeeds.
- `NEW_LIVE_CALLS_DURING_FORENSICS = 0`.
- ATHENA challenge-response diagnostic: `NOT_RUN`.

## Phase 5G durable live-run artifact and certification observability

Phase 5G repairs the observability gap identified by Phase 5F. The first full live execution remains historical truth: `FIRST_FULL_LIVE_ROUND_EXECUTION=COMPLETED`, `FIRST_FULL_LIVE_ROUND_CERTIFICATION=FAIL`, with root cause `INSUFFICIENT_PERSISTED_FORENSIC_ARTIFACTS`. It was not retroactively certified or rewritten.

Future bounded live executions now create a runtime-owned `run_id`, start timestamp, case identity, protocol version, and artifact schema version before provider execution. They persist one sanitized artifact at `artifacts/swarm/live-certifications/<run_id>.json`; the directory is ignored by Git so runtime output cannot accidentally become a source fixture or overwrite an earlier run. A deterministic fingerprint is computed when the artifact is finalized from canonical certification metadata.

The existing Phase 5 runner has two narrow observability seams. The request observer reserves a ledger entry before the executor/router path is entered and closes it with sanitized status, HTTP/finish/token telemetry, failure stage/code, retry index, and fallback state. The event observer receives each already-reduced protocol event. Both observers write atomically through a temporary file and rename, so checkpoints remain valid JSON after a crash or interruption. Zeus synthesis is an explicit ledger category but Phase 5 rejects any Zeus request; retry and fallback remain disabled.

The versioned `SWARM_PHASE5G_CERTIFICATION_ARTIFACT_V1` contract contains provider configuration, case/evidence attestations, budgets, the per-operation request ledger, Round 1 accepted positions and fingerprints, lock and immutability state, disagreements, selected challenges, challenge responses, revisions/concessions/evidence requests/abstentions, post-challenge disagreement states, Apollo findings, Zeus readiness, human authority, a run-scoped ordered event envelope, replay metadata, and security attestations. Provider wire bodies, credentials, authorization headers, raw responses, chain-of-thought, `reasoning_content`, and hidden reasoning are never persisted.

`replayPhase5gArtifact` loads only the saved artifact, validates the event envelope and canonical sequence, and reconstructs the protocol blackboard through the existing reducer. `certifyPhase5gArtifact` independently checks ledger reconciliation, event ordering, run identity consistency, secret/hidden-reasoning scanning, Zeus exclusion, and artifact-only replay. The harness may print `CERTIFICATION_CANDIDATE=YES`; Phase 5G does not redefine that candidate state as final certification.

Offline Phase 5G tests execute a complete golden round through the same persistence path, discard the in-memory result, reload only the saved artifact, and replay it with zero network/provider/model calls. They also cover pre-transport ledger reservation, 4+1+1 request reconstruction, failure checkpoints, nested secret scanning, Zeus exclusion, Round 1 position fingerprints, evidence fingerprint preservation, and human decision pending. Additional failure-injection coverage remains available for provider failure, malformed output, challenge-generation/response failure, revision rejection, privacy-boundary failure, budget overflow, interruption, Apollo blocker, and Zeus-readiness failure; these states are required to remain non-complete and non-certifiable.

Phase 5G is an offline repair only. No live provider request, real model request, Zeus call, commit, push, or historical-result rewrite was performed. The next live run must be separately authorized and then certified offline from its persisted artifact; Phase 6 Zeus synthesis preparation remains `NO`.

## Phase 5E full bounded live adversarial round preparation

Phase 5E composes the already-certified protocol pieces for one future,
independently authorized full Council round. This section is preparation only;
it does not rewrite or supersede the historical Phase 5C, Phase 5C.2, Phase
5C.3, or Phase 5D live results above. `FULL_BOUNDED_LIVE_ADVERSARIAL_ROUND =
NOT_RUN`.

The composed protocol is:

`CASE_CREATED → EVIDENCE_READY → INDEPENDENT_ANALYSIS → POSITIONS_LOCKED → DISAGREEMENTS_IDENTIFIED → CHALLENGE_ROUND → REVISIONS_LOCKED → DISAGREEMENTS_REEVALUATED → AUDIT → ZEUS_READINESS → STOP`

The offline golden path uses the existing sealed synthetic payment-review case
and evidence package. It records the case fingerprint, evidence fingerprint,
and evidence count before execution and verifies the sealed package hash and
contents are unchanged afterward. Four blind Round-1 seat inputs are built
from the same sealed snapshot with no peer positions, disagreements, challenge
data, Zeus context, or human-decision context. The preparation harness keeps
the existing `ModelRouter → ModelRuntime → XaiProviderAdapter` seam available
for the future live path, with provider `xai`, model `grok-4.7`, and bounded
`max_output_tokens=4096`.

The future full-round budget is explicit before any request: four Round-1
requests, one ARES challenge-generation request, and at most six directed
challenge-response requests, for a hard global ceiling of eleven provider
requests. Retry and fallback remain disabled. The offline golden run accounts
for nine conceptual requests (four Round-1, one generation, four accepted
directed challenges), with no blocked or hidden request. Zeus is always zero.
The dedicated authorization variable is
`SWARM_LIVE_FULL_ADVERSARIAL_CONFIRM=YES`; isolated diagnostic confirmation
variables do not authorize this round. Without that exact gate, the future
entry point remains `NOT_RUN` and must make zero provider calls.

The offline composition verifies deterministic ARES selection, canonical
challenge compatibility and duplicate identity, the one-round/two-per-
disagreement/six-total/three-per-target bounds, targeted Round-2 privacy,
response action validation, revision lineage, immutable Round-1 positions,
open-disagreement preservation, evidence-request non-escalation, and the
deterministic post-challenge Apollo audit. The protocol ends at
`ZEUS_READINESS_EVALUATED`; Zeus is not called, synthesis is not started, and
`HUMAN_DECISION` remains `PENDING`.

The safe Phase 5E artifact contains only validated protocol state, runtime
identities, fingerprints, statuses, audit summaries, and the structured event
log required for reducer replay. It does not contain credentials,
authorization headers, raw provider bodies, hidden reasoning, chain of
thought, or raw response fields. Replaying the captured event log reproduces
the locked positions, disagreements, challenges, responses, revisions,
reevaluation, audit, and readiness state without a provider call.

Offline failure-injection coverage is recorded for Round-1 provider and
validation failures, partial participation, no-disagreement and generation
failure, incompatible/duplicate/overflow challenges, response failures,
invalid/no-op/spoofed revisions, unknown evidence, privacy violations,
Round-1 mutation, false consensus, Apollo blockers, Zeus-readiness failure,
and global-budget overflow. Failures remain rejected or contained; no
fallback, fabricated position, recursive challenge, external research, or
human decision is introduced.

Phase 5E preparation status:

- `SWARM_2_PHASE_5E_FULL_ROUND_PREP = PASS`.
- `GOLDEN_OFFLINE_FULL_ROUND = PASS`.
- `SAFE_ARTIFACT_CAPTURE = PASS`; `REPLAY_DETERMINISM = PASS`.
- `GLOBAL_PROVIDER_REQUEST_BUDGET = 11`; enforcement is fail-closed.
- `ZEUS_ENABLED = NO`; `ZEUS_CALLED = NO`; `HUMAN_DECISION = PENDING`.
- `LIVE_NETWORK_CALLS = 0`; `LIVE_PROVIDER_CALLS = 0`; `REAL_MODEL_CALLS = 0`.
- `FULL_BOUNDED_LIVE_ADVERSARIAL_ROUND = NOT_RUN`.
- A future one-round manual authorization is prepared; Zeus live synthesis is
  not authorized by this phase.

## Phase 5E.1 silent full-round harness execution forensics

The manual Phase 5E full-round attempt invoked
`bun .\\scripts\\phase5e-live-full-round.ts` multiple times. The command
returned to PowerShell without preflight, provider, certification, or error
output. Those attempts are not live certification results and are preserved as
an incident: provider-call occurrence was initially unverified, and no
successful full round occurred.

Static control-flow inspection established the precise cause. The TypeScript
file contained exports and helper definitions only; it had no `main()` call,
no Bun direct-entry guard, and no top-level preflight or error boundary. Bun
therefore evaluated module imports/definitions and exited successfully. The
silent path could not reach `ModelRouter`, `ModelRuntime`, `XaiProviderAdapter`,
or a transport request: `OBSERVED_SILENT_PATH_PROVIDER_CALLS =
PROVABLY_ZERO`. This conclusion is based on control-flow inspection, not on
the absence of terminal output.

The executable path now uses the Bun-compatible `import.meta.main` guard and
invokes `main()` exactly once. It reads the independent
`SWARM_LIVE_FULL_ADVERSARIAL_CONFIRM` gate before constructing the live runner.
Without the exact value `YES`, it prints `NOT_RUN`, authorization failure, and
zero provider calls, then exits successfully. Authorized configuration prints
the complete preflight—including provider/model, requested/effective 4096
tokens, sealed-case identity, 4 + 1 + 6 request budgets, retry/fallback policy,
Zeus disabled, human decision pending, and `REQUEST_PRECHECK=PASS`—before any
transport request.

Preflight rejects missing credentials, provider/model mismatch, invalid or
non-4096 full-round output budget, Zeus enablement, and other invariant
failures with sanitized reasons and zero calls. A single global ledger reserves
each request before transport, enforcing the ceiling of eleven requests across
Round 1, challenge generation, and challenge responses. Retry and fallback
remain disabled. A sanitized in-memory checkpoint distinguishes no request,
request in flight, completed/failed request, interruption, and artifact
validation completion. SIGINT reporting does not claim that an already-started
remote request was never received. Top-level failures report only a sanitized
class/stage/code; credentials and authorization material are never printed.

Offline Phase 5E.1 tests cover direct invocation, single-entry guarding,
visible no-authorization behavior, preflight ordering, missing-credential and
configuration failures, Zeus gating, global budget enforcement, retry/fallback
policy, sanitized exception output, interruption checkpoints, and all prior
Phase 5E protocol invariants. The exact direct command was smoke-tested with
authorization removed; it printed `LIVE_FULL_ADVERSARIAL_ROUND=NOT_RUN`,
`FULL_ROUND_AUTHORIZATION_GATE=FAIL`, and `LIVE_PROVIDER_CALLS=0`.

Phase 5E.1 status:

- `SWARM_2_PHASE_5E_1_CLI_FORENSICS = PASS`.
- `FULL_BOUNDED_LIVE_ADVERSARIAL_ROUND = NOT_CERTIFIED`.
- `LIVE_NETWORK_CALLS_DURING_FORENSICS = 0`;
  `LIVE_PROVIDER_CALLS_DURING_FORENSICS = 0`;
  `REAL_MODEL_CALLS_DURING_FORENSICS = 0`.
- Zeus remains disabled and `HUMAN_DECISION = PENDING`.

## Phase 5F post-run forensic certification of the first full live adversarial round

The reported completed run is preserved as a claimed terminal observation, not
as a certification result. The supplied facts were provider `xai`, model
`grok-4.7`, case `case-revision_after_challenge`, evidence fingerprint
`fnv1a:362a2671`, global budget 11, six attempted/completed requests, zero
blocked requests, no interruption, artifact validation reported complete,
Zeus not called, and human decision pending.

Forensic inspection searched the repository, workspace, attachments, and
available local session records for a persisted/sanitized artifact or event
log matching that case, evidence fingerprint, and six-request terminal state.
No such live-run artifact, request ledger detail, per-seat result, challenge
response record, revision state, audit record, readiness record, or replay
artifact was found. The current CLI returned aggregate counters and did not
persist the completed live artifact. The offline golden fixture is therefore
not evidence for this run and was not substituted.

The run identity used for this forensic record is explicitly derived, because
no captured run identity existed:

- `RUN_ID = phase5f-case-revision_after_challenge-requests-6`.
- `RUN_FINGERPRINT = fnv1a:bbff52b5`, derived deterministically from the
  supplied non-secret terminal facts. This is not a provider-output or event
  log fingerprint.

The aggregate count of six is recorded exactly, but its operation split cannot
be proven. In particular, the evidence does not establish which requests were
the four Round-1 seats, challenge generation, or challenge responses, nor can
it prove the absence of hidden/retry/fallback requests beyond the aggregate
terminal counters. The frequently suggested `4 + 1 + 1` explanation is not
asserted as fact.

Per-seat HTTP status, finish reason, output tokens, structured validation,
position IDs, risk levels, confidence, actual challenge DTOs, response
actions, revisions, disagreement transitions, Apollo findings, event order,
replay equivalence, and persisted secret-safety surfaces are all
`UNVERIFIABLE` for this exact run. No live output was reconstructed and no
provider call was made during forensics.

Phase 5F therefore fails closed:

- `FULL_BOUNDED_LIVE_ADVERSARIAL_ROUND_CERTIFICATION = FAIL`.
- The six-request terminal facts prove completion was reported, not that the
  real deliberation was truthful, bounded, auditable, and replayable.
- `ZEUS_CALLED = NO`; `HUMAN_DECISION = PENDING` remain recorded facts.
- `READY_FOR_PHASE_6_ZEUS_SYNTHESIS_PREP = NO`.

## Phase 5D live revision lineage and post-challenge reevaluation

The first authorized live ATHENA challenge-response certification is preserved as a successful historical result. It used provider `xai`, model `grok-4.7`, operation `CHALLENGE_RESPONSE`, seat `ATHENA`, challenge `challenge-athena-phase5c`, and disagreement `disagreement-assumption-1`. The provider returned HTTP 200 with `finish_reason=stop`; structured output extraction, JSON parsing, DTO validation, semantic validation, protocol validation, and response conversion all passed. The action was `REVISE`. The privacy boundary passed with no peer reasoning, unrelated challenges, Zeus context, or human-decision context. The bounded request budget was one, retry and fallback were disabled, truncation was false, and the historical final execution status was `SUCCESS`.

`LIVE_ATHENA_CHALLENGE_RESPONSE_CERTIFICATION=PASS` is now recorded. The previous ARES attempts and the Phase 5C.3 compatibility failure remain unchanged. No raw provider content, hidden reasoning, credential, authorization header, or unverified reconstruction of the live response was added.

The offline Phase 5D lifecycle begins from the sanitized synthetic Phase 5 fixture representing the validated REVISE contract. The accepted response is converted through the existing seat executor into runtime-owned response and revision identity. The canonical `Revision` links the case, old Round 1 position, new Round 2 position, triggering challenge, triggering response, changed/retained claim IDs, and bounded reason. Seat identity is not model-authored: the reducer binds the new position to the challenged seat and the old position to the same seat, while the event actor must match that seat. Revision, response, position, case, round, and lineage fields are excluded from the model-facing challenge response schema and generated by the runtime seam.

Round 1 remains immutable. The original position remains in the event-sourced position collection with its original ID, conclusion, risk level, confidence, claims, citations, and execution record. The revised position is a new `REVISED`, round-2 position with an explicit `position_references` link to the original. In-place mutation is rejected. A `REVISE` response whose semantic position projection is unchanged is rejected as `INVALID_TRANSITION`; a new ID or round alone cannot manufacture a revision.

After revisions are locked, `reevaluateDisagreements` recomputes the supported structured disagreement dimensions. Outcomes remain `OPEN`, `NARROWED`, or `RESOLVED` based on the revised structured positions. A revision does not imply resolution: a material risk or confidence conflict remains open or narrowed, and aligned risk positions resolve only when the canonical detector no longer observes that disagreement. Causal and scope disagreements are not inferred from prose in this protocol version; if no structured detector result exists, they remain `OPEN` rather than being falsely marked resolved. Recommendation changes do not silently erase a causal disagreement.

Apollo then audits the revised state deterministically. The offline audit verifies sealed evidence and citations, Round 1 blind dispatch, revision lineage, budgets, seat authority boundaries, participation truth, unresolved disagreement preservation, and execution truth. No evidence package mutation, unknown citation, authority claim, or human decision is introduced. The lifecycle emits `POST_CHALLENGE_AUDIT_COMPLETED` and a `ZEUS_READINESS_EVALUATED` event only; Zeus is not called, no synthesis is produced, and `HUMAN_DECISION` remains `PENDING`.

The historical `OUTPUT_TOKENS=null` value was a benign diagnostic mapping defect, not a provider or acceptance defect. The xAI adapter correctly maps `usage.completion_tokens` to `ModelResponse.usage.output_tokens`, and the seat executor copies it into sanitized execution diagnostics under `output_tokens`. The response diagnostic was reading the nonexistent `output_count` field from that later execution projection, so it reported `null` even when the provider usage field was available. The mapping was corrected to read `output_tokens`. Null remains truthful when the provider omits usage metadata and does not invalidate otherwise successful structured output; a supplied usage value is now reported correctly. No truncation is inferred from null telemetry.

Offline Phase 5D tests prove accepted REVISE lineage, runtime-owned identity boundaries, no-op rejection, Round 1 immutability, OPEN/NARROWED/RESOLVED reevaluation, false-consensus prevention, preservation of unsupported causal disagreements, Apollo audit of the revised state, Zeus-readiness-only termination, human decision pending, deterministic replay, null-versus-present output-token telemetry, no retry, no fallback, and zero live calls.

Recorded Phase 5D status:

- `LIVE_ATHENA_CHALLENGE_RESPONSE_CERTIFICATION = PASS`.
- `ACTION = REVISE`.
- `ROUND1_POSITION_IMMUTABILITY = PASS`.
- `REVISION_LINEAGE = PASS`.
- `FALSE_CONSENSUS_PREVENTION = PASS`.
- `POST_CHALLENGE_APOLLO_AUDIT = PASS`.
- `ZEUS_CALLED = NO`; readiness is evaluated without synthesis.
- `HUMAN_DECISION = PENDING`.
- `OUTPUT_TOKENS_NULL_ROOT_CAUSE = diagnostic read `output_count` instead of the normalized `output_tokens` field; repaired.`
- `NEW_LIVE_CALLS_DURING_PHASE5D = 0`.
- Full live adversarial round, Zeus, synthesis, and human decision: `NOT_RUN`, `PENDING` for human decision.

## Phase 5C.2 multi-target disagreement protocol forensics

The second authorized ARES result is preserved separately from the first. It made one successful xAI/Grok 4.7 request: HTTP 200, `finish_reason=stop`, `output_tokens=479`, no truncation, JSON/DTO/semantic/conversion validation passed. ARES emitted three challenges for `disagreement-assumption-1`, targeting ATHENA, HADES, and APOLLO. Each candidate independently passed semantic validation, protocol validation, and budget validation. The collection failed with the historical diagnostic code `DUPLICATE_DISAGREEMENT_TARGET`; model execution was `SUCCESS`, artifact validation was `REJECTED`, and final certification was `FAIL`.

The historical duplicate condition was not a provider failure. The diagnostic code was emitted in `scripts/phase5c-live-diagnostics.ts` by the collection failure expression that compared the number of distinct `disagreement_id` values with the number of converted challenges. The production reducer independently had the same overly broad rule in `src/swarm/engine/reducer.ts`, inside `reduceSwarmEvent`'s `CHALLENGE_EMITTED` branch: any existing challenge with the same `disagreement_id` caused `DUPLICATE_ID`. The uniqueness key was therefore `disagreement_id` alone, not target seat, target position, target type, target identifier, or challenge purpose.

That blanket rule contradicted the declared Phase 5 bounds. `src/swarm/debate/challenges.ts` defines `MAX_CHALLENGES_PER_DISAGREEMENT=2`, `MAX_TOTAL_CHALLENGES=6`, and `MAX_CHALLENGES_PER_TARGET_SEAT=3`; the Phase 5 design also documents two challenges per disagreement. The existing deterministic planner emitted one challenge per disagreement and its test asserted unique disagreement IDs, but that was an implementation limitation, not the declared two-per-disagreement invariant. The intended protocol is now explicit: different target positions may challenge the same disagreement; the same semantic target/purpose is a duplicate; aggregate budgets remain independent checks.

The canonical duplicate identity is the tuple:

`(disagreement_id, target_position_id, target_type, target_id, challenge_type, requested_action)`

where `target_id` is the target claim for a claim challenge, the disagreement for a disagreement challenge, or the target position for a position challenge. Different seats or positions addressing one disagreement are not automatically duplicates. Identical semantic target/purpose collisions remain rejected.

The historical three-challenge collection also exposed a separate budget-observability bug: candidate-level checks did not evaluate the aggregate per-disagreement count, so all three candidates reported `BUDGET_VALID=PASS`. The repaired diagnostics report `CANDIDATE_BUDGET_VALIDATION` separately from `COLLECTION_BUDGET_VALIDATION`, then evaluate duplicate identity, per-disagreement budget, per-target-seat budget, and total budget in that order. A collection of three challenges for one disagreement is rejected atomically with `CHALLENGE_PER_DISAGREEMENT_BUDGET_EXCEEDED`; no overflow challenge is silently dropped or accepted. The model-generated count remains observable.

For the one-disagreement certification operation, the provider-facing production schema is now context-constrained to `maxItems=2`, and the ARES instruction says: generate at most two high-value targeted challenges for the selected disagreement, each targeting one eligible seat, without optimizing for the maximum. The canonical runtime and reducer checks remain authoritative if a provider still returns an over-budget artifact.

Offline Phase 5C.2 tests prove: two different targets for one disagreement are allowed; identical semantic targets are duplicates; a third same-disagreement challenge fails the per-disagreement budget; different disagreements remain bounded by total and target-seat limits; candidate and collection budget telemetry remain distinct; strict schemas, evidence integrity, privacy, Round 1 immutability, no retry, no fallback, Zeus disabled, and human decision pending remain unchanged.

Recorded Phase 5C history:

- Attempt 1: schema PASS, semantic FAIL, artifact rejected; root cause was the prompt/diagnostic cardinality mismatch.
- Attempt 2: schema PASS, semantic PASS, all three individual protocol checks PASS, collection protocol FAIL with `DUPLICATE_DISAGREEMENT_TARGET`; artifact rejected.
- `NEW_LIVE_CALLS_DURING_FORENSICS = 0`.
- `LIVE_ARES_CHALLENGE_CERTIFICATION = FAIL` remains historical until a future explicitly authorized final ARES retest succeeds.
- ATHENA challenge-response diagnostic: `NOT_RUN`.

## Phase 5C.3 disagreement-challenge compatibility alignment

The third authorized ARES result is preserved exactly as a historical failed attempt. It made one successful xAI/Grok 4.7 request: HTTP 200, `finish_reason=stop`, `output_tokens=356`, `TRUNCATION_DETECTED=false`, and configured output budget 4096. The response contained two challenges for `disagreement-assumption-1`, targeting ATHENA and HADES. Challenge 1 was `ASSUMPTION` and passed DTO, semantic, and protocol validation. Challenge 2 was `SEVERITY`; its DTO passed, but semantic validation failed at `CHALLENGE_TYPE_COMPATIBLE`, so protocol evaluation was not run. Model execution was `SUCCESS`, artifact validation was `REJECTED`, and final certification was `FAIL`.

The validator was correct. The canonical protocol mapping in `src/swarm/debate/challenges.ts#allowedChallengeTypesForDisagreement` treats a disagreement as challengeable along its own dimension: `ASSUMPTION → ASSUMPTION`, `RISK_RATING → SEVERITY`, `EVIDENCE_INTERPRETATION → EVIDENCE`, `CONTROL_EFFECTIVENESS → CONTROL`, and the remaining supported types map to their corresponding challenge type. A severity concern discovered while examining an assumption disagreement is not silently relabelled; it must be surfaced as a separate disagreement in a later protocol-owned step. The selected disagreement identity and type remain runtime-owned.

The defect was provider-schema compatibility drift. The broad historical draft schema advertised the complete `ChallengeType` enum even when generation was scoped to one selected disagreement. The model therefore received `SEVERITY` as a syntactically valid choice although the runtime would reject it semantically. This was not repaired by broadening the validator. The context-specific strict provider schema now exposes only the canonical compatible subset, and the prompt explicitly includes the selected disagreement type and allowed challenge types. The same compatibility source drives the planner, semantic diagnostic, provider schema projection, prompt context, and telemetry.

Phase 5C.3 telemetry now reports `TARGET_DISAGREEMENT_TYPE`, `ALLOWED_CHALLENGE_TYPES`, `PROVIDER_CHALLENGE_TYPE_ENUM`, `COMPATIBILITY_SOURCE`, `SCHEMA_COMPATIBILITY_ALIGNMENT`, and `PROMPT_COMPATIBILITY_ALIGNMENT`. Runtime validation remains the final authority, and a schema/validator parity test rejects an incompatible `SEVERITY` draft for an `ASSUMPTION` disagreement. Phase 5C.2 duplicate identity and aggregate budget behavior remains unchanged: two compatible challenges for one disagreement remain permitted, a third is rejected by the per-disagreement budget, and different target seats are not treated as duplicates.

Recorded Phase 5C history:

- Attempt 1: DTO PASS, semantic FAIL; historical root cause was the cardinality contract mismatch.
- Attempt 2: individual semantic/protocol PASS, collection protocol FAIL; duplicate identity and aggregate budget defects were repaired.
- Attempt 3: count bounded to two; challenge 1 fully PASS; challenge 2 `SEVERITY` for an `ASSUMPTION` disagreement failed `CHALLENGE_TYPE_COMPATIBLE`; artifact rejected.
- `NEW_LIVE_CALLS_DURING_FORENSICS = 0`.
- ATHENA challenge-response diagnostic: `NOT_RUN`.

## Phase 5G.1 global provider budget failure forensics

The second full live-round attempt is preserved as a failed execution. Its durable artifact is:

`artifacts/swarm/live-certifications/swarm-phase5g-1791210219563-c6a133b4-f6f8-4c4f-a08f-8651c24c70e6.json`

The artifact is readable, schema-valid, and remains unmodified. It identifies `case-revision_after_challenge` and evidence fingerprint `fnv1a:362a2671`. Its persisted request ledger proves exactly five provider operations: four `ROUND1_ANALYSIS` requests for ATHENA, ARES, HADES, and APOLLO, followed by one `CHALLENGE_GENERATION` request for ARES. It contains zero `CHALLENGE_RESPONSE` and zero Zeus requests. The persisted event log ends at sequence 24, after the second `CHALLENGE_EMITTED`; no challenge-response request was attempted. Therefore `4 + 1 + 0 = 5`, not `4 + 1 + 1`.

The terminal `SANITIZED_ERROR_CODE=GLOBAL_PROVIDER_BUDGET` was not a global provider-budget exhaustion. The exact throw was in `src/swarm/engine/reducer.ts`, `reduceSwarmEvent`, the `CHALLENGE_EMITTED` branch: the third model-generated challenge targeted the same disagreement after two challenges had already been accepted, so `current.challenges.filter(item => item.disagreement_id === event.challenge.disagreement_id).length >= PHASE5_MAX_CHALLENGES_PER_DISAGREEMENT` raised `BUDGET_EXCEEDED`. The Phase 5E CLI helper classified any error containing `BUDGET` as `GLOBAL_PROVIDER_BUDGET`, conflating protocol challenge-budget exhaustion with provider transport exhaustion. The global transport ledger had only five admitted requests against a configured maximum of eleven and never threw.

Phase 5G.1 repairs that classification and accounting boundary. The CLI now distinguishes `GLOBAL_PROVIDER_BUDGET`, category-budget failures, and `PROTOCOL_BUDGET`. The provider ledger counts only admitted reservations, so a blocked twelfth request does not inflate `attempted` to twelve. Category metadata is carried internally to the transport and independently enforces `ROUND1_ANALYSIS ≤ 4`, `CHALLENGE_GENERATION ≤ 1`, `CHALLENGE_RESPONSE ≤ 6`, and `ZEUS_SYNTHESIS = 0`; blocked category requests never reach transport. A blocked reservation is represented separately from a provider-attempted request. Checkpoint output now distinguishes `LAST_PROVIDER_REQUEST_STATUS` from `RUN_EXECUTION_STATUS`, preventing `REQUEST_COMPLETED` for the last request from being read as whole-run success.

The historical failed artifact remains truthful: `execution_status=FAILED`, `certification_candidate_status=NO`, five ledger entries, `failure_code=BUDGET_EXCEEDED`, and `replayable=false` because the run stopped before a complete protocol. It did not contain the later failure-stage/last-phase fields or final security-attestation fields; those omissions were not backfilled. A separate forensic validator now checks incomplete artifacts for schema readability, ledger/event presence and ordering, failure-code presence, and recursive secret/hidden-reasoning safety without turning an incomplete run into a certification candidate. Future failure checkpoints persist failure stage, failure code, and last completed protocol phase.

Offline Phase 5G.1 tests prove the exact budget matrix: `4+1+0=5`, `4+1+1=6`, `4+1+2=7`, `4+1+6=11`, the first challenge response after five valid requests is admitted, the twelfth request is blocked before transport, category overflows are independently blocked, Zeus is blocked, and ledger counts equal mock transport calls. No budget was increased, no live call was made, and no historical artifact was rewritten.

## Phase 5G.2 challenge admission and canonical selection repair

The durable historical artifact `artifacts/swarm/live-certifications/swarm-phase5g-1791210219563-c6a133b4-f6f8-4c4f-a08f-8651c24c70e6.json` remains unchanged. It records `case-revision_after_challenge`, evidence fingerprint `fnv1a:362a2671`, four completed Round-1 requests, one completed ARES challenge-generation request, two accepted `CHALLENGE_EMITTED` events for `disagreement-recommendation-0`, and no challenge-response request. The recorded run therefore remains `execution_status=FAILED`, `certification_candidate_status=NO`, `failure_code=BUDGET_EXCEEDED`, and `replayable=false`.

The first full-round live report established that ARES returned three candidates for one disagreement. The persisted historical artifact contains the two candidates that crossed the old event boundary: `challenge-1` targeted ATHENA's position and `challenge-2` targeted HADES's position, both for `disagreement-recommendation-0`, with `challenge_type=RECOMMENDATION` and `requested_action=DEFEND`. The detailed DTO for the third candidate is not present in that old artifact; it is not reconstructed here. The reducer then received that third same-disagreement candidate and threw `BUDGET_EXCEEDED` at `src/swarm/engine/reducer.ts` while reducing `CHALLENGE_EMITTED`. The failure was therefore an admission-boundary defect, not global provider-budget exhaustion.

The repaired pipeline is now:

`provider candidates → DTO conversion → semantic validation → compatibility validation → canonical duplicate identity → deterministic selection → budget admission → CHALLENGE_EMITTED → reducer`

`src/swarm/debate/challenges.ts#selectAndAdmitPhase5Challenges` is the canonical selector. It reuses the established compatibility mapping and duplicate identity tuple `(disagreement_id, target_position_id, target_type, target_id, challenge_type, requested_action)`. Provider order is not authoritative. Candidates are sorted by the existing Phase 5 disagreement priority and stable semantic fields, then classified with sanitized dispositions: `ADMITTED`, `NOT_SELECTED`, `DUPLICATE_REJECTED`, `INCOMPATIBLE_REJECTED`, `SEMANTIC_REJECTED`, or `BUDGET_REJECTED`.

The selector enforces the unchanged protocol limits before reduction: one challenge round, at most two challenges per disagreement, at most six total challenges, and at most three challenges per target seat. Only `admitted` candidates reach the reducer. A provider response containing three valid, compatible, distinct targets for one disagreement is now classified as `3 candidates / 2 admitted / 1 BUDGET_REJECTED`; the overflow is not emitted and cannot abort the round.

The durable artifact records only sanitized candidate metadata and counts at `admission_boundary=BEFORE_REDUCER`: provider count, DTO-valid count, semantic-valid count, compatible count, deduplicated count, selected count, admitted count, and per-candidate disposition metadata. It does not persist a raw provider response or hidden reasoning. Round-1 blindness, sealed evidence identity, strict challenge DTO validation, runtime-owned identity, retry-disabled behavior, fallback-disabled behavior, Zeus-disabled behavior, and human authority boundaries remain unchanged.

Offline Phase 5G.2 tests cover the incident shape, duplicate identity, independent disagreement budgets, incompatible and semantically invalid candidates, per-target-seat and total limits, provider-order independence, pre-reducer response progression, sanitized durable metadata, and the absence of challenge text or hidden provider material from disposition records. The focused suite is `10/10`; the full suite is `1,083/1,083`. No live provider call was made, no Zeus call was made, and the historical failed run was not rerun or rewritten.

Recorded Phase 5G.2 status:

- `LIVE_INCIDENT_ROOT_CAUSE = THIRD_SAME_DISAGREEMENT_CHALLENGE_REACHED_REDUCER`.
- `CANONICAL_SELECTION_BEFORE_REDUCER = PASS`.
- `INCIDENT_FIXTURE_PROVIDER_CANDIDATE_COUNT = 3`.
- `INCIDENT_FIXTURE_ADMITTED_COUNT = 2`.
- `INCIDENT_FIXTURE_OVERFLOW_DISPOSITION = BUDGET_REJECTED`.
- `NEW_LIVE_CALLS_DURING_PHASE5G2 = 0`.
- Historical Phase 5G failure remains historical and is not converted into a certification result.

## Phase 5H final artifact-only live adversarial certification

Phase 5H inspected only the specified persisted artifact and did not make a network, provider, model, or Zeus call. The artifact was not modified:

`artifacts/swarm/live-certifications/swarm-phase5g-1791211595745-83cec8da-b9a5-419c-ac4d-4e26fa0e64a4.json`

The artifact run identity is `swarm-phase5g-1791211595745-83cec8da-b9a5-419c-ac4d-4e26fa0e64a4` with `run_fingerprint=fnv1a:632328cd`. Its schema validates and the fingerprint recomputes exactly. The persisted artifact reports `execution_status=COMPLETED` and `certification_candidate_status=YES`, but Phase 5H applies the stricter final certification requirement that all four Round-1 seats have accepted positions.

The request ledger proves, without assuming a decomposition, `ROUND1=4`, `CHALLENGE_GENERATION=1`, `CHALLENGE_RESPONSE=2`, `ZEUS=0`, total `7`. All seven persisted requests completed; hidden requests are not indicated, retry count is zero, fallback count is zero, and Zeus count is zero.

Round 1 is not certifiable as a four-seat Council from this artifact. ATHENA, ARES, and HADES each have `SUCCESS` execution, accepted structured positions, provider `xai`, model `grok-4.7`, and passing sanitized validation diagnostics. APOLLO was model-called and received HTTP 200 with parsed model content, but its structured DTO/schema validation failed; no accepted APOLLO position was persisted. Its sanitized execution status is `REJECTED`, `failure_stage=STRUCTURED_VALIDATION`, `failure_reason_code=STRUCTURED_OUTPUT_INVALID`, `dto_schema_validation=FAIL`, and `seat_semantic_validation=NOT_RUN`. No raw output was reconstructed.

The artifact proves sealed-evidence immutability: before and after fingerprint are both `fnv1a:362a2671`, and no unknown accepted evidence IDs were found. It records three material, open pre-challenge disagreements: `RECOMMENDATION`, `ASSUMPTION`, and `CONTROL_EFFECTIVENESS`.

Challenge admission in this final artifact records `PROVIDER_CANDIDATE_COUNT=2`, `DTO_VALID_CANDIDATE_COUNT=2`, `SEMANTIC_VALID_CANDIDATE_COUNT=2`, `COMPATIBLE_CANDIDATE_COUNT=2`, `DEDUPLICATED_CANDIDATE_COUNT=2`, `SELECTED_CANDIDATE_COUNT=2`, and `ADMITTED_CHALLENGE_COUNT=2`. Both admitted challenges target the recommendation disagreement, one to ATHENA and one to HADES. The canonical limits, compatibility, duplicate identity, budget admission, and reducer replay checks pass.

Both persisted challenge responses are `REVISE`: ATHENA responded to `challenge-1`, and HADES responded to `challenge-2`. The Round-2 privacy boundary passes. Two revisions were created with preserved triggering challenge/response and old/new position lineage. There were zero concessions, zero evidence requests, and zero abstentions. Post-challenge reevaluation records three open, zero narrowed, and zero resolved disagreements; no false consensus was asserted.

Apollo’s persisted post-challenge audit contains ten findings, zero blockers, and two warnings. Citation, evidence-integrity, and authority-violation failure counts are zero. Zeus is disabled and not called; the persisted readiness gate is `PASS`. Human decision remains `PENDING` with zero authority violations. Event ordering, artifact-only replay, request reconciliation, secret scanning, and hidden-reasoning scanning pass. No synthesis or completed human-decision event exists.

The final artifact-only certification is therefore fail-closed:

- `SWARM_2_PHASE_5H_FINAL_LIVE_CERTIFICATION = FAIL`.
- `FULL_BOUNDED_LIVE_ADVERSARIAL_ROUND_CERTIFICATION = FAIL`.
- The decisive failure is the missing accepted APOLLO Round-1 position, not a ledger, replay, evidence, security, Zeus, or human-authority defect.
- `PHASE_5_ADVERSARIAL_DELIBERATION = INCOMPLETE`.
- `READY_FOR_PHASE_6_ZEUS_SYNTHESIS_PREP = NO`.
- `LIVE_NETWORK_CALLS_DURING_PHASE5H = 0`; `LIVE_PROVIDER_CALLS_DURING_PHASE5H = 0`; `REAL_MODEL_CALLS_DURING_PHASE5H = 0`.

The Phase 5H certification implementation is `scripts/phase5h-artifact-certification.ts` with an offline test proving the result remains `FAIL` when APOLLO is rejected. No historical artifact was rewritten, no live round was rerun, and no commit or push was made.

## Phase 5H.1 APOLLO Round-1 and blindness forensics

Phase 5H.1 is an artifact-only forensic diagnosis. It inspected the historical artifact below without rerunning the Council, making a provider/model call, or modifying the artifact:

`artifacts/swarm/live-certifications/swarm-phase5g-1791211595745-83cec8da-b9a5-419c-ac4d-4e26fa0e64a4.json`

The artifact remains byte-for-byte unchanged (SHA-256 `503477F453196820AD41FD2C0CFBC012E2BFB079519984B713F791CA213A0587`). Its run identity remains `swarm-phase5g-1791211595745-83cec8da-b9a5-419c-ac4d-4e26fa0e64a4`, with `run_fingerprint=fnv1a:632328cd`; schema validation and recomputed fingerprint validation pass.

### APOLLO provider and position diagnosis

The APOLLO Round-1 ledger record is `model-request-case-revision_after_challenge-APOLLO-4-round1`, provider `xai`, model `grok-4.7`, request status `REQUEST_COMPLETED`, configured/effective output budget `4096`, retry index `0`, and fallback `false`. The ledger’s optional HTTP/finish/output telemetry is null, so it is not used to infer transport details. The corresponding persisted execution diagnostics are authoritative for this diagnosis: `model_called=true`, `provider_attempted=true`, `provider_reply_received=true`, `http_status=200`, `provider_output_extracted=true`, `model_output_present=true`, `json_parse=PASS`, `finish_reason=stop`, `output_tokens=1695`, and `truncation_detected=false`.

APOLLO has no accepted `AgentPosition` in the Round-1 artifact. Its terminal execution is `REJECTED` with `failure_stage=STRUCTURED_VALIDATION` and `failure_reason_code=STRUCTURED_OUTPUT_INVALID`; `dto_schema_validation=FAIL`, `structured_schema_passed=false`, `output_accepted=false`, and `seat_semantic_validation=NOT_RUN`. The exact failure predicate is therefore the DTO/schema validation branch in `src/swarm/models/structured-output.ts#normalizeStructuredOutput`, surfaced by `src/swarm/models/runtime.ts#ModelRuntime.execute`. This is `MODEL_OUTPUT_SCHEMA_FAILURE`, not a provider request failure, empty model content, semantic specialist-validation failure, or blindness failure. No raw model text was reconstructed.

The APOLLO failure is independent of Round-1 blindness. A rejected DTO does not establish that peer context was exposed, and it does not by itself establish a blindness violation. The repaired offline certification path evaluates position acceptance and blindness evidence as separate predicates.

### Round-1 temporal and context diagnosis

The event sequence is consistent with a Round-1 snapshot before any positions were appended: ATHENA, ARES, HADES, and APOLLO started at sequences 4, 5, 6, and 7; ATHENA, ARES, and HADES completed at 9, 11, and 13; APOLLO was rejected at 14; and `POSITIONS_LOCKED` occurred at 15. All four Round-1 executions therefore started before the lock, and no later challenge or revision event could have entered their Round-1 context.

The implementation path also assembles Round-1 input from a pre-position snapshot. `src/swarm/engine/offline.ts` creates the snapshot before dispatch, `buildRound1SeatInput` includes the sealed case/evidence package but no positions, disagreements, challenges, or reasoning, and `ModelBackedSeatExecutor.buildContext` has no peer-position or peer-reasoning fields in its Round-1 context. This establishes the intended assembly boundary, but the historical artifact did not persist an immutable per-request attestation proving what each provider request received. The historical artifact therefore cannot upgrade intended code behavior into an observed fact.

The old Phase 5H aggregate predicate also coupled “all four accepted positions” to `ROUND1_BLIND`: it required four accepted seats before it could pass blindness. That was overly broad classification. The repaired certifier in `scripts/phase5h-artifact-certification.ts#certifyPhase5hArtifactOnly` now separates position acceptance from blindness evidence and requires a pre-request attestation for each required Round-1 request. Because the historical request ledger contains no `round1_context_attestation`, ATHENA, ARES, HADES, APOLLO, peer-position context, peer-reasoning context, challenge context, Zeus context, and human-decision context are all `UNVERIFIABLE`—not asserted present and not asserted absent. The artifact’s `PEER_REASONING_LEAKAGE=NO` remains valid as a persisted hidden-reasoning scan result: no hidden reasoning or raw provider material was retained. It does not substitute for missing context attestation.

The historical Round-1 evidence fingerprint is `fnv1a:362a2671`. Because no APOLLO request attestation was persisted, APOLLO’s request evidence fingerprint and peer-position count are `UNVERIFIABLE`, not guessed from the later artifact state. The forensic classification is therefore:

- `BLINDNESS_FAILURE_CLASS = MISSING_ATTESTATION`.
- `FORENSIC_CLASSIFICATION = CATEGORY_2_INSUFFICIENT_HISTORICAL_EVIDENCE`.
- `ROUND1_APOLLO_AND_BLINDNESS_INDEPENDENT = PASS`.
- `HISTORICAL_RUN_CERTIFICATION_STATUS = FAIL`.
- `NEW_LIVE_RUN_REQUIRED = YES`.

This is not Category 1: no peer-context leak was proven. It is not Category 3: APOLLO’s schema rejection is deterministic and independently evidenced. It is not Category 4: the artifact, code path, and validation boundary permit a narrower classification. `ROUND1_CONTEXT_ASSEMBLY_REPAIRED=NOT_NEEDED`; the missing repair was durable attestation capture, not a protocol redesign.

### Minimal forward repair and offline proof

Before a future provider request, `src/swarm/engine/offline.ts` now creates and passes a sanitized Round-1 attestation containing only:

`peer_position_count`, `peer_position_ids`, `peer_context_present`, `peer_reasoning_present`, `request_context_fingerprint`, `evidence_fingerprint`, and `seat_contract_version`.

The fail-closed pre-request invariant requires `peer_position_count=0`, `peer_position_ids=[]`, `peer_context_present=false`, and no peer reasoning. `scripts/phase5g-durable-artifact.ts` persists this attestation on the reserved request ledger entry. It contains no prompt, model text, credentials, authorization headers, or raw provider response. The certifier evaluates a captured attestation independently: valid zero-peer evidence passes; any peer position/context fails; missing or mismatched attestation remains `UNVERIFIABLE`.

The Phase 5H.1 offline matrix covers: valid blind APOLLO attestation, actual peer context, rejected APOLLO DTO without automatic blindness failure, missing evidence, post-lock timing, completion-order independence, structured peer positions with hidden reasoning absent, and durable capture of all four pre-request attestations. Focused tests pass `9/9`.

Final Phase 5H.1 status:

- `SWARM_2_PHASE_5H_1_APOLLO_BLINDNESS_FORENSICS = PASS`.
- `ROUND1_BLINDNESS = FAIL` historically because its evidence is `UNVERIFIABLE`.
- `BLINDNESS_ATTESTATION_CAPTURE_REPAIRED = YES`.
- `CERTIFIER_REPAIRED = YES`.
- `READY_FOR_SAME_ARTIFACT_RECERTIFICATION = NO`.
- `READY_FOR_NEW_LIVE_CERTIFICATION_RUN = YES`, subject to an explicitly authorized future run.
- `READY_FOR_PHASE_6 = NO`.
- `LIVE_NETWORK_CALLS = 0`; `LIVE_PROVIDER_CALLS = 0`; `REAL_MODEL_CALLS = 0`.

No historical live run was rerun, no historical artifact was overwritten, no Zeus call was made, and no commit or push was made.

## Phase 5H.2 APOLLO Round-1 structured-output hardening

Phase 5H.2 was an offline-only hardening gate. It made no network, provider, model, or Zeus call and did not modify the historical Phase 5G artifact. The historical run remains unchanged and remains a failed live certification candidate.

### Historical APOLLO DTO diagnosis

The persisted APOLLO event proves: HTTP 200, model content present, provider output extracted, JSON parse `PASS`, `dto_schema_validation=FAIL`, `output_accepted=false`, `failure_stage=STRUCTURED_VALIDATION`, and `failure_reason_code=STRUCTURED_OUTPUT_INVALID`. The artifact does not contain the model object, raw response, or field-level validation issues. Consequently:

- `APOLLO_DTO_FAILURE_PATH = UNVERIFIABLE_FROM_HISTORICAL_ARTIFACT`.
- `APOLLO_DTO_FAILURE_EXPECTED_TYPE = SeatAssessmentOutput`.
- `APOLLO_DTO_FAILURE_ACTUAL_TYPE = parsed structured model object with unknown field-level shape`.
- `APOLLO_DTO_FAILURE_REASON = strict local DTO validation failed after successful extraction and JSON parsing; the retained artifact omitted the issue path`.
- `APOLLO_DTO_FAILURE_CLASS = MODEL_OUTPUT_NONCOMPLIANCE`.

This is the narrowest supported classification. There is no persisted evidence of an HTTP, extraction, JSON parser, converter, or provider-schema transport failure. The exact invalid field is intentionally not reconstructed or guessed. `HISTORICAL_FAILURE_FIXTURE=NOT_AVAILABLE` because no sufficient sanitized provider object was retained.

### Contract-layer alignment

The domain-facing `SeatAssessmentOutput`, strict xAI provider schema, prompt contract, structured-output normalizer, semantic validator, and `AgentPosition` converter are structurally aligned. All four seats use the same required 13-field model DTO; APOLLO has no unique required field, nested shape, enum, cardinality, nullability, additional-property, or evidence-reference representation. The successful ATHENA, ARES, and HADES seats therefore provide a structural comparison: their provider/model/budget and strict schema contract are the same, while APOLLO alone has `dto_schema_validation=FAIL` and no accepted position. The smallest demonstrated difference is APOLLO’s invalid model output, not an APOLLO-specific DTO.

The schema remains strict with `additionalProperties=false`, required fields unchanged, canonical risk/confidence bounds unchanged, and no identity or reasoning fields. `reasoning_content`, identity fields, peer context, and forbidden authority fields remain rejected. No DTO, parser, semantic validator, evidence package, or converter was weakened.

### Repair boundary

The repair is at the earliest safe observability and instruction layers:

- APOLLO Round-1 prompt language now explicitly identifies its evidence/governance-auditor mandate, citation/provenance checks, evidence-versus-inference distinction, contradiction and unsupported-claim detection, uncertainty preservation, and human-authority boundary. It explicitly requires only the exact `SeatAssessmentOutput` fields and forbids identity, peer, challenge, audit-event, provider, and reasoning fields.
- Structured validation now propagates a bounded sanitized `validation_reason` into runtime diagnostics. It contains no raw response, prompt, credential, or hidden reasoning and does not affect acceptance.
- The existing strict provider schema remains authoritative and unchanged in semantic strength.
- Invalid output remains `REJECTED`; no fallback position, default field, invented citation, risk, confidence, or semantic rewrite is possible.

The Phase 5H.1 blindness repair is active in the same Round-1 orchestration path. Each reservation now persists `seat_id`, `round=1`, evidence fingerprint, peer-position count and IDs, peer-context flag, request-context fingerprint, and seat-contract version. A pre-transport fail-closed check requires `peer_position_count=0` and `peer_context_present=false` for ATHENA, ARES, HADES, and APOLLO.

### Offline proof

The Phase 5H.2 suite covers canonical APOLLO output, unavailable historical field-level evidence, missing substantive fields, invalid risk and confidence, unknown evidence IDs, malformed nested structures, forbidden fields, hidden reasoning fields, provider-shape extraction through xAI normalization and JSON parsing, DTO validation, semantic validation, conversion, protocol acceptance, independent blindness pass/fail, four-seat Round-1 attestation persistence, and a complete artifact-only Phase 5 certification candidate.

The complete mock/recorded-provider candidate produced four valid Round-1 positions, four matching sealed-evidence fingerprints, four zero-peer pre-transport attestations, locked positions, challenge generation/admission, challenge responses, audit, Zeus readiness, and artifact-only certification. Zeus was not invoked. The actual Phase 5H certifier reported:

- `ROUND1_ATHENA=PASS`.
- `ROUND1_ARES=PASS`.
- `ROUND1_HADES=PASS`.
- `ROUND1_APOLLO=PASS`.
- `ROUND1_BLINDNESS=PASS`.
- `FULL_BOUNDED_OFFLINE_ADVERSARIAL_ROUND_CERTIFICATION=PASS`.
- `SECRET_SCAN=PASS`; `HIDDEN_REASONING_SCAN=PASS`.

Phase 5H.2 focused tests pass `19/19`; the full suite passes `1,104/1,104`. Required typecheck, snapshot, build, and diff checks pass. The historical result remains `FULL_BOUNDED_LIVE_ADVERSARIAL_ROUND_CERTIFICATION=FAIL`; it was not backfilled, rewritten, or recertified as live.

Final Phase 5H.2 status:

- `SWARM_2_PHASE_5H_2_APOLLO_DTO_HARDENING = PASS`.
- `HISTORICAL_ARTIFACT_MODIFIED = NO`.
- `LIVE_NETWORK_CALLS = 0`; `LIVE_PROVIDER_CALLS = 0`; `REAL_MODEL_CALLS = 0`.
- `READY_FOR_EXACTLY_ONE_NEW_LIVE_CERTIFICATION_RUN = YES`.
- `READY_FOR_PHASE_6_ZEUS_SYNTHESIS_PREP = NO`.

No commit or push was made. The prior historical forensic result and all earlier failed live attempts remain preserved.

## Phase 5H final recertification — new live certification candidate

The specified completed live candidate was certified using only its persisted durable artifact. No network, provider, model, or Zeus call was made, and the artifact was not modified:

`artifacts/swarm/live-certifications/swarm-phase5g-1791214093989-6ffe3b68-c695-422c-9da7-30ad43f978d5.json`

The artifact identity is `run_id=swarm-phase5g-1791214093989-6ffe3b68-c695-422c-9da7-30ad43f978d5` and `run_fingerprint=fnv1a:c91145c9`. The persisted artifact schema validates and the fingerprint recomputes exactly. It records `execution_status=COMPLETED`, `certification_candidate_status=YES`, provider `xai`, model `grok-4.7`, and the bounded 4096-token configuration. The artifact itself remains unchanged.

### Request ledger and Round 1

The authoritative persisted request ledger contains exactly seven completed requests: four `ROUND1_ANALYSIS`, one `CHALLENGE_GENERATION`, two `CHALLENGE_RESPONSE`, and zero Zeus requests. Hidden requests are zero, retries are zero, fallbacks are zero, and blocked requests are zero. Ledger and aggregate reconciliation pass.

All four Round-1 seats are independently accepted:

- ATHENA: `SUCCESS`, accepted position `position-athena-1-1`, DTO/semantic/conversion validation `PASS`.
- ARES: `SUCCESS`, accepted position `position-ares-1-3`, DTO/semantic/conversion validation `PASS`.
- HADES: `SUCCESS`, accepted position `position-hades-1-5`, DTO/semantic/conversion validation `PASS`.
- APOLLO: `SUCCESS`, accepted position `position-apollo-1-7`, DTO/semantic/conversion validation `PASS`.

The Phase 5H.2 APOLLO structured-output failure did not recur. All persisted positions have valid identity, risk level, confidence, evidence references, and protocol state.

### Round-1 blindness and evidence

Each Round-1 request persists the repaired pre-transport attestation. ATHENA, ARES, HADES, and APOLLO each prove `round=1`, evidence fingerprint `fnv1a:362a2671`, `peer_position_count=0`, `peer_position_ids=[]`, `peer_context_present=false`, `peer_reasoning_present=false`, a request-context fingerprint, and the correct seat contract version. The repaired blindness evaluator returns `PASS` independently for all four seats.

The sealed evidence fingerprint is `fnv1a:362a2671` before and after execution. No unknown accepted evidence IDs exist. Position lock occurs at event sequence 16 after all four Round-1 positions were proposed and completed; Round-1 position immutability passes.

### Deliberation and audit

The persisted pre-challenge state contains four material, open disagreements: `CONFIDENCE`, `RECOMMENDATION`, `ASSUMPTION`, and `CONTROL_EFFECTIVENESS`. Canonical challenge admission records two provider candidates, two DTO-valid, semantic-valid, compatible, deduplicated, selected, and admitted candidates. Both are admitted within the one-round, per-disagreement, total, and per-target-seat limits.

There are two live challenge responses: APOLLO `DEFEND` and HADES `REVISE`. The Round-2 privacy boundary passes. One revision was created with valid immutable lineage; concessions, evidence requests, and abstentions are zero. Post-challenge reevaluation records four open, zero narrowed, and zero resolved disagreements. Open disagreement preservation, false-consensus prevention, and minority-position preservation pass. No external research was triggered.

The deterministic post-challenge APOLLO audit records ten findings, zero blockers, one warning, zero citation failures, zero evidence-integrity failures, and zero authority violations. This audit is distinct from APOLLO’s successful independent Round-1 seat.

Zeus is disabled and not called; the persisted Zeus readiness gate is `PASS`. Human decision remains `PENDING` with zero authority violations. Event ordering, artifact-only replay, secret scanning, and hidden-reasoning scanning pass. No synthesis or human-decision completion event exists.

Final recertification result:

- `SWARM_2_PHASE_5H_FINAL_LIVE_CERTIFICATION = PASS`.
- `FULL_BOUNDED_LIVE_ADVERSARIAL_ROUND_CERTIFICATION = PASS`.
- `PHASE_5_ADVERSARIAL_DELIBERATION = COMPLETE`.
- `READY_FOR_PHASE_6_ZEUS_SYNTHESIS_PREP = YES`.
- `LIVE_NETWORK_CALLS_DURING_CERTIFICATION = 0`.
- `LIVE_PROVIDER_CALLS_DURING_CERTIFICATION = 0`.
- `REAL_MODEL_CALLS_DURING_CERTIFICATION = 0`.

The focused artifact-certification suite passes `2/2`; the full suite passes `1,105/1,105`. Typecheck, snapshot check, build, and diff check pass. No commit, push, staging, reset, or clean operation was performed. All previous failed artifacts remain preserved, including the original Phase 5H failure.
