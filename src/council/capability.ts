/**
 * THE COMMAND BAR's capability router. Text in, a real read over this run's own stored data out - or
 * the literal words `Capability unavailable.`
 *
 * The rule that makes this worth having rather than a liability: **there is no fallback branch that
 * improvises.** Every recognised command is a projection of `RunResult`, the graph or the transcript,
 * and every unrecognised one returns `UNAVAILABLE` unchanged. A command bar that guesses is a
 * fabrication engine with a prompt in front of it; this one would rather say no.
 *
 * It is also read-only by construction: the only command that changes anything returns a cursor for the
 * caller to move, and nothing here can write to the graph, the store or the transcript.
 */
import type { DeliberationEvent } from '../core/domain/model';
import type { RunResult } from '../core/orchestrator/run';
import type { Pattern } from '../core/integrations/atlas';
import { AGENT_CODENAME, AGENT_LABEL, AGENT_ORDER } from '../app/lib/agents';
import { decisionLineage, evidenceNeeded, sourceConcentration } from '../core/lineage/lineage';
import { OUTCOME_NOTE, typeTally } from './derive';
import { COUNCIL_SEATS } from './roster';
import { transcriptDigest } from './replay';

/** The exact string the spec requires for anything this router cannot really do. Never reworded. */
export const UNAVAILABLE = 'Capability unavailable.';

export type CommandResult =
  | { kind: 'answer'; lines: string[] }
  /** A read that also asks the caller to move the transcript cursor. Still a read of stored events. */
  | { kind: 'cursor'; cursor: number; lines: string[] }
  | { kind: 'unavailable'; message: typeof UNAVAILABLE };

export interface CommandContext {
  result: RunResult;
  /** The pinned taxonomy, if the shell has it. `null` means not loaded - never means "nothing there". */
  patterns: Map<string, Pattern> | null;
}

export const COMMAND_HELP: string[] = [
  'outcome            the deliberation outcome, and what it means',
  'band               the recommended action band, severity, urgency, confidence',
  'gates              every gate that failed and every cap applied, by name',
  'objections         unresolved objections, verbatim',
  'open               exchanges still carrying an unresolved status',
  'who <agent>        one seat: its remit, its position, what it cannot do',
  'count              the transcript by event type',
  'find <text>        exchanges whose words contain <text>',
  'node <id>          one graph node, if it exists',
  'sources            source concentration across the cited evidence',
  'gaps               indicators nobody has assessed, heaviest first',
  'lineage            decision to hypothesis to observation to evidence',
  'digest             a fingerprint of the transcript',
  'goto <n>           move the transcript to exchange <n>',
  'help               this list',
];

const unavailable = (): CommandResult => ({ kind: 'unavailable', message: UNAVAILABLE });
const answer = (lines: string[]): CommandResult => ({ kind: 'answer', lines });

function describeEvent(e: DeliberationEvent): string {
  const to = e.to_agent === null ? 'the council' : AGENT_CODENAME[e.to_agent];
  return `${String(e.sequence).padStart(2, '0')} ${AGENT_CODENAME[e.from_agent]} -> ${to} [${e.type}/${e.status}] ${e.content}`;
}

function seatLookup(token: string) {
  const wanted = token.toLowerCase();
  return AGENT_ORDER.find(
    (id) => id === wanted || AGENT_CODENAME[id].toLowerCase() === wanted || AGENT_LABEL[id].toLowerCase() === wanted,
  );
}

/** Splits on the first run of whitespace only, so `find` keeps the rest of the line intact. */
function split(input: string): { verb: string; rest: string } {
  const trimmed = input.trim();
  const gap = trimmed.search(/\s/);
  if (gap === -1) return { verb: trimmed.toLowerCase(), rest: '' };
  return { verb: trimmed.slice(0, gap).toLowerCase(), rest: trimmed.slice(gap + 1).trim() };
}

export function routeCommand(input: string, ctx: CommandContext): CommandResult {
  const { verb, rest } = split(input);
  if (verb === '') return unavailable();

  const { result } = ctx;
  const decision = result.outputs.decision.decision;
  const events = result.deliberation.events;

  switch (verb) {
    case 'help':
    case '?':
      return answer(COMMAND_HELP);

    case 'outcome': {
      const r = result.deliberation;
      return answer([
        `${r.outcome.replace(/_/g, ' ')} - ${OUTCOME_NOTE[r.outcome]}`,
        `${r.events.length} exchanges over ${r.rounds_used} rounds`,
        r.limited_by === null ? 'No budget cut the session short.' : `Stopped by ${r.limited_by}.`,
      ]);
    }

    case 'band':
    case 'decision':
      return answer([
        `${decision.action_band.replace(/_/g, ' ')} - ${decision.headline_risk}`,
        `severity ${decision.severity_band} (${decision.severity_score.toFixed(2)}) · urgency ${decision.urgency}`,
        decision.confidence === null
          ? `confidence withheld: ${decision.confidence_blocked_reason ?? 'no reason recorded'}`
          : `confidence ${decision.confidence.toFixed(2)}`,
        `owner ${decision.owner_role} · review by ${decision.review_by.slice(0, 10)}`,
      ]);

    case 'gates': {
      const lines: string[] = [];
      for (const g of decision.gates_failed) lines.push(`gate failed: ${g}`);
      for (const c of decision.caps_applied) lines.push(`cap applied: ${c}`);
      return answer(lines.length === 0 ? ['No gate failed and no cap was applied on this run.'] : lines);
    }

    case 'objections': {
      const open = decision.unresolved_objections;
      return answer(open.length === 0 ? ['No objection was left unresolved.'] : open);
    }

    case 'open': {
      const unresolved = events.filter((e) => e.status === 'unresolved');
      return answer(
        unresolved.length === 0
          ? ['Every exchange in the transcript is resolved.']
          : unresolved.map(describeEvent),
      );
    }

    case 'who': {
      const id = seatLookup(rest);
      if (id === undefined) return unavailable();
      const out = result.outputs[({
        scout: 'scout', intelligence: 'intelligence', risk_analyst: 'analyst', governance_officer: 'governance',
        challenger: 'challenger', red_team: 'red_team', decision_engine: 'decision',
      } as const)[id]];
      const position = result.outputs.decision.scoring_input.agent_positions.find((p) => p.agent === id);
      return answer([
        `${AGENT_CODENAME[id]} (${AGENT_LABEL[id]})`,
        COUNCIL_SEATS[id].trait,
        `cannot: ${COUNCIL_SEATS[id].cannot}`,
        position === undefined
          ? 'Casts no position in the score - it assembles the score rather than voting in it.'
          : `recorded position: ${position.reasoning_status.replace(/_/g, ' ')} at ${position.confidence.toFixed(2)}`,
        `${out.findings.length} findings · ${out.evidence_cited.length} evidence cited · ${events.filter((e) => e.from_agent === id).length} exchanges spoken`,
      ]);
    }

    case 'count':
      return answer(
        events.length === 0
          ? ['This run produced no transcript.']
          : typeTally(events).map((t) => `${String(t.count).padStart(3, ' ')}  ${t.type}`),
      );

    case 'find': {
      if (rest === '') return unavailable();
      const needle = rest.toLowerCase();
      const hits = events.filter((e) => e.content.toLowerCase().includes(needle));
      return answer(
        hits.length === 0 ? [`Nothing in the transcript contains "${rest}".`] : hits.map(describeEvent),
      );
    }

    case 'node': {
      if (rest === '') return unavailable();
      const node = result.graph.all().find((n) => n.id === rest);
      if (node === undefined) return answer([`No node with id ${rest} exists in this run's graph.`]);
      const summary = 'statement' in node ? node.statement : 'text' in node ? node.text : 'claim' in node ? node.claim : node.kind;
      return answer([`${node.id} · ${node.kind} · by ${node.created_by}`, String(summary)]);
    }

    case 'sources': {
      const lineage = decisionLineage(result.graph, decision);
      const conc = sourceConcentration(lineage.hypotheses.flatMap((h) => h.evidence).concat(lineage.decision_evidence));
      if (conc.total_evidence === 0) return answer(['This decision cites no evidence at all.']);
      return answer([
        `${conc.total_evidence} evidence nodes · largest single source holds ${(conc.top_source_share * 100).toFixed(0)}%`,
        ...conc.by_source.map((e) => `${String(e.count).padStart(3, ' ')}  ${e.source_identity}`),
      ]);
    }

    case 'gaps': {
      if (ctx.patterns === null) {
        return answer(['The pinned taxonomy is not loaded, so the indicator text is not available yet.']);
      }
      const patterns = ctx.patterns;
      const ranked = result.outputs.analyst.findings
        .flatMap((f) => {
          const pattern = patterns.get(f.coverage.pattern_id);
          return pattern === undefined ? [] : evidenceNeeded(f.coverage, pattern);
        })
        .sort((a, b) => b.weight - a.weight || a.indicator_id.localeCompare(b.indicator_id));
      return answer(
        ranked.length === 0
          ? ['Every indicator on the matched patterns has been assessed one way or the other.']
          : ranked.map((g) => `w${g.weight} ${g.indicator_id} - ${g.signal} (observable in: ${g.observable_in})`),
      );
    }

    case 'lineage': {
      const lineage = decisionLineage(result.graph, decision);
      if (lineage.hypotheses.length === 0) return answer(['This decision rests on no hypothesis in the graph.']);
      return answer([
        `${lineage.decision_id} cites ${lineage.decision_evidence.length} evidence nodes directly`,
        ...lineage.hypotheses.map(
          (h) => `${h.hypothesis.id} [${h.hypothesis.status}] ${h.observations.length} observations, ${h.evidence.length} evidence in the chain - ${h.hypothesis.statement}`,
        ),
      ]);
    }

    case 'digest':
      return answer([
        transcriptDigest(events),
        'A non-cryptographic fingerprint over every exchange: order, speaker, addressee, type, status, exact words and every cited id.',
      ]);

    case 'goto': {
      const n = Number.parseInt(rest, 10);
      if (!Number.isInteger(n) || n < 0 || n >= events.length) return unavailable();
      return { kind: 'cursor', cursor: n, lines: [describeEvent(events[n])] };
    }

    default:
      return unavailable();
  }
}
