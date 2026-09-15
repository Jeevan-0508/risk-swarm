import type { NormalizedEvidence } from '../research/normalize';

export function fixtureEvidence(rows: Array<{ id: string; title: string; excerpt: string; source?: string }>): NormalizedEvidence[] {
  return rows.map((r) => ({
    evidence: { id: r.id, title: r.title, excerpt_or_summary: r.excerpt, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title)}` },
    provenance: { source_identity: r.source ?? 'en.wikipedia.org', provider: 'wikipedia' },
  })) as unknown as NormalizedEvidence[];
}
