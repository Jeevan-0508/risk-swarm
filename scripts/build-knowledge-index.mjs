/**
 * Builds the internal knowledge index.
 *
 * The engine cannot walk a filesystem in a browser, so the repository's own knowledge is compiled
 * into one pinned, hashed JSON file that the existing snapshot loader can serve in both environments.
 * The index holds records, not files: a taxonomy pattern is a record, a governance control is a
 * record, a documentation section is a record. That is what makes a match citable.
 *
 * Run: bun run knowledge:index
 * The output is committed, because a run must be able to say exactly which version of internal
 * knowledge it read.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'public', 'snapshots', 'knowledge', 'index.json');
const MAX_TEXT = 1400;

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const clip = (s) => {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_TEXT ? { text: `${flat.slice(0, MAX_TEXT)}…`, truncated: true } : { text: flat, truncated: false };
};

const records = [];
const push = (r) => {
  const { text, truncated } = clip(r.text);
  records.push({ ...r, text, truncated, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256(text) });
};

async function taxonomy() {
  const rel = 'freight-risk-atlas/taxonomy.json';
  const raw = JSON.parse(await readFile(path.join(ROOT, 'public', 'snapshots', rel), 'utf8'));
  for (const p of raw.patterns ?? []) {
    push({
      id: `KN-TAX-${p.id}`,
      source_kind: 'taxonomy',
      source: raw.meta?.taxonomy ?? 'freight-risk-atlas',
      path: rel,
      ref: p.id,
      title: `${p.id} ${p.name}`,
      // Aliases are indexed because an operator's word for a pattern is rarely the taxonomy's word.
      text: [p.summary, p.how_it_works, (p.aliases ?? []).join(', ')].filter(Boolean).join(' '),
      updated_at: p.last_reviewed ?? raw.meta?.last_reviewed ?? null,
      facets: { category: p.category ?? null, severity: p.severity ?? null, geography: p.geography ?? [], modes: p.modes ?? [] },
    });
  }
}

async function controls() {
  const rel = 'ai-governance-control-room/controls.json';
  const raw = JSON.parse(await readFile(path.join(ROOT, 'public', 'snapshots', rel), 'utf8'));
  for (const c of raw.controls ?? []) {
    push({
      id: `KN-CTL-${c.id}`,
      source_kind: 'controls',
      source: 'ai-governance-control-room',
      path: rel,
      ref: c.id,
      title: `${c.id} ${c.name ?? c.title ?? ''}`.trim(),
      text: [c.name ?? c.title, c.requirement, c.description, c.obligation, (c.evidence ?? []).join(', ')].filter(Boolean).join(' '),
      updated_at: raw.updated ?? null,
      facets: { framework: c.framework ?? null, article: c.article ?? null },
    });
  }
}

/** Markdown split on level-2 and level-3 headings, so a match points at a section rather than a file. */
async function documents() {
  const files = [{ dir: '.', name: 'README.md' }];
  for (const name of await readdir(path.join(ROOT, 'docs'))) if (name.endsWith('.md')) files.push({ dir: 'docs', name });

  for (const { dir, name } of files) {
    const rel = dir === '.' ? name : `${dir}/${name}`;
    const body = await readFile(path.join(ROOT, rel), 'utf8');
    const lines = body.split(/\r?\n/);
    let heading = name.replace(/\.md$/, '');
    let buffer = [];
    let index = 0;
    const flush = () => {
      const text = buffer.join(' ').trim();
      buffer = [];
      if (text.length < 60) return; // a heading with no prose is not knowledge
      index += 1;
      push({
        id: `KN-DOC-${name.replace(/\.md$/, '').replace(/[^A-Za-z0-9]/g, '')}-${String(index).padStart(2, '0')}`,
        source_kind: 'document',
        source: rel,
        path: rel,
        ref: heading,
        title: `${name.replace(/\.md$/, '')} · ${heading}`,
        text,
        updated_at: null,
        facets: {},
      });
    };
    for (const line of lines) {
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h !== null) {
        flush();
        heading = h[2].replace(/[#*`]/g, '').trim();
        continue;
      }
      if (/^\s*```/.test(line)) continue;
      buffer.push(line.replace(/[|>*`]/g, ' '));
    }
    flush();
  }
}

await taxonomy();
await controls();
await documents();

const index = {
  schema_version: '1',
  built_at: new Date().toISOString(),
  // The index is derived, so it carries the hash of its own content rather than claiming an upstream commit.
  content_hash: sha256(JSON.stringify(records.map((r) => r.sha256))),
  record_count: records.length,
  sources: [...new Set(records.map((r) => r.source))].sort(),
  note:
    'Compiled from this repository by scripts/build-knowledge-index.mjs. Each record is a taxonomy pattern, ' +
    'a governance control or a documentation section, clipped to 1400 characters and hashed. A record ' +
    'evidences what this repository states, never that the statement is correct.',
  records,
};

await writeFile(OUT, `${JSON.stringify(index, null, 1)}\n`, 'utf8');
console.log(`knowledge index: ${records.length} records, ${Buffer.byteLength(JSON.stringify(index), 'utf8')} bytes -> ${path.relative(ROOT, OUT)}`);
for (const kind of ['taxonomy', 'controls', 'document']) {
  console.log(`  ${kind}: ${records.filter((r) => r.source_kind === kind).length}`);
}
