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

---

## Close-out

Every phase landed, one commit each, each ending typecheck → test → build. At close: **643 tests across
49 files, 0 failing**, typecheck clean, build clean, entry chunk 477.77 kB / 145.49 kB gzip.

| phase | commit | what actually shipped |
|---|---|---|
| A | `d3836d4` | this audit |
| B | `b8b438c` | `src/visual/`: `SystemState`, event derivation, motion gates, tokens, `console.css` |
| C | `c3ec2b4` | the command centre: one core, seven stations, one ring geometry |
| D | `f063b8a` | the frame on the cursor drives every mark; visual replay proven deterministic |
| E | `cf304be` | the evidence inspector |
| F | `7c8e093` | the form stops being freight-shaped; packs are scored, not looked up |
| G | `194a0a1` | internal knowledge gets a screen (12) |
| H | `eae89c8` | the research pipeline gets a caller and reaches the real internet (13) |
| I | `b5047c5` | the knowledge delta ledger and the approval gate get a human (14) |
| J | `22daa9a` | SENTINEL, PULSE and ORBIT become marks as well as lists |
| K | `a21d95c` | four screens route-lazy, phone layout, skip link, live region, CSS reduced-motion gate |
| L | this commit | README and docs corrected against the code |

### The honest list, revisited

Section D listed six gaps. Four are closed, two are not, and both remaining ones are architectural
rather than unfinished work:

1. ~~The research pipeline has no live caller.~~ **Closed in H.** `core/research/session.ts` composes
   plan → execute → normalize → delta, and `app/lib/research.ts` wires it to the browser. It is
   deliberately *not* inside `investigate()`: that function's byte-for-byte reproducibility is asserted
   for both packs, and a live network cannot live inside a reproducible run.
2. ~~The question form is freight-shaped.~~ **Closed in F.** Geography and mode are optional, an empty
   scope means no filter, and the open pack is reachable from the form.
3. **Pack vocabulary is only partly consumed.** `relevance_terms` now drives pack recommendation
   (`core/packs/recommend.ts`), and `min_relevance`, `category_rules`, `geo_rules` and `mode_rules` are
   read through the pack. `toRawSignal()` in `integrations/fomo.ts` still classifies with the
   module-level freight constants, which is why the freight pack references those constants rather than
   restating them — one source, but read in two places. Still open.
4. ~~No Knowledge Delta UI.~~ **Closed in I**, including the approval gate and the plain statement that
   approval builds a session pack and cannot write the pinned snapshot.
5. **DEFENSE is unreachable by a live run; REBUTTAL has no resolver.** Unchanged, and disclosed in the
   README. Nothing in the pipeline moves an objection off `open`, so nothing defends against one.
6. **No agent personality layer.** Unchanged. Codenames and accents exist; tone does not, and a tone
   layer that paraphrased an agent's own words would be the first place a fabrication could hide.

### The gap this evolution added

**No screen in this evolution has been checked in a browser.** The browser tool available during the
build timed out on every call, so the arcs, rings, lanes and the phone layout are verified only by
typecheck, build, and tests that render or read the markup. That is enough to prove the wiring and the
arithmetic and it is not enough to prove the layout. It is stated in the README under honest
limitations rather than left for a reader to discover.
