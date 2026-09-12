/**
 * AI Governance Control Room adapter - the GOVERNANCE OFFICER's source.
 *
 * Upstream (github.com/Jeevan-0508/ai-governance-control-room) publishes 4 frameworks with cited
 * requirements and a control catalogue mapped to them. Applicability is derived from each
 * requirement's `applies` block upstream, so it is never stored on a control here either.
 *
 * `established` applicability is only reachable with a citation and a resolvable url. Anything else
 * is at most `possible`, and a missing citation forces `not_established`.
 */
import type { RegulatoryImplication } from '../domain/model';
import type { SnapshotLoader, SnapshotSourceProvenance } from './loader';

const FRAMEWORKS_PATH = 'ai-governance-control-room/frameworks.json';
const CONTROLS_PATH = 'ai-governance-control-room/controls.json';

export interface UpstreamRequirement {
  id: string;
  ref: string;
  title: string;
  summary: string;
  applies?: { roles?: string[]; tiers?: string[]; flags?: string[] };
}

export interface UpstreamFramework {
  id: string;
  name: string;
  citation: string;
  url: string;
  kind: string;
  requirements: UpstreamRequirement[];
}

export interface UpstreamControl {
  id: string;
  name: string;
  type: string;
  owner: string;
  objective: string;
  satisfies: string[];
  evidence: Array<{ id: string; name: string; kind: string }>;
}

export interface Requirement extends UpstreamRequirement {
  framework_id: string;
  framework_name: string;
  framework_citation: string;
  framework_url: string;
  framework_kind: string;
}

export interface Citation {
  ref: string;
  citation: string;
  url: string | null;
  framework: string;
  /** Upstream summaries are plain-language paraphrases, not legal text. Stated, not implied. */
  paraphrase_warning: string;
}

export interface RequirementFilter {
  frameworks?: string[];
  /** Case-insensitive keyword match over title and summary. */
  keywords?: string[];
  ids?: string[];
}

export interface RegulatoryMapper {
  frameworks(): Promise<UpstreamFramework[]>;
  requirements(filter?: RequirementFilter): Promise<Requirement[]>;
  requirement(id: string): Promise<Requirement>;
  cite(requirementId: string): Promise<Citation>;
  controls(requirementId: string): Promise<UpstreamControl[]>;
  /** Builds a validated implication. Applicability is capped by what the citation supports. */
  implication(input: {
    requirement_id: string;
    proposed_applicability: RegulatoryImplication['applicability'];
    reasoning: string;
    evidence_ids?: string[];
  }): Promise<RegulatoryImplication>;
  provenance(): Promise<SnapshotSourceProvenance>;
}

const PARAPHRASE =
  'Upstream requirement summaries are plain-language paraphrases for operational use, not legal text and not legal advice.';

export function createGovernanceMapper(loader: SnapshotLoader): RegulatoryMapper {
  let reqCache: Requirement[] | null = null;
  let fwCache: UpstreamFramework[] | null = null;
  let ctlCache: UpstreamControl[] | null = null;

  const loadFrameworks = async (): Promise<UpstreamFramework[]> => {
    if (!fwCache) {
      const raw = await loader.loadJson<{ frameworks: UpstreamFramework[] }>(FRAMEWORKS_PATH);
      if (!Array.isArray(raw?.frameworks)) throw new Error('SNAPSHOT_INVALID: frameworks missing');
      fwCache = raw.frameworks;
    }
    return fwCache;
  };

  const loadRequirements = async (): Promise<Requirement[]> => {
    if (!reqCache) {
      reqCache = (await loadFrameworks()).flatMap((f) =>
        (f.requirements ?? []).map((r) => ({
          ...r,
          framework_id: f.id,
          framework_name: f.name,
          framework_citation: f.citation,
          framework_url: f.url,
          framework_kind: f.kind,
        })),
      );
    }
    return reqCache;
  };

  const loadControls = async (): Promise<UpstreamControl[]> => {
    if (!ctlCache) {
      const raw = await loader.loadJson<{ controls: UpstreamControl[] }>(CONTROLS_PATH);
      if (!Array.isArray(raw?.controls)) throw new Error('SNAPSHOT_INVALID: controls missing');
      ctlCache = raw.controls;
    }
    return ctlCache;
  };

  const requirement = async (id: string): Promise<Requirement> => {
    const found = (await loadRequirements()).find((r) => r.id === id);
    if (!found) throw new Error(`UNKNOWN_REQUIREMENT: ${id}`);
    return found;
  };

  const isResolvableUrl = (url: string | null | undefined): boolean => {
    if (!url) return false;
    try {
      const u = new URL(url);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  };

  return {
    frameworks: loadFrameworks,

    async requirements(filter = {}) {
      const all = await loadRequirements();
      return all.filter((r) => {
        if (filter.ids && !filter.ids.includes(r.id)) return false;
        if (filter.frameworks && filter.frameworks.length > 0 && !filter.frameworks.includes(r.framework_id)) return false;
        if (filter.keywords && filter.keywords.length > 0) {
          const hay = `${r.title} ${r.summary}`.toLowerCase();
          if (!filter.keywords.some((k) => hay.includes(k.toLowerCase()))) return false;
        }
        return true;
      });
    },

    requirement,

    async cite(requirementId) {
      const r = await requirement(requirementId);
      return {
        ref: r.ref,
        citation: r.framework_citation,
        url: isResolvableUrl(r.framework_url) ? r.framework_url : null,
        framework: r.framework_name,
        paraphrase_warning: PARAPHRASE,
      };
    },

    async controls(requirementId) {
      return (await loadControls()).filter((c) => (c.satisfies ?? []).includes(requirementId));
    },

    async implication({ requirement_id, proposed_applicability, reasoning, evidence_ids = [] }) {
      const r = await requirement(requirement_id);
      const citation = await this.cite(requirement_id);
      const controls = await this.controls(requirement_id);

      // The gate: no citation, no obligation. A regulator-grade citation is required for 'established'.
      const hasCitation = Boolean(citation.citation) && citation.url !== null;
      const applicability: RegulatoryImplication['applicability'] = !hasCitation
        ? 'not_established'
        : proposed_applicability === 'established' && r.framework_kind !== 'regulation'
          ? 'possible'
          : proposed_applicability;

      return {
        requirement_id,
        framework: r.framework_name,
        ref: r.ref,
        citation: citation.citation,
        url: citation.url,
        title: r.title,
        applicability,
        reasoning: applicability === proposed_applicability ? reasoning : `${reasoning} [capped: ${hasCitation ? 'framework is not a regulation, so an obligation cannot be established from it alone' : 'no resolvable citation available'}]`,
        control_ids: controls.map((c) => c.id),
        evidence_ids,
      };
    },

    async provenance() {
      const prov = await loader.provenance();
      const entry = prov.sources.find((s) => s.key === 'ai-governance-control-room');
      if (!entry) throw new Error('SNAPSHOT_UNAVAILABLE: no ai-governance-control-room provenance entry');
      return entry;
    },
  };
}
