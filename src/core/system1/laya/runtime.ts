/**
 * Real Laya inference (SYSTEM-1 directive §3). Laya has no HTTP API — the only real, honest way to
 * call it is the actual `laya` PyPI package (Apache-2.0, `convaiinnovations/laya*` on HuggingFace),
 * which needs torch + transformers. Rather than pull that into this repo's bun/TS/browser dependency
 * tree, this shells out to `scripts/laya_infer.py` via `uv run` — the same "real runtime, isolated
 * behind a narrow contract" shape `core/reasoner/*.ts` uses for an HTTP provider, just over a
 * subprocess boundary instead of a network one.
 *
 * This subprocess only ever runs in a Node/Bun context (test runner, or a local `bun run` script) —
 * never inside the deployed static app. RISK//SWARM ships as a GitHub Pages site with no backend
 * (see `core/reasoner/llm.ts`'s own doc comment on BYOK/CORS); a browser cannot spawn a Python
 * process. Laya's real inference path is proven here and by the evaluation harness, not claimed to
 * run live inside the shipped site — the honest ceiling this repo already applies to other
 * local-only tooling (Jeevan's own "CSV export + local script" pattern elsewhere in this ecosystem).
 *
 * Known limitation, stated rather than hidden: each call cold-loads the checkpoint (~10-20s observed
 * for laya-typed-decisions on CPU) because the process does not persist between calls.
 */
import { spawnSync } from 'bun';
import { fileURLToPath } from 'url';

export type LayaQuestion = {
  type: 'choice' | 'score' | 'noul';
  instructions: string;
  criteria?: Record<string, string | null> | string[];
};

export type LayaInferenceInput = {
  checkpoint: string;
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, LayaQuestion>;
};

export type LayaRawAnswer = {
  type: 'choice' | 'score' | 'noul';
  choice?: string;
  score?: number;
  noul?: number;
  probabilities?: Record<string, number>;
  confidence: number;
  action?: { act_probability: number };
  legend?: Record<string, string>;
};

export type LayaRawResult = {
  model: string;
  answers: Record<string, LayaRawAnswer>;
  usage: { input_tokens: number; output_tokens: number };
};

export type LayaRuntimeResult =
  | { ok: true; load_seconds: number; infer_seconds: number; result: LayaRawResult }
  | { ok: false; error: string };

const SCRIPT_PATH = fileURLToPath(new URL('../../../../scripts/laya_infer.py', import.meta.url));

/** Real subprocess call. Not exercised by the default `bun test` run (see `runtime.test.ts`) — it
 * needs a working `uv` + network + torch, which CI/other machines may not have; gating it behind an
 * explicit call site keeps the default suite fast and always green. */
export function callLayaSubprocess(input: LayaInferenceInput, timeoutMs = 60_000): LayaRuntimeResult {
  const proc = spawnSync({
    cmd: ['uv', 'run', '--with', 'laya', 'python', SCRIPT_PATH],
    stdin: Buffer.from(JSON.stringify(input)),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, USE_TF: '0', HF_HUB_DISABLE_SYMLINKS: '1' },
    timeout: timeoutMs,
  });

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString('utf-8').trim();
    return { ok: false, error: `laya_infer.py exited ${proc.exitCode}: ${stderr.slice(-2000) || '(no stderr)'}` };
  }

  const stdout = proc.stdout.toString('utf-8').trim();
  try {
    const parsed = JSON.parse(stdout);
    return parsed as LayaRuntimeResult;
  } catch {
    return { ok: false, error: `laya_infer.py produced non-JSON stdout: ${stdout.slice(0, 500)}` };
  }
}

/** Normalized Shannon entropy in [0,1] of a real probability distribution — System-1-computed, not
 * a native Laya field. */
export function shannonUncertainty(probabilities: Record<string, number> | undefined | null): number | null {
  if (!probabilities) return null;
  const values = Object.values(probabilities).filter((p) => p > 0);
  const k = Object.keys(probabilities).length;
  if (k <= 1) return 0;
  const entropy = -values.reduce((sum, p) => sum + p * Math.log(p), 0);
  return entropy / Math.log(k);
}

/** Pure mapping from Laya's real raw answer to System1Result's decision/confidence/uncertainty
 * fields. No subprocess, no network — safe to unit-test against a captured fixture. */
export function mapLayaAnswer(answer: LayaRawAnswer) {
  const decision = answer.type === 'choice' ? (answer.choice ?? '')
    : answer.type === 'score' ? String(answer.score ?? '')
    : String(answer.noul ?? '');

  return {
    decision,
    confidence: answer.confidence,
    uncertainty: shannonUncertainty(answer.probabilities),
    raw: answer as Record<string, unknown>,
  };
}
