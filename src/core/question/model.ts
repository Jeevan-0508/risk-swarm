/**
 * THE QUESTION MODEL.
 *
 * A question is turned into a structured research object by rule, not by a model. That is a
 * deliberate constraint: classification decides which providers are called and which agents sit, so
 * it has to be inspectable, testable and identical on every run. A model that guessed "this is a
 * regulatory question" would be an untraceable input to a traceable system.
 *
 * The router's contract is narrow and absolute: it never refuses. An unrecognised subject resolves
 * to `domain: 'general'` with a general research plan, because "outside our taxonomy" is not a fact
 * about the world - it is a fact about our taxonomy.
 */

/** What the asker wants done, which decides the shape of the research plan. */
export type Intent =
  | 'definition'      // what is X
  | 'explanation'     // explain / how does X work
  | 'comparison'      // X vs Y, how does X differ from Y
  | 'temporal_delta'  // what changed, what is new
  | 'current_value'   // a number as of now
  | 'quantification'  // how many, what share, what percentage
  | 'enumeration'     // list the X
  | 'causal'          // why did X
  | 'risk_assessment' // are we exposed, what is the risk
  | 'open';           // no recognised form; research it generally

/** How current the evidence has to be for an answer to be worth anything. */
export type Freshness = 'timeless' | 'low' | 'medium' | 'high' | 'critical';

export type Depth = 'shallow' | 'standard' | 'deep';

export interface QuestionEntity {
  text: string;
  /** How the token was recognised. Never a claim about what the entity *is*. */
  kind: 'acronym' | 'proper_noun' | 'quoted' | 'numeric_year';
}

export interface QuestionModel {
  query: string;
  intent: Intent;
  /** A routing label, not an assertion of subject expertise. `general` is a first-class answer. */
  domain: string;
  subdomains: string[];
  entities: QuestionEntity[];
  /** Content words, stopwords removed, order preserved, deduplicated. Drives query construction. */
  keywords: string[];
  freshness: Freshness;
  temporal_markers: string[];
  /** Only geographies the question actually names. An empty list is honest, not a failure. */
  geo: string[];
  depth: Depth;
  requires_external: boolean;
  requires_internal: boolean;
  /** True when the answer is a number. Recorded because most sources cannot supply a denominator. */
  quantitative: boolean;
  /** What would have to be true of the evidence for the answer to stand. Human-readable, checkable. */
  evidence_requirements: string[];
  /** Anything the router could not settle. Printed, never hidden. */
  notes: string[];
}

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'because', 'been',
  'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'him', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'no', 'nor', 'not', 'of', 'off',
  'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under',
  'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will',
  'with', 'would', 'you', 'your', 'yours',
]);

/** Markers that raise required freshness. Ordered strongest first; the strongest hit wins. */
const FRESHNESS_MARKERS: Array<[Freshness, string[]]> = [
  ['critical', ['right now', 'as of today', 'market cap', 'share price', 'stock price', 'current price', 'exchange rate', 'live']],
  ['high', ['today', 'this week', 'this month', 'currently', 'current', 'now', 'latest', 'just announced', 'breaking', 'recently', 'recent']],
  ['medium', ['this year', 'this quarter', 'last month', 'upcoming', 'changed', 'change', 'changes', 'new', 'update', 'updated', 'so far', 'trend', 'emerging']],
];

const INTENT_RULES: Array<[Intent, RegExp]> = [
  ['quantification', /\b(how many|how much|what (?:share|percentage|proportion|fraction)|what % |\bpercent\b|\brate of\b)/],
  ['current_value', /\b(market cap|share price|stock price|current (?:price|value|level|figure)|how much is|worth (?:now|today))/],
  ['temporal_delta', /\b(what changed|what has changed|what.s new|any (?:changes|updates)|recent (?:changes|developments|amendments)|latest (?:changes|developments))\b/],
  ['comparison', /\b(vs\.?|versus|compared? (?:to|with)|difference between|differs? from|how does .+ differ|which (?:\S+\s+){0,2}(?:is|are|has|have) (?:more|less|better|worse|bigger|smaller|higher|lower|greater|healthier|safer|stronger|weaker|faster|slower|cheaper|largest|biggest|smallest|highest|lowest|greatest|most|least))\b/],
  ['risk_assessment', /\b(are we exposed|risk of|risks? (?:in|to|of|for)|exposure to|threat(?:s)? (?:to|in)|vulnerab)/],
  ['enumeration', /\b(list|name the|what are the|which are the|examples of|types of|kinds of)\b/],
  ['causal', /\b(why (?:did|do|does|is|are|has)|what caused|root cause|reason(?:s)? (?:for|why))\b/],
  ['explanation', /\b(explain|how does|how do|how is|how are|walk me through|describe how|mechanism)\b/],
  ['definition', /\b(what is|what are|what does .+ mean|define|definition of|who is|who are)\b/],
];

/**
 * Domain hints. These select a knowledge package and bias provider choice; they do NOT decide
 * whether a question is allowed. Every list here is a shortcut to a better plan, and the absence of
 * a hit costs nothing but a slightly broader search.
 */
const DOMAIN_HINTS: Array<[string, string[]]> = [
  ['freight risk', ['freight', 'haulage', 'haulier', 'carrier', 'trucking', 'lorry', 'trailer', 'logistics', 'cargo', 'consignment', 'shipper', 'forwarder', 'spedition', 'fracht', 'lkw', 'supply chain']],
  ['regulation', ['gdpr', 'ai act', 'regulation', 'directive', 'compliance', 'statute', 'legislation', 'law', 'legal', 'regulator', 'enforcement', 'dora', 'nis2', 'lksg', 'sanction']],
  ['ai governance', ['ai governance', 'model risk', 'algorithmic', 'ai act', 'ai safety', 'machine learning governance', 'responsible ai']],
  ['technology', ['software', 'computing', 'quantum', 'semiconductor', 'chip', 'gpu', 'cloud', 'database', 'programming', 'algorithm', 'nvidia', 'processor', 'llm', 'neural']],
  ['cybersecurity', ['cyber', 'ransomware', 'malware', 'phishing', 'breach', 'vulnerability', 'exploit', 'zero-day', 'infosec']],
  ['science', ['physics', 'chemistry', 'biology', 'genome', 'astrophysics', 'quantum mechanics', 'climate', 'neuroscience', 'vaccine', 'protein']],
  ['economics', ['gdp', 'inflation', 'interest rate', 'unemployment', 'economy', 'economic', 'trade balance', 'recession', 'monetary', 'fiscal']],
  ['finance', ['market cap', 'valuation', 'earnings', 'revenue', 'stock', 'equity', 'bond', 'investor']],
  ['geopolitics', ['geopolitic', 'sanctions', 'treaty', 'diplomatic', 'conflict', 'war', 'border', 'alliance', 'nato']],
  ['history', ['history', 'historical', 'century', 'ancient', 'medieval', 'dynasty', 'empire', 'war of']],
];

/** Geographies the router can name from question text. Extended by a knowledge package, never required. */
const GEO_HINTS: Array<[string, string[]]> = [
  ['DE', ['germany', 'german', 'deutschland', 'berlin', 'munich', 'hamburg']],
  ['AT', ['austria', 'austrian', 'vienna']],
  ['CH', ['switzerland', 'swiss', 'zurich']],
  ['NL', ['netherlands', 'dutch', 'rotterdam', 'amsterdam']],
  ['FR', ['france', 'french', 'paris']],
  ['PL', ['poland', 'polish', 'warsaw']],
  ['UK', ['united kingdom', 'britain', 'british', 'england', 'london', 'scotland', 'wales']],
  ['US', ['united states', 'u.s.', 'usa', 'america', 'american']],
  ['IN', ['india', 'indian', 'delhi', 'mumbai', 'hyderabad']],
  ['CN', ['china', 'chinese', 'beijing', 'shanghai']],
  ['EU', ['european union', 'eu-wide', 'europe', 'european', 'brussels']],
];

const DEEP_MARKERS = ['comprehensive', 'in depth', 'in-depth', 'thorough', 'deep dive', 'fully', 'everything about', 'exhaustive'];
const SHALLOW_MARKERS = ['briefly', 'in short', 'one line', 'quick', 'tl;dr', 'summarise', 'summarize'];

const dedupe = (xs: string[]): string[] => [...new Set(xs)];

/** Content words in question order. Punctuation is dropped; hyphens and dots inside tokens survive. */
export function keywordsOf(question: string): string[] {
  const tokens = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.\-']/gu, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-']+|[.\-']+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return dedupe(tokens);
}

/**
 * Entities by surface form only. An acronym is an uppercase run, a proper noun a capitalised word
 * that is not sentence-initial, and a quoted span is taken verbatim. No lookup, no inference: this
 * is a reading of the string, so it can be wrong in ways a reader can see.
 */
export function entitiesOf(question: string): QuestionEntity[] {
  const out: QuestionEntity[] = [];
  const seen = new Set<string>();
  const push = (text: string, kind: QuestionEntity['kind']) => {
    const t = text.trim();
    if (t.length === 0) return;
    const key = `${kind}:${t.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: t, kind });
  };

  for (const m of question.matchAll(/"([^"]{2,80})"|'([^']{2,80})'/g)) push(m[1] ?? m[2] ?? '', 'quoted');
  for (const m of question.matchAll(/\b([A-Z]{2,8})\b/g)) push(m[1], 'acronym');
  for (const m of question.matchAll(/\b(19|20)\d{2}\b/g)) push(m[0], 'numeric_year');

  // Capitalised runs, excluding a leading sentence-initial word, which is capitalised by convention.
  const words = question.split(/\s+/);
  let run: string[] = [];
  words.forEach((raw, i) => {
    const w = raw.replace(/[^\p{L}\p{N}\-']/gu, '');
    const capitalised = /^[A-Z][\p{Ll}\-']+$/u.test(w);
    if (capitalised && i > 0) {
      run.push(w);
      return;
    }
    if (run.length > 0) push(run.join(' '), 'proper_noun');
    run = [];
  });
  if (run.length > 0) push(run.join(' '), 'proper_noun');
  return out;
}

function matchHints(hay: string, rules: Array<[string, string[]]>): Array<{ key: string; hits: number }> {
  return rules
    .map(([key, terms]) => ({ key, hits: terms.reduce((n, t) => (hay.includes(t) ? n + 1 : n), 0) }))
    .filter((r) => r.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.key.localeCompare(b.key));
}

export interface RouteOptions {
  /** Extra domain hints from a knowledge package. Merged, never replacing the built-in list. */
  domainHints?: Array<[string, string[]]>;
  /** Extra geographies a package knows about. */
  geoHints?: Array<[string, string[]]>;
}

/**
 * Classify a question. Total: every string produces a model, and an unrecognised subject produces
 * `domain: 'general'` with `intent: 'open'` rather than a refusal.
 */
export function routeQuestion(question: string, options: RouteOptions = {}): QuestionModel {
  const query = question.trim();
  const hay = ` ${query.toLowerCase()} `;
  const notes: string[] = [];

  const intent = INTENT_RULES.find(([, re]) => re.test(hay))?.[0] ?? 'open';
  if (intent === 'open') notes.push('No question form was recognised, so the plan researches the subject generally rather than answering a specific shape.');

  const domains = matchHints(hay, [...DOMAIN_HINTS, ...(options.domainHints ?? [])]);
  const domain = domains[0]?.key ?? 'general';
  const subdomains = domains.slice(1).map((d) => d.key);
  if (domain === 'general') notes.push('No domain hint matched. This is not a rejection: the question is researched with general-purpose providers.');

  const temporal_markers: string[] = [];
  let freshness: Freshness = 'timeless';
  for (const [level, markers] of FRESHNESS_MARKERS) {
    const hit = markers.filter((m) => hay.includes(` ${m} `) || hay.includes(`${m} `) || hay.includes(` ${m}`));
    if (hit.length > 0) {
      temporal_markers.push(...hit);
      if (freshness === 'timeless') freshness = level;
    }
  }
  if (freshness === 'timeless' && (intent === 'temporal_delta' || intent === 'current_value')) freshness = 'high';
  if (freshness === 'timeless' && intent === 'risk_assessment') freshness = 'medium';
  if (intent === 'current_value') freshness = 'critical';

  const geo = matchHints(hay, [...GEO_HINTS, ...(options.geoHints ?? [])]).map((g) => g.key);

  const depth: Depth = DEEP_MARKERS.some((m) => hay.includes(m))
    ? 'deep'
    : SHALLOW_MARKERS.some((m) => hay.includes(m))
      ? 'shallow'
      : intent === 'definition'
        ? 'shallow'
        : intent === 'risk_assessment' || intent === 'comparison'
          ? 'deep'
          : 'standard';

  const quantitative = intent === 'quantification' || intent === 'current_value';
  const evidence_requirements: string[] = [];
  if (quantitative) {
    evidence_requirements.push('A figure needs a stated denominator and a stated measurement date; a count of documents is not a rate.');
    notes.push('This question asks for a number. Most document sources cannot supply a denominator, so the answer may have to be refused rather than estimated.');
  }
  if (freshness === 'high' || freshness === 'critical') {
    evidence_requirements.push('At least one source retrieved during this run, dated, rather than recalled from pinned knowledge.');
  }
  if (intent === 'comparison') evidence_requirements.push('Independent evidence for each side of the comparison, not one source describing both.');
  if (intent === 'risk_assessment') evidence_requirements.push('Operational indicators, not only public reporting: reporting evidences discussion, not occurrence.');
  if (intent === 'causal') evidence_requirements.push('A stated mechanism, and at least one source that argues against the proposed cause.');
  if (evidence_requirements.length === 0) evidence_requirements.push('At least two independent sources that are not restatements of one another.');

  return {
    query,
    intent,
    domain,
    subdomains,
    entities: entitiesOf(query),
    keywords: keywordsOf(query),
    freshness,
    temporal_markers: dedupe(temporal_markers),
    geo,
    depth,
    // Pinned knowledge is never current, so anything above `low` has to go outside. A comparison or a
    // causal claim also has to go outside regardless of freshness: the evidence requirement two lines
    // above demands independent-per-side or argued-against sources, and a pinned snapshot is one
    // fixed perspective, never independent sources plural.
    requires_external: freshness !== 'timeless' || domain === 'general' || intent === 'open' || intent === 'comparison' || intent === 'causal',
    requires_internal: true,
    quantitative,
    evidence_requirements,
    notes,
  };
}
