/**
 * The reasoning seam.
 *
 * Every agent is written so that it produces a complete, valid result with no model at all. A model,
 * when configured, may only *replace phrasing or add candidate wording* inside a structure the agent
 * already built and validated. Three consequences, all deliberate:
 *
 *   1. DEMO MODE needs no API key and is byte-for-byte reproducible.
 *   2. A model failure degrades to the deterministic result instead of failing the investigation.
 *   3. Anything a model produced is tier 5 and carries zero evidential weight in the scorer.
 */

export interface ReasonRequest<T> {
  /** Stable task name, used for prompt selection, cost accounting and the activity log. */
  task: string;
  /** Fixed instruction. Retrieved content can never reach this position. */
  instruction: string;
  /** Structured, already-sanitised facts the model may use, rendered as fenced data blocks. */
  data_blocks: string[];
  /** Evidence ids the model is allowed to cite. Citing anything else invalidates the whole output. */
  allowed_evidence_ids: string[];
  /** Shape description for the model, and the validator that decides whether it complied. */
  schema_hint: string;
  validate: (raw: unknown) => T;
  /** The deterministic answer. Always computed; used as-is in demo mode and on any model failure. */
  fallback: () => T;
}

export interface ReasonResult<T> {
  value: T;
  provider: string;
  /** True when the model was asked but its answer was not usable, so the fallback was returned. */
  degraded: boolean;
  degraded_reason: string | null;
  est_tokens: number;
  ms: number;
}

export interface Reasoner {
  readonly id: string;
  readonly uses_network: boolean;
  propose<T>(req: ReasonRequest<T>): Promise<ReasonResult<T>>;
}

/** Collects ids an output tried to cite, however deeply nested, for the provenance check. */
export function citedIds(value: unknown, pattern = /^[A-Z]{1,2}-\d{2,}$/): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      if (pattern.test(v)) out.add(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return [...out].sort();
}

export class FabricatedCitationError extends Error {
  constructor(readonly offending: string[]) {
    super(`REJECTED_PROVENANCE: output cited evidence it was never given: ${offending.join(', ')}`);
    this.name = 'FabricatedCitationError';
  }
}

/** Rejects an output that cites evidence the agent never received. Used by every reasoner. */
export function assertNoFabricatedCitations(value: unknown, allowed: string[]): void {
  const allowedSet = new Set(allowed);
  const offending = citedIds(value).filter((id) => !allowedSet.has(id));
  if (offending.length > 0) throw new FabricatedCitationError(offending);
}
