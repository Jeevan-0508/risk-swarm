# RISK//SWARM Phase 2A — AI Risk Manager

## 1. Purpose

Phase 2A adds the first genuine professional specialist: `ai-risk-manager` version `1.0.0`. It is an advisory model-backed reasoning seam over a bounded projection of existing SWARM evidence.

The specialist does not retrieve, create evidence, mutate the evidence graph, change source tiers, approve a decision, or replace the deterministic SWARM spine.

## 2. Architecture

The implementation is core-only and post-analysis optional:

```text
completed RunResult
  -> bounded SpecialistEvidencePackage
  -> AI Risk Manager prompt and one Reasoner call
  -> strict validation and citation/authority checks
  -> SpecialistRun
  -> optional RunResult.specialists collection
```

`withSpecialist()` attaches a completed specialist record without changing the canonical graph. `investigate()` remains valid with `specialists: []`; no API key is required for the deterministic investigation.

## 3. Specialist Contract

The reusable `SpecialistContract<T>` defines:

- identity, version, name, description, and mandate;
- allowed and prohibited actions;
- required and optional inputs;
- a Zod output schema;
- advisory authority;
- evidence and abstention policy.

The AI Risk Manager contract is exported as `AI_RISK_MANAGER_CONTRACT` and is the reference implementation for future specialists. No other specialist was added.

## 4. Authority Model

Allowed actions are limited to assessment, risk and control-gap identification, hypothesis formation, assumption challenge, evidence requests, control/monitoring/escalation recommendations, and abstention.

The contract explicitly prohibits evidence mutation or creation, evidence re-tiering, unsupported facts, legal-compliance claims, regulatory certainty, approval/rejection of final decisions, Red Team/Sentinel/publication overrides, disagreement suppression, hidden uncertainty, and invented citations.

The output schema contains no approval or rejection authority field. A defense-in-depth validator also rejects authority-claiming output text.

## 5. Evidence Package

`SpecialistEvidencePackage` is a detached, deeply frozen projection containing investigation id, exact question, domain, scope, bounded evidence references, known uncertainties/conflicts/gaps, provenance summary, and generation time.

Each reference carries only the specialist-facing fields: evidence id, source type and identity, title, bounded excerpt, observed/retrieved dates, tier, relevance, and incident-claim flag. The default bound is 32 evidence items and 900 characters per excerpt.

`buildSpecialistEvidencePackageFromRun()` projects existing `RiskGraph` evidence and deterministic uncertainties. It retains no graph reference and exposes no graph mutation API.

## 6. Prompt Boundary

The prompt separates role, mandate, authority, prohibitions, question, reasoning discipline, and output contract from JSON-fenced evidence data blocks.

Retrieved text is explicitly untrusted data. Hostile text such as `IGNORE ALL PREVIOUS INSTRUCTIONS` is placed only inside `EVIDENCE_DATA_JSON`; it cannot become specialist instruction text.

## 7. Output Schema

The AI Risk Manager output is strict Zod data with bounded vocabularies:

- `ASSESSED` or `ABSTAINED` status;
- executive summary and bounded findings;
- bounded risk level: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, or `UNDETERMINED`;
- bounded confidence in `[0, 1]`;
- first-class uncertainty;
- evidence gaps and conflicting evidence;
- control and monitoring recommendations;
- advisory escalation recommendation;
- explicit abstention object.

Runtime identity and execution metadata are attached by the runner, not accepted from model output.

## 8. Abstention

`ABSTAINED` means the model executed successfully, returned valid structured output, and responsibly declined. It requires an abstention reason and `overall_risk: UNDETERMINED`.

`UNAVAILABLE` means the specialist did not produce a usable assessment because it was disabled, the provider failed, the output was malformed, or validation rejected it. `UNAVAILABLE` always carries `assessment: null`.

## 9. Execution States

The specialist reuses Phase-1 `ModelExecution` semantics:

`model_called`, `provider`, `model_id`, `status`, `degraded`, `degraded_reason`, and `independent`.

A successful specialist assessment requires `model_called: true`, `status: SUCCESS`, `degraded: false`, and `independent: true`. Missing metadata or deterministic/fallback output is never promoted to a specialist assessment.

## 10. Validation

Validation rejects malformed JSON/schema, unknown risk levels, out-of-range confidence, duplicate finding ids, inconsistent abstention fields, assessed findings without citations, unsupported findings over empty evidence, missing-provenance assessed output, authority violations, and unknown evidence ids.

The specialist runner performs one bounded call. It does not retry, call another provider, or run an autonomous loop.

## 11. Citation Integrity

Every finding and conflict citation must resolve to an evidence id in the immutable package. Unknown ids fail the whole result; they are never silently removed.

The specialist has no field through which it can mint an evidence node or change evidence tier. Existing SWARM evidence remains the only evidence authority.

## 12. Failure Semantics

| Condition | Specialist result |
|---|---|
| No reasoner configured | `UNAVAILABLE`, `DISABLED`, `assessment: null` |
| Provider timeout/error | `UNAVAILABLE`, degraded/failed execution, `assessment: null` |
| HTTP 200 with empty content | `UNAVAILABLE`, `assessment: null` |
| Malformed or invalid structured output | `UNAVAILABLE`, validation failure, `assessment: null` |
| Successful responsible decline | `ABSTAINED`, valid assessment, `SUCCESS`, independent |
| Successful supported analysis | `ASSESSED`, valid assessment, `SUCCESS`, independent |

No deterministic AI Risk Manager prose is returned on failure. The deterministic SWARM investigation remains independent and can continue without the specialist.

## 13. Adversarial Tests

The specialist suite contains 17 focused tests covering hostile evidence injection, fabricated citations, confidence `1.5`, unknown risk level, legal-compliance/approval claims, empty evidence, one-source starvation, contradictory evidence, irrelevant/out-of-mandate input, missing provenance, provider failure, malformed JSON, HTTP-200 empty content, evidence minting, graph isolation, adapter success, and optional persistence.

The existing Phase-1 adversarial and reasoner suites remain part of the full repository suite.

## 14. Evidence Starvation

An empty package cannot produce a risk finding. The validator permits an explicit successful abstention and permits only `UNDETERMINED` assessed output without findings; a high-risk finding over no evidence is rejected.

The test exercises both rejected unsupported assessment and successful model abstention.

## 15. Contradiction Test

Two evidence references—one describing universal human review and another describing production finalization without review—are preserved together in `conflicting_evidence`, with both ids cited and uncertainty raised to `HIGH`.

The specialist is not allowed to silently select one source.

## 16. Supported Risk Test

The successful fixture assessment cites supplied evidence, identifies a human-oversight control gap, assigns a bounded `HIGH` risk, states uncertainty, recommends controls and monitoring, and recommends advisory escalation. It does not approve or reject deployment.

This is an engineering proof of the successful model-shaped contract. It is not a claim of live provider execution.

## 17. Persistence

`RunResult.specialists` is an extensible `SpecialistRun[]` collection. `serializeRun()` stores it and `deserializeRun()` restores it. The field defaults to `[]`, so a Phase-1 record at the current store version that predates the optional field remains readable.

The specialist result is not mixed invisibly into deterministic findings or the decision object.

## 18. Observability

Every `SpecialistRun` records specialist id/version, provider, model, start/completion timestamps, duration, model-called status, execution status, abstention, validation status, evidence count, and cited-evidence count.

Keys and credentials are never included. Existing provider adapters continue to sanitize provider errors.

## 19. Real Model Proof

`REAL_MODEL_PROOF = UNVERIFIED`.

No valid provider credential was present in the environment, so no live model call was attempted and no live result is claimed. The existing OpenAI-compatible reasoner adapter was exercised with a controlled successful response and failure responses; that proves the real adapter seam, not live model availability.

## 20. Test Results

Phase-2A verification after implementation:

- `bun test`: 70 files, 891 passed, 0 failed, 0 skipped, 5794 expectations, approximately 5.69s.
- Specialist-focused tests: 17 passed, 0 failed, 65 expectations.
- `bun run typecheck`: passed.
- `bun run snapshot:check`: passed before final documentation-only changes.
- `bun run build`: passed at the Phase-1 baseline and is rerun for the final Phase-2A gate.
- `git diff --check`: passed aside from expected Windows LF/CRLF warnings.

## 21. Known Limitations

- Live model execution is unverified because no credential was available; this is intentionally not simulated.
- The specialist is core-only in Phase 2A. No UI section was added, avoiding a visual redesign and keeping unavailable results from being misrepresented by an existing screen.
- The specialist is post-analysis optional rather than automatically invoked by every investigation. Callers must explicitly build a package, run the specialist, and attach the result.
- There is one specialist and one bounded call; no specialist debate, dynamic routing, autonomous tools, web retrieval, MESH, or Calypso integration exists.
- Authority validation is defense in depth over structured fields and output text; it is not a legal-compliance engine and makes no regulatory applicability determination.

## 22. Phase-3 Readiness

Engineering readiness is `PARTIAL`: the reusable contract and failure-safe reference implementation are present, but live model proof remains unverified. Phase 3 should begin only after review of the immutable evidence seam, authority validator, persistence shape, and one-call execution policy.

Future specialists must reuse `SpecialistContract`, `SpecialistEvidencePackage`, `SpecialistRun`, and the same fail-closed validation semantics. No additional specialist belongs in this phase.

**Phase 2A status: PARTIAL — implementation gates pass; `REAL_MODEL_PROOF` is UNVERIFIED.**
