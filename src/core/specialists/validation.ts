import type { SpecialistContract } from './contract';
import type { SpecialistEvidencePackage } from './evidence';

export class SpecialistValidationError extends Error {
  constructor(message: string) {
    super(`INVALID_SPECIALIST_OUTPUT: ${message}`);
    this.name = 'SpecialistValidationError';
  }
}

const AUTHORITY_VIOLATIONS = [
  /\blegal(?:ly)?\s+compliance\b/i,
  /\blegal(?:ly)?\s+compliant\b/i,
  /\bregulatory\s+certainty\b/i,
  /\bcertif(?:y|ied|ication)\b/i,
  /\bapprove(?:d|s)?\s+(?:the\s+)?(?:deployment|decision|release)\b/i,
  /\breject(?:ed|s)?\s+(?:the\s+)?(?:deployment|decision|release)\b/i,
  /\bfinal\s+decision\b/i,
  /\boverride\s+(?:red\s+team|sentinel|publication)\b/i,
  /\bsuppress\s+(?:disagreement|uncertainty)\b/i,
  /\bhide\s+uncertainty\b/i,
];

function stringsIn(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => stringsIn(item, output));
  return output;
}

function assertNoAuthorityViolation(value: unknown): void {
  const violation = stringsIn(value).find((text) => AUTHORITY_VIOLATIONS.some((pattern) => pattern.test(text)));
  if (violation !== undefined) throw new SpecialistValidationError(`authority boundary violation in output text: ${violation.slice(0, 160)}`);
}

export function countKnownCitations(value: unknown, packageValue: SpecialistEvidencePackage): number {
  const allowed = new Set(packageValue.evidence.map((item) => item.evidence_id));
  const cited = new Set<string>();
  const inspect = (candidate: unknown) => {
    if (typeof candidate === 'object' && candidate !== null) {
      for (const [key, child] of Object.entries(candidate)) {
        if (key === 'evidence_ids' && Array.isArray(child)) {
          for (const id of child) {
            if (typeof id !== 'string' || !allowed.has(id)) throw new SpecialistValidationError(`unknown evidence id: ${String(id)}`);
            cited.add(id);
          }
        } else inspect(child);
      }
    } else if (Array.isArray(candidate)) candidate.forEach(inspect);
  };
  inspect(value);
  return cited.size;
}

/** Shared defense-in-depth validation for specialist outputs. */
export function validateSpecialistOutput<T>(
  raw: unknown,
  contract: SpecialistContract<T>,
  evidencePackage: SpecialistEvidencePackage,
): { value: T; cited_evidence_count: number } {
  const parsed = contract.output_schema.safeParse(raw);
  if (!parsed.success) throw new SpecialistValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
  assertNoAuthorityViolation(parsed.data);
  const cited_evidence_count = countKnownCitations(parsed.data, evidencePackage);
  return { value: parsed.data, cited_evidence_count };
}
