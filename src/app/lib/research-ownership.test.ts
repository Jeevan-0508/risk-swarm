import { describe, expect, test } from 'bun:test';
import { isCouncilAuthoritative, swarmDecisionPanelTitle } from './research-ownership';
import type { CouncilResult } from '@core/council/types';

function fixtureCouncilResult(): CouncilResult {
  const position = {
    position: {
      agent: 'ATHENA' as const,
      stance: 'jupiter',
      confidence: 0.9,
      reasoning_summary: 'test fixture',
      claims: [],
      evidence_ids: [],
      evidence_requests: [],
      assumptions: [],
    },
    provider: 'deterministic',
    degraded: false,
    degraded_reason: null,
    ms: 1,
    est_tokens: 1,
  };
  return {
    question: 'which is bigger?',
    positions: { ATHENA: position, ARES: position, HADES: position },
    disagreement: {
      independent_count: 0,
      stances: { ATHENA: 'jupiter', ARES: 'jupiter', HADES: 'jupiter' },
      distinct_stances: ['jupiter'],
      confidence_variance: 0,
      agreement: 'strong_consensus',
    },
    verdict: {
      verdict: {
        verdict_type: 'UNRESOLVED',
        answer: 'unresolved',
        confidence: 0,
        rationale: [],
        minority_view: null,
        unresolved: ['no configured Zeus model'],
        cited_evidence_ids: [],
      },
      provider: 'deterministic',
      degraded: false,
      degraded_reason: null,
    },
    trace: [],
    model_diversity: { active_agents: 0, providers: 0, label: 'none' },
  };
}

describe('decision ownership between the legacy research pass and the Olympian Council', () => {
  test('with Council Mode off (no council result), the legacy panel keeps its original identity', () => {
    expect(isCouncilAuthoritative(null)).toBe(false);
    expect(swarmDecisionPanelTitle(null)).toBe('SWARM DECISION');
  });

  test('with Council Mode on and a council result present, the Council becomes authoritative and the legacy panel is reframed as analysis, not a verdict', () => {
    const council = fixtureCouncilResult();
    expect(isCouncilAuthoritative(council)).toBe(true);
    const title = swarmDecisionPanelTitle(council);
    expect(title).not.toBe('SWARM DECISION');
    expect(title.toUpperCase()).not.toBe(title);
    expect(title).toContain('not the final verdict');
  });

  test('the reframing holds regardless of what the Council actually concluded — ownership is structural, not a function of agreement or confidence', () => {
    const consensus = fixtureCouncilResult();
    consensus.verdict.verdict.verdict_type = 'CONSENSUS';
    consensus.verdict.verdict.confidence = 0.99;
    expect(swarmDecisionPanelTitle(consensus)).toBe(swarmDecisionPanelTitle(fixtureCouncilResult()));
  });
});
