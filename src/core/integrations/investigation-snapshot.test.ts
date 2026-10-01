import { describe, expect, it } from 'bun:test';
import { buildInvestigationSnapshot, candidateInvestigationQuestion } from './investigation-snapshot';
import { NOW, candidate, researchOutcome } from './investigation-fixture';
import { SwarmReplayCapture } from './replay-capture';
import { validateInvestigationSnapshot, buildReplayInvestigationHandoff, validateReplayInvestigationHandoff } from '../../../contracts/investigation-v1.mjs';
const validCapture = (v: unknown) => SwarmReplayCapture.safeParse(v).success;
const make = () => buildInvestigationSnapshot({ outcome: researchOutcome(), question: 'Contract fixture question?', capturedAt: NOW, candidate, council: null });
describe('frozen investigation boundary', () => {
  it('keeps synthetic context separate, unknown outcomes explicit and preserves detached history', () => {
    const s = make(); const h = buildReplayInvestigationHandoff(s, NOW, validCapture);
    s.capture.research.question = 'changed current state';
    expect(h.reconstruction.question).toBe('Contract fixture question?');
    expect(h.reconstruction.live_provider_calls).toBe(0);
    expect(h.reconstruction.synthetic_context_used_as_evidence).toBe(false);
    expect(h.snapshot.outcome.correctness).toBe('unknown');
    expect(validateReplayInvestigationHandoff(h, validCapture).ok).toBe(true);
  });
  it('rejects reconstructed history tampering, invented outcomes and synthetic source relabeling', () => {
    const h = buildReplayInvestigationHandoff(make(), NOW, validCapture);
    h.reconstruction.question = 'forged';
    expect(validateReplayInvestigationHandoff(h, validCapture).ok).toBe(false);
    const s: any = make(); s.outcome.correctness = 'correct';
    expect(validateInvestigationSnapshot(s, validCapture).ok).toBe(false);
    s.outcome.correctness = 'unknown'; s.capture.research.source_records[0].data_class = 'synthetic_simulation';
    expect(validateInvestigationSnapshot(s, validCapture).ok).toBe(false);
  });
  it('rejects missing references, chronology, fabricated analysis and malicious structures', () => {
    const s: any = make(); s.analysis.selected_source_ids = ['fraud-watch:SIG-001'];
    expect(validateInvestigationSnapshot(s, validCapture).ok).toBe(false);
    expect(() => buildReplayInvestigationHandoff(make(), '2020-01-01T00:00:00Z', validCapture)).toThrow();
    s.analysis.selected_source_ids = []; s.analysis.positions.push({ agent: 'ATHENA', stance: 'certain' });
    expect(validateInvestigationSnapshot(s, validCapture).ok).toBe(false);
    const cyclic: any = make(); cyclic.loop = cyclic;
    expect(validateInvestigationSnapshot(cyclic, validCapture).ok).toBe(false);
    expect(validateInvestigationSnapshot(JSON.parse('{"__proto__":{}}'), validCapture).ok).toBe(false);
    expect(validateInvestigationSnapshot(make(), () => { throw new Error('bad'); }).ok).toBe(false);
  });
  it('drafts a research question that explicitly preserves hypothesis status', () => {
    const q = candidateInvestigationQuestion(candidate);
    expect(q).toContain('synthetic simulation'); expect(q).toContain('independent external evidence');
    expect(q).not.toContain('SIG-001');
  });
});
