/**
 * EVOLUTION 5.0 Phase I - the research ledger, persisted.
 *
 * `core/knowledge/delta.ts` already defines an append-only ledger as a pure value. This adds the only
 * thing it lacked: somewhere for it to live between page loads. Nothing here decides anything - it
 * loads, appends and stores, and every state transition on a proposal is computed by
 * `core/knowledge/approval.ts`.
 *
 * Append-only is enforced on the way in. `append()` refuses a delta id the ledger already holds rather
 * than replacing it, because a ledger whose entries can be overwritten is not a record of what was
 * proposed, it is a record of what somebody currently wants to have proposed.
 *
 * A malformed or future-version record is dropped, not repaired. The same policy
 * `core/persistence/serialize.ts` documents for runs: a guessed field is worse than a missing one.
 */
// Relative rather than aliased on purpose: `bun test` does not read tsconfig path aliases, and a
// persistence layer that cannot be tested is a persistence layer nobody has checked.
import { appendDelta, emptyLedger, type KnowledgeDelta, type ResearchLedger } from '../../core/knowledge/delta';
import type { TaxonomyProposal } from '../../core/knowledge/approval';

const KEY = 'risk-swarm.research-ledger';
const VERSION = 1;

interface Stored {
  version: number;
  ledger: ResearchLedger;
  /** Decisions taken on screen 14, keyed by proposal id. A proposal is derived; its decision is not. */
  proposals: TaxonomyProposal[];
}

export interface LedgerState {
  ledger: ResearchLedger;
  proposals: TaxonomyProposal[];
}

const empty = (): LedgerState => ({ ledger: emptyLedger(), proposals: [] });

function isDelta(value: unknown): value is KnowledgeDelta {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Partial<KnowledgeDelta>;
  return (
    typeof d.id === 'string' &&
    typeof d.run_id === 'string' &&
    typeof d.domain === 'string' &&
    Array.isArray(d.keywords) &&
    Array.isArray(d.evidence_ids) &&
    (d.status === 'proposed' || d.status === 'approved' || d.status === 'rejected')
  );
}

export function loadLedger(): LedgerState {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw === null || raw === undefined) return empty();
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (parsed.version !== VERSION) return empty();
    const entries = Array.isArray(parsed.ledger?.entries) ? parsed.ledger.entries.filter(isDelta) : [];
    const proposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];
    return { ledger: { entries }, proposals };
  } catch {
    return empty();
  }
}

export function saveLedger(state: LedgerState): void {
  try {
    const stored: Stored = { version: VERSION, ledger: state.ledger, proposals: state.proposals };
    globalThis.localStorage?.setItem(KEY, JSON.stringify(stored));
  } catch {
    // A full or blocked store must not break the screen. The in-memory state is still correct, and the
    // screen says nothing was persisted rather than pretending it was.
  }
}

export interface AppendResult {
  state: LedgerState;
  /** False when the delta was already on the ledger. Append-only means it is not replaced. */
  appended: boolean;
}

export function append(state: LedgerState, delta: KnowledgeDelta | null): AppendResult {
  if (delta === null) return { state, appended: false };
  if (state.ledger.entries.some((e) => e.id === delta.id)) return { state, appended: false };
  return { state: { ...state, ledger: appendDelta(state.ledger, delta) }, appended: true };
}

/** Records a decision computed by `approveProposal`/`rejectProposal`, and mirrors it onto its delta. */
export function recordDecision(state: LedgerState, proposal: TaxonomyProposal): LedgerState {
  const proposals = [...state.proposals.filter((p) => p.id !== proposal.id), proposal];
  const entries = state.ledger.entries.map((d) =>
    d.id === proposal.delta_id && proposal.status !== 'proposed' ? { ...d, status: proposal.status } : d,
  );
  return { ledger: { entries }, proposals };
}

export const proposalFor = (state: LedgerState, deltaId: string): TaxonomyProposal | null =>
  state.proposals.find((p) => p.delta_id === deltaId) ?? null;
