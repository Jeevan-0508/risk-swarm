# Build handoff — state of the implementation

Updated after every slice. Read this first, then `git log --oneline`.

## Stack facts
- One package, no monorepo. `src/core` (engine, no DOM) + `src/app` (React, later slices).
- Runtime + tests: **bun** (`bun test`). BDD functions come from `src/core/test/bdd.ts` only.
- Typecheck: `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` (bun has no `bunx` here).
- Snapshots: `bun run snapshot:sync` (from sibling clones) / `snapshot:check` (hash verify, CI).

## Done (all green)
| Slice | Files | Tests |
|---|---|---|
| Scaffold, Tailwind tokens, Pages base | `package.json`, `vite.config.ts`, `tailwind.config.js` | — |
| Snapshot sync + provenance (sha256 + upstream commit) | `scripts/sync-snapshots.mjs` | verified by `--check` |
| Domain model (zod is the single source of truth) | `src/core/domain/model.ts` | via graph tests |
| Append-only risk graph, evidence chain, cycle detection | `src/core/domain/graph.ts`, `ids.ts`, `build.ts` | 9 |
| Untrusted-input boundary, injection flags, source identity | `src/core/ingest/sanitize.ts` | 11 |
| Deterministic clustering, possible-duplicate reporting, recurrence buckets | `src/core/intel/cluster.ts` | 13 |
| FOMO adapter (874 real signals, category distrust, aggregator handling) | `src/core/integrations/fomo.ts` | 15 |
| Atlas adapter (12 patterns / 77 indicators / 31 gates, coverage maths) | `src/core/integrations/atlas.ts` | 10 |
| Control Room adapter (4 frameworks / 56 requirements, citation gate) | `src/core/integrations/governance.ts` | 8 |
| RISK//OS export sink (import-shaped candidate risk) | `src/core/integrations/riskos.ts` | via decision tests |
| Scoring: ten factors, disagreement index, hard caps, action ladder | `src/core/scoring/score.ts` | 18 |
| Learning policy: tighten-only lesson deltas | `src/core/scoring/policy.ts` | 4 |
| Reasoning seam: deterministic + BYO-key LLM, fabricated-citation rejection | `src/core/reasoner/*` | 12 |
| Seven agents (scout, intelligence, analyst, governance, challenger, red team, decision) | `src/core/agents/*.ts` | 26 |
| Harness: reproducible context, budget ledger, kill switch | `src/core/agents/harness.ts` | covered above |
| Orchestrator: fixed phase order, graph assembly, bounded rework | `src/core/orchestrator/run.ts` | 9 |
| Demo CLI (`bun run scripts/demo-run.ts`) | `scripts/demo-run.ts` | — |

## Next, in order
1. `tests/adversarial` — the 15 attacks in `docs/TEST-STRATEGY.md` (5 are already covered by the agent suite).
2. `src/core/learning/` — outcome → lesson → bounded scoring delta (policy side already done).
3. `src/core/brief/` — node-referenced brief renderer (no free strings).
4. `src/app/` — 10 screens, dark Swiss enterprise.
5. README (diagram, worked example, honest limitations), CI, Pages deploy.

## Demo result, verified (`bun run scripts/demo-run.ts`)
24-month DACH road window over 874 FOMO signals: 12 survive, 12 distinct event clusters, 8 publishers,
2 hypotheses (FFT-002 phantom carrier, FFT-008 GPS spoofing), 13 challenges, 5 red-team findings
(verdict `fail`), 64 graph nodes / 97 edges, no cycles.

**MONITOR, severity HIGH 0.525, urgency ELEVATED, confidence withheld** — 3 unresolved blocking
findings. Four escalation requirements unmet: blocking findings open, confidence withheld,
false-positive risk 0.41, and no tier-1/2 source behind the incident claim. This is the honest answer
and the README must keep it: the demo proves the system's point instead of flattering it.

## Decisions taken while wiring the agents
- **Independence excludes structure evidence.** A regulatory citation is tier 1 but can never make an
  event independently reported, so `independent_evidence_count` counts `incident_claim` evidence only.
  Otherwise the governance officer could satisfy the escalation gate by citing more law.
- **The tier-1/2 escalation gate is judged on incident evidence** for the same reason.
- **The action band is the highest rung whose requirements are met**, not one drop per failed gate.
  The penalty-count version collapsed a real 8-publisher signal to NOTE, which is how a system teaches
  its users to ignore it. Every unmet requirement is still named in `gates_failed`.
- **Rework is only for construction defects** (fabricated id, circular chain, untestable hypothesis).
  A defect in the evidence that exists (one publisher, no operational data, benign baseline) is
  published and caps the band, because re-running cannot conjure evidence.
- **Red team is asymmetric**: a `fail` can stop an escalation, nothing it produces can create one.

## Findings that shape the demo (real data, 24-month DACH window)
- 12 signals survive filtering out of 874 scanned: 7 insolvency, 1 carrier fraud, 2 disruption,
  1 regulatory, 1 unclassified. 478/317 excluded by window, 329/468 by freight relevance.
- Only **one** fraud signal (`GPS-Tracker entlarvt Fake-Frachtführer in Köln`, trans.info, 2026-07-06)
  and it is from a single publisher. So the honest answer to the demo question is **not** "escalate":
  it is monitor, with the better-evidenced adjacent risk being insolvency-driven carrier substitution.
  The demo therefore proves the point of the system rather than flattering it.
- One publisher in the DACH set is `facebook.com` (a DW repost). Useful: it exercises tier weighting.
