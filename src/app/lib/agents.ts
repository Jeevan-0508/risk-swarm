import type { AgentId } from '@core/domain/model';
import type { RunResult } from '@core/orchestrator/run';

export const AGENT_ORDER = ['scout', 'intelligence', 'risk_analyst', 'governance_officer', 'challenger', 'red_team', 'decision_engine'] as const;

export const AGENT_LABEL: Record<AgentId, string> = {
  scout: 'SCOUT',
  intelligence: 'INTELLIGENCE',
  risk_analyst: 'RISK ANALYST',
  governance_officer: 'GOVERNANCE OFFICER',
  challenger: 'CHALLENGER',
  red_team: 'RED TEAM',
  decision_engine: 'DECISION ENGINE',
};

export const AGENT_REMIT: Record<AgentId, string> = {
  scout: 'Retrieves signals. Does not interpret, rank or conclude.',
  intelligence: 'Deduplicates so one event counts once. Uses no model at all.',
  risk_analyst: 'Forms hypotheses, each with a falsification test.',
  governance_officer: 'Maps obligations. Cannot evidence an incident.',
  challenger: 'Argues the benign case from documented false positives.',
  red_team: 'Attacks the investigation. Can stop an escalation, never create one.',
  decision_engine: 'Assembles the recommendation and its gates for a human.',
};

/**
 * Product identity layer. Purely presentational: the technical role above (`AGENT_LABEL`) is the
 * contract everything else in this codebase - tests, the graph, the agent modules - actually names.
 * A codename never appears in an id, a test assertion or a stored record, only in the UI chrome.
 */
export const AGENT_CODENAME: Record<AgentId, string> = {
  scout: 'HERMES',
  intelligence: 'ATHENA',
  risk_analyst: 'APOLLO',
  governance_officer: 'ZEUS',
  challenger: 'ARES',
  red_team: 'HADES',
  decision_engine: 'HEPHAESTUS',
};

export const AGENT_TAGLINE: Record<AgentId, string> = {
  scout: 'Sees everything. Concludes nothing.',
  intelligence: 'Turns noise into distinct events.',
  risk_analyst: 'Explains what might be happening — and how it could be wrong.',
  governance_officer: 'Determines what obligations attach to action.',
  challenger: 'Builds the strongest case against the first conclusion.',
  red_team: 'Break the investigation before the investigation breaks trust.',
  decision_engine: 'Recommends. Never decides.',
};

/** Maps the orchestrator's phase name to the agent that ran it. */
export const PHASE_AGENT: Record<string, AgentId> = {
  discover: 'scout',
  deduplicate: 'intelligence',
  analyse: 'risk_analyst',
  govern: 'governance_officer',
  challenge: 'challenger',
  red_team: 'red_team',
  decide: 'decision_engine',
};

/** The orchestrator names its outputs by role; agents are named by id. One place to reconcile the two. */
export const OUTPUT_KEY = {
  scout: 'scout',
  intelligence: 'intelligence',
  risk_analyst: 'analyst',
  governance_officer: 'governance',
  challenger: 'challenger',
  red_team: 'red_team',
  decision_engine: 'decision',
} as const satisfies Record<AgentId, string>;

export function agentOutput(result: RunResult, id: AgentId) {
  return result.outputs[OUTPUT_KEY[id]];
}
