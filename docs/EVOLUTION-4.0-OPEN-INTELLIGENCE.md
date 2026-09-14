# EVOLUTION 4.0 — OPEN INTELLIGENCE

Risk//Swarm becomes an open-ended research, deliberation and knowledge-evolution system **without
losing what it already is**: a freight-fraud risk instrument with an evidence graph, an integrity
layer, a health layer, an adversarial layer and a Council that narrates real disagreement.

This document is written before any code changes. Every claim in the audit below was read out of the
repository or measured, never assumed. Where a thing is not yet known it says so.

---

## PHASE 0 — ARCHITECTURE AUDIT

16,845 lines of TypeScript across `src/core` (engine), `src/app` (11 screens), `src/council`
(screen 12) and `src/showcase` (`/pantheon`).

### 1-6. Application, agents, registry, roles, lifecycle, RunResult

`investigate()` in `core/orchestrator/run.ts` (354 lines) is the whole lifecycle. It is a **fixed
seven-phase pipeline** with one rework loop:

```
discover(scout) → deduplicate(intelligence) → [ analyse(analyst) → govern(governance)
  → challenge(challenger) → red_team(redteam) ]* → decide(decision)
  → assemble(graph) → runDeliberation → runSentinel → runPulse
```

There is **no agent registry**. The seven agents are seven direct imports and seven inline `await`
calls (`run.ts:119-254`). Participation is unconditional: every agent runs on every question. The
order is hard-coded by control flow, not data.

`RunResult` (`run.ts:71-96`) is a closed record: `outputs` is an object with exactly seven named
keys. Adding a research phase means either adding a key or carrying it beside `outputs`.

Agents have **no prompts**. Each is a deterministic TypeScript function; a model may only rephrase
inside a structure the agent already built and validated (`reasoner/types.ts:1-11`). This is the
single most important fact in the repository for this evolution — see "What an LLM may not do".

### 7. ScoreResult

`core/scoring/score.ts` + `policy.ts`. Pure, deterministic, DO-NOT-TOUCH. The band comes from
evidence counts, gates and caps — never from narration.

### 8-10. SENTINEL / PULSE / ORBIT

- `runSentinel({ graph, snapshotFiles, deliberationEvents })` — evidence integrity over the graph
  that was actually built. Never affects the recommendation.
- `runPulse({ intelligence, governance, challenger, red_team, decision, policy, sentinel, spent,
  budget?, deliberation? })` — 10 health keys, asserted exactly in `pulse.test.ts:129`.
- `runOrbit` — adversarial scenarios through real system pathways. 12 field keys asserted exactly in
  `orbit.test.ts:79`.

`run.ts:275-277` already carries an **honest admission** that live retrieval is invisible to PULSE
because it is captured by a UI-only side channel. Phase 9 closes exactly that gap.

### 11-12. Council and deliberation

`core/deliberation/coordinator.ts` is a **pure single-pass synthesis over a completed run**. It
emits a sibling append-only `DeliberationEvent[]`, not graph nodes. This is why replay is free and
determinism automatic.

12 event types exist. The demo run produces **8 of 12**. DEFENSE and REBUTTAL are *structurally*
dormant: nothing in the coordinator moves an objection off `open`, so no agent ever answers a
challenge. REVISION and ESCALATION are merely run-dependent. Phase 6 must make DEFENSE/REBUTTAL
reachable **from real agent output**, or leave them dormant and say so.

**Phase 6 update:** one resolver now exists. The orchestrator's rework loop (`orchestrator/run.ts`)
drops a hypothesis when a *blocking, reworkable* red-team finding names it, and keeps that finding -
not deleted - with `resolution: 'accepted'` and the withdrawn hypothesis as a `superseded` node. The
coordinator's read side (Round 5) already turns that into an `AGREEMENT` event for real, no coordinator
change needed - `computeScore`/`unresolved_objections` were already resolution-aware, unexercised until
now. Said plainly: three of the four reworkable classes always target the run as a whole (never a
specific hypothesis, so rework never fires for them today); the fourth, `unsupported_claim`, targets a
hypothesis but no shipped pattern's `falsificationTest()` output is ever short enough to trip it. So
this resolver is real, deterministic, fully typed and covered on its read side by
`coordinator.test.ts`, but has not yet fired in any live run - honestly unreached, not fabricated.
`Challenge.resolution` and `RedTeamFinding.resolution === 'rebutted'` still have no resolver at all;
REBUTTAL stays structurally dormant. Closing that gap for real would mean a second agent examining a
challenge/objection and answering it from evidence already in the graph, which is a materially bigger
change than this phase's budget - left dormant and said so, per this doc's own rule.

### 13-14. Evidence and graph model

`core/domain/model.ts` + `graph.ts`. Append-only, superseding rather than mutating. `Evidence`
carries `source`, `source_type`, `url`, `publication_date`, `retrieved_at`, `claim`,
`excerpt_or_summary`, `reliability`, `relevance`, `injection_suspected`. **This model is already
domain-neutral.** No change is required to hold external research evidence — a significant finding.

### 15-16. Taxonomy and vocabulary — THE DOMAIN PRISON

Two distinct locks, in two different places, doing two different jobs:

**Lock A — the relevance gate.** `freightRelevance(title)` (`integrations/fomo.ts:167`) counts hits
against a **31-word freight vocabulary** (`FREIGHT_TERMS`, `fomo.ts:87-90`) and returns
`min(1, hits/3)`. Anything scoring under `minFreightRelevance ?? 0.34` is dropped as
`excluded_low_relevance` in **both** signal sources (`fomo.ts:220`, `sources/live.ts:105`,
`sources/live.ts:128`). A question about quantum computing loses 100% of its evidence here, before
any agent sees it.

**Lock B — the taxonomy match.** `runAnalyst` matches signals lexically against 12 pinned patterns
via `ctx.tools.atlas.matchLexical` (`agents/analyst.ts:70`), keyed by `PATTERN_LEXICON`
(`atlas.ts:79-93`). No match means no hypothesis, which means `analyst.findings` is empty, which
means the decision engine has nothing to name — the *"No pattern could be named from the evidence
retrieved"* the operator sees.

Supporting locks: `CATEGORY_RULES` (6 freight categories, `fomo.ts:78-85`), `GEO_RULES` (9
geographies, `fomo.ts:92-102`), `MODE_RULES` (5 transport modes, `fomo.ts:104-110`),
`REGULATOR_HOSTS` + `INDUSTRY_HOSTS` (freight/EU regulators only, `agents/types.ts:50-53`),
`BENIGN_CATEGORY = 'insolven'` (`run.ts:99`), `scopeBreadth()` normalising against "a nominal
ten-country, four-mode network" (`run.ts:298-302`).

### 17-18. Retrieval and LIVE mode

`SignalSource` (`sources/types.ts`) is a clean seam: `querySignals(query) → { signals, stats }` plus
`provenance()`. Two implementations: the pinned snapshot loader and `createLiveSource`.

**LIVE mode is broken in the browser, and the cause is now measured, not guessed.**
`liveSignalSource` (`app/lib/engine.ts:69-81`) calls `globalThis.fetch` directly on
`news.google.com/rss/search`. Google News sends no `Access-Control-Allow-Origin`, so the browser
kills the request. Verified in real Chromium page context: `TypeError: Failed to fetch`. The same
query from Node returns **17 usable signals** — the pipeline is fine, it has no legal path out of a
web page. Three of the four live sources (`regulatory`, `industry`, `web`) additionally ship **no
default endpoint at all** (`sources/registry.ts:37-70`) and report `not_configured`.

Worse for the operator: `scout.ts:92-98` raises uncertainties for truncation, low relevance and
category disagreement, **but says nothing when every feed failed**. A total retrieval failure is
silent. Regression fix in Phase 4.

Search terms are **never derived from the question** — the UI states this itself
(`NewInvestigation.tsx:157`): *"Sent verbatim to the news feed; nothing is inferred from the
question."* So the question today steers framing, not retrieval.

### 19. Repository knowledge sources

`public/snapshots/` already holds **three pinned domains**, not one:

| snapshot | content | consumed by |
|---|---|---|
| `freight-risk-atlas/taxonomy.json` | 12 fraud patterns, indicators, gates, countermeasures | APOLLO via `atlas.ts` |
| `ai-governance-control-room/controls.json` | EU AI Act controls (`C-01`, `E-01a`, …) | ZEUS via `integrations/governance.ts` |
| `fomo/` | signal feed | HERMES via `integrations/fomo.ts` |

ZEUS is therefore **already reasoning over a non-freight domain through the same machinery.** The
architecture is not freight-specific; only Locks A and B are. There is however **no generalized
internal retrieval**: each snapshot has its own bespoke typed reader. Phase 3 adds one.

### 20. External search capabilities — MEASURED TODAY

Every candidate was called from real Chromium page context against `localhost:5173`. This table is
the empirical basis of the entire external layer; nothing here is assumed.

| provider | endpoint | result | use |
|---|---|---|---|
| Wikipedia search | `en.wikipedia.org/w/api.php` | **OK 200** 4,716 b | any domain, definitional |
| Wikipedia summary | `/api/rest_v1/page/summary/` | **OK 200** 2,971 b | extract + revision |
| Wikidata | `wikidata.org/w/api.php` | **OK 200** 3,353 b | entity resolution |
| OpenAlex | `api.openalex.org/works` | **OK 200** 66,272 b | academic, any field |
| Crossref | `api.crossref.org/works` | **OK 200** 12,277 b | DOI-level literature |
| Hacker News (Algolia) | `hn.algolia.com/api/v1/search` | **OK 200** 3,387 b | current technical discussion |
| World Bank | `api.worldbank.org/v2/` | **OK 200** 10,432 b | **real economic denominators** |
| DuckDuckGo IA | `api.duckduckgo.com` | **OK 202** 5,337 b | instant answers |
| r.jina.ai | `r.jina.ai/<url>` | **OK 200** | reader proxy, opt-in only |
| GDELT | `api.gdeltproject.org` | **BLOCKED** | — |
| EUR-Lex RSS | `eur-lex.europa.eu` | **BLOCKED** | proxy only |
| arXiv | `export.arxiv.org` | **BLOCKED** | proxy only |
| Google News RSS | `news.google.com` | **BLOCKED** | proxy only |

Eight providers reachable first-party, with no key, no server and no proxy. That is enough for
genuine open-ended research. The blocked four are reachable only through `r.jina.ai`, which inserts
a third party into the evidence chain and must therefore be **opt-in, off by default, and labelled
in provenance wherever its output is used.**

World Bank matters more than it looks: it is the only provider that supplies **denominators**, which
is what a *"what percentage…"* question actually needs.

### 21-25. Persistence, replay, lineage, inspector, command bar

- `core/persistence/serialize.ts`, `STORE_VERSION = 4`, zod-validated, `localStorage` key
  `risk-swarm:run:<run_id>`. A record that no longer parses is dropped, not repaired.
- `council/replay.ts` — pure frame reduction over the stored event array; its entire dependency list
  is one `import type` line. Determinism is structural.
- `core/lineage/lineage.ts` — recomputable, deliberately **not** on `RunResult` and not persisted.
- `council/capability.ts` — 15 verbs, `UNAVAILABLE = 'Capability unavailable.'`, **no improvising
  fallback branch**. New verbs must keep that property.

### 26-29. State, tests, build, performance

Zustand (`app/store/session.ts`), rehydrating from `localStorage` at `App.tsx:138`.
**372 tests across 28 files, all passing.** `bun run typecheck` (= `tsc -b --noEmit`) and
`bun run build` clean. Console bundle 455.85 kB; the Council is a separate lazy chunk.

Four tests assert exact key lists and will break if extended carelessly — they are the tripwires,
and each is listed in the phase plan where it is touched:
`pulse.test.ts:129` (10 keys) · `orbit.test.ts:79` (12 keys) · `run.test.ts:97`
(`['duplicate_integrity']`) · `adversarial/attacks.test.ts:291` (`store_version = 99`).

---

## DOMAIN RESTRICTION REGISTER

Every hard-coded domain assumption, with the disposition chosen for it. "Keep" means the freight
behaviour is correct and stays reachable as a knowledge package.

| # | location | restriction | disposition |
|---|---|---|---|
| R1 | `fomo.ts:87-90` `FREIGHT_TERMS` | 31 freight words gate all evidence | **generalize** → `Vocabulary` on a knowledge package; open pack derives terms from the question |
| R2 | `fomo.ts:220`, `live.ts:105,128` | `minFreightRelevance ?? 0.34` | **generalize** → `minRelevance` supplied by the pack; name loses `Freight` |
| R3 | `atlas.ts:79-93` `PATTERN_LEXICON` | 12 freight patterns | **keep + generalize** → freight pack; open pack uses a *research taxonomy* built from the question |
| R4 | `analyst.ts:70` | hypotheses only from `atlas.matchLexical` | **generalize** → `TaxonomyMatcher` interface; atlas becomes one implementation |
| R5 | `fomo.ts:78-85` `CATEGORY_RULES` | 6 freight categories | **generalize** → pack-supplied |
| R6 | `fomo.ts:92-102` `GEO_RULES` | 9 geographies | **extend** → pack-supplied, open pack adds none and returns `[]` honestly |
| R7 | `fomo.ts:104-110` `MODE_RULES` | 5 transport modes | **generalize** → optional pack facet |
| R8 | `agents/types.ts:50-53` | freight/EU regulator + industry host lists | **extend** → per-pack lists + provider-declared authority tier |
| R9 | `run.ts:99` `BENIGN_CATEGORY='insolven'` | freight benign baseline | **generalize** → pack-declared benign category |
| R10 | `run.ts:298-302` `scopeBreadth` | "ten-country, four-mode network" | **generalize** → pack-declared network size |
| R11 | `run.ts:119-254` | all seven agents always run | **generalize** → dynamic participation from the question model |
| R12 | `engine.ts:61` `DEMO_INPUT.terms` | 3 freight search terms | **generalize** → planner-derived queries, shown on screen |
| R13 | `engine.ts:69-81` | one provider, CORS-blocked | **replace** → `ResearchProvider` registry, 8 verified providers |
| R14 | `scout.ts:92-98` | silent total retrieval failure | **fix** → explicit uncertainty + `SEARCH_FAILED` |
| R15 | `governance.ts` | EU-freight regulatory mapping | **keep** → relevance-gated so ZEUS stays silent off-domain |

---

## LOCKED DESIGN DECISIONS

**1. One engine, parameterized. Not two.** `investigate()` gains a `pack` option defaulting to the
freight pack, so every existing test passes unmodified. A second parallel research engine would
diverge from the first within a month.

**2. What an LLM may not do.** The existing contract — a model may only rephrase inside a structure
the agent already built and validated, and anything it produced is tier 5 with zero evidential
weight — **is not relaxed.** Consequences: question classification, planning and query generation
are **deterministic and testable**; no agent's conclusion can come from a model; a run with no API
key behaves identically. Open-endedness comes from *retrieval reach*, not from a model being
allowed to assert things.

**3. Taxonomy becomes two things.** *Canonical taxonomy* stays pinned, hashed, human-approved.
*Research taxonomy* is derived per question from the planner's dimensions and the evidence actually
retrieved, lives in the research ledger, and can only reach canonical status through the approval
workflow. Research never writes canonical.

**4. Absence stays visible.** Every generalization must preserve the property that the system says
what it could not do. An open pack that silently accepts everything is worse than a closed one that
refuses honestly.

**5. Provenance names the hop.** External evidence records provider, query, retrieval timestamp,
source identity and — where a proxy was used — that the proxy was used.

**6. Live is not deterministic and must never be displayed as if it were.** Replay of a live run
replays the *stored record*, and the record says so.

---

## PHASE PLAN

| phase | deliverable | risk |
|---|---|---|
| 1 | this audit + restriction register | none |
| 2 | `core/question/` model + router; `core/research/plan.ts` | none, additive |
| 3 | `core/knowledge/internal.ts` + generated index over `public/snapshots` and `docs` | none, additive |
| 4 | `core/research/providers/` — 8 verified providers + opt-in proxy; fix R13, R14 | medium: real network |
| 5 | `core/research/normalize.ts` — provider result → `Evidence`/`Signal`, source quality, duplication | medium: touches evidence |
| 6 | knowledge packages; dynamic participation; DEFENSE/REBUTTAL from real output | **high: touches run.ts and agents** |
| 7 | `core/knowledge/delta.ts` + research ledger | low |
| 8 | taxonomy proposal → validation → approval workflow | low |
| 9 | SENTINEL/PULSE/ORBIT extensions; close the `run.ts:275` gap | medium: exact-key tests |
| 10 | Council Core visual layer, state-driven | low, isolated in `src/council` |
| 11 | replay, performance, responsive, docs | low |

Every phase ends `bun run typecheck` → `bun test` → `bun run build` → commit. No phase may leave a
red test or a fabricated capability behind.
