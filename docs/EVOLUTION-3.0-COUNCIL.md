# EVOLUTION 3.0 — COUNCIL — build plan

Standing mandate from the user's "RISK//SWARM — COUNCIL EVOLUTION" spec: an existing, mature project
gets a visible, real, auditable multi-agent deliberation layer. Phase 1 of that spec is a mandatory
read-only audit before any implementation — this document is that audit's deliverable, plus the phase
plan for everything after it. Cross-session anchor for the Council epic; read before resuming.

## Non-negotiables from the spec (binding, restated in this repo's own voice)

- **No fake conversation.** Every deliberation event corresponds to a real structured event the
  coordinator actually emitted from real agent output. The UI may animate or pace it; it may never
  invent one.
- **Personality is presentation only.** HERMES/ATHENA/APOLLO/ZEUS/ARES/HADES/HEPHAESTUS style never
  touches evidence, tiers, scores, gates, caps, bands or governance applicability. Exactly the same
  boundary this repo already enforces for codenames (`AGENT_CODENAME` is UI-only over `AgentId`).
- **Determinism.** The same seeded run produces the identical deliberation event sequence twice. Text
  flavor may vary if a reasoner is ever involved; which events fire, in what order, referencing which
  evidence, must not.
- **Never force consensus.** Final deliberation states: CONSENSUS / QUALIFIED_CONSENSUS /
  MATERIAL_DISAGREEMENT / UNRESOLVED / LIMIT_REACHED. `computeDisagreementIndex` stays authoritative;
  Council narrates it, never recomputes it.
- **Human-in-the-loop always.** ACCEPT / REJECT / REQUEST MORE EVIDENCE is a human act, recorded with
  reason + timestamp. No autonomous consequential action. This is the existing `decided_by` /
  `human_verdict` seam on `Decision`, not a new concept.
- **Core never gains UI knowledge.** Any new `src/core/deliberation/` module takes a roster / naming
  argument exactly the way `casefile.ts` does — core mints no codename, no personality string.

## Phase 1 audit — EXISTING / EXTEND / NEW / DO NOT TOUCH

### DO NOT TOUCH
- `scoring/score.ts` — `computeScore`, `computeDisagreementIndex`, every gate/cap, the action-band
  ladder. Council narrates this arithmetic; it must never gain a second implementation.
- `scoring/policy.ts` — tighten-only lesson application (`applyPolicyDelta`).
- The 7-agent pipeline order and rework rule in `orchestrator/run.ts`.
- `domain/graph.ts` append-only guarantee, `GraphNode`/`Edge` zod validation, `isIntact()`, `cycles()`.
- All 7 agent modules' deterministic decision logic (scout's url-or-drop rule, intelligence's
  clustering, analyst's coverage/falsification gating, governance's fixed trigger table, challenger's
  named-deficiency rule, red team's 12 finding classes, decision's rationale/gate assembly).
- Existing 12 routes/screens' current behavior (`/`, `/new`, `/console`, `/graph`, `/disagreement`,
  `/redteam`, `/brief`, `/history`, `/history/:id`, `/agents`, `/provenance`, `/orbit`) and `/pantheon`.
- `AGENT_CODENAME`/`AGENT_TAGLINE` values — spec's requested names already match exactly (HERMES,
  ATHENA, APOLLO, ZEUS, ARES, HADES, HEPHAESTUS); zero rename work.

### EXTEND
- **SENTINEL** (`core/sentinel/sentinel.ts`, 10 checks) — add deliberation-event validation: every
  `evidenceIds`/`claimIds` on an event must resolve via `graph.has()`; flag `UNSUPPORTED_CLAIM` as an
  11th check, same VERIFIED/WARNING/BLOCKED vocabulary, never drop silently. Natural fit — this module
  already owns `citation_validity`/`provenance_completeness`.
- **PULSE** (`core/pulse/pulse.ts`, 9 checks) — add a `deliberation_health` check: event count, question/
  answer ratio, unresolved challenges, revisions, objections resolved, unsupported claims, budget
  utilization (reuse the existing `budget_utilization` pattern/threshold). No vanity metrics — every
  number must be a real count over stored events, per the module's own existing discipline.
- **ORBIT** (`core/orbit/orbit.ts`, `DIFF_FIELDS`) — add 1-2 fields: deliberation length (event count),
  agent-position spread. Diffed baseline-vs-stressed like every other field; no new scenario required
  for this alone.
- **`serialize.ts`** (`STORE_VERSION = 3`) — deliberation events, if persisted, need either a version
  bump (required field) or `nullable().default(null)` (optional-on-old-records), decided consciously in
  the same commit that adds the field — per the Phase B/C lesson this repo already learned twice.
- **`Decision.scoring_input.agent_positions`** (`Array<{agent, reasoning_status, confidence}>`) — the
  existing "where each agent stood" primitive `DisagreementRoom` already renders. A deliberation
  "agent position" event should resolve to/extend this shape, not duplicate it with a second one.
- Phase E of EVOLUTION-2.0 (Decision Lineage, Evidence Needed, Source Concentration) — fully designed
  there already, never implemented. Council's own "Decision Lineage" feature is the same feature at
  larger scope; absorbed into this doc's Phase L1 rather than built twice. `graph.evidenceChain(id)` is
  the mechanism for both.

### NEW
- `core/domain/model.ts` — a `DeliberationEvent` node kind (or a sibling append-only log reusing the
  same envelope/zod-validation pattern — decided in Phase D1 below) with the 12 spec'd event types
  (QUESTION, ANSWER, CHALLENGE, DEFENSE, REBUTTAL, REVISION, AGREEMENT, DISAGREEMENT, OBJECTION,
  CLARIFICATION, ESCALATION, RESOLUTION), `parentEventId`, `status`, `requiresResponse`.
- `core/deliberation/` — deterministic coordinator (who speaks next), termination budgets modeled
  directly on `agents/harness.ts`'s existing `Budget`/`spend`/`assertAlive`/`BudgetExceededError`
  pattern (`MAX_ROUNDS`/`MAX_EVENTS`/`MAX_AGENT_RESPONSES` → `DELIBERATION_LIMIT_REACHED`, never a false
  consensus). Every event the coordinator emits must resolve to a real, already-computed challenger
  finding, red-team finding, agent position or evidence ref — never freeform LLM disagreement.
- `/council` route + 4-zone screen (Council Core, Live Deliberation, Agent Inspector, Decision Core).
  Decision Core reuses/links `DecisionBrief` (`/brief`, screen 07) rather than re-rendering the
  recommendation a second way.
- Decision Lineage renderer — thin wrapper over `graph.evidenceChain()`, per EVOLUTION-2.0 Phase E's
  already-resolved design (decision → hypothesis → observation(s) → evidence).
- Deterministic replay engine — pure function over stored events, explicitly forbidden from re-running
  `investigate()` or the coordinator.
- Command bar capability router — maps text to real read operations over `RunResult`/graph/events;
  unsupported → literal "Capability unavailable.", never simulated.
- Personality content — `showcase/gods.ts`'s existing `God[]` (blurb/mechanism/pose per agent) is
  directly reusable raw material; spec's requested personality traits already line up 1:1 (HERMES
  fast/curious ~ "mid-stride, never seated"; ATHENA precise/skeptical ~ "weighing... refusing to say
  identical"; ZEUS authoritative/procedural ~ "rules loudly where written, silent otherwise"; ARES
  aggressive/adversarial ~ "not allowed to just disagree"; HADES dark/worst-case ~ "can shut a door,
  cannot open one"; HEPHAESTUS quiet/synthesis ~ "working, not deliberating"). Council needs its own
  visual identity (spec requires this explicitly, not a Pantheon re-skin) but the character content
  itself does not need to be reinvented.
- Original Web-Audio sound design, reduced-motion variant, mobile vertical layout, new tests.

## Phase map

| Phase | What | Where | Status |
|---|---|---|---|
| D1 | `DeliberationEvent` model + zod schema + append-only event log, coordinator skeleton, termination budgets | `core/domain/model.ts`, `core/deliberation/` | **done** (merged with D2/D3, see below) |
| D2 | Coordinator wired into a real run: agent-to-agent questions/challenges/defenses resolving to real challenger/red-team/position data; determinism test (same seed → identical sequence) | `core/deliberation/` | **done** |
| D3 | SENTINEL event-validation check, PULSE deliberation-health check, ORBIT diff fields | `core/sentinel/`, `core/pulse/`, `core/orbit/` | **done** |
| L1 | Decision Lineage over `graph.evidenceChain()` (absorbs EVOLUTION-2.0 Phase E) | `core/lineage/` | **done** |
| G1 | `/council` route shell, Council Core (radial layout + state machine), minimal real Live Deliberation stream | `src/council/` (detached lazy route) | **done** |
| G2 | Agent Inspector, Decision Core (links to `/brief`), Decision Lineage view, timeline | `src/council/` | **done** |
| G3 | Replay (deterministic, no re-run), command bar | `src/council/` | **done** |
| G4 | Audio (original, on/off), reduced-motion, mobile vertical layout | `src/council/` | **done** |
| H | Adversarial tests: fabrication attempts, sealed-event mutation, UI-cannot-create-events, determinism, budget exhaustion | `core/deliberation/*.test.ts` | |
| I | README update (verbatim copy from spec), final 10-second product-test self-check | `README.md` | |

Each phase: implement → `tsc -b --noEmit` → `bun test` → `bun run build` → browser sanity check for UI
phases → commit → push, matching the EVOLUTION-2.0 discipline exactly.

## Baseline confirmed before any Council code is written

`bun test` 262/262 pass · `bun x tsc --noEmit` clean · `bun run build` clean (`index-*.js` 446.55 kB,
`Pantheon-*.js` 17.85 kB, 109 modules) at `8a1ef75`. No files modified this phase — read-only audit only.

## Phase D (D1+D2+D3), closed out (2026-09-14)

Shipped as one commit, the same way SENTINEL/PULSE/ORBIT each shipped as one commit in EVOLUTION-2.0.

- `core/domain/model.ts`: `DeliberationEventType` (12 values), `DeliberationEventStatus`,
  `DeliberationOutcome`, `DeliberationEvent` — additive only, deliberately **not** added to the
  `GraphNode` union (see the doc comment on why: it is a conversation-tree log, not a
  citation/cycle-checked node; it references real graph ids by string instead).
- `core/deliberation/coordinator.ts` (new): `runDeliberation()` — a pure, deterministic, single-pass
  synthesis over an already-completed `RunResult`'s own outputs, never a live loop and never a second
  model call. 8 fixed rounds (opening clarifications → 6 agent positions → 7 questions from real
  `recommended_next_step`s → challenges → objections → governance answers → revisions → conditional
  escalation), then exactly one terminal `resolution` event. Every `evidence_ids`/`claim_ids` entry is
  filtered through `graph.has()` at generation time, so a dangling reference can never enter the
  transcript. Budgeted (`max_events`/`max_rounds`/`max_agent_responses`, defaults 80/12/20) as a hard
  stop, never a silent truncation — the terminal event always states `LIMIT_REACHED` plainly instead of
  implying consensus, and a slot for it is always reserved.
- **Honesty finding, banked in code comments**: `Challenge.resolution`/`RedTeamFinding.resolution` are
  always `'open'` in the current pipeline (grep-confirmed, nothing today sets them to
  `'accepted'`/`'rebutted'`), so DEFENSE/REBUTTAL/resolution-driven-AGREEMENT event types are real,
  wired code paths that never actually appear over a real run yet — dormant, not dropped, exercised
  only by a hand-built fixture in `coordinator.test.ts`. Same posture ORBIT already documented for its
  own scope decisions.
- `core/orchestrator/run.ts`: wired `deliberation` onto `RunResult`, computed right after `assemble()`
  and passed into both SENTINEL and PULSE.
- `core/sentinel/sentinel.ts`: 11th check, `deliberation_integrity` — every event's
  evidence/claim ids must resolve to a real node, reported `BLOCKED` with the literal phrase
  `UNSUPPORTED CLAIM` on failure. Input field is optional so all 15 existing callers stay green.
- `core/pulse/pulse.ts`: 10th check, `deliberation_health` — question/challenge/objection/revision
  counts and whether a budget cut the transcript short, read from the report rather than recomputed.
- `core/orbit/orbit.ts`: 2 new `DIFF_FIELDS` entries (`deliberation_event_count`,
  `deliberation_outcome`), both informational (`material: false`), matching `disagreement_index`'s own
  granularity.
- `core/persistence/serialize.ts`: `STORE_VERSION` 3 → 4, `deliberation` stored verbatim like
  `sentinel`/`pulse`; a pre-Council record is dropped, not backfilled, matching the v2/v3 precedent.
- New `core/deliberation/coordinator.test.ts` (17 tests): determinism (byte-for-byte identical
  transcript across two runs of the same seed), no-fabrication (every cited id resolves, asserted
  independently of SENTINEL), real disagreement narrated honestly (challenge/objection counts match
  the real challenger/red-team findings, all unresolved), exactly 6 recorded positions (not 7 —
  `decision_engine` never votes on itself), exactly one terminal event, all three budget dimensions
  exhausted individually (with the terminal event always surviving), and the dormant
  DEFENSE/REBUTTAL/resolution-driven-AGREEMENT path via one hand-built fixture that also exercises
  REVISION and ESCALATION.
- `pulse.test.ts`/`orbit.test.ts`'s exact-key-list assertions and `serialize.test.ts` updated in
  lockstep (a v3→v4 round-trip test and a drop-test added, matching the v1→v2 and v2→v3 precedent).

Verified: `bun x tsc -b --noEmit` clean · `bun test` 281/281 pass (264 pre-existing + 17 new) · `bun run
build` clean. Not yet done: L1 (Decision Lineage), G1-G4 (`/council` UI), H (adversarial tests beyond
budget/fabrication, e.g. sealed-event mutation and UI-cannot-create-events — those need the UI to exist
first), I (README update).

## Phase L1 (Decision Lineage, Evidence Needed, Source Concentration), closed out (2026-09-14)

All three shipped together in `core/lineage/lineage.ts`, per EVOLUTION-2.0.md's already-resolved
design — none needed a new agent, a new engine computation, or a new graph API. Deliberately **not**
wired onto `RunResult` or persisted: everything here is recomputable for free from the graph and
outputs a stored run already keeps (unlike SENTINEL/PULSE/deliberation, which are records of a
judgment made *at run time* and would drift if recomputed later).

- `decisionLineage(graph, decision)`: decision → hypothesis → observation(s) → evidence, as an ordered
  structure for display rather than a paragraph. Uses `graph.evidenceChain()` exactly as designed, with
  one correction found while testing it: `evidenceChain(hypothesis.id)` is the **full transitive**
  evidence base (hypothesis <- observation <- evidence, per that method's own doc comment), not just
  the analyst's direct `supporting_evidence_ids` — it is a superset, because a hypothesis is
  `based_on` every observation this run produced, not only the one it was matched from. Field named
  `evidence`, not `direct_evidence`, to say so honestly; observations are still broken out
  separately for structure.
- `evidenceNeeded(coverage, pattern)`: ranked, weight-first list of indicators nobody has looked at
  yet, every field copied verbatim from the taxonomy. Takes an already-resolved `Pattern` rather than
  an `(matcher, patternId)` pair, so the function itself stays synchronous and pure — the caller (a
  Phase G screen) awaits `atlas.pattern()` once, the same call the analyst already made.
- `sourceConcentration(evidence)`: the permanent, every-run version of ORBIT's `source_concentration`
  scenario. Groups `Evidence[]` by `sourceIdentity()` (the same host/publisher normalization
  SENTINEL's `source_identity` check already uses) rather than reimplementing ORBIT's raw-publisher
  grouping, which operates on a different, pre-graph input type (`RawSignal[]`) anyway.
- 11 new tests in `core/lineage/lineage.test.ts`: real-run integrity (every returned node actually
  exists in the graph, decision_evidence matches `evidence_cited` exactly, every hypothesis's evidence
  is a superset of what the analyst directly cited), a decision with nothing to rest on returns empty
  rather than throwing, concentration's three shapes (empty, fully concentrated, evenly split, and the
  real run), and evidence-needed's ranking and no-fabrication guarantee via both the real atlas and a
  hand-built fixture.

Verified: `bun x tsc -b --noEmit` clean · `bun test` 292/292 pass (281 prior + 11 new) · `bun run
build` clean. Not yet done: G1-G4 (`/council` UI - this is where lineage/evidence-needed/
concentration actually get a screen), H, I.

## Phase G1 (`/council` shell, Council Core, Live Deliberation), closed out (2026-09-14)

Built as a third top-level folder, `src/council/`, on the showcase's precedent rather than as a
twelfth console screen: own lazy chunk, own `cn-`-prefixed stylesheet, rendered outside `Frame` so it
has no sidebar and no mode switch. Unlike the showcase it *is* linked from the sidebar, because it
reads a real run rather than telling a story about one.

- `roster.ts`: `COUNCIL_SEATS` (accent, `trait`, `cannot` per `AgentId`) and `ringPoint()` - pure seat
  geometry in a 0-100 square, so the ring is identical in a test, on a phone and in a screenshot. The
  character lines restate what `showcase/gods.ts` already claims; that file is deliberately **not**
  imported (it keys by display label, this keys by `AgentId`, and sharing it would couple two pages
  that are allowed to diverge).
- `derive.ts`: every visual state as a pure reduction of the stored transcript - `chamberState()`
  (empty/convening/deliberating/resolved, from the cursor's position in the transcript, never a timer),
  `visible()` (a *prefix* of the real array - it cannot reorder or invent), `seatActivity()`,
  `threads()` (`parent_event_id` grouping, an orphan promoted to a root rather than dropped),
  `typeTally()`, `EVENT_TONE`/`TONE_COLOR`/`OUTCOME_NOTE`/`OUTCOME_TONE`. Nothing in this file can
  construct a `DeliberationEvent`.
- `Chamber.tsx` / `Council.tsx`: split on purpose. `Chamber` is the whole presentational tree and is
  free of the session store, of `localStorage` and of the stylesheet import; `Council` is the shell
  that finds the active run. That split is what makes the render test below possible with no browser.
- Zones shipped this phase: **Council Core** (7 seats on a ring, lit by whoever speaks at the cursor, a
  beam drawn only when a real event names both a speaker and an addressee, unlit-but-present seats for
  agents who have not spoken) and **Live Deliberation** (the transcript in `sequence` order, cursor
  controls, per-seat filter). **Decision Core** ships as the band + outcome + a link to screen 07 -
  the recommendation itself is rendered once, by the brief, so the two can never disagree.
- No run loaded says so, in those words, and offers `/new`. It never seats a demonstration.

Two conventions learned this phase, both worth keeping:

1. **`bun test` does not resolve the `@core`/`@app` tsconfig paths** (the root `tsconfig.json` is a
   solution file with `files: []` and no `paths`). A *type-only* alias import survives because it is
   erased; a value import does not. Everything under `src/council/` therefore uses relative imports, so
   any module here can be pulled into a test.
2. **A headless render test is the browser check.** `render.test.tsx` renders `Chamber` over a real
   `investigate()` result via `renderToStaticMarkup` + `StaticRouter`, and asserts the two things `tsc`
   and the reducer tests both miss: that the tree renders at all, and that every event's `content`
   appears in the markup **verbatim** (escaped-compared, no paraphrase and no ellipsis truncation),
   alongside the real outcome, the real event count, the real band, and `withheld` wherever the engine
   withheld confidence.

Verified: `bun run typecheck` clean · `bun test` 313/313 pass (292 prior + 15 `derive` + 6 `render`) ·
`bun run build` clean, `Council-*.js` 12.69 kB in its own chunk (`index-*.js` unchanged at 455.81 kB,
so nothing leaked into the console bundle).

## Phase G2 (Agent Inspector, Timeline, Decision Lineage zone), closed out (2026-09-14)

Three zones added to `Chamber.tsx`, and L1's three core functions finally get a screen.

- **Timeline**: one tick per event, coloured by type, height marking the cursor and any event that
  `requires_response`, plus a legend from `typeTally()`. It is the scrubber as well as the overview -
  a tick *is* an event, so clicking one cannot land anywhere the transcript does not go.
- **Agent Inspector**: on selecting a seat, its remit (`AGENT_REMIT`), its disposition, what it
  structurally **cannot** do, the position it recorded in `decision.scoring_input.agent_positions`,
  its own published `reasoning_status`/`confidence`/`findings`/`evidence_cited`, its `uncertainties`
  verbatim, its `recommended_next_step`, and its `degraded_reason` if the model path degraded. Every
  number is read off the agent's own output - the inspector computes nothing. `decision_engine` is
  shown as casting no position rather than as a missing row, because it does not vote on itself.
  Nothing is pre-selected: the zone invites a click instead of implying one seat matters more.
- **Decision Lineage**: `decisionLineage()` rendered as the real chain (hypothesis id, status,
  statement, falsification test, observation and evidence counts), with the superset caveat printed
  on screen rather than buried in a doc comment. Alongside it, `sourceConcentration()` (top-source
  share plus the five largest sources) and `evidenceNeeded()` as "what would change this".
- The indicator text lives in the pinned taxonomy, not in the run, so `Council.tsx` (the shell) fetches
  it once via `createAtlasMatcher(snapshotLoader()).patterns()` and passes a `Map<string, Pattern>`
  down. `Chamber` stays synchronous and store-free. **A failed fetch degrades to `null`, not to an
  empty array**: an empty list would read as "nothing left to check", which is the opposite of the
  truth, so the zone says the taxonomy is not loaded until it really is.
- `evidenceNeeded()` results are ranked **globally by weight across the run**, not concatenated per
  finding - otherwise a heavy indicator could be pushed off the list of six by a lighter one whose
  pattern merely matched first. Found by the render test, which asserts the single heaviest unassessed
  indicator in the whole run is on screen with its `signal` verbatim.

Verified: `bun run typecheck` clean · `bun test` 320/320 pass (313 prior + 7 new render assertions
groups) · `bun run build` clean, `Council-*.js` 22.60 kB (`index-*.js` 455.85 kB, still flat).

## Phase G3 (deterministic replay, command bar), closed out (2026-09-14)

- `replay.ts`: `frameAt()` / `advance()` / `rewind()` / `replay()` / `transcriptDigest()`, all pure. Its
  **entire** dependency list is one `import type` line - the test asserts that structurally, over the
  file's own import lines, so "does not re-run `investigate()` or the coordinator" is a property of the
  module rather than a promise in a comment. Every frame's `event` is the stored object itself
  (reference-identical, asserted), so replay cannot introduce, drop, paraphrase or reorder an exchange.
  Speed is pacing only: the test walks the whole transcript at each of 1x/2x/4x and asserts the same id
  sequence, so a speed can never skip an exchange. The cursor clamps at both ends rather than wrapping -
  a looping deliberation would imply the council kept going, and it did not.
- `transcriptDigest()`: an FNV-1a fingerprint over id, order, speaker, addressee, type, status,
  `requires_response`, parent, every cited id and the exact words. Tested to change on a single altered
  character, on two swapped exchanges, and on one quietly dropped citation. Labelled `fnv1a:` and
  documented as **not** a security claim, matching `sources/hash.ts`'s existing honesty about the same
  fallback - it is a tamper tell for a reader comparing two renderings, nothing more.
- `capability.ts`: 15 verbs, each one a projection of `RunResult` / the graph / the transcript, plus
  `UNAVAILABLE = 'Capability unavailable.'` **with no improvising fallback branch**. Tested: an unknown
  verb, an empty line, and a known verb with a missing or nonsense argument are all refused with exactly
  that string and nothing else appended; every verb listed in `COMMAND_HELP` really answers; the same
  command answers identically twice; `goto` mutates nothing but the caller's cursor; `gaps` says the
  taxonomy is not loaded rather than reporting no gaps; `band` never prints a confidence number when the
  engine withheld one.
- UI: `Transport` (play/pause/replay, 1x/2x/4x, start/back/next/whole-transcript) drives the cursor
  through `advance()`/`rewind()` on a `setInterval` and stops itself at the last event. `CommandBar`
  echoes each command and its answer, renders a refusal in the caution colour, and states in its own
  footer that it refuses rather than improvises. The transcript header carries the digest as its title.

Verified: `bun run typecheck` clean · `bun test` 346/346 pass (320 prior + 12 replay + 14 capability) ·
`bun run build` clean, `Council-*.js` 31.58 kB (`index-*.js` 455.85 kB, still flat).

## Phase G4 (sound, reduced motion, narrow screens), closed out (2026-09-14)

- `audio.ts`: written from oscillators, nothing sampled. Seven pitches on one minor-pentatonic set (one
  degree per seat in pipeline order) so **any** order of speakers is consonant - the council can speak in
  any sequence, at 4x, and the result cannot land on a dissonance a reader would hear as an error. One
  waveform/duration/gain per event register (sharper for adversarial, longer and softer for the closing
  resolution), struck-not-swelled envelope so a fast replay stays legible instead of becoming a drone.
- The one audible distinction that maps onto something evidential - an `unresolved` exchange sits a whole
  tone lower - is **also printed beside every event**, which is the rule the whole file exists under:
  sound carries nothing that is not on screen, so a deaf reader, a muted tab and a screenshot lose
  nothing. Tested: the note ignores an event's words entirely, so the tone cannot leak content.
- `noteFor()` is pure and total (asserted over all 12 event types x all 7 seats) with no clock and no
  random source (asserted by reading the module's own text). The AudioContext adapter has no decisions of
  its own, so there is nothing there worth mocking a browser for; where Web Audio is absent it returns a
  working no-op instead of throwing.
- **Silence is the default and the toggle is real**: the context is built on the first switch-on and
  `close()`d on switch-off, rather than created up front and muted - a page nobody asked for sound on
  should not be holding an audio device open. The render test asserts the markup ships `sound off`, and
  that the transport opens paused on the whole transcript rather than auto-playing at the reader.
- Narrow screens: below `sm` the ring is replaced by `SeatColumn` - the same seven seats, the same
  lit/unlit and speaking/addressed states, the same counts, laid out vertically. A re-layout, not a
  reduction: the render test asserts every codename appears in **both** layouts, so the column cannot
  drift from the ring. Between `sm` and `lg` the circle is capped rather than allowed to push the
  transcript off screen, and under 400px the transcript takes the height the ring is no longer using.
- `prefers-reduced-motion`: every animation off, and the speaking seat keeps a solid fill so it stays
  identifiable without the breath. Nothing is lost, because every state the motion expressed - who
  speaks, who was addressed, how far the transcript has been read - is written in text beside it.

Verified: `bun run typecheck` clean · `bun test` 358/358 pass (346 prior + 8 audio + 4 render) ·
`bun run build` clean, `Council-*.js` 34.38 kB / `Council-*.css` 1.91 kB (`index-*.js` 455.85 kB, flat
through all four G phases - nothing has leaked into the console bundle).
