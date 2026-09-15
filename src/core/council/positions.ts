/**
 * EVOLUTION 6.0 — Olympian persona → position request. Builds a `ReasonRequest<OlympianPosition>` per
 * agent and sends it through that agent's own `Reasoner` (real model or deterministic fallback).
 *
 * Independence is structural, not a promise: each request is built from the question and the retrieved
 * evidence only — never from another agent's position — and the three requests are issued in parallel
 * by the caller (`run.ts`), so there is nothing in this module an agent could "see" from another.
 */
import type { NormalizedEvidence } from '../research/normalize';
import type { Reasoner, ReasonRequest, ReasonResult } from '../reasoner/types';
import type { OlympianPosition, ReasoningAgent } from './types';

interface Persona {
  instruction: string;
}

/**
 * Personality is presentation *and* research posture — but never a second implementation of the
 * fabrication fence, which is enforced identically for all three by `Reasoner.propose()`.
 */
const PERSONA: Record<ReasoningAgent, Persona> = {
  ATHENA: {
    instruction:
      'You are ATHENA: analytical, evidence-driven, skeptical of unsupported claims. Form a position on the ' +
      'question using ONLY the evidence blocks provided. Prefer the reading best supported by the most ' +
      'reliable evidence. If the evidence does not clearly settle the question, say so and use stance ' +
      '"insufficient_evidence" rather than inventing certainty. List any evidence ids you rely on in ' +
      'evidence_ids, using only the ids you were given, never inventing one.',
  },
  ARES: {
    instruction:
      'You are ARES: blunt, competitive, adversarial. Stress-test the question as a direct comparison or ' +
      'contest where one applies: strengths, weaknesses, failure modes. Attack the most obvious assumption ' +
      'before accepting it. Form a position using ONLY the evidence blocks provided; if the evidence cannot ' +
      'support a confident answer, say "insufficient_evidence" rather than bluffing. List any evidence ids ' +
      'you rely on in evidence_ids, using only the ids you were given, never inventing one.',
  },
  HADES: {
    instruction:
      'You are HADES: dark, skeptical, a devil\'s advocate who does not agree merely because agreement is ' +
      'easy. Actively look for the alternative explanation, the hidden assumption, the reason the obvious ' +
      'answer might be wrong. You are not required to disagree for its own sake, but you must not concede ' +
      'without reason. Form a position using ONLY the evidence blocks provided; use stance ' +
      '"insufficient_evidence" if the evidence genuinely does not settle it. List any evidence ids you rely ' +
      'on in evidence_ids, using only the ids you were given, never inventing one.',
  },
};

const SCHEMA_HINT =
  '{ stance: string, confidence: number (0-1), reasoning_summary: string, claims: string[], evidence_ids: string[], evidence_requests: string[], assumptions: string[] }';

/**
 * Phase 1 live-debug brief (evidence-payload fix): a live ARES/OpenRouter call over 37 evidence items
 * came back `HTTP 200`, `finish_reason: "length"`, empty content. Measured directly from this module's
 * own output: 37 evidence blocks at the research pipeline's own per-item storage ceiling (title 300
 * chars, excerpt 1200 chars) run to ~58,000 characters — over 97% of the whole prompt, ~14,800
 * estimated input tokens on top of a ~1,400-char fixed frame. OpenRouter's own docs confirm reasoning
 * tokens are billed from the *same* output budget as final content, and `openrouter/free` randomly
 * routes to a pool that explicitly includes "DeepSeek R1 (free) — DeepSeek's reasoning model": a much
 * larger prompt to digest is a real, plausible driver of a reasoning-heavy model exhausting that
 * shared budget before it ever emits JSON.
 *
 * This bounds how much of each item's excerpt *this prompt* repeats — nothing else. It does not touch
 * the research engine's own storage truncation (still 300/1200, `normalize.ts`, untouched), does not
 * drop any evidence item or id (every item still gets its own block; `allowed_evidence_ids` is
 * unaffected), and does not invent anything: a truncated excerpt is marked with `…`, never rewritten
 * or summarized by anything other than the research pipeline that produced it.
 */
const COUNCIL_EXCERPT_CHAR_LIMIT = 320;

function truncateForCouncilPrompt(text: string, limit = COUNCIL_EXCERPT_CHAR_LIMIT): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function evidenceBlock(item: NormalizedEvidence): string {
  return `<<<EVIDENCE id="${item.evidence.id}" source="${item.provenance.source_identity}">>> ${item.evidence.title}. ${truncateForCouncilPrompt(item.evidence.excerpt_or_summary)} <<<END>>>`;
}

type PositionBody = Omit<OlympianPosition, 'agent'>;

function validateBody(raw: unknown): PositionBody {
  const r = raw as Partial<OlympianPosition>;
  if (
    !r || typeof r.stance !== 'string' || r.stance.trim().length === 0 ||
    typeof r.confidence !== 'number' || !Number.isFinite(r.confidence) ||
    typeof r.reasoning_summary !== 'string' ||
    !Array.isArray(r.claims) || !Array.isArray(r.evidence_ids) || !Array.isArray(r.evidence_requests) || !Array.isArray(r.assumptions)
  ) {
    throw new Error('SHAPE_MISMATCH: expected a full OlympianPosition');
  }
  return {
    stance: r.stance.trim(),
    confidence: Math.min(1, Math.max(0, r.confidence)),
    reasoning_summary: r.reasoning_summary,
    claims: r.claims.map(String),
    evidence_ids: r.evidence_ids.map(String),
    evidence_requests: r.evidence_requests.map(String),
    assumptions: r.assumptions.map(String),
  };
}

/** The honest, zero-network answer: derived from nothing invented, low confidence, clearly marked degraded upstream. */
function fallbackBody(evidence: NormalizedEvidence[]): PositionBody {
  return {
    stance: 'insufficient_evidence',
    confidence: 0.3,
    reasoning_summary: evidence.length === 0
      ? 'No model configured and no evidence retrieved; no position formed.'
      : `No model configured for this agent; ${evidence.length} evidence item(s) were retrieved but not independently reasoned over.`,
    claims: [],
    evidence_ids: [],
    evidence_requests: [],
    assumptions: [],
  };
}

export function buildPositionRequest(agent: ReasoningAgent, question: string, evidence: NormalizedEvidence[]): ReasonRequest<OlympianPosition> {
  const allowed_evidence_ids = evidence.map((e) => e.evidence.id);
  return {
    task: `council.position.${agent.toLowerCase()}`,
    instruction: `${PERSONA[agent].instruction} THE QUESTION: "${question}"`,
    data_blocks: evidence.length === 0
      ? ['<<<EVIDENCE>>> none retrieved <<<END>>>']
      : evidence.map(evidenceBlock),
    allowed_evidence_ids,
    schema_hint: SCHEMA_HINT,
    validate: (raw) => ({ ...validateBody(raw), agent }),
    fallback: () => ({ ...fallbackBody(evidence), agent }),
  };
}

export async function requestPosition(
  agent: ReasoningAgent,
  reasoner: Reasoner,
  question: string,
  evidence: NormalizedEvidence[],
): Promise<ReasonResult<OlympianPosition>> {
  return reasoner.propose(buildPositionRequest(agent, question, evidence));
}
