# RISK//SWARM 2.0 Phase 3 — Model Runtime & Provider Fabric

## Status

**NO LIVE MODEL CALL WAS MADE DURING PHASE 3 IMPLEMENTATION.**

**THE SWARM 2 COUNCIL IS STILL FIXTURE-BACKED.**

Phase 3 adds an isolated, provider-neutral runtime under `src/swarm/models/`. It proves the socket between a future seat and replaceable model infrastructure without dispatching Athena, Ares, Hades, Apollo, or Zeus through it. The Phase 2 offline runner remains unchanged in behavior and continues to use `FixtureSeatExecutor`.

## Architecture

```text
ModelSeatExecutor (generic test task only)
             |
        ModelRouter
             |
        ModelRuntime
             |
      ProviderAdapter
             |
    MockProviderAdapter       FetchTransport (injectable transport only)
```

The layers have distinct responsibilities:

- A seat executor knows only its generic task and the runtime seam. It does not know Gemini/OpenAI HTTP details or create `AgentPosition` records.
- `ModelRequest` contains request identity, purpose, task instructions, bounded context, output-schema descriptor, model requirements, timeout, and optional cancellation signal. It contains no credential, URL, authorization header, or provider payload.
- `ModelRouter` validates capabilities, chooses the primary, applies explicit retry and fallback policy, preserves every attempt, and records requested versus executed identity.
- `ModelRuntime` resolves injected credentials, calls the selected adapter, normalizes provider status, validates structured output, sanitizes diagnostics, and rejects late success after cancellation.
- `ProviderAdapter` returns normalized provider execution facts. It never emits `AgentPosition` and never knows seat mandates.

## Model identity and capabilities

`ModelRef` keeps `provider` and `model` as separate fields. Capabilities include text generation, structured output, JSON mode, tool calling, and streaming. Capability metadata carries a source: `CONFIGURED`, `DISCOVERED`, or `VERIFIED`. A listed model is not treated as verified execution, and healthy observation is not treated as proof that structured output works.

## Router, retries, fallback, and circuit breaker

`ModelExecutionPlan` names one primary model, optional fallback models, required capabilities, fallback enablement, allowed fallback failure codes, retry policy, and optional minimum health metadata.

Fallback is explicit and preserves:

- requested provider/model;
- executed provider/model;
- `fallback_used`;
- `fallback_reason`;
- immutable `ModelAttempt[]` history.

Authentication, authorization, model-not-found, capability mismatch, and structured-output failures do not silently trigger fallback. Retry candidates are explicit and bounded; the scheduler is injected and tests do not sleep.

`CircuitBreaker` is in-memory, provider/model scoped, clock-injected, and has `CLOSED`, `OPEN`, and `HALF_OPEN` states. Only infrastructure-style failures count toward the threshold. Schema-invalid model output does not count as provider infrastructure outage. There is no background timer or polling loop.

## Error and failure-stage vocabulary

Stable error codes include authentication, authorization, model-not-found, capability mismatch, rate-limited, timeout, network, provider unavailable, provider HTTP error, response parse error, empty response, structured-output invalid, cancelled, and unknown provider error.

Failure stages include routing, capability check, request build, request, HTTP, response parse, response normalization, structured validation, and complete. Provider-specific strings are never control-flow conditions and are not copied into safe diagnostics.

## Structured output

Provider output is normalized to text or structured data before generic schema validation. The processor supports:

- direct JSON;
- one explicit JSON code fence when enabled;
- one clearly bounded JSON object/array when enabled.

It rejects invalid JSON, ambiguous multiple objects, missing fields, wrong types, and strict-schema extras. It does not invent fields, guess citations, or semantically repair model text. The generic Phase 3 task validates only `{ summary: string, confidence: number }` with optional explicit abstention fields; it is not a risk-seat schema.

## Credentials and transport

Credential acquisition is injected through `CredentialResolver`. A resolver may serve browser, server, CLI, test, or future secret-manager storage without changing adapters. Credentials are never placed in `ModelRequest`, `ModelResponse`, `ModelAttempt`, runtime events, Phase 2 events, or errors. The runtime passes a credential only through an internal adapter context.

`HttpTransport` separates transport from adapters. `FetchTransport` is available for a future isolated adapter, while `MockTransport` is used by tests. The Phase 3 runtime has no registered real provider adapter and no test uses network access.

Existing browser `localStorage` model configuration remains legacy application behavior. Phase 3 does not read it, change it, or make the new runtime depend on it.

## Health and discovery

`HealthStore` records scoped observations with provider, optional model, source, timestamp, status, and reason code. It has no polling or timer. Mock discovery reports models as `LISTED`; it does not label them `EXECUTION_VERIFIED`. A health observation is not a permanent truth and is not automatically used as a model certification claim.

## Observability and usage

Runtime events expose routing started, attempt started, attempt failed, retry scheduled, fallback selected, attempt succeeded, and execution completed. They carry request/model identity and stable failure metadata only. Attempts may carry provider-reported token counts and externally supplied cost metadata; no provider pricing is embedded.

`analyzeExecutionDiversity` reports unique executed models/providers, fallback count, and repeated-model facts without inventing an independence score. A mock execution intentionally reports `real_model_called = false` and `independent = false`; only a future adapter may assert real model invocation.

## Cancellation and concurrency

Every request can carry an `AbortSignal`. The runtime checks cancellation after adapter resolution so a late transport result cannot become `SUCCESS`. Runtime state is request-local; concurrent requests use separate normalized outputs and attempt histories.

## ModelSeatExecutor bridge

`ModelSeatExecutor` implements the existing Phase 2 `SeatExecutor` method shape but returns a generic runtime result for isolated certification. It does not create positions, does not contain Athena/Ares/Hades/Apollo prompts, and is not connected to `runOfflineSwarmCase`. Phase 4 may define seat-specific tasks and an explicit bridge from validated model output to seat contracts.

## Future certification harness

`scripts/certify-swarm-model-runtime.mjs` is a manual-only future harness. It reads explicitly configured provider/model/endpoint/credential settings, reports only sanitized result categories, and allows at most one primary call plus one explicitly configured fallback call for retryable infrastructure failures. It was created but **not executed** during Phase 3. It makes no Council call and makes no certification claim.

## Security and test strategy

The focused Phase 3 tests cover successful structured output, empty/malformed/schema-invalid responses, 400/401/403/404/408/429/500/503-like failures, network and provider exceptions, cancellation, capability checks, retries, fallback, requested/executed identity, immutable attempt history, circuit transitions, discovery versus health, structured extraction, concurrent requests, injectable transport, generic seat bridging, and synthetic secret serialization. The synthetic credential `SWARM_TEST_SECRET_DO_NOT_LEAK` is asserted absent from serialized runtime records.

No chain-of-thought, hidden reasoning, raw provider body, authorization header, credential-bearing URL, or API key is persisted by the runtime.

## Legacy provider migration report

| Legacy component | Current path | Decision | Reason |
|---|---|---|---|
| Provider-neutral reasoner types | `src/core/reasoner/types.ts` | ADAPT later | Useful execution vocabulary, but the Phase 3 runtime needs its own versioned provider-neutral contracts and attempt history. |
| Gemini reasoner | `src/core/reasoner/gemini.ts` | DEFER / ADAPT later | Existing key seam and diagnostics are valuable historical input; it is not imported or changed by Phase 3. A future adapter must use `ProviderAdapter` and injected transport. |
| OpenAI-compatible reasoner | `src/core/reasoner/llm.ts` | DEFER / ADAPT later | Existing behavior remains legacy. Provider-specific request/response traversal must be isolated behind the new adapter interface. |
| Reasoner registry and browser model storage | `src/core/reasoner/registry.ts`, `src/app/lib/models.ts`, `src/app/store/models.ts` | DEFER | Configuration and credentials must not become seat assignment or runtime storage implicitly. |
| Specialist framework | `src/core/specialists/` | REUSE boundary concepts | Immutable evidence, validation, and advisory authority are good precedents; no specialist semantic contract was changed. |
| AI Risk Manager | `src/core/specialists/ai-risk-manager/` | DEFER | It remains a legacy specialist and is not renamed into a SWARM seat. |
| Laya/Jev | `src/core/system1/` | DEFER | They remain System-1 integrations, explicitly outside Phase 3 model infrastructure. |

No legacy provider or production specialist behavior was modified.

## Known limitations

- No real provider adapter is registered in Phase 3; the mock adapter is the only executable provider implementation.
- Capability discovery and health are observations, not certification.
- Cost is metadata only; no pricing table or estimate is included.
- The manual harness is intentionally not a certification runner and was not executed.
- Seat-specific prompts, schemas, Council integration, UI, Laya, Jev, MESH, and Calypso remain deferred to later phases.
