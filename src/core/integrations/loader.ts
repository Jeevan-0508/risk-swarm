/**
 * Snapshot access. The engine never reaches for the network on its own: it is handed a loader, so
 * the same code runs in the browser (fetch) and in tests (filesystem) with no branching inside the
 * agents.
 */

export interface SnapshotFileProvenance {
  upstream_path: string;
  path: string;
  bytes: number;
  sha256: string;
}

export interface SnapshotSourceProvenance {
  key: string;
  upstream_repo: string;
  upstream_url: string;
  commit: string | null;
  note: string;
  files: SnapshotFileProvenance[];
}

export interface SnapshotProvenance {
  schema_version: string;
  synced_at: string;
  synced_by: string;
  sources: SnapshotSourceProvenance[];
}

export interface SnapshotLoader {
  loadJson<T>(relativePath: string): Promise<T>;
  provenance(): Promise<SnapshotProvenance>;
}

export class SnapshotUnavailableError extends Error {
  constructor(readonly path: string, cause?: unknown) {
    super(`SNAPSHOT_UNAVAILABLE: ${path}${cause instanceof Error ? ` (${cause.message})` : ''}`);
    this.name = 'SnapshotUnavailableError';
  }
}

/** Browser loader. A missing or non-JSON snapshot is a hard error: the run must not proceed blind. */
export function createFetchLoader(baseUrl: string, fetchImpl: typeof fetch = fetch): SnapshotLoader {
  const cache = new Map<string, Promise<unknown>>();
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const load = <T,>(path: string): Promise<T> => {
    if (!cache.has(path)) {
      cache.set(
        path,
        (async () => {
          try {
            const res = await fetchImpl(`${base}${path}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return (await res.json()) as T;
          } catch (err) {
            throw new SnapshotUnavailableError(path, err);
          }
        })(),
      );
    }
    return cache.get(path) as Promise<T>;
  };
  return {
    loadJson: load,
    provenance: () => load<SnapshotProvenance>('provenance.json'),
  };
}

/** In-memory loader for fixtures and adversarial tests. */
export function createMemoryLoader(files: Record<string, unknown>, provenance?: SnapshotProvenance): SnapshotLoader {
  return {
    async loadJson<T>(path: string): Promise<T> {
      if (!(path in files)) throw new SnapshotUnavailableError(path);
      return files[path] as T;
    },
    async provenance(): Promise<SnapshotProvenance> {
      if (provenance) return provenance;
      if ('provenance.json' in files) return files['provenance.json'] as SnapshotProvenance;
      throw new SnapshotUnavailableError('provenance.json');
    },
  };
}
