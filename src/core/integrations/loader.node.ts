/**
 * Filesystem loader. Used by tests and by the snapshot check script; never imported by the browser
 * bundle, so node built-ins stay out of the build.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SnapshotUnavailableError, type SnapshotLoader, type SnapshotProvenance } from './loader';

export function createFileLoader(rootDir: string): SnapshotLoader {
  const cache = new Map<string, Promise<unknown>>();
  const load = <T,>(rel: string): Promise<T> => {
    if (!cache.has(rel)) {
      cache.set(
        rel,
        (async () => {
          try {
            return JSON.parse(await readFile(path.join(rootDir, rel), 'utf8')) as T;
          } catch (err) {
            throw new SnapshotUnavailableError(rel, err);
          }
        })(),
      );
    }
    return cache.get(rel) as Promise<T>;
  };
  return { loadJson: load, provenance: () => load<SnapshotProvenance>('provenance.json') };
}
