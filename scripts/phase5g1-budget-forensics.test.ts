import { describe, expect, test } from 'bun:test';
import { MockTransport, type HttpRequest } from '../src/swarm/models/transport';
import {
  PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET,
  PHASE5E_MAX_CHALLENGE_RESPONSE_REQUEST_BUDGET,
  PHASE5E_ROUND1_REQUEST_BUDGET,
  Phase5eBudgetLedger,
  Phase5eExecutionState,
  Phase5eLiveBudgetedTransport,
  classifyPhase5eFailure,
} from './phase5e-live-full-round';

const categoryLimits = {
  ROUND1_ANALYSIS: PHASE5E_ROUND1_REQUEST_BUDGET,
  CHALLENGE_GENERATION: 1,
  CHALLENGE_RESPONSE: PHASE5E_MAX_CHALLENGE_RESPONSE_REQUEST_BUDGET,
  ZEUS_SYNTHESIS: 0,
} as const;

async function execute(categories: readonly HttpRequest['budget_category'][]) {
  const calls: HttpRequest[] = [];
  const delegate = new MockTransport((request) => { calls.push(request); return { status: 200, headers: {}, body: '{}' }; });
  const ledger = new Phase5eBudgetLedger(PHASE5E_GLOBAL_PROVIDER_REQUEST_BUDGET, categoryLimits);
  const transport = new Phase5eLiveBudgetedTransport(delegate, ledger, new Phase5eExecutionState());
  for (const budget_category of categories) {
    try { await transport.request({ method: 'POST', url: 'https://mock.invalid', budget_category }); } catch { /* blocked requests are intentionally not transport calls */ }
  }
  return { ledger: ledger.stats(), calls };
}

function sequence(round1: number, generation: number, responses: number, zeus = 0): NonNullable<HttpRequest['budget_category']>[] {
  return [
    ...Array.from({ length: round1 }, () => 'ROUND1_ANALYSIS' as const),
    ...Array.from({ length: generation }, () => 'CHALLENGE_GENERATION' as const),
    ...Array.from({ length: responses }, () => 'CHALLENGE_RESPONSE' as const),
    ...Array.from({ length: zeus }, () => 'ZEUS_SYNTHESIS' as const),
  ];
}

describe('Phase 5G.1 global provider budget forensics', () => {
  test('the historical terminal label is distinguished from a protocol budget error', () => {
    expect(classifyPhase5eFailure(new Error('BUDGET_EXCEEDED'))).toBe('PROTOCOL_BUDGET');
    expect(classifyPhase5eFailure(new Error('PHASE5E_GLOBAL_PROVIDER_BUDGET'))).toBe('GLOBAL_PROVIDER_BUDGET');
    expect(classifyPhase5eFailure(new Error('PHASE5E_CHALLENGE_RESPONSE_CATEGORY_BUDGET'))).toBe('CHALLENGE_RESPONSE_CATEGORY_BUDGET');
  });

  test.each([
    ['5 requests', sequence(4, 1, 0), 5],
    ['6 requests', sequence(4, 1, 1), 6],
    ['7 requests', sequence(4, 1, 2), 7],
    ['11 requests', sequence(4, 1, 6), 11],
  ])('%s is admitted and ledger equals mock transport calls', async (_label, categories, expected) => {
    const result = await execute(categories);
    expect(result.ledger.attempted).toBe(expected);
    expect(result.ledger.attempted).toBe(result.calls.length);
    expect(result.ledger.blocked).toBe(0);
  });

  test('the twelfth request is blocked before transport and the eleventh remains admitted', async () => {
    const result = await execute([...sequence(4, 1, 6), 'CHALLENGE_RESPONSE']);
    expect(result.ledger).toMatchObject({ maximum: 11, attempted: 11, admitted: 11, blocked: 1 });
    expect(result.calls).toHaveLength(11);
  });

  test('the first challenge response after five valid requests is admitted', async () => {
    const result = await execute(sequence(4, 1, 1));
    expect(result.ledger.category_attempted).toMatchObject({ ROUND1_ANALYSIS: 4, CHALLENGE_GENERATION: 1, CHALLENGE_RESPONSE: 1 });
    expect(result.calls).toHaveLength(6);
  });

  test('category limits block independently without masquerading as global exhaustion', async () => {
    const round1 = await execute(sequence(5, 0, 0));
    const generation = await execute(sequence(0, 2, 0));
    const response = await execute(sequence(0, 0, 7));
    const zeus = await execute(sequence(0, 0, 0, 1));
    expect(round1.ledger).toMatchObject({ attempted: 4, blocked: 1, category_blocked: { ROUND1_ANALYSIS: 1 } });
    expect(generation.ledger).toMatchObject({ attempted: 1, blocked: 1, category_blocked: { CHALLENGE_GENERATION: 1 } });
    expect(response.ledger).toMatchObject({ attempted: 6, blocked: 1, category_blocked: { CHALLENGE_RESPONSE: 1 } });
    expect(zeus.ledger).toMatchObject({ attempted: 0, blocked: 1, category_blocked: { ZEUS_SYNTHESIS: 1 } });
    expect(round1.calls).toHaveLength(4);
    expect(generation.calls).toHaveLength(1);
    expect(response.calls).toHaveLength(6);
    expect(zeus.calls).toHaveLength(0);
  });
});
