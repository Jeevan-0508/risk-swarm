import { describe, expect, it } from '../test/bdd';
import { freightPack, openPack } from '../packs/registry';
import type { KnowledgeDelta } from './delta';
import { ApprovalRefused, MIN_DISTINCT_SOURCES, approveProposal, proposeTaxonomyChange, rejectProposal, validateProposal } from './approval';

const NOW = '2026-09-14T00:00:00.000Z';

const delta = (over: Partial<KnowledgeDelta> = {}): KnowledgeDelta => ({
  id: 'KD-abc',
  run_id: 'RUN-KD',
  question: 'What are the latest developments in quantum computing?',
  domain: 'quantum computing',
  subdomains: [],
  keywords: ['quantum', 'qubit', 'decoherence'],
  status: 'proposed',
  evidence_ids: ['E-001', 'E-002'],
  evidence_count: 2,
  distinct_source_count: 2,
  proposed_at: NOW,
  rationale: 'two external items across two sources',
  ...over,
});

const decision = { by: 'Jeevan Siddhabhaktula', now: NOW, note: 'Corroborated by two independent sources.' };

describe('the taxonomy approval workflow', () => {
  it('turns a delta into a proposal against a named field of a named pack, still undecided', () => {
    const p = proposeTaxonomyChange(delta(), openPack(), NOW);
    expect(p.kind).toBe('category_rule');
    expect(p.target_pack_id).toBe(openPack().id);
    expect(p.status).toBe('proposed');
    expect(p.decided_by).toBeNull();
    expect(p.category).toBe('quantum computing');
    expect(p.terms).toEqual(['quantum', 'qubit', 'decoherence']);
  });

  it('validates a well-supported proposal against a pack that has no conflicting category', () => {
    const v = validateProposal(proposeTaxonomyChange(delta(), openPack(), NOW), openPack());
    expect(v.ok).toBe(true);
    expect(v.failures).toEqual([]);
  });

  it('refuses a proposal supported by one source repeated, rather than treating repetition as corroboration', () => {
    const p = proposeTaxonomyChange(delta({ distinct_source_count: 1, evidence_count: 4 }), openPack(), NOW);
    const v = validateProposal(p, openPack());
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes(`minimum of ${MIN_DISTINCT_SOURCES}`))).toBe(true);
  });

  it('refuses a category with no terms, which would add a name that can never match anything', () => {
    const v = validateProposal(proposeTaxonomyChange(delta({ keywords: [] }), openPack(), NOW), openPack());
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes('no terms'))).toBe(true);
  });

  it('refuses to overwrite a category the pack already pins', () => {
    const pack = freightPack();
    const existing = pack.category_rules[0]![0];
    const v = validateProposal(proposeTaxonomyChange(delta({ domain: existing }), pack, NOW), pack);
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes('already has a category'))).toBe(true);
  });

  it('refuses a term that already belongs to another category, so no signal can match two', () => {
    const pack = freightPack();
    const takenTerm = pack.category_rules[0]![1][0]!;
    const v = validateProposal(proposeTaxonomyChange(delta({ keywords: [takenTerm] }), pack, NOW), pack);
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes('already belongs to category'))).toBe(true);
  });

  it('refuses a proposal validated against a pack it does not target', () => {
    const v = validateProposal(proposeTaxonomyChange(delta(), openPack(), NOW), freightPack());
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes('was validated against'))).toBe(true);
  });

  it('adds the category to a NEW pack on approval, and leaves the pack it was given untouched', () => {
    const pack = openPack();
    const before = pack.category_rules.length;
    const result = approveProposal(proposeTaxonomyChange(delta(), pack, NOW), pack, decision);

    expect(result.pack.category_rules.length).toBe(before + 1);
    expect(result.pack.category_rules.at(-1)).toEqual(['quantum computing', ['quantum', 'qubit', 'decoherence']]);
    expect(pack.category_rules.length).toBe(before);
    expect(result.proposal.status).toBe('approved');
    expect(result.proposal.decided_by).toBe('Jeevan Siddhabhaktula');
    expect(result.proposal.decided_at).toBe(NOW);
  });

  it('never changes canonical knowledge anonymously', () => {
    const pack = openPack();
    const p = proposeTaxonomyChange(delta(), pack, NOW);
    expect(() => approveProposal(p, pack, { ...decision, by: '   ' })).toThrow(ApprovalRefused);
  });

  it('never approves a proposal that failed validation, however it was asked', () => {
    const pack = openPack();
    const p = proposeTaxonomyChange(delta({ distinct_source_count: 1 }), pack, NOW);
    let refused: unknown = null;
    try {
      approveProposal(p, pack, decision);
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(ApprovalRefused);
    expect((refused as ApprovalRefused).reasons.length > 0).toBe(true);
    expect(pack.category_rules.some(([c]) => c === 'quantum computing')).toBe(false);
  });

  it('will not decide the same proposal twice', () => {
    const pack = openPack();
    const approved = approveProposal(proposeTaxonomyChange(delta(), pack, NOW), pack, decision).proposal;
    expect(() => approveProposal(approved, pack, decision)).toThrow(ApprovalRefused);
    expect(() => rejectProposal(approved, decision)).toThrow(ApprovalRefused);
  });

  it('requires a reason to reject, and records who rejected it', () => {
    const p = proposeTaxonomyChange(delta(), openPack(), NOW);
    expect(() => rejectProposal(p, { ...decision, note: '  ' })).toThrow(ApprovalRefused);
    const rejected = rejectProposal(p, { ...decision, note: 'Both sources trace to the same press release.' });
    expect(rejected.status).toBe('rejected');
    expect(rejected.note).toContain('press release');
    expect(rejected.decided_by).toBe('Jeevan Siddhabhaktula');
  });
});
