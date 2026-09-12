#!/usr/bin/env node
/**
 * Copies published data files from the sibling portfolio clones into
 * public/snapshots/ and records provenance (upstream commit + sha256).
 *
 *   node scripts/sync-snapshots.mjs          sync
 *   node scripts/sync-snapshots.mjs --check  verify snapshots match provenance hashes (CI)
 *
 * Upstream repos are never modified and no upstream code is copied.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siblings = path.resolve(root, '..');
const out = path.join(root, 'public', 'snapshots');

const SOURCES = [
  {
    key: 'fomo',
    repo: 'FOMO',
    url: 'https://github.com/Jeevan-0508/FOMO',
    files: [['data/signals.json', 'fomo/signals.json']],
    note: 'External freight/logistics risk signals discovered by the FOMO scanner (Google News RSS).',
  },
  {
    key: 'freight-risk-atlas',
    repo: 'freight-risk-atlas',
    url: 'https://github.com/Jeevan-0508/freight-risk-atlas',
    files: [['data/taxonomy.json', 'freight-risk-atlas/taxonomy.json']],
    note: 'Freight & Carrier Fraud Risk Taxonomy model as synced into the Atlas (patterns, indicators, false positives, countermeasures, regulatory hooks).',
  },
  {
    key: 'ai-governance-control-room',
    repo: 'ai-governance-control-room',
    url: 'https://github.com/Jeevan-0508/ai-governance-control-room',
    files: [
      ['data/frameworks.json', 'ai-governance-control-room/frameworks.json'],
      ['data/controls.json', 'ai-governance-control-room/controls.json'],
    ],
    note: 'Regulatory frameworks with cited requirements, and the control catalogue mapped to them.',
  },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function commitOf(repoDir) {
  try {
    return execFileSync('git', ['-C', repoDir, 'log', '-1', '--format=%H'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const check = process.argv.includes('--check');
const provPath = path.join(out, 'provenance.json');
const failures = [];

if (check) {
  if (!fs.existsSync(provPath)) {
    console.error('FAIL no snapshot provenance found at public/snapshots/provenance.json');
    process.exit(1);
  }
  const prov = JSON.parse(fs.readFileSync(provPath, 'utf8'));
  for (const src of prov.sources) {
    for (const f of src.files) {
      const p = path.join(out, f.path);
      if (!fs.existsSync(p)) {
        failures.push(`missing snapshot file ${f.path}`);
        continue;
      }
      const got = sha256(fs.readFileSync(p));
      if (got !== f.sha256) failures.push(`hash mismatch ${f.path}\n  expected ${f.sha256}\n  actual   ${got}`);
    }
  }
  if (failures.length) {
    console.error('SNAPSHOT CHECK FAILED\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log(`snapshot check OK (${prov.sources.length} sources, ${prov.sources.reduce((n, s) => n + s.files.length, 0)} files)`);
  process.exit(0);
}

const prov = { schema_version: '1.0', synced_at: new Date().toISOString(), synced_by: 'scripts/sync-snapshots.mjs', sources: [] };

for (const src of SOURCES) {
  const repoDir = path.join(siblings, src.repo);
  if (!fs.existsSync(repoDir)) {
    console.error(`SKIP ${src.key}: clone not found at ${repoDir}`);
    process.exitCode = 1;
    continue;
  }
  const entry = { key: src.key, upstream_repo: src.repo, upstream_url: src.url, commit: commitOf(repoDir), note: src.note, files: [] };
  for (const [from, to] of src.files) {
    const buf = fs.readFileSync(path.join(repoDir, from));
    JSON.parse(buf.toString('utf8')); // refuse to snapshot invalid JSON
    const dest = path.join(out, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    entry.files.push({ upstream_path: from, path: to, bytes: buf.length, sha256: sha256(buf) });
    console.log(`${src.key}: ${from} -> public/snapshots/${to} (${buf.length} bytes)`);
  }
  prov.sources.push(entry);
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(provPath, JSON.stringify(prov, null, 2) + '\n');
console.log('wrote public/snapshots/provenance.json');
