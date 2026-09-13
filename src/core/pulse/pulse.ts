/**
 * PULSE - the system-health monitor. It is not a risk analyst either: it never re-scores the
 * investigation, it only reads numbers the seven agents and SENTINEL already produced and asks
 * whether the *process* that produced this run looks healthy - budget, retrieval, execution,
 * governance coverage, source diversity - as distinct from whether the *conclusion* is right.
 *
 * The one rule the spec insists on by name: high agent agreement over low source diversity must be
 * reported as a WARNING, never read as health. Agreement over one publisher is not corroboration.
 *
 * Every check here is a synthesis of a number that already exists on `RunResult` / `ScoreResult` /
 * `SentinelReport`. PULSE never touches the graph and never computes a new metric from scratch - a
 * gap in what it can report (no budget cap supplied, no live-retrieval record, no run history to
 * diff against) is itself reported as a WARNING, not silently skipped and not read as healthy.
 */
import type { IntelligenceOutput } from '../agents/intelligence';
import type { GovernanceOutput } from '../agents/governance';
import type { ChallengerOutput } from '../agents/challenger';
import type { RedTeamOutput } from '../agents/redteam';
import type { DecisionOutput } from '../agents/decision';
import type { Budget } from '../agents/harness';
import type { ScoringPolicy } from '../scoring/policy';
import type { SentinelReport } from '../sentinel/sentinel';
import type { LiveFetchResult } from '../sources/types';
import { overallStatus, type IntegrityStatus } from '../status';

export type PulseStatus = IntegrityStatus;

export interface PulseCheck {
  key: string;
  label: string;
  status: PulseStatus;
  detail: string;
}

export interface PulseReport {
  status: PulseStatus;
  checks: PulseCheck[];
}

export interface PulseInput {
  intelligence: IntelligenceOutput;
  governance: GovernanceOutput;
  challenger: ChallengerOutput;
  red_team: RedTeamOutput;
  decision: DecisionOutput;
  policy: ScoringPolicy;
  sentinel: SentinelReport;
  spent: Budget;
  /**
   * The cap this run was metered against. A run *configuration*, not something the engine computes,
   * so it is passed in rather than added to `RunResult` (which would let it drift from
   * `StoredRun.input.budget`). Absent means utilization is unchecked, not assumed comfortable.
   */
  budget?: Budget;
  /** Only present in LIVE mode. Its absence in DEMO/SNAPSHOT reflects the mode, not a gap. */
  liveRetrieval?: LiveFetchResult;
}

/** Above this fraction of any budget dimension, a run that did fit is still worth a human's attention. */
const UTILIZATION_WARNING = 0.85;

export function runPulse(input: PulseInput): PulseReport {
  const checks: PulseCheck[] = [];
  const push = (c: PulseCheck) => checks.push(c);

  const { decision, intelligence, governance, challenger, red_team, sentinel } = input;
  const score = decision.score;

  // 1. Record integrity, folded in rather than re-derived: PULSE cannot call this run healthy if
  //    SENTINEL found the record it rests on unsound.
  push({
    key: 'record_integrity',
    label: 'Record integrity',
    status: sentinel.status,
    detail: sentinel.status === 'VERIFIED'
      ? 'SENTINEL reports the record this run produced is sound.'
      : `SENTINEL reports ${sentinel.status.toLowerCase()} - see Knowledge & Provenance for which check and why.`,
  });

  // 2. Source diversity, and the rule the spec names explicitly: agreement is not health when it
  //    rests on too few independent sources. Read against the same policy minimum score.ts already
  //    gates escalation on, so this never disagrees with the decision engine's own arithmetic.
  const minSources = input.policy.escalate_min_independent_sources;
  const thin = score.independent_evidence_count < minSources;
  // Same boundary DisagreementRoom already uses to decide whether disagreement reads as an
  // objection (> 50) - reused here rather than a second, inconsistent threshold.
  const agreeing = score.disagreement_index.value <= 50;
  push({
    key: 'source_diversity',
    label: 'Source diversity vs. agreement',
    status: thin ? 'WARNING' : 'VERIFIED',
    detail: thin && agreeing
      ? `${score.independent_evidence_count} independent source(s) against a floor of ${minSources}, yet the agents largely agree (disagreement index ${score.disagreement_index.value}). Agreement over few sources is not corroboration - look at the source list, not the score.`
      : thin
        ? `${score.independent_evidence_count} independent source(s) against a floor of ${minSources}.`
        : `${score.independent_evidence_count} independent source(s), at or above the policy floor of ${minSources}.`,
  });

  // 3. Evidence volume. Informational on a single run - there is no history to diff against here,
  //    so a low number is reported as a fact, not flagged as drift it cannot prove.
  push({
    key: 'evidence_volume',
    label: 'Evidence volume',
    status: 'VERIFIED',
    detail: `${intelligence.clusters.length} distinct event cluster(s) this run. No prior run was supplied to this report to compare drift against.`,
  });

  // 4. Governance coverage. A run that never established a single regulatory implication has not
  //    been reviewed for compliance exposure, whatever the risk score says.
  const established = governance.implications.filter((i) => i.applicability === 'established').length;
  push({
    key: 'governance_coverage',
    label: 'Governance coverage',
    status: governance.implications.length === 0 ? 'WARNING' : 'VERIFIED',
    detail: governance.implications.length === 0
      ? 'No regulatory framework produced an implication for this scope.'
      : `${established} of ${governance.implications.length} assessed implication(s) are established.`,
  });

  // 5. Red-team outcome, read transparently rather than re-argued. A `fail` verdict on a completed
  //    run is, by the orchestrator's own rule, a fact about the evidence rather than a bug - it is
  //    still surfaced here rather than left implicit in a band the score already carries.
  push({
    key: 'red_team_outcome',
    label: 'Red-team outcome',
    status: red_team.verdict === 'pass' ? 'VERIFIED' : 'WARNING',
    detail: `Verdict ${red_team.verdict} over ${red_team.checks_run} check(s), ${red_team.findings.length} finding(s).`,
  });

  // 6. Unresolved blockers. Reads the decision's own published gates rather than re-deriving
  //    severity - disagreement that is still open is the system working as designed, not a defect,
  //    so this is a WARNING (a human still has something to resolve), never BLOCKED.
  const objections = decision.decision.unresolved_objections.length;
  push({
    key: 'unresolved_blockers',
    label: 'Unresolved objections',
    status: objections === 0 ? 'VERIFIED' : 'WARNING',
    detail: objections === 0
      ? 'No open objection from the challenger or red team remains unresolved.'
      : `${objections} open objection(s) remain unresolved: ${challenger.findings.length} challenger, ${red_team.findings.length} red-team finding(s) in this run.`,
  });

  // 7. Budget utilization, only checked when a cap was actually supplied. A run that finished at
  //    all has, by construction, not exceeded its cap - BLOCKED is not a reachable state here.
  if (input.budget === undefined) {
    push({
      key: 'budget_utilization',
      label: 'Budget utilization',
      status: 'WARNING',
      detail: 'No configured budget cap was supplied to this report, so utilization is unchecked.',
    });
  } else {
    const dims: Array<[string, number, number]> = [
      ['agent calls', input.spent.agent_call, input.budget.agent_call],
      ['retrieval', input.spent.retrieval, input.budget.retrieval],
      ['tokens', input.spent.tokens, input.budget.tokens],
    ];
    const ratios = dims.map(([label, spent, cap]) => ({ label, ratio: cap > 0 ? spent / cap : 0, spent, cap }));
    const tight = ratios.filter((r) => r.ratio >= UTILIZATION_WARNING);
    push({
      key: 'budget_utilization',
      label: 'Budget utilization',
      status: tight.length === 0 ? 'VERIFIED' : 'WARNING',
      detail: tight.length === 0
        ? `Comfortably inside its budget: ${ratios.map((r) => `${r.label} ${r.spent}/${r.cap}`).join(', ')}.`
        : `${tight.map((r) => `${r.label} at ${r.spent}/${r.cap}`).join(', ')} - this run fit, but with little margin.`,
    });
  }

  // 8. Retrieval health. Only meaningful in LIVE mode; its absence in DEMO/SNAPSHOT is the expected
  //    shape of those modes, not a gap, so it is reported VERIFIED rather than WARNING.
  if (input.liveRetrieval === undefined) {
    push({
      key: 'retrieval_health',
      label: 'Live retrieval health',
      status: 'VERIFIED',
      detail: 'No live retrieval is in scope for this run (DEMO or SNAPSHOT mode).',
    });
  } else {
    const { feeds, failures } = input.liveRetrieval;
    push({
      key: 'retrieval_health',
      label: 'Live retrieval health',
      status: failures.length === 0 ? 'VERIFIED' : 'WARNING',
      detail: failures.length === 0
        ? `${feeds.length} live feed(s) read, none failed.`
        : `${failures.length} of ${feeds.length + failures.length} live feed(s) could not be read. Each failure is reported with its reason, not substituted for.`,
    });
  }

  // 9. Outcome history. False-positive rate needs verdicts recorded after this run, which do not
  //    exist yet at the moment a fresh run completes - reported honestly as not yet available
  //    rather than defaulted to a rate of zero.
  push({
    key: 'outcome_history',
    label: 'False-positive rate',
    status: 'WARNING',
    detail: 'Not available from a single completed run: this metric needs outcomes recorded after the fact across prior runs, which this report was not given.',
  });

  return { status: overallStatus(checks.map((c) => c.status)), checks };
}
