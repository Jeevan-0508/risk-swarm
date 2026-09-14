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
| D1 | `DeliberationEvent` model + zod schema + append-only event log, coordinator skeleton, termination budgets | `core/domain/model.ts`, `core/deliberation/` | next |
| D2 | Coordinator wired into a real run: agent-to-agent questions/challenges/defenses resolving to real challenger/red-team/position data; determinism test (same seed → identical sequence) | `core/deliberation/` | |
| D3 | SENTINEL event-validation check, PULSE deliberation-health check, ORBIT diff fields | `core/sentinel/`, `core/pulse/`, `core/orbit/` | |
| L1 | Decision Lineage over `graph.evidenceChain()` (absorbs EVOLUTION-2.0 Phase E) | `core/lineage/` | |
| G1 | `/council` route shell, Council Core (radial layout + state machine), minimal real Live Deliberation stream | `app/screens/Council.tsx` or `showcase/`-style detached route | |
| G2 | Agent Inspector, Decision Core (links to `/brief`), Decision Lineage view, timeline | same | |
| G3 | Replay (deterministic, no re-run), command bar | same | |
| G4 | Audio (original, on/off), reduced-motion, mobile vertical layout | same | |
| H | Adversarial tests: fabrication attempts, sealed-event mutation, UI-cannot-create-events, determinism, budget exhaustion | `core/deliberation/*.test.ts` | |
| I | README update (verbatim copy from spec), final 10-second product-test self-check | `README.md` | |

Each phase: implement → `tsc -b --noEmit` → `bun test` → `bun run build` → browser sanity check for UI
phases → commit → push, matching the EVOLUTION-2.0 discipline exactly.

## Baseline confirmed before any Council code is written

`bun test` 262/262 pass · `bun x tsc --noEmit` clean · `bun run build` clean (`index-*.js` 446.55 kB,
`Pantheon-*.js` 17.85 kB, 109 modules) at `8a1ef75`. No files modified this phase — read-only audit only.
