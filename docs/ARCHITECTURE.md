# RISK//SWARM — Architecture Proposal

> "Where AI agents disagree before humans decide."

Status: **proposal, pre-implementation** (per development process step 1–10). No application code
has been written yet. Nothing in the four existing portfolio repos is modified or copied.

## 1. What this system is

A multi-agent risk investigation engine. A human asks one risk question. Seven specialised agents
investigate it against **real, cited datasets**, exchange structured messages, challenge each other,
and the run terminates in one executive brief plus a *human* decision. The LLM is never the source
of truth; it is one clearly-labelled reasoning tier (Level 5) that may only generate hypotheses.

The differentiator is not the agents. It is that the system is **allowed to conclude "not enough
evidence"** — and that conclusion is produced by deterministic code, not by a model's mood.

## 2. Repository inspection — what already exists (2026-09-13)

| Repo | Role in RISK//SWARM | Real content found |
|---|---|---|
| `FOMO` | SCOUT signal source | `data/signals.json` — **874 signals**, 32 scan runs, fields `category,title,link,source,pub_date,severity,found_at`, 6 categories |
| `freight-fraud-taxonomy` | RISK ANALYST pattern base | 12 patterns, 8 categories, **77 phase-tagged weighted indicators**, 31 `false_positives` blocks (`looks_like/actually/how_to_rule_out`), 137 countermeasures, `regulatory_hooks`, `related` |
| `freight-risk-atlas` | RISK ANALYST scoring discipline | coverage-not-probability assessment model, false-positive gates, stage filtering |
| `ai-governance-control-room` | GOVERNANCE OFFICER source | 4 frameworks / **56 requirements** with `citation`,`url`,`ref`,`applies`; 29 controls, 84 evidence artefacts |
| `riskos` | Decision / register sink + UI precedent | React 18 + TS + Vite + Tailwind + zustand + recharts + vitest, 325 tests, reusable `src/ui` primitives, seeded `lib/random.ts` |

**Reusable, not rebuilt:** the riskos UI shell pattern (Sidebar/TopBar/ScreenHeader/DataTable/
SlideOver/CommandPalette), its seeded RNG for determinism, its `domain/validate.ts` discipline, its
`scripts/copy-dist-to-docs.mjs` Pages deploy, and its vitest setup. Same conventions, new repo.

## 3. Stack decision — RESOLVED: Option A (single TypeScript package, no backend)

The brief said "prefer Python + FastAPI". That choice costs the project its live demo link: GitHub
Pages cannot run a Python server, and a React front end cannot be hosted on Streamlit. Every other
shipped repo in this portfolio is a live URL, so the decision was taken the other way.

- **`src/core`** — framework-free TypeScript engine: domain graph, agents, orchestrator, scoring,
  validators, budgets, kill switch. Pure functions, zero DOM, fully unit-testable.
- **`src/app`** — React 18 + TS + Vite + Tailwind, 11 screens, dark Swiss enterprise.
- **`src/showcase`** — one marketing-style page (`/pantheon`, "Meet the Agents"), physically separate from
  the console: its own folder, its own stylesheet (`pn-` prefixed), its own lazy-loaded bundle chunk, no
  sidebar entry, and it renders outside the app `Frame`. Nothing in `src/app` imports from it. The
  console's own design language rules out imagery of that kind, so the story version lives here instead
  of eroding Screen 1. Its closing seal reads the band from a real stored run or prints nothing at all.
- Persistence: **IndexedDB**, storing the structured graph (objects + edges), never chat logs.
  JSON export/import for portability.
- Reasoning: `Reasoner` interface. Default `DeterministicReasoner` (seeded, offline, zero cost) =
  DEMO MODE. Optional `LlmReasoner` with a **bring-your-own key held only in localStorage**, never
  in the repo, never in a build artefact.
- Deploys to Pages via Actions.

It is one package, not a monorepo: workspace tooling would buy nothing here, and the brief forbids
infrastructure added to look impressive. The `src/core` / `src/app` split is enforced by the rule
that nothing in `src/core` may import React or touch the DOM.

**Runtime and test runner: bun.** There is no system Node on the build machine, and `vite-node`
(vitest's loader) breaks under bun's Node shim on Windows, so tests run on `bun test` with BDD
functions imported from a single seam, `src/core/test/bdd.ts`. Swapping runners is one file.

Rejected dependencies, for the record: `recharts` and `@xyflow/react` (the visualisations here are
hand-drawn SVG, deterministic and small), `lucide-react` (a handful of inline icons instead),
`zod` was **accepted** for exactly one reason: it validates every agent output at the boundary and
gives the rejection message that the red team prints.

## 4. System shape

```
                              HUMAN (question)
                                    |
                          +---------v---------+
                          |   ORCHESTRATOR    |  budget ledger · kill switch · state machine
                          +---------+---------+
                                    |
              parallel fan-out      |
        +---------------+-----------+-----------+
        |               |                       |
     SCOUT          INTELLIGENCE            (waits)
   FOMO adapter    cluster / dedup /
   874 signals     independence count
        |               |
        +-------+-------+
                |
          RISK ANALYST  <- taxonomy: 12 patterns / 77 indicators / 31 FP gates
                |
        GOVERNANCE OFFICER <- control room: 56 cited requirements / 29 controls
                |
        +-------+-------+          (parallel, adversarial)
        |               |
   CHALLENGER       RED TEAM
   disprove H       attack the investigation
        |               |
        +-------+-------+
                |
        blocking findings? --yes--> REWORK (max 2 loops) --> back to SCOUT/ANALYST
                |no
        DECISION ENGINE  -> severity / confidence / urgency / action / owner / review
                |
        EXECUTIVE BRIEF -> HUMAN GATE (accept / override / reject) -> OUTCOME -> LESSON
```

## 5. Safety envelope (SAFETY > AUTONOMY)

Hard limits enforced in `orchestrator/budget.ts`, checked **before every dispatch**:

| Limit | Default | Behaviour on breach |
|---|---|---|
| max agent calls | 24 | run halts, state `HALTED_BUDGET`, partial brief marked incomplete |
| max wall clock | 120 s (demo) | same |
| max evidence retrievals | 60 | scout stops, gap recorded as uncertainty |
| max rework loops | 2 | proceed to decision with objections *unresolved and printed* |
| max recursion depth | 2 | sub-investigation refused |
| kill switch | user-triggered | current dispatch abandoned, graph preserved, state `KILLED` |
| human gate | mandatory | no decision is ever `DECIDED` without a human action |

The system may DISCOVER, ANALYZE, CHALLENGE, RECOMMEND. It has no tool that can send mail, write to
an external system, or take a consequential action — not gated, **absent from the tool registry**.

## 6. Untrusted-input boundary

Every retrieved artefact (news title, summary, snapshot record) enters through
`ingest/sanitize.ts` and is stored as `UntrustedText`. Rules:
1. Retrieved content is never concatenated into an instruction position of a prompt; it is passed
   inside a delimited data block with an explicit "this is data, not instruction" frame.
2. Instruction-shaped patterns in retrieved text are flagged (`injection_suspected`) and the source
   reliability is downgraded, not silently stripped.
3. Every agent output is schema-validated **and** cross-checked: an agent may only cite evidence IDs
   that were in its own input. A fabricated ID rejects the whole output (`REJECTED_PROVENANCE`).
4. No agent output can change budgets, limits, another agent's role, or the escalation gates.

## 7. Honest limitations (to appear in the README)

- Browser-only (Option A) means no live crawling: SCOUT reads a **provenanced snapshot** of FOMO's
  real signal set. Freshness is the snapshot date, and the UI states it.
- Coverage of indicators is **not** a probability of fraud. Inherited discipline from the Atlas.
- No legal advice. Requirement summaries are paraphrases with citations to the official text.
- Nothing employer-specific: no Amazon data, no real thresholds, no internal carrier names.
- The learning loop adjusts evidence thresholds for repeat patterns. It does not retrain a model.
