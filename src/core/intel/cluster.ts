/**
 * Deterministic clustering used by the INTELLIGENCE agent. No model is involved: two items become
 * one cluster only for reasons that can be printed and argued with.
 *
 * The purpose is not tidiness. It is that five reports of one event must never count as five
 * independent pieces of evidence.
 */

const STOP = new Set([
  'the','and','for','with','from','that','this','after','into','over','amid','says','said','will','have','has','was','were','are','its','his','her','their','than','then','more','most','new','not','but','out','how','why','who','all','can','may','one','two','per','via','you','our','off','now',
  'der','die','das','und','für','mit','von','dem','den','des','ein','eine','einen','auf','ist','sind','war','wird','werden','nach','bei','aus','vor','über','durch','als','auch','wie','sich','sie','ihr','wir','man','dass','noch','nur','beim','zum','zur',
]);

export interface Clusterable {
  id: string;
  title: string;
  /** Stable publisher identity from ingest/sanitize.sourceIdentity. */
  source_identity: string;
  occurred_at: string | null;
}

export type ClusterReason = 'singleton' | 'near_duplicate' | 'same_event_candidate';

export interface Cluster {
  id: string;
  member_ids: string[];
  source_identities: string[];
  representative_id: string;
  earliest: string | null;
  latest: string | null;
  reason: ClusterReason;
  /** How sure the merge is. Printed in the UI; a 'same_event_candidate' merge is arguable. */
  merge_confidence: number;
}

export interface PossibleDuplicatePair {
  a: string;
  b: string;
  score: number;
  note: string;
}

export interface ClusterResult {
  clusters: Cluster[];
  /** item id -> cluster id */
  assignment: Record<string, string>;
  duplicates_removed: number;
  /** Distinct publishers across clusters, counting each cluster once. */
  independent_source_count: number;
  /**
   * Pairs that are too similar to ignore but not similar enough to merge. Left unmerged on purpose,
   * because silently merging destroys real corroboration - but they are published so the red team
   * can challenge the independence count instead of the count quietly flattering the risk.
   */
  possible_duplicate_pairs: PossibleDuplicatePair[];
}

export interface ClusterOptions {
  /** Word-trigram Jaccard at or above this is a near-duplicate title. */
  duplicateThreshold?: number;
  /** Content-token Dice at or above this, inside the window and sharing an entity, is one event. */
  sameEventThreshold?: number;
  /** Below the merge threshold but at or above this, a pair is reported as a possible duplicate. */
  possibleDuplicateThreshold?: number;
  windowHours?: number;
}

const DEFAULTS: Required<ClusterOptions> = {
  duplicateThreshold: 0.82,
  sameEventThreshold: 0.55,
  possibleDuplicateThreshold: 0.4,
  windowHours: 72,
};

export const normaliseTitle = (t: string): string =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const tokens = (t: string): string[] => normaliseTitle(t).split(' ').filter(Boolean);

export const contentTokens = (t: string): string[] => tokens(t).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Capitalised words approximate named entities (company, place, authority). This is a weak guard on
 * purpose: it only ever acts as a conjunct with a content-token score and a time window, so a
 * generic capitalised word such as "German" cannot merge two unrelated reports on its own.
 */
export const entityTokens = (title: string): Set<string> => {
  const out = new Set<string>();
  for (const w of title.split(/\s+/).filter(Boolean)) {
    const clean = w.replace(/[^\p{L}\p{N}\-]/gu, '');
    if (clean.length > 2 && clean[0] === clean[0].toUpperCase() && clean[0] !== clean[0].toLowerCase() && !STOP.has(clean.toLowerCase())) {
      out.add(clean.toLowerCase());
    }
  }
  return out;
};

export const wordShingles = (t: string, k = 3): Set<string> => {
  const w = tokens(t);
  if (w.length < k) return new Set(w.length ? [w.join(' ')] : []);
  const out = new Set<string>();
  for (let i = 0; i + k <= w.length; i += 1) out.add(w.slice(i, i + k).join(' '));
  return out;
};

const intersectionSize = <T,>(a: Set<T>, b: Set<T>): number => {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
};

export const jaccard = <T,>(a: Set<T>, b: Set<T>): number => {
  if (a.size === 0 && b.size === 0) return 0;
  const inter = intersectionSize(a, b);
  return inter / (a.size + b.size - inter);
};

export const dice = <T,>(a: Set<T>, b: Set<T>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  return (2 * intersectionSize(a, b)) / (a.size + b.size);
};

export const hoursBetween = (a: string | null, b: string | null): number => {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Number.POSITIVE_INFINITY;
  return Math.abs(ta - tb) / 3_600_000;
};

export interface PairVerdict {
  same: boolean;
  reason: ClusterReason;
  score: number;
  /** True when the pair may be one event but the evidence for merging is not strong enough. */
  possible_duplicate: boolean;
  shared_entity: boolean;
  in_window: boolean;
}

/** Explains, for a pair, whether they are one event and why. Used directly by the UI. */
export function comparePair(a: Clusterable, b: Clusterable, options: ClusterOptions = {}): PairVerdict {
  const opt = { ...DEFAULTS, ...options };
  const titleSim = jaccard(wordShingles(a.title), wordShingles(b.title));
  const contentSim = dice(new Set(contentTokens(a.title)), new Set(contentTokens(b.title)));
  const shared_entity = intersectionSize(entityTokens(a.title), entityTokens(b.title)) > 0;
  const in_window = hoursBetween(a.occurred_at, b.occurred_at) <= opt.windowHours;

  if (titleSim >= opt.duplicateThreshold) {
    return { same: true, reason: 'near_duplicate', score: titleSim, possible_duplicate: false, shared_entity, in_window };
  }
  if (contentSim >= opt.sameEventThreshold && shared_entity && in_window) {
    return { same: true, reason: 'same_event_candidate', score: contentSim, possible_duplicate: false, shared_entity, in_window };
  }
  const score = Math.max(titleSim, contentSim);
  return {
    same: false,
    reason: 'singleton',
    score,
    possible_duplicate: contentSim >= opt.possibleDuplicateThreshold && shared_entity && in_window,
    shared_entity,
    in_window,
  };
}

/**
 * Single-link agglomeration in input order, so the result is stable and reproducible for a given
 * input list. Cluster ids are CL-001.. in first-seen order.
 */
export function clusterItems(items: Clusterable[], options: ClusterOptions = {}): ClusterResult {
  const clusters: Cluster[] = [];
  const assignment: Record<string, string> = {};
  const possible_duplicate_pairs: PossibleDuplicatePair[] = [];

  for (const item of items) {
    let target: Cluster | null = null;
    let verdict: PairVerdict | null = null;
    // At most one possible-duplicate pair per cluster: the closest member, so the count means
    // "clusters this item might belong to", not "comparisons that happened".
    const nearMisses: PossibleDuplicatePair[] = [];
    for (const cluster of clusters) {
      let closest: PossibleDuplicatePair | null = null;
      for (const memberId of cluster.member_ids) {
        const member = items.find((i) => i.id === memberId);
        if (!member) continue;
        const v = comparePair(item, member, options);
        if (v.same) {
          target = cluster;
          verdict = v;
          break;
        }
        if (v.possible_duplicate && (!closest || v.score > closest.score)) {
          closest = {
            a: member.id,
            b: item.id,
            score: Number(v.score.toFixed(3)),
            note: 'similar wording, shared entity and overlapping time window, below the merge threshold',
          };
        }
      }
      if (target) break;
      if (closest) nearMisses.push(closest);
    }
    if (!target) possible_duplicate_pairs.push(...nearMisses);

    if (target && verdict) {
      target.member_ids.push(item.id);
      if (!target.source_identities.includes(item.source_identity)) target.source_identities.push(item.source_identity);
      if (item.occurred_at) {
        if (!target.earliest || item.occurred_at < target.earliest) target.earliest = item.occurred_at;
        if (!target.latest || item.occurred_at > target.latest) target.latest = item.occurred_at;
      }
      // A cluster is only as strong as its weakest merge.
      target.reason = target.reason === 'same_event_candidate' || verdict.reason === 'same_event_candidate' ? 'same_event_candidate' : 'near_duplicate';
      target.merge_confidence = Math.min(target.merge_confidence === 1 ? verdict.score : target.merge_confidence, verdict.score);
      assignment[item.id] = target.id;
      continue;
    }

    const cluster: Cluster = {
      id: `CL-${String(clusters.length + 1).padStart(3, '0')}`,
      member_ids: [item.id],
      source_identities: [item.source_identity],
      representative_id: item.id,
      earliest: item.occurred_at,
      latest: item.occurred_at,
      reason: 'singleton',
      merge_confidence: 1,
    };
    clusters.push(cluster);
    assignment[item.id] = cluster.id;
  }

  const duplicates_removed = items.length - clusters.length;
  const publishers = new Set<string>();
  for (const c of clusters) publishers.add(c.source_identities[0]);

  return { clusters, assignment, duplicates_removed, independent_source_count: publishers.size, possible_duplicate_pairs };
}

/** ISO week-style fixed buckets. Recurrence counts distinct buckets, never repeated coverage. */
export const timeBucket = (iso: string | null, days = 7, epoch = '2026-01-01T00:00:00.000Z'): string | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const n = Math.floor((t - Date.parse(epoch)) / (days * 86_400_000));
  return `B${n}`;
};

/** Distinct time buckets that contain at least one cluster. */
export function recurrenceBuckets(clusters: Cluster[], days = 7): string[] {
  const set = new Set<string>();
  for (const c of clusters) {
    const b = timeBucket(c.latest ?? c.earliest, days);
    if (b) set.add(b);
  }
  return [...set].sort();
}
