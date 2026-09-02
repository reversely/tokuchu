/**
 * The schema, as ordered SQL migrations. `schema_migrations` records each applied name, so a rerun
 * skips what is already there, and each statement also guards itself with `if not exists`.
 */
import type { Database } from "./db";

export type Migration = { name: string; sql: string };

export const migrations: Migration[] = [
  {
    name: "001_events",
    sql: `
      create table if not exists events (
        id text primary key,
        owner_id text,
        invite_code text unique,
        data jsonb not null,
        updated_at timestamptz not null default now()
      )`
  }
];

/** Applies every migration the database has not recorded yet and returns the names applied. */
export async function migrate(db: Database): Promise<string[]> {
  await db.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const applied = new Set((await db.query("select name from schema_migrations")).map((row) => row.name as string));
  const done: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    await db.query(migration.sql);
    await db.query("insert into schema_migrations (name) values ($1)", [migration.name]);
    done.push(migration.name);
  }
  return done;
}
