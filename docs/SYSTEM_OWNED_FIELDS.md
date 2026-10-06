# SYSTEM_OWNED_FIELDS audit

Phase 6B Zeus output is split into an untrusted provider body and a trusted canonical SWARM envelope.

| Path | Owner | Provider contract | Construction / verification |
| --- | --- | --- | --- |
| `synthesis_id` | SYSTEM | absent | Derived from canonical `case_id`; checked during conversion and replay |
| `case_id` | SYSTEM | absent | Copied from the sealed input; checked during conversion and replay |
| `seat_id` | SYSTEM | absent | Constant `ZEUS` |
| `execution.*` | SYSTEM | absent | Runtime request/response metadata, prompt and input fingerprints, retry/fallback constants, and reference-normalization audit are injected after parsing |
| `synthesis_fingerprint` | SYSTEM | absent; legacy injection rejected by strict schema | `zeusSynthesisFingerprint(canonical body)` after body, DTO, source-reference, semantic, disagreement, minority, Apollo, and authority validation; independently recomputed during replay |
| `human_decision_required` | SYSTEM | absent | Constant `true` |
| `human_decision_status` | SYSTEM | absent | Constant `PENDING` |
| `authority_statement` | SYSTEM | absent | Exact `ZEUS_AUTHORITY_CONTRACT` |
| protocol/event identity and timestamps | SYSTEM | absent | Owned by the reducer/runtime event path; never part of the provider body |

The provider owns only bounded synthesis semantics: summary, risks, controls, evidence assessment, agreements, disagreements, minority references, uncertainties, assumptions, evidence gaps, options, actions, escalations, audit summary, confidence, and canonical source references. The provider can propose source references, but SWARM resolves them against the closed input catalog and fails closed on unknown or duplicate references.

Audit result: `MODEL_OWNED_DETERMINISTIC_METADATA_COUNT=0`.
