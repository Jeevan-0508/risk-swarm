/**
 * Turns each agent's output into short structured statements for the console and the brief.
 *
 * These are summaries of *published findings*, never a narration of reasoning. There is no
 * chain-of-thought anywhere in this file, and there is nowhere for one to leak in: every line is built
 * from a counted field or a node's own text.
 */
import type { RunResult } from '@core/orchestrator/run';
import type { AgentId } from '@core/domain/model';

export interface Line {
  tone: 'support' | 'caution' | 'objection' | 'block' | 'neutral';
  text: string;
  /** Node ids this line is derived from, so the graph screen can be opened at the right place. */
  refs?: string[];
}

export function agentLines(result: RunResult, id: AgentId): Line[] {
  const o = result.outputs;
  switch (id) {
    case 'scout': {
      const s = o.scout.stats;
      return [
        { tone: 'support', text: `${s.returned} signal(s) discovered from ${s.scanned} scanned` },
        { tone: 'neutral', text: `${s.excluded_out_of_window} outside the window, ${s.excluded_geo} outside the geography` },
        { tone: 'caution', text: `${s.excluded_low_relevance} excluded as not freight-related` },
        ...(s.excluded_no_url > 0 ? [{ tone: 'objection' as const, text: `${s.excluded_no_url} dropped for having no verifiable url` }] : []),
        ...(s.category_disagreements > 0 ? [{ tone: 'caution' as const, text: `${s.category_disagreements} signal(s) disagree with their upstream category label` }] : []),
      ];
    }
    case 'intelligence': {
      const i = o.intelligence;
      return [
        { tone: 'support', text: `${i.duplicates_removed} duplicate report(s) collapsed`, refs: i.clusters.map((c) => c.id) },
        { tone: 'support', text: `${i.clusters.length} distinct event cluster(s) created` },
        { tone: i.independent_source_count >= 3 ? 'support' : 'caution', text: `${i.independent_source_count} independent publisher(s)` },
        { tone: 'neutral', text: `activity falls in ${i.recurrence_buckets.length} of ${i.window_buckets} weekly bucket(s)` },
        ...(i.possible_duplicate_pairs.length > 0
          ? [{ tone: 'caution' as const, text: `${i.possible_duplicate_pairs.length} pair(s) may be the same event but were not merged; the independence count may be overstated` }]
          : []),
      ];
    }
    case 'risk_analyst':
      return [
        { tone: 'support', text: `${o.analyst.findings.length} hypothesis/es generated, each with a falsification test`, refs: o.analyst.findings.map((f) => f.hypothesis.id) },
        ...o.analyst.findings.map((f) => ({
          tone: 'neutral' as const,
          text: `${f.match.pattern_id} ${f.match.pattern_name} — ${f.cluster_ids.length} cluster(s), ${f.gates.length} documented false positive(s)`,
          refs: [f.hypothesis.id],
        })),
        { tone: o.analyst.unknown_indicator_share > 0.8 ? 'block' : 'caution', text: `${Math.round(o.analyst.unknown_indicator_share * 100)}% of operational indicator weight unassessed` },
      ];
    case 'governance_officer': {
      const g = o.governance;
      const est = g.implications.filter((i) => i.applicability === 'established').length;
      return [
        { tone: 'support', text: `${g.implications.length} obligation(s) evaluated across ${g.frameworks.length} framework(s)` },
        { tone: est > 0 ? 'caution' : 'neutral', text: `${est} established, ${g.implications.filter((i) => i.applicability === 'possible').length} possible, ${g.implications.filter((i) => i.applicability === 'not_established').length} not established` },
        { tone: 'neutral', text: 'citations are tier 1 but flagged as structure, so they cannot evidence an incident' },
      ];
    }
    case 'challenger': {
      const c = o.challenger;
      const blocking = c.findings.filter((x) => x.severity === 'blocking').length;
      return [
        { tone: blocking > 0 ? 'block' : 'objection', text: `${c.findings.length} challenge(s) raised, ${blocking} blocking`, refs: c.findings.map((x) => x.id) },
        { tone: 'objection', text: `${c.ungated_false_positives} of ${c.total_false_positive_gates} documented false-positive gate(s) still open` },
        ...[...new Set(c.findings.map((x) => x.alternative_explanation).filter((x): x is string => Boolean(x)))]
          .slice(0, 3)
          .map((alt) => ({ tone: 'caution' as const, text: `benign alternative: ${alt}` })),
      ];
    }
    case 'red_team': {
      const r = o.red_team;
      return [
        { tone: r.verdict === 'fail' ? 'block' : r.findings.length > 0 ? 'caution' : 'support', text: `verdict ${r.verdict.replace(/_/g, ' ')} after ${r.checks_run} standing checks` },
        ...r.findings.map((f) => ({ tone: (f.severity === 'blocking' ? 'block' : 'objection') as 'block' | 'objection', text: `${f.finding_class.replace(/_/g, ' ')} — ${f.severity}`, refs: [f.id] })),
      ];
    }
    case 'decision_engine': {
      const d = o.decision.decision;
      return [
        { tone: 'support', text: `recommendation assembled: ${d.action_band.replace(/_/g, ' ')}`, refs: [d.id] },
        { tone: d.confidence === null ? 'block' : 'neutral', text: d.confidence === null ? 'confidence withheld while a blocking objection stands' : `confidence ${d.confidence.toFixed(2)}` },
        { tone: 'caution', text: `${d.gates_failed.length} escalation requirement(s) unmet` },
        { tone: 'neutral', text: `${o.decision.actions.length} action(s) proposed for a human to approve` },
      ];
    }
  }
}

export function agentUncertainties(result: RunResult, id: AgentId): string[] {
  const map: Record<AgentId, string[]> = {
    scout: result.outputs.scout.uncertainties,
    intelligence: result.outputs.intelligence.uncertainties,
    risk_analyst: result.outputs.analyst.uncertainties,
    governance_officer: result.outputs.governance.uncertainties,
    challenger: result.outputs.challenger.uncertainties,
    red_team: result.outputs.red_team.uncertainties,
    decision_engine: result.outputs.decision.uncertainties,
  };
  return map[id];
}
