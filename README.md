<p align="center"><img src="assets/jk-brand-banner.png" alt="Jeevan Siddhabhaktula — Risk. Governance. AI." width="280"></p>

# RISK//SWARM

**Where AI agents disagree before humans decide.**

Most "AI risk" tools produce one confident answer. That is the failure mode, not the feature: a single
confident answer hides the evidence it rests on, buries the benign explanation that fits the same facts,
and gives a human nothing to push back on.

RISK//SWARM runs seven agents over the same question and **keeps their disagreement in the output**. Every
claim carries the evidence it rests on. A red team attacks the investigation itself. The scorer publishes
which requirement it failed and why the recommendation was held back. A human decides at the end.

It runs with **no API key, no network and no paid service**. The demo below is reproducible byte for byte.

**[Open the live demo](https://jeevan-0508.github.io/risk-swarm/)** — ten screens, no sign-in, no backend.

---

## The seven agents

| Agent | Job | Cannot |
|---|---|---|
| **SCOUT** | Retrieves external signals, one evidence object per signal | Interpret, rank or conclude. A signal with no verifiable URL is dropped, not downgraded |
| **INTELLIGENCE** | Deduplicates: makes one event reported five times count once | Use a model at all. Every number is deterministic arithmetic you can audit line by line |
| **RISK ANALYST** | Turns observations into hypotheses, each with a mandatory falsification test | Reach "supported" while the operational indicators are unassessed |
| **GOVERNANCE OFFICER** | Maps the obligations that attach to *acting on this with an automated system* | Evidence an incident. Its citations are tier 1 but flagged `incident_claim: false` |
| **CHALLENGER** | Argues the benign case from the taxonomy's own documented false positives | Be talked out of an objection. Every challenge names a fact in the record |
| **RED TEAM** | Attacks the investigation, not the risk: 12 standing checks | Ever *create* an escalation. A `fail` can only stop one |
| **DECISION ENGINE** | Assembles the recommendation, its gates and its actions | Decide on its own authority. `decided_by` stays `system_recommendation` until a human records a verdict |

---

## Where to watch the agents work

Everything each agent did is inspectable, not hidden behind a chat log.

```bash
bun run scripts/demo-run.ts     # the whole investigation, printed
```

| What you want to see | Where it is |
|---|---|
| Which agent ran, in what order, how long, how many findings | `result.log` — one `PhaseLogEntry` per phase, printed as the `agents` line |
| Everything one agent produced, including what it was unsure about | `result.outputs.<agent>` — `findings`, `uncertainties`, `reasoning_status`, `cost` |
| Who created any given node | every node carries `created_by`, and `result.graph.toJSON()` dumps all of them |
| What the recommendation actually rests on | `result.graph.evidenceChain(decisionId)` — the only sanctioned way to ask |
| Why the band is not higher | `decision.gates_failed` and `decision.caps_applied`, both printed |
| What it cost and whether it was stopped | `result.spent` (agent calls / retrievals / tokens) and `result.attempts` |
| Whether an agent was allowed to phrase something with a model | `degraded_reason` on the agent output; absent means deterministic wording |
| That the behaviour is enforced, not described | `bun test` — 186 tests across 15 files, 15 of them attacks |

The same record drives the UI. The browser build is a **pure renderer** over `RunResult`: no screen
recomputes a number, because a figure computed twice is a figure that can disagree with itself.

| Screen | What it is for |
|---|---|
| 01 Command Center | The last run's answer, its gates and the mode in force |
| 02 New Investigation | Question, scope, depth and budget — set before the run, not raised mid-flight |
| 03 Agent Console | Each phase as it really completes, with findings, uncertainties and cost |
| 04 Evidence Graph | The append-only graph, layered by node kind; click any node for its evidence chain |
| 05 Disagreement Room | The disagreement index with all four terms and their arithmetic, and every objection |
| 06 Red Team | The 12 named checks, which fired, and which findings could not be cleared |
| 07 Decision Brief | One page a human can act on, plus the markdown export and the human verdict |
| 08 History | Past runs, restored from browser storage, each still carrying its own graph |
| 09 Agent Performance | Cost and output per agent, the outcome recorder, and the lesson ledger |
| 10 Knowledge & Provenance | Snapshot hashes, the tier ladder, and what LIVE retrieval actually fetched |

---

## The demo, unedited

A 24-month DACH road-freight window over 874 real signals:

```
Are we exposed to phantom-carrier fraud in the DACH road network?

recommendation         MONITOR  (severity HIGH 0.525, urgency ELEVATED)
confidence             withheld - 3 unresolved blocking finding(s): no confidence figure is
                       published while the investigation is contested
disagreement index     79.4
graph                  64 nodes, 97 edges, intact true, cycles 0
agents                 discover:12 deduplicate:8 analyse:2 govern:7 challenge:13 red_team:5 decide:1
budget spent           7 agent calls, 27 retrievals, 0 tokens

why:
  - 12 incident-claim evidence object(s) reduce to 12 distinct event cluster(s) across
    8 independent publisher(s).
  - The link to Phantom Carrier (FFT-002) is a lexical topic match on "fake-frachtführer";
    it evidences discussion of the pattern, not its occurrence here.
  - 9 of 9 operational indicator(s) are unassessed (completeness 0%), so occurrence is
    untested rather than disproved.
  - 5 of 5 documented false-positive gate(s) remain open, and each one is a benign
    explanation that fits the same evidence.

unmet escalation requirements:
  - unresolved blocking finding(s): escalation withheld
  - confidence withheld below 0.6
  - false-positive risk 0.41 at or above 0.4
  - no tier-1 or tier-2 source supports the incident claim
```

**This is the point of the project.** 874 signals, one genuine carrier-fraud report from a single
publisher, no internal operational data — the honest output is *monitor and investigate*, with the
better-evidenced adjacent risk being insolvency-driven carrier substitution (58% of the surviving
signals are insolvency events). A system that answered "CRITICAL — escalate" here would be flattering
itself, and you would learn to ignore it by the third false alarm.

---

## How it refuses to flatter itself

These are enforced in code and covered by tests, not stated as intentions.

- **Reasoning is not evidence.** Source tiers weigh 1.0 / 0.8 / 0.55 / 0.7 and **tier 5 (model
  reasoning) weighs 0.00**. An all-tier-5 chain scores zero confidence.
- **Repetition cannot manufacture certainty.** Confidence is computed over evidence *clusters* and
  source tiers, never over how many agents agree. Ten articles about one event count once.
- **Independence means independent *incident* reporting.** A regulator citation is tier 1 and belongs in
  the record, but it can never make an event independently reported — otherwise the governance officer
  could satisfy the escalation gate by citing more law.
- **`unknown` is never folded into `absent`.** An unassessed indicator is an evidence gap; treating it as
  a clean result is how a coverage score becomes a fraud probability.
- **A hypothesis with no falsification test is invalid** — the schema rejects it.
- **Near-duplicates that fall short of the merge threshold are published, not merged.** Silently merging
  destroys real corroboration; failing to merge inflates independence. So the ambiguous pairs are printed
  and the red team may challenge the count.
- **Confidence is withheld, not lowered, while a blocking objection stands.** No number is published on a
  contested investigation.
- **A lesson may only tighten.** The learning loop's policy deltas throw `PolicyDeltaRejected` on any
  attempt to lower a gate, so a bad outcome cannot be used to poison the scorer.
- **Retrieved text is data, never instruction.** Eight injection patterns are detected, fences are
  neutralised, and a suspected item's weight is halved. A model may only re-word a structure the agent
  already built and validated, and may cite only the evidence ids it was handed —
  `FabricatedCitationError` otherwise.
- **The band is the highest rung whose requirements are met**, not one demotion per failed gate. Four
  ordinary shortfalls should not collapse a real multi-publisher signal to "nothing to see".
- **A stored run that no longer validates is dropped, never repaired.** A tampered record fails the
  schema and disappears; it is not coerced into something plausible.
- **The UI recomputes nothing.** Every figure on every screen is read from the run record, so the screens
  and the audit trail cannot drift apart.
- **Rework is only for construction defects** — a fabricated id, a circular chain, an untestable
  hypothesis. A defect in the *evidence that exists* (one publisher, no internal data) is published and
  caps the band, because re-running cannot conjure evidence.

---

## Three modes, and what changes between them

| Mode | Knowledge | Clock | Reproducible |
|---|---|---|---|
| **DEMO** | pinned snapshots | fixed instant, fixed run id | byte for byte |
| **SNAPSHOT** | pinned snapshots | real clock | same knowledge, live timing |
| **LIVE** | public feeds for discovery; taxonomy and governance stay pinned | real clock | no — and it says so |

LIVE changes discovery and nothing else. Tier still follows source type, so a live item can add evidence
but can never promote it. A browser cannot read a feed that forbids cross-origin access, and a feed that
could not be read is listed on the provenance screen with its reason — never substituted with a
plausible item. Lessons are excluded in DEMO mode so the reproducible run stays reproducible.

---

## The learning loop, and why it cannot be poisoned

A human records what actually happened. Only a **false positive** produces a lesson, and a lesson may
only **tighten** a gate for the pattern it was learned on:

- a *correct* outcome proposes nothing — being right is not evidence the gates are too strict;
- a *false negative* proposes nothing either, because the only change that would have caught it is a
  looser gate, and a run of planted misses would otherwise train the system into recklessness;
- the delta schema cannot even express a looser gate, and `applyPolicyDelta` throws
  `PolicyDeltaRejected` on one handed in past the type;
- every lesson expires after a stated number of runs, and rejected lessons stay visible in the ledger.

---

## The adversarial suite

`src/core/adversarial/attacks.test.ts` holds 15 attacks on the guards rather than tests of the features.
Each one tries to make the system say something it cannot support: instructions hidden in retrieved text,
a fence breaker, a pile-on from one publisher wearing many names, one event syndicated to look like a
trend, an aggregator posing as the publisher, a caller supplying its own tier, a lesson that loosens a
gate, a success story used to argue for less scrutiny, an expired lesson, an edit to the graph after the
fact, a tampered stored run, an escalation demanded without operational evidence, an empty world fished
for a verdict, a red team that can never be satisfied, and a run pushed past its budget.

---

## Knowledge sources

The agents do not browse. They read **pinned, hash-verified snapshots** (3 sources, 4 files) of my own
repositories, so a run is reproducible and provenance is checkable. A fourth repo is the export target.

| Source | What it provides | Verified counts |
|---|---|---|
| [FOMO](https://github.com/Jeevan-0508/FOMO) | The signal feed SCOUT retrieves from | 874 signals |
| [freight-risk-atlas](https://github.com/Jeevan-0508/freight-risk-atlas) / [freight-fraud-taxonomy](https://github.com/Jeevan-0508/freight-fraud-taxonomy) | The RISK ANALYST's pattern base | 12 patterns, 77 indicators, 31 documented false positives, 137 countermeasures |
| [ai-governance-control-room](https://github.com/Jeevan-0508/ai-governance-control-room) | The GOVERNANCE OFFICER's frameworks | 4 frameworks, 56 requirements, 29 controls |
| [risk-os](https://github.com/Jeevan-0508/risk-os) | Export sink — a decision leaves as an import-shaped risk candidate | no snapshot needed |

`public/snapshots/provenance.json` records the upstream commit and a sha256 for every file.
`bun run snapshot:check` fails if a snapshot has drifted from its recorded hash.

Upstream `category` and `severity` labels are **distrusted on principle**: the adapter re-derives the
category by keyword and reports a `category_disagreement` rather than accepting the label. That check was
added because the upstream feed matches news by OR'd keywords, so its own labels are unreliable.

---

## Run it

```bash
bun install
bun run scripts/demo-run.ts        # the full investigation, no key, no network
bun run dev                        # the ten screens at /risk-swarm/
bun test                           # 186 tests, 15 files
./node_modules/.bin/tsc -b --noEmit # typecheck
bun run snapshot:check              # verify snapshots against their recorded hashes
```

Requires [bun](https://bun.sh). There is no backend and no database: the engine is framework-free
TypeScript with zod as the single source of truth for every node shape.

## Repo map

```
src/core/domain/       zod model, append-only risk graph, id factory, node minter
src/core/ingest/       untrusted-input boundary: injection detection, source identity
src/core/intel/        deterministic clustering, possible-duplicate reporting, recurrence buckets
src/core/integrations/ one adapter per knowledge source, behind a snapshot-loader seam
src/core/scoring/      ten factors, disagreement index, hard caps, requirement ladder, tighten-only policy
src/core/reasoner/     the model seam: deterministic default, optional BYO-key LLM
src/core/agents/       the seven agents, plus the reproducible harness (budget + kill switch)
src/core/orchestrator/ fixed phase order, graph assembly, bounded rework
src/core/sources/      LIVE retrieval: feed parsing, content hashing, an operator-configured registry
src/core/learning/     outcomes and tighten-only lessons
src/core/persistence/  versioned run records; a record that fails validation is dropped
src/core/brief/        the markdown decision brief
src/core/adversarial/  15 attacks on the guards
src/app/               the ten screens: a pure renderer over the run record
docs/                  architecture, domain model, agent contracts, scoring, integrations, test strategy
```

## Honest limitations

- **No internal operational data.** Every operational indicator is `unknown`, so the system can evidence
  that a pattern is *discussed* and never that it *occurred*. Supply indicator states and the analysis
  gets sharper; the demo deliberately does not.
- **Lexical pattern matching.** A pattern nobody named in a headline is invisible to this method.
- **The signal feed is news.** News coverage rises when journalists notice something, which is not the
  same as the underlying rate rising. The challenger says so on every run.
- **Framework summaries are plain-language paraphrases**, not legal text, and none of this is legal advice.
- **A red-team pass means "no known defect"**, not "sound". 12 checks run; a weakness outside them passes
  unnoticed.
- **History lives in browser storage.** It is per-browser and per-device, and it is cleared with the
  screen's own discard button. There is no server, so there is nowhere else for it to live.
- **LIVE mode is limited by the browser.** Many feeds refuse cross-origin reads from a static host. The
  system reports each refusal instead of working around it.

## Licence

MIT. Built by [Jeevan Siddhabhaktula](https://github.com/Jeevan-0508).
