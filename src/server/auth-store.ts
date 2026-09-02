/**
 * What Auth.js stores and where: the adapter's tables live in the events database, or in an
 * in-process PGlite when `DATABASE_URL` is unset outside production, so the dev server needs no
 * database. Dev mode logs each magic link instead of sending it and keeps it for the test endpoint.
 */
import type { Pool } from "pg";
import { getDatabase, hasDatabase, pgliteDatabase, type Database } from "./db";
import { migrate } from "./migrations";

declare global {
  // eslint-disable-next-line no-var
  var __tokuchuAuthDatabase: Promise<Database> | undefined;
  // eslint-disable-next-line no-var
  var __tokuchuMagicLinks: Map<string, string> | undefined;
}

async function memoryDatabase(): Promise<Database> {
  const db = await pgliteDatabase();
  await migrate(db);
  return db;
}

/** The database behind the Auth.js tables; the in-process one sits on `globalThis` across dev reloads. */
export function authDatabase(): Promise<Database> {
  if (hasDatabase() || process.env.NODE_ENV === "production") return getDatabase();
  globalThis.__tokuchuAuthDatabase ??= memoryDatabase();
  return globalThis.__tokuchuAuthDatabase;
}

/** The adapter reads `rows` and `rowCount` from a `pg` result, so a Database wraps into that shape. */
export function adapterPool(database: () => Promise<Database>): Pool {
  const query = async (sql: string, values: unknown[] = []) => {
    const rows = await (await database()).query(sql, values);
    return { rows, rowCount: rows.length };
  };
  return { query } as unknown as Pool;
}

/** The magic links dev mode logged instead of sending, by address. */
export function magicLinks(): Map<string, string> {
  return (globalThis.__tokuchuMagicLinks ??= new Map());
}

/** The dev sender: the link goes to the console and to `magicLinks()`. */
export async function logMagicLink({ identifier, url }: { identifier: string; url: string }): Promise<void> {
  magicLinks().set(identifier.toLowerCase(), url);
  console.log(`Magic link for ${identifier}: ${url}`);
}
