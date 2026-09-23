/**
 * The Laya model registry (SYSTEM-1 directive §3). `laya-typed` is the fine-tuned typed-decisions
 * checkpoint; `laya-english`/`laya-multilingual` are its general-purpose base checkpoints. All three
 * are real, independently connected models (see `runtime.ts`, `scripts/laya_infer.py`), each proven
 * with a captured live fixture rather than asserted from a model card alone.
 *
 * Status is `SHADOW`, not `LIVE`-authoritative: a real Laya result is recorded for every case System-1
 * evaluates, but per the directive's §20 stop condition, System-1 does not yet replace SWARM's own
 * final answer for any case in the shipped app — see `router/policy.ts`.
 */
export interface LayaModelProfile {
  model_id: 'laya-typed' | 'laya-english' | 'laya-multilingual';
  checkpoint: string;
  license: string;
  parameter_count: number;
  self_reported_accuracy: number;
  self_reported_brier_score: number | null;
  self_reported_ece: number | null;
  known_limitations: string[];
}

export const LAYA_TYPED: LayaModelProfile = {
  model_id: 'laya-typed',
  checkpoint: 'convaiinnovations/laya-typed-decisions',
  license: 'apache-2.0',
  parameter_count: 421_000_000,
  self_reported_accuracy: 0.766,
  self_reported_brier_score: 0.062,
  self_reported_ece: 0.213,
  known_limitations: [
    'English-only specialist fine-tuned on four synthetic workflows (invoice processing, security '
      + 'incidents, customer service, agent-trace observability); expect base-checkpoint-or-worse '
      + 'accuracy on carrier-fraud cases until System-1 benchmarks it directly (directive §21).',
    'Still over-confident per its own model card (ECE 0.213) versus the third-party Jev figure it '
      + 'benchmarks against (ECE 0.144, unverified by this repo).',
  ],
};

export const LAYA_ENGLISH: LayaModelProfile = {
  model_id: 'laya-english',
  checkpoint: 'convaiinnovations/laya',
  license: 'apache-2.0',
  parameter_count: 421_000_000,
  self_reported_accuracy: 0.362,
  self_reported_brier_score: null,
  self_reported_ece: null,
  known_limitations: [
    'General-purpose base checkpoint, not fine-tuned for typed-decisions: published accuracy on the '
      + 'typed-decisions test split is 0.362, far below laya-typed. Exists to give the Arena a '
      + 'genuinely independent second Laya checkpoint, not because it is a good typed-decision model.',
  ],
};

export const LAYA_MULTILINGUAL: LayaModelProfile = {
  model_id: 'laya-multilingual',
  checkpoint: 'convaiinnovations/laya-multilingual',
  license: 'apache-2.0',
  parameter_count: 322_000_000,
  self_reported_accuracy: 0.342,
  self_reported_brier_score: null,
  self_reported_ece: null,
  known_limitations: [
    'General-purpose multilingual base checkpoint, not fine-tuned for typed-decisions: published '
      + 'accuracy on the typed-decisions test split is 0.342, far below laya-typed.',
  ],
};

export const LAYA_REGISTRY: LayaModelProfile[] = [LAYA_TYPED, LAYA_ENGLISH, LAYA_MULTILINGUAL];

/** System-1's default checkpoint for the primary fast layer (directive §3, §8): the one fine-tuned
 * for typed decisions, not a general-purpose base model pressed into service. */
export const DEFAULT_LAYA_MODEL_ID: LayaModelProfile['model_id'] = 'laya-typed';

export function findLayaProfile(modelId: string): LayaModelProfile | undefined {
  return LAYA_REGISTRY.find((p) => p.model_id === modelId);
}
