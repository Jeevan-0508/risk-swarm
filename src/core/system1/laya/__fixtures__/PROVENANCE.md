# Laya fixture provenance

Both files here are byte-for-byte captures of a real `laya.load(checkpoint).predict()` call made via
`scripts/laya_infer.py` on 2026-09-23, over `uv run --with laya python scripts/laya_infer.py`, real
network (HuggingFace Hub) and real inference (CPU, torch). Neither is hand-written or edited.

Input case (identical for both, so the only variable is the checkpoint):

> "A carrier assigned to a high-value electronics load in the EU lane went dark for 6 hours, then
> resumed with a route deviation of 180km and no explanation logged. The carrier has one prior
> missing-trailer incident in the last 12 months."
>
> Question: "Given this carrier behavior, what action should a fraud investigator take?"
> Choices: NOTE / MONITOR / TARGETED_INVESTIGATION / ESCALATE

| file | checkpoint | choice | confidence | load_seconds |
|---|---|---|---|---|
| `laya-typed-eu-carrier-dark-case.json` | `convaiinnovations/laya-typed-decisions` | MONITOR | 0.0418 | 11.95 |
| `laya-english-eu-carrier-dark-case.json` | `convaiinnovations/laya` | MONITOR | 0.1846 | 12.13 |

Both checkpoints agree on MONITOR here — a real result, not selected to make the Arena's agreement
path look good. The Arena's disagreement path is exercised in tests by a separate, explicitly labeled
*synthetic* fixture (`arena/__fixtures__/synthetic-disagreement.md` — see `arena/compare.test.ts`),
never presented as a live capture.

Confidence on both is low relative to what the number might suggest at a glance — consistent with
`laya-typed`'s own known limitation (ECE 0.213, i.e. over/under-confident) and with neither checkpoint
being benchmarked on carrier-fraud data. Not evidence either checkpoint is "right"; only evidence the
subprocess path is genuinely live.
