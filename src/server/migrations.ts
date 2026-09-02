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
  },
  // The tables `@auth/pg-adapter` queries by name, one migration each because a query with
  // parameters runs one statement. Ids are text uuids rather than the adapter's sample serials so a
  // user id fits `events.owner_id` as it is.
  {
    name: "002_users",
    sql: `
      create table if not exists users (
        id text primary key default gen_random_uuid()::text,
        name text,
        email text unique,
        "emailVerified" timestamptz,
        image text
      )`
  },
  {
    name: "003_accounts",
    sql: `
      create table if not exists accounts (
        id text primary key default gen_random_uuid()::text,
        "userId" text not null references users (id) on delete cascade,
        type text not null,
        provider text not null,
        "providerAccountId" text not null,
        refresh_token text,
        access_token text,
        expires_at bigint,
        id_token text,
        scope text,
        session_state text,
        token_type text,
        unique (provider, "providerAccountId")
      )`
  },
  {
    name: "004_sessions",
    sql: `
      create table if not exists sessions (
        id text primary key default gen_random_uuid()::text,
        "userId" text not null references users (id) on delete cascade,
        expires timestamptz not null,
        "sessionToken" text not null unique
      )`
  },
  {
    name: "005_verification_token",
    sql: `
      create table if not exists verification_token (
        identifier text not null,
        expires timestamptz not null,
        token text not null,
        primary key (identifier, token)
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
