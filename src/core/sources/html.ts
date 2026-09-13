/**
 * Markup handling for retrieved documents. Deliberately regex-based rather than DOM-based: this code
 * must behave identically in a browser and in a test runner, and it must never construct nodes from
 * retrieved markup. Script and style contents are removed entirely, not escaped.
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block: string, tag: string): string | null {
  const cdata = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i').exec(block);
  if (cdata !== null) return stripHtml(cdata[1]!);
  const plain = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  return plain === null ? null : stripHtml(plain[1]!);
}

function linkHref(block: string): string | null {
  const direct = tagText(block, 'link');
  if (direct !== null && /^https?:\/\//.test(direct)) return direct;
  const atom = /<link\b[^>]*href=["']([^"']+)["'][^>]*>/i.exec(block);
  return atom !== null && /^https?:\/\//.test(atom[1]!) ? atom[1]! : null;
}

export interface FeedEntry {
  title: string;
  url: string | null;
  published_at: string | null;
  summary: string;
  publisher: string | null;
}

/** Parses RSS 2.0 and Atom with one pass. An entry without a title is dropped rather than guessed at. */
export function parseFeed(body: string): FeedEntry[] {
  const blocks = [...body.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const out: FeedEntry[] = [];
  for (const block of blocks) {
    const title = tagText(block, 'title');
    if (title === null || title.length === 0) continue;
    const published = tagText(block, 'pubDate') ?? tagText(block, 'published') ?? tagText(block, 'updated') ?? tagText(block, 'dc:date');
    const summary = tagText(block, 'description') ?? tagText(block, 'summary') ?? tagText(block, 'content') ?? '';
    const sourceTag = /<source\b[^>]*>([\s\S]*?)<\/source>/i.exec(block);
    out.push({
      title,
      url: linkHref(block),
      published_at: normaliseDate(published),
      summary,
      publisher: sourceTag === null ? null : stripHtml(sourceTag[1]!) || null,
    });
  }
  return out;
}

/** Returns an ISO string, or null when the feed's date cannot be parsed. Never substitutes "now". */
export function normaliseDate(raw: string | null): string | null {
  if (raw === null || raw.trim().length === 0) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
