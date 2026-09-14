/**
 * EVOLUTION 5.0 Phase L. A README is a claim about a codebase, and a claim nobody checks goes stale in
 * one commit - this one had accumulated three different wrong test counts and a screen count two
 * evolutions behind. So the checkable claims are checked here.
 *
 * Only the structural ones. A count of tests would be self-referential (adding this file would change it)
 * and a prose claim is not a thing a test can read, so the badge and the narrative are still a human's
 * responsibility. What is pinned is every number and name that is derivable from source: the screens, the
 * providers, the internal index, and the directories the repo map says exist.
 */
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from './test/bdd';
import { PROVIDERS } from './research/providers/types';

/** Prose wraps; a claim must be findable regardless of where the line broke. */
const README = readFileSync('README.md', 'utf8').replace(/\s+/g, ' ');
const README_LINES = readFileSync('README.md', 'utf8');
const APP = readFileSync('src/app/App.tsx', 'utf8');

describe('the README, against the code it describes', () => {
  it('lists every screen the console actually routes, under the same number and label', () => {
    const nav = [...APP.matchAll(/\{ to: '[^']+', n: '(\d\d)', label: '([^']+)' \}/g)].map((m) => ({ n: m[1], label: m[2] }));
    const rows = [...README_LINES.matchAll(/^\| (\d\d) ([^|]+?) \| /gm)].map((m) => ({ n: m[1], label: m[2].trim() }));

    expect(rows.length).toBe(nav.length);
    for (const entry of nav) {
      const row = rows.find((r) => r.n === entry.n);
      expect(row).not.toBe(undefined);
      // The README shortens two long nav labels; a row must still name the screen recognisably.
      const first = entry.label.split(' ')[0];
      expect(row!.label.includes(first)).toBe(true);
    }
  });

  it('counts the retrieval providers the way the registry does, and names each one', () => {
    expect(README.includes(`${PROVIDERS.length === 8 ? 'eight' : String(PROVIDERS.length)} keyless public providers`)).toBe(true);
    expect(PROVIDERS.every((p) => p.keyless)).toBe(true);
    const proxyOnly = PROVIDERS.filter((p) => p.requires_proxy);
    expect(proxyOnly.length).toBe(1);
    expect(README.includes('One of the eight cannot be read cross-origin')).toBe(true);
  });

  it('reports the internal index size the index itself reports', () => {
    const index = JSON.parse(readFileSync('public/snapshots/knowledge/index.json', 'utf8')) as {
      records: unknown[];
      sources: unknown[];
    };
    expect(README.includes(`${index.records.length} records over ${index.sources.length} sources`)).toBe(true);
  });

  it('maps only directories that exist', () => {
    const mapped = [...README_LINES.matchAll(/^(src\/[a-z/]+)\/ +/gm)].map((m) => m[1]);
    expect(mapped.length > 0).toBe(true);
    for (const dir of mapped) {
      expect(existsSync(dir)).toBe(true);
    }
  });

  it('does not claim a count of adversarial attacks the suites do not hold', () => {
    const attacks = readFileSync('src/core/adversarial/attacks.test.ts', 'utf8');
    const council = readFileSync('src/core/deliberation/adversarial.test.ts', 'utf8');
    const count = (source: string) => [...source.matchAll(/\bit\(/g)].length;

    expect(README.includes(`holds ${count(attacks)} attacks on the guards`)).toBe(true);
    expect(README.includes(`adds ${count(council)} more`)).toBe(true);
    expect(README.includes(`${count(attacks) + count(council)} attacks`)).toBe(true);
  });
});
