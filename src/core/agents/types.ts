import type { Minter } from '../domain/build';
import type { AgentId, ReasoningStatus } from '../domain/model';
import type { Reasoner } from '../reasoner/types';
import type { SignalSource } from '../integrations/fomo';
import type { PatternMatcher } from '../integrations/atlas';
import type { RegulatoryMapper } from '../integrations/governance';

export interface AgentCost {
  calls: number;
  ms: number;
  est_tokens: number;
}

export interface AgentOutput<T> {
  agent: AgentId;
  run_id: string;
  findings: T[];
  evidence_created: string[];
  evidence_cited: string[];
  confidence: number;
  uncertainties: string[];
  reasoning_status: ReasoningStatus;
  recommended_next_step: string | null;
  cost: AgentCost;
  /** Set when the model path was asked and degraded, so the UI can show it honestly. */
  degraded_reason?: string | null;
}

export interface Tools {
  signals: SignalSource;
  atlas: PatternMatcher;
  governance: RegulatoryMapper;
}

export interface AgentContext {
  run_id: string;
  minter: Minter;
  now: string;
  reasoner: Reasoner;
  tools: Tools;
  /** Charged before every retrieval and every agent call. Throws when a limit is reached. */
  spend: (kind: 'agent_call' | 'retrieval' | 'tokens', amount?: number) => void;
  /** Checked at the start of every agent and between phases. */
  assertAlive: () => void;
}

export const emptyCost = (): AgentCost => ({ calls: 0, ms: 0, est_tokens: 0 });

/**
 * Sentinel target for a challenge or finding that is about the run as a whole rather than about any
 * one hypothesis - raised, for instance, when the evidence has an unmerged duplicate pair but no
 * hypothesis exists to hang that concern on. It is deliberately never minted as a graph node, so every
 * checker that walks citations (SENTINEL's own report, and RED_TEAM's fabricated-reference check) has
 * to know about it and exclude it explicitly, rather than one of them silently reporting it as a
 * dangling reference to a node that was never supposed to exist.
 */
export const RUN_LEVEL_TARGET = 'run';

/** Source classification by host. Tier is derived from this, never chosen by an agent. */
const REGULATOR_HOSTS = [
  'europa.eu', 'eur-lex.europa.eu', 'bund.de', 'bag.bund.de', 'bka.de', 'polizei.de', 'gov.uk', 'admin.ch', 'bmk.gv.at', 'destatis.de', 'bmdv.bund.de',
];
const INDUSTRY_HOSTS = ['tapa-global.org', 'tapaemea.org', 'iru.org', 'bglonline.org.uk', 'tianet.org', 'bifa.org', 'fiata.org', 'dslv.org', 'enisa.europa.eu'];

export function classifySource(host: string | null): 'regulator' | 'industry_body' | 'news' {
  if (!host) return 'news';
  if (REGULATOR_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'regulator';
  if (INDUSTRY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'industry_body';
  return 'news';
}
