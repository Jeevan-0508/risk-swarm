/**
 * EVOLUTION 5.0 Phase I. The ledger is the only mutable thing between a research pass and the approval
 * gate, so the properties worth pinning are the ones whose failure would let a record be rewritten:
 * append-only on the way in, and a malformed or foreign-version store dropped rather than repaired.
 */
import { describe, expect, it } from '../../core/test/bdd';
import { append, loadLedger, proposalFor, recordDecision, saveLedger, type LedgerState } from './ledger';
import { emptyLedger, type KnowledgeDelta } from '../../core/knowledge/delta';
import { proposeTaxonomyChange, rejectProposal } from '../../core/knowledge/approval';
import { packById } from '../../core/packs/registry';

const NOW = '2026-09-14T00:00:00.000Z';

const delta = (over: Partial<KnowledgeDelta> = {}): KnowledgeDelta => ({
  id: 'KD-abc',
  run_id: 'RES-1',
  question: 'does this belong in the taxonomy',
  domain: 'quantum computing',
  subdomains: ['error correction'],
  keywords: ['surface code'],
  status: 'proposed',
  evidence_ids: ['EV-1', 'EV-2'],
  evidence_count: 2,
  distinct_source_count: 2,
  proposed_at: NOW,
  rationale: 'two sources',
  ...over,
});

const state = (...deltas: KnowledgeDelta[]): LedgerState => ({
  ledger: { entries: deltas },
  proposals: [],
});

class MemoryStore {
  private data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
  clear = () => this.data.clear();
  key = () => null;
  get length() {
    return this.data.size;
  }
}

function withStore<T>(store: unknown, body: () => T): T {
  const holder = globalThis as { localStorage?: unknown };
  const previous = holder.localStorage;
  Object.defineProperty(holder, 'localStorage', { value: store, configurable: true, writable: true });
  try {
    return body();
  } finally {
    Object.defineProperty(holder, 'localStorage', { value: previous, configurable: true, writable: true });
  }
}

describe('the persisted research ledger', () => {
  it('appends a delta and refuses the same delta id a second time', () => {
    const first = append(state(), delta());
    expect(first.appended).toBe(true);
    expect(first.state.ledger.entries.length).toBe(1);

    const again = append(first.state, delta({ question: 'a rewritten question' }));
    expect(again.appended).toBe(false);
    expect(again.state.ledger.entries.length).toBe(1);
    expect(again.state.ledger.entries[0].question).toBe('does this belong in the taxonomy');
  });

  it('treats a null delta as nothing to append, which is what a run expecting no update returns', () => {
    const result = append(state(), null);
    expect(result.appended).toBe(false);
    expect(result.state.ledger.entries.length).toBe(0);
  });

  it('never mutates the state it was given', () => {
    const before = state();
    append(before, delta());
    expect(before.ledger.entries.length).toBe(0);
  });

  it('round-trips through a store and drops a record written by another version', () => {
    withStore(new MemoryStore(), () => {
      saveLedger(state(delta()));
      expect(loadLedger().ledger.entries.length).toBe(1);

      globalThis.localStorage.setItem(
        'risk-swarm.research-ledger',
        JSON.stringify({ version: 99, ledger: { entries: [delta()] }, proposals: [] }),
      );
      expect(loadLedger().ledger.entries.length).toBe(0);
    });
  });

  it('drops a malformed entry rather than guessing what it was', () => {
    withStore(new MemoryStore(), () => {
      globalThis.localStorage.setItem(
        'risk-swarm.research-ledger',
        JSON.stringify({ version: 1, ledger: { entries: [delta(), { id: 'KD-x' }] }, proposals: [] }),
      );
      const loaded = loadLedger();
      expect(loaded.ledger.entries.length).toBe(1);
      expect(loaded.ledger.entries[0].id).toBe('KD-abc');
    });
  });

  it('survives a store that refuses to write, without claiming it persisted', () => {
    const blocked = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    withStore(blocked, () => {
      saveLedger(state(delta()));
      expect(loadLedger().ledger.entries.length).toBe(0);
    });
  });

  it('starts empty when there is no store at all, rather than throwing on a server render', () => {
    withStore(undefined, () => {
      expect(loadLedger().ledger.entries).toEqual(emptyLedger().entries);
    });
  });

  it('mirrors a decision onto its delta and finds the proposal again by delta id', () => {
    const d = delta();
    const pack = packById('open');
    const rejected = rejectProposal(proposeTaxonomyChange(d, pack, NOW), {
      by: 'reviewer',
      now: NOW,
      note: 'the domain label is too broad to be a category',
    });

    const next = recordDecision(state(d), rejected);
    expect(next.ledger.entries[0].status).toBe('rejected');
    expect(proposalFor(next, d.id)?.status).toBe('rejected');
    expect(proposalFor(next, 'KD-missing')).toBe(null);
  });

  it('replaces a decision on the same proposal rather than storing two of it', () => {
    const d = delta();
    const proposal = proposeTaxonomyChange(d, packById('open'), NOW);
    const once = recordDecision(state(d), { ...proposal, status: 'rejected', decided_by: 'a', note: 'no' });
    const twice = recordDecision(once, { ...proposal, status: 'rejected', decided_by: 'b', note: 'still no' });
    expect(twice.proposals.length).toBe(1);
    expect(twice.proposals[0].decided_by).toBe('b');
  });
});
