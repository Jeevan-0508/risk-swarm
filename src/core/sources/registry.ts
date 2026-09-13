/**
 * The four live sources. Only the news source ships with a default endpoint, because Google News RSS is
 * the feed the pinned FOMO snapshot was itself built from and its query format is known. The other three
 * are operator-configured: inventing a regulator's feed URL would put a fabricated citation at tier 1,
 * which is the single worst failure this system could have.
 */
import { parseFeed, stripHtml } from './html';
import type { LiveItem, LiveQuery, LiveSource } from './types';

const toItems = (body: string, fallbackPublisher: string): LiveItem[] =>
  parseFeed(body).map((e) => ({
    title: e.title,
    url: e.url,
    publisher: e.publisher ?? fallbackPublisher,
    published_at: e.published_at,
    summary: stripHtml(e.summary).slice(0, 600),
  }));

export function newsSource(): LiveSource {
  return {
    key: 'news',
    label: 'News search (Google News RSS)',
    source_type: 'news',
    remit: 'Press and trade reporting. Tier 3: it evidences that something was reported, not that it happened.',
    endpoints(query: LiveQuery) {
      const locale = query.locale ?? 'en';
      const region = query.geo[0] ?? 'DE';
      return query.terms.map(
        (term) => `https://news.google.com/rss/search?q=${encodeURIComponent(term)}&hl=${locale}&gl=${region}&ceid=${region}:${locale}`,
      );
    },
    parse: (body) => toItems(body, 'news.google.com'),
  };
}

/** A feed the operator names as a regulator's own publication. Tier 1, so it is never defaulted. */
export function regulatorySource(endpoints: string[]): LiveSource {
  return {
    key: 'regulatory',
    label: 'Regulator feed (operator-configured)',
    source_type: 'regulator',
    remit: 'An official publication feed. Tier 1, so the URL must be supplied by a person who can vouch for it.',
    endpoints: () => endpoints,
    parse: (body) => toItems(body, 'regulator'),
  };
}

export function industrySource(endpoints: string[]): LiveSource {
  return {
    key: 'industry',
    label: 'Industry body feed (operator-configured)',
    source_type: 'industry_body',
    remit: 'An association, insurer or standards body feed. Tier 2.',
    endpoints: () => endpoints,
    parse: (body) => toItems(body, 'industry body'),
  };
}

/**
 * A single page or feed the operator pastes in. Classified as portfolio_kb (tier 4) whatever it contains:
 * an arbitrary URL cannot earn a better tier than "someone thought this was relevant".
 */
export function webSource(endpoints: string[]): LiveSource {
  return {
    key: 'web',
    label: 'Web page or feed (operator-supplied)',
    source_type: 'portfolio_kb',
    remit: 'An arbitrary URL. Tier 4 regardless of what it is, because nothing about it has been verified.',
    endpoints: () => endpoints,
    parse: (body) => {
      const feed = toItems(body, 'web');
      if (feed.length > 0) return feed;
      const text = stripHtml(body);
      if (text.length === 0) return [];
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
      return [{
        title: title === null ? text.slice(0, 140) : stripHtml(title[1]!),
        url: null,
        publisher: 'web',
        published_at: null,
        summary: text.slice(0, 600),
      }];
    },
  };
}
