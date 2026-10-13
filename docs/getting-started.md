# Getting started

## Install and run

```bash
bun install
bun run dev
```

Open the Vite URL and start in Demo mode for the reproducible freight-risk investigation. The UI is a static browser application; there is no required backend for the demo path.

## Optional model providers

The `.env.example` file documents the Node/Bun-side `JEV_API_KEY` boundary. Browser-entered provider keys are held in guarded local storage and sent only to the provider selected by the user. Review the in-app warning and the provider documentation before using a real key.

## Useful validation commands

```bash
bun run typecheck
bun test
bun run build
bun run snapshot:check
```

`bun run scripts/demo-run.ts` prints a complete deterministic investigation record, including phases, findings, evidence chains, gates, budget, and attempts.
