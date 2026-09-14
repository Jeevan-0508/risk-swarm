# EVOLUTION 5.0 — RISK//SWARM INTELLIGENCE CONSOLE

## PHASE A — ARCHITECTURE AUDIT

Read-only pass. No code was changed to produce this. Every claim below was read out of the
repository at commit `07843c0`.

### A. What already works, and works honestly

| capability | where | evidence it is real |
|---|---|---|
| seven agents, fixed order | `core/agents/*`, `app/lib/agents.ts` | `AGENT_ORDER`, codenames HERMES/ATHENA/APOLLO/ZEUS/ARES/HADES/HEPHAESTUS |
| append-only evidence graph | `core/domain/graph.ts` | `isIntact()`, `cycles()`, re-`add()` throws |
| evidence provenance + hashing | `core/sources/*`, `core/research/normalize.ts` | `EvidenceProvenance` names provider, query, retrieval time, proxy flag |
| confidence gating | `core/scoring/*` | reference run returns `confidence: null` + a blocked reason |
| SENTINEL, 12 checks | `core/sentinel/sentinel.ts` | `run.test.ts` pins the warning list to exactly `['duplicate_integrity']` |
| PULSE, 10 checks | `core/pulse/pulse.ts` | `pulse.test.ts` pins the key list |
| ORBIT, 5 scenarios, 14 diff fields | `core/orbit/orbit.ts` | `orbit.test.ts` pins the field list |
| deterministic replay | `council/replay.ts` | test asserts the orchestrator and coordinator are *absent* from its import graph |
| byte-for-byte reproducibility | `core/orchestrator/run.test.ts` | asserted for the freight pack **and** the open pack |
| budget enforcement | `core/agents/harness.ts` | `BudgetExceededError` on a too-small budget |
| human decision gate | `app/store/session.ts` `human` | persisted with the run |
| adversarial defences | `core/adversarial/*` | prompt-injection, store tampering, retry bounds |
| deliberation, 12 event types | `core/deliberation/coordinator.ts` | events carry `sequence`, `parent_event_id`, filtered evidence ids |
| knowledge packs + participation | `core/packs/*`, `core/orchestrator/participation.ts` | SENTINEL check 12 blocks a stood-down agent that minted nodes |
| research providers | `core/research/providers/registry.ts` | 8 providers, each verified against its live endpoint once |
| knowledge delta + approval | `core/knowledge/{delta,approval}.ts` | 7 validation gates, `MIN_DISTINCT_SOURCES = 2`, canonical pack never mutated in place |

**527 tests / 37 files / 0 failing. `typecheck` clean. `build` clean.**

### B. What is deterministic

`investigate()` end to end under a fixed `now` and `run_id`; question routing; research planning;
delta proposal; approval validation; every `council/derive.ts` reduction; replay. Determinism is
asserted, not assumed.

### C. What is merely presentation

`council/derive.ts` (pure reductions, no clock, no randomness), `EVENT_TONE`/`TONE_COLOR`,
`OUTCOME_NOTE`, `app/ui/kit.tsx`, `showcase/Motifs.tsx`, all three stylesheets. None of it can
construct a `DeliberationEvent` — enforced by test, not by convention.

### D. What is currently mocked or unreached — the honest list

1. **The whole research pipeline has no live caller.** `core/research/{plan,execute,normalize}` and
   `core/knowledge/{delta,approval}` are tested and buildable. `investigate()` never calls them.
   `app/lib/engine.ts` still runs the pre-Phase-4 demo path with 3 hardcoded freight search terms.
2. **The question form is freight-shaped.** `NewInvestigation.tsx` requires `geo[]` and `mode[]` and
   will not submit without them. So today **the user cannot ask a question outside freight/fraud**
   through the UI, even though `routeQuestion()` and `openPack()` exist and are tested.
3. **Pack vocabulary is declared but not consumed.** `relevance_terms`, `geo_rules`, `mode_rules`,
   `lexicon` have no reader; `toRawSignal()` still classifies with the module-level freight constants.
4. **No Knowledge Delta UI at all.** `delta.ts` has no screen.
5. **DEFENSE is unreachable by a live run; REBUTTAL has no resolver.** Recorded when phase 6 closed.
6. **No agent personality layer.** Codenames and accents exist; tone does not.

### E. What cannot work on static GitHub Pages

Anything needing a secret, a server or a cross-origin POST. Of the 12 endpoints probed in EVOLUTION
4.0, 8 answered from the browser and 4 (GDELT, EUR-Lex, arXiv, Google News) were CORS-blocked and are
reachable only through an opt-in reader proxy. **LIVE mode must therefore be able to say
"unavailable, and here is the reason" — and it already can:** `scout.ts` emits `SEARCH_FAILED` and
PULSE's `retrieval_health` reads the real retrieval record. That machinery exists and is unexposed.

### F. Where external retrieval can realistically be introduced

`core/research/execute.ts` already is the provider-agnostic seam, with a budget and per-provider
failure recording. What is missing is a *caller*: `app/lib/engine.ts` in LIVE mode.

### G. Where knowledge updates can safely occur

Only through `proposeDelta()` → `ResearchLedger` → `proposeTaxonomyChange()` → `validateProposal()`
→ `approveProposal()`, which returns a **new** pack and throws `ApprovalRefused` otherwise. Canonical
snapshots under `public/snapshots/` stay immutable. This is already correct and needs a UI, not a
redesign.

### H. Architectural foundations — do not casually rewrite

`core/domain/{model,graph}.ts` · `core/orchestrator/run.ts` · `core/agents/*` ·
`core/deliberation/coordinator.ts` · `core/{sentinel,pulse,orbit}/*` · `core/persistence/serialize.ts` ·
`council/{derive,replay}.ts`. Each is load-bearing and each has an exact-key tripwire test.

### The finding that matters most

The visual complaint has a structural cause, not a styling cause. The Council is **one 800-line
component** rendering five zones, and there is no shared visual system: `styles.css` holds the console's
Tailwind layer, `council.css` holds 130 lines of chamber-specific CSS, `pantheon.css` a third set. There
are no visual primitives, no state→visual mapping, and no central core component. Restyling `Chamber.tsx`
would produce a prettier version of the same thing. What is missing is a **visual layer with its own
vocabulary, driven by engine state** — which is Phase B, and it has to come before Phase C.

### Phase plan

| phase | deliverable | risk |
|---|---|---|
| A | this audit | none |
| B | `src/visual/` design system: tokens, primitives, `SystemState`, `VisualEvent` derivation | none, additive |
| C | Council command centre — central core, seven stations, zone layout | medium: rewrites `Chamber.tsx` presentation only |
| D | event-driven replay visualisation, deterministic, reduced-motion respected | medium |
| E | evidence + decision lineage visualisation with a real inspector | medium |
| F | open-domain question bar; pack selection; drop the freight-shaped requirement | **high: touches engine entry** |
| G | internal knowledge retrieval surfaced | low |
| H | LIVE retrieval wired to `execute.ts`, with honest unavailability | **high: real network** |
| I | Knowledge Delta screen + approval workflow UI | medium |
| J | SENTINEL / PULSE / ORBIT visualisation | low |
| K | performance, accessibility, responsive | low |
| L | tests, README, polish | low |

Every phase ends `typecheck` → `test` → `build` → commit. No phase may leave a red test, a fabricated
capability, or a claim the code does not support.
