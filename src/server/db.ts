/**
 * The database behind the persisted events: Postgres through `pg` in production and PGlite, an
 * embedded Postgres, in tests. Both speak the same `$1` placeholders and return parsed jsonb, so the
 * persistence code sees one interface. The drivers load on first use, so a request that never
 * touches the database pays nothing for them.
 */

export type Row = Record<string, unknown>;

export interface Database {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  close(): Promise<void>;
}

export async function pgDatabase(connectionString: string): Promise<Database> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString });
  return {
    query: async (sql, params = []) => (await pool.query(sql, params)).rows as Row[],
    close: () => pool.end()
  };
}

/** An in-process Postgres for tests; its data lives in memory and goes with the instance. */
export async function pgliteDatabase(): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  return {
    query: async (sql, params = []) => (await db.query(sql, params)).rows as Row[],
    close: () => db.close()
  };
}

declare global {
  // eslint-disable-next-line no-var
  var __tokuchuDatabase: Promise<Database> | undefined;
}

let override: Database | undefined;

/** Test hook: the database every wrapper uses instead of `DATABASE_URL`; null restores the default. */
export function setDatabase(db: Database | null): void {
  override = db ?? undefined;
}

export function hasDatabase(): boolean {
  return override !== undefined || !!process.env.DATABASE_URL;
}

/**
 * The process-wide database. The pool sits on `globalThis` so the Next dev server's module reloads
 * reuse it instead of opening one pool per reload.
 *
 * Raises:
 *   Error: when `DATABASE_URL` is not set and no test database is installed.
 */
export function getDatabase(): Promise<Database> {
  if (override) return Promise.resolve(override);
  const url = process.env.DATABASE_URL;
  if (!url) return Promise.reject(new Error("DATABASE_URL is not set; the persisted events need a Postgres connection string."));
  globalThis.__tokuchuDatabase ??= pgDatabase(url);
  return globalThis.__tokuchuDatabase;
}
