# EVOLUTION 6.0 — OLYMPIAN COUNCIL — audit + Phase-1 plan

Standing mandate: the user's 28-section "OLYMPIAN COUNCIL" master prompt, narrowed by his own
follow-up authorization to a single proof slice. This document is the Phase-0 audit the follow-up
requires, plus the Phase-1 plan. Written before Phase-1 code, per the same discipline EVOLUTION 2.0
through 5.0 already used every time.

## The one fact that governs everything below

**RISK//SWARM makes zero live LLM calls today, by deliberate five-evolution design.**
`core/reasoner/llm.ts` (bring-your-own-key, one endpoint, one model) is fully built, tested
(`reasoner.test.ts`), and never instantiated by the running app — the only production call site is
`core/agents/analyst.ts`, which uses it to *reword an already-computed, already-validated hypothesis
statement*, never to decide anything. Every one of the 7 agents (`scout/intelligence/analyst/
governance/challenger/redteam/decision`) is a pure deterministic function. `reasoner/types.ts`'s own
doc comment: "A model, when configured, may only replace phrasing or add candidate wording inside a
structure the agent already built and validated." EVOLUTION-5.0's honest-gaps list: "No agent
personality layer... a tone layer that paraphrased an agent's own words would be the first place a
fabrication could hide."

EVOLUTION-6.0 is the intentional, explicit reversal of that one rule, for a new, separate code path
only: **let the model decide the position, not just the wording** — for the open-domain question path,
never for the freight/fraud `investigate()` pipeline, which stays untouched.

## Phase 0 audit — WHAT EXISTS / REUSABLE / MUST CHANGE / MUST STAY DETERMINISTIC

### WHAT EXISTS (reusable as-is)
- `core/reasoner/types.ts` — `Reasoner`/`ReasonRequest`/`ReasonResult`, `citedIds`/
  `assertNoFabricatedCitations`. This is already exactly the "LLM output adapter" the follow-up brief's
  §12/§13 asks for: structured request in, validated+fabrication-guarded structured result out,
  deterministic fallback on any failure. **Council positions and the Zeus verdict will be requested
  through this exact interface — no second mechanism.**
- `core/reasoner/llm.ts` — generic OpenAI-compatible chat-completions caller (bearer auth,
  `/chat/completions` shape). Covers OpenAI and OpenRouter unchanged (both speak this exact API);
  only `endpoint`/`model`/key differ.
- `core/reasoner/deterministic.ts` — the safety net for "no key configured" / "model disabled."
- `core/research/session.ts` → `ResearchOutcome.merged.items` — already-retrieved, already-normalised,
  already-provenance-tagged evidence (`EV-###`-style ids matching `citedIds`'s pattern). This is the
  only evidence an Olympian is allowed to cite; an LLM-invented URL is never evidence (brief §13).
- `app/screens/Research.tsx` ("Ask the Swarm") — the open-domain question screen, already calling
  `runResearch()` then a synthesiser (`deliberateOpenResearch`, regex-based). Council mode is a second
  synthesiser offered from the same retrieved evidence, not a new question flow.
- `app/lib/persist.ts` — guarded-localStorage pattern (`try/catch`, degrade to memory, `risk-swarm:`
  key prefix). Model keys and agent/model assignments use the same pattern, not zustand's `persist`
  middleware, for consistency with the one localStorage convention this repo already has.
- Pantheon codenames/personas (`showcase/gods.ts`) — raw material for the four Phase-1 personas.

### WHAT MUST CHANGE (new, additive)
- A **provider abstraction wider than one endpoint**: OpenAI, OpenRouter (both reuse `llm.ts`
  unchanged) and Google Gemini (different request/response shape — new `core/reasoner/gemini.ts`).
- A **model registry**: agent → provider → model → enabled, with a getter for a per-provider key. New
  `core/reasoner/registry.ts`.
- A **Council layer for open-domain questions**: three Olympians reason independently over the same
  retrieved evidence, a fourth (Zeus) synthesises. New `core/council/`. This is not the existing
  `/council` route (`src/council/`), which renders a *completed freight run's* deterministic
  deliberation transcript — a different, untouched consumer of a different, untouched pipeline.
- A **key-entry + model-assignment UI**. New screen (`ModelConfig.tsx`), because there is currently no
  UI anywhere in the app that accepts an API key.

### WHAT MUST STAY DETERMINISTIC (do not touch)
- `core/orchestrator/run.ts`, all 7 freight agents, `scoring/score.ts`, `scoring/policy.ts`,
  `core/deliberation/coordinator.ts`, `core/domain/graph.ts`, SENTINEL/PULSE/ORBIT, the existing
  `/council` route. None of this evolution's code is imported by any of them.
- `deliberateOpenResearch` (regex path) — stays as the zero-key, zero-network, byte-reproducible
  fallback. Council mode is additive, never a replacement.

### WHAT CANNOT BE DONE CLIENT-SIDE (GitHub Pages, no backend, no secret store)
- A real gateway process (LiteLLM et al.) — it is a server. Not available.
- Storing a key anywhere other than the user's own browser. Not available, not attempted.
- Anthropic's ordinary API — blocks browser CORS without its `anthropic-dangerous-direct-browser-
  access` beta header, which still means shipping the user's raw key into every browser request
  exactly like every other provider here; deferred to Phase 2, not because it is impossible, but
  because it needs its own adapter and its own honest warning copy, and Phase 1's budget is 3
  providers.
- Ollama/vLLM — only reachable if the user's own local server has CORS enabled for this origin.
  Explicitly out of Phase 1 per the follow-up's own §21.

### WHAT REQUIRES USER-PROVIDED API KEYS / CORS
All three Phase-1 providers (OpenAI, OpenRouter, Google) support a direct browser `fetch` with the
user's own key attached client-side. None of the three keys ever leaves the browser except straight to
that provider's own API host. `ModelConfig.tsx` says this in plain language before the first key field,
per the follow-up's §6.

## Phase-1 architecture (this evolution's slice only)

```
question ──▶ runResearch() [unchanged] ──▶ retrieved, validated evidence
                                                  │
                        ┌─────────────────────────┼─────────────────────────┐
                        ▼                         ▼                         ▼
                    ATHENA.propose()         ARES.propose()            HADES.propose()
                 (independent Reasoner)   (independent Reasoner)   (independent Reasoner)
                        │                         │                         │
                        └─────────────────────────┼─────────────────────────┘
                                                  ▼
                                  assessDisagreement() [pure, new, small]
                                                  │
                                                  ▼
                                     ZEUS.propose() — verdict, given
                                     positions + disagreement + evidence,
                                     never the others' hidden reasoning
                                                  │
                                                  ▼
                                        CouncilVerdict → Research.tsx
```

Four model calls maximum per question (`MAX_OLYMPIAN_CALLS = 4`), no debate rounds yet — Round 1
(independent investigation) through Round 8 (Zeus verdict) of the 8-round pipeline collapse into this
one pass for Phase 1, exactly the slice the follow-up authorized. Rounds 2-7 (opening statements as a
first-class UI moment, live challenge/concede/revise exchanges, targeted re-research on disputed
claims) are named, not built — Phase 2 candidate.

## Phase map

| Phase | What | Where | Status |
|---|---|---|---|
| 1a | Shared prompt/JSON-extraction helpers factored out of `llm.ts` (no behavior change) | `core/reasoner/shared.ts` | build now |
| 1b | Gemini adapter, same `Reasoner` contract | `core/reasoner/gemini.ts` | build now |
| 1c | Provider/model registry, agent→reasoner wiring, deterministic fallback when disabled/no key | `core/reasoner/registry.ts` | build now |
| 1d | Olympian personas + structured position request/validate/fabrication-guard | `core/council/positions.ts` | build now |
| 1e | Disagreement assessment (stance grouping + confidence variance) + Zeus verdict request | `core/council/deliberate.ts` | build now |
| 1f | Orchestration: independent calls, real trace events, per-agent failure isolation | `core/council/run.ts` | build now |
| 1g | Key entry + provider/model assignment UI, guarded localStorage, model-diversity readout | `app/store/models.ts`, `app/screens/ModelConfig.tsx` | build now |
| 1h | Wire into "Ask the Swarm": Council Mode toggle, positions panel, verdict panel, trace panel | `app/screens/Research.tsx` | build now |
| 1i | Tests: registry selection/fallback, independence, disagreement (agree + disagree cases), Zeus synthesis, no-key-leak, malformed-output, provider failure isolation | `core/reasoner/*.test.ts`, `core/council/*.test.ts` | build now |
| 1j | typecheck → test → build → Phase-1 validation report | — | after 1a-1i |

## Non-negotiables carried over from the follow-up brief, restated

- No fake conversation: every Council event this evolution emits corresponds to a real `propose()`
  call and its real result.
- No manufactured consensus: `assessDisagreement` reports what the three positions actually said; Zeus
  is given that report, not told to produce agreement.
- No fabricated evidence: `assertNoFabricatedCitations` (already-existing, unmodified) rejects any
  position that cites an id `runResearch()` never produced. This is enforced by the same `propose()`
  path every existing agent already uses — not reimplemented.
- Honest failure: one Olympian's provider timeout/CORS/malformed-JSON degrades that Olympian to its
  deterministic fallback with `degraded: true` and a stated reason. It never silently disappears and
  never fabricates a position.
- No key ever leaves the browser except to its own provider; no key is ever interpolated into a log,
  error, or thrown message (same discipline `llm.ts`'s existing tests already enforce, extended to the
  new Gemini path).
