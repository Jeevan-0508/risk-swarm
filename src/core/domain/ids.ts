import type { NodeKind } from './model';

const PREFIX: Record<NodeKind, string> = {
  signal: 'S',
  observation: 'O',
  hypothesis: 'H',
  evidence: 'E',
  challenge: 'C',
  red_team_finding: 'R',
  decision: 'D',
  action: 'A',
  outcome: 'U',
  lesson: 'L',
};

/** Deterministic, per-run, gap-free ids. No randomness anywhere in the engine. */
export class IdFactory {
  private counters = new Map<NodeKind, number>();

  next(kind: NodeKind): string {
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    return `${PREFIX[kind]}-${String(n).padStart(3, '0')}`;
  }

  peek(kind: NodeKind): number {
    return this.counters.get(kind) ?? 0;
  }
}

export const idPrefix = (kind: NodeKind): string => PREFIX[kind];
export const kindOfId = (id: string): NodeKind | null => {
  const p = id.split('-')[0];
  const hit = (Object.keys(PREFIX) as NodeKind[]).find((k) => PREFIX[k] === p);
  return hit ?? null;
};
