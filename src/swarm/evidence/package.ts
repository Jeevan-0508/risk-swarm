import {
  EvidenceItemSchema,
  EvidencePackageSchema,
  type EvidenceItem,
  type EvidencePackage,
  type SwarmCase,
  type EvidencePackageId,
} from '../contracts';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`;
}

/** A deterministic, non-cryptographic package fingerprint. It is an integrity identity, not a security primitive. */
export function deterministicPackageHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a:${hash.toString(16).padStart(8, '0')}`;
}

function packageHashInput(value: Omit<EvidencePackage, 'package_hash'>): unknown {
  return {
    package_id: value.package_id,
    case_id: value.case_id,
    protocol_version: value.protocol_version,
    items: value.items,
    known_gaps: value.known_gaps,
    known_conflicts: value.known_conflicts,
    sealed_at: value.sealed_at,
  };
}

export interface SealEvidenceOptions {
  readonly package_id?: EvidencePackageId;
  readonly sealed_at: string;
  readonly known_gaps?: readonly string[];
  readonly known_conflicts?: readonly string[];
}

/** Validates, sorts, fingerprints, and deeply freezes a detached evidence package. */
export function sealEvidence(
  caseValue: SwarmCase,
  candidates: readonly EvidenceItem[],
  options: SealEvidenceOptions,
): EvidencePackage {
  if (candidates.length > caseValue.policy.max_evidence_items) throw new Error('EVIDENCE_LIMIT_EXCEEDED');
  const items = candidates
    .map((candidate) => EvidenceItemSchema.parse(candidate))
    .sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  const package_id = options.package_id ?? (`EP-${caseValue.case_id}-${deterministicPackageHash(items).slice(-8)}` as EvidencePackageId);
  const withoutHash: Omit<EvidencePackage, 'package_hash'> = {
    package_id,
    case_id: caseValue.case_id,
    protocol_version: caseValue.protocol_version,
    items,
    known_gaps: [...(options.known_gaps ?? [])],
    known_conflicts: [...(options.known_conflicts ?? [])],
    sealed_at: options.sealed_at,
  };
  const packageValue = EvidencePackageSchema.parse({
    ...withoutHash,
    package_hash: deterministicPackageHash(packageHashInput(withoutHash)),
  });
  return deepFreeze(packageValue);
}

export function verifyEvidencePackageHash(packageValue: EvidencePackage): boolean {
  const { package_hash: _ignored, ...withoutHash } = packageValue;
  return packageValue.package_hash === deterministicPackageHash(packageHashInput(withoutHash));
}

export function evidenceIds(packageValue: EvidencePackage): ReadonlySet<string> {
  return new Set(packageValue.items.map((item) => item.evidence_id));
}

export { stableStringify };
