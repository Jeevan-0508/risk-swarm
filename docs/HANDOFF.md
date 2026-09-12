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
| RISK//OS export sink (import-shaped candidate risk) | `src/core/integrations/riskos.ts` | pending |

## Next, in order
1. `src/core/scoring/` — ten factors, disagreement index, hard caps, action-band ladder (`docs/SCORING.md`).
2. `src/core/reasoner/` — `Reasoner` interface + `DeterministicReasoner`.
3. `src/core/agents/` — the seven agents against `docs/AGENT-CONTRACTS.md`.
4. `src/core/orchestrator/` — plan, budget ledger, state machine, kill switch, rework loop.
5. `tests/adversarial` — the 15 attacks in `docs/TEST-STRATEGY.md`.
6. `src/core/learning/` — outcome → lesson → bounded scoring delta.
7. `src/core/brief/` — node-referenced brief renderer (no free strings).
8. `src/app/` — 10 screens, dark Swiss enterprise.
9. README (diagram, worked example, honest limitations), CI, Pages deploy.

## Findings that shape the demo (real data, 24-month DACH window)
- 12 signals survive filtering out of 874 scanned: 7 insolvency, 1 carrier fraud, 2 disruption,
  1 regulatory, 1 unclassified. 478/317 excluded by window, 329/468 by freight relevance.
- Only **one** fraud signal (`GPS-Tracker entlarvt Fake-Frachtführer in Köln`, trans.info, 2026-07-06)
  and it is from a single publisher. So the honest answer to the demo question is **not** "escalate":
  it is monitor, with the better-evidenced adjacent risk being insolvency-driven carrier substitution.
  The demo therefore proves the point of the system rather than flattering it.
- One publisher in the DACH set is `facebook.com` (a DW repost). Useful: it exercises tier weighting.
