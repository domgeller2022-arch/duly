/**
 * Schema version and app version.
 *
 * Migrations are versioned and a backup is taken before any of them run. A
 * database written by a newer build is refused rather than silently opened, since
 * the alternative is data loss with no explanation.
 */

export const SCHEMA_VERSION = 3;

let cachedVersion: string | null = null;

/**
 * The app version.
 *
 * Read from Vite's build constants at runtime and fall back to the package
 * version, so the value is correct in a dev server and in a packaged build.
 */
export function appVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const meta = (import.meta as unknown as { env?: Record<string, string> }).env;
    cachedVersion = meta?.VITE_APP_VERSION ?? '0.1.0';
  } catch {
    cachedVersion = '0.1.0';
  }
  return cachedVersion;
}

/** Compare two dotted version strings. Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

export class SchemaTooNewError extends Error {
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `This database was written by a newer version of Duly (schema ${found}; this build supports ${supported}). Update Duly to open it.`,
    );
    this.name = 'SchemaTooNewError';
  }
}

/** Guard a snapshot before importing it. */
export function assertSchemaSupported(version: number): void {
  if (version > SCHEMA_VERSION) throw new SchemaTooNewError(version, SCHEMA_VERSION);
}
