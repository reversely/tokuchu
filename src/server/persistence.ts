/**
 * One event per row: a request loads its event's document into a State, runs the domain code under
 * `runWithState`, and writes the document back when it changed. A handler that throws writes nothing.
 * Without `DATABASE_URL` outside production the handler runs against the in-memory global State, so
 * the dev server and the browser suites need no database.
 *
 * Concurrent writes use optimistic locking: the upsert checks `updated_at` against the value read
 * at load time. A stale write re-loads the row, re-runs the handler, and tries again.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { deserializeState, freshState, runWithState, serializeState, state, type State } from "../domain/store";
import type { Event } from "../domain/types";
import { getDatabase, hasDatabase, type Database, type Row } from "./db";
import { NotFoundError } from "./errors";

type Handler<T> = () => T | Promise<T>;

/** The promise a request's persist settles, so work scheduled after the response can wait for the row. */
const commits = new AsyncLocalStorage<Promise<void>>();

declare global {
  // eslint-disable-next-line no-var
  var __tokuchuWarnedNoDatabase: boolean | undefined;
}

/** The warning fires once per process; the flag sits on `globalThis` because each route bundle loads its own copy of this module. */
function usesDatabase(): boolean {
  if (hasDatabase()) return true;
  if (process.env.NODE_ENV === "production") return true;
  if (!globalThis.__tokuchuWarnedNoDatabase) {
    globalThis.__tokuchuWarnedNoDatabase = true;
    console.warn("DATABASE_URL is not set; events live in this process's memory and vanish with it.");
  }
  return false;
}

async function loadRow(db: Database, column: "id" | "invite_code", value: string): Promise<Row | undefined> {
  const [row] = await db.query(`select id, data, updated_at from events where ${column} = $1`, [value]);
  return row;
}

function stateOf(row: Row): State {
  return deserializeState(typeof row.data === "string" ? JSON.parse(row.data) : row.data);
}

function loadedAt(row: Row): string {
  const ts = row.updated_at;
  return ts instanceof Date ? ts.toISOString() : String(ts);
}

async function upsert(db: Database, s: State, eventId: string, document: string, expectedUpdatedAt: string | null): Promise<boolean> {
  const event = s.events.get(eventId);
  if (expectedUpdatedAt) {
    const [updated] = await db.query(
      `update events set owner_id = $2, invite_code = $3, data = $4::jsonb, updated_at = now()
       where id = $1 and updated_at = $5
       returning id`,
      [eventId, event?.owner_id ?? null, event?.invite_code ?? null, document, expectedUpdatedAt]
    );
    return !!updated;
  }
  await db.query(
    `insert into events (id, owner_id, invite_code, data, updated_at) values ($1, $2, $3, $4::jsonb, now())
     on conflict (id) do update set owner_id = excluded.owner_id, invite_code = excluded.invite_code, data = excluded.data, updated_at = now()`,
    [eventId, event?.owner_id ?? null, event?.invite_code ?? null, document]
  );
  return true;
}

const MAX_RETRIES = 3;

/**
 * Runs the handler under the State and then persists it. The event id comes from a callback because
 * a create handler mints it during the run. An unchanged document skips the write, so a poll never
 * touches the row.
 */
async function persisted<T>(db: Database, s: State, handler: Handler<T>, eventIdOf: () => string, expectedUpdatedAt: string | null = null): Promise<T> {
  const before = JSON.stringify(serializeState(s));
  let settle!: () => void;
  const committed = new Promise<void>((resolve) => (settle = resolve));
  try {
    const result = await commits.run(committed, () => runWithState(s, handler));
    const after = JSON.stringify(serializeState(s));
    if (after !== before) {
      const written = await upsert(db, s, eventIdOf(), after, expectedUpdatedAt);
      if (!written) throw new StaleWriteError(eventIdOf());
    }
    return result;
  } finally {
    settle();
  }
}

class StaleWriteError extends Error {
  constructor(public eventId: string) { super(`Concurrent write to event ${eventId}`); }
}

async function persistedWithRetry<T>(db: Database, loadColumn: "id" | "invite_code", loadValue: string, handler: Handler<T>, eventIdOf: (row: Row) => string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const row = await loadRow(db, loadColumn, loadValue);
    if (!row) throw new NotFoundError(`No event with ${loadColumn} ${loadValue}.`);
    try {
      return await persisted(db, stateOf(row), handler, () => eventIdOf(row), loadedAt(row));
    } catch (e) {
      if (e instanceof StaleWriteError && attempt < MAX_RETRIES) continue;
      throw e;
    }
  }
  throw new Error("unreachable");
}

/**
 * Runs the handler with `state()` bound to the stored event and writes the event back afterwards.
 *
 * Raises:
 *   NotFoundError: when no row has the id.
 */
export async function withPersistedEvent<T>(eventId: string, handler: Handler<T>): Promise<T> {
  if (!usesDatabase()) return handler();
  const db = await getDatabase();
  return persistedWithRetry(db, "id", eventId, handler, () => eventId);
}

/**
 * The public loader: the same wrapper keyed by the invite code.
 *
 * Raises:
 *   NotFoundError: when no row has the code.
 */
export async function withPersistedEventByInviteCode<T>(code: string, handler: Handler<T>): Promise<T> {
  if (!usesDatabase()) return handler();
  const db = await getDatabase();
  return persistedWithRetry(db, "invite_code", code.toUpperCase(), handler, (row) => row.id as string);
}

/**
 * Runs a create handler on a fresh State and inserts the event it made as a new row.
 *
 * Raises:
 *   Error: when the handler created no event.
 */
export async function createPersistedEvent<T>(handler: Handler<T>): Promise<T> {
  if (!usesDatabase()) return handler();
  const db = await getDatabase();
  const s = freshState();
  return persisted(db, s, handler, () => {
    const [event] = s.events.values();
    if (!event) throw new Error("The create handler stored no event.");
    return event.id;
  }, null);
}

/** One row of an organizer's event list. */
export type OwnedEvent = { id: string; title: string; status: Event["status"]; invite_code: string | null; updated_at: string; demo: boolean };

/**
 * The events one organizer owns, latest first. The title and status sit inside the document at the
 * first entry of its events list, so the query reads them by path instead of loading each document.
 * The in-memory store keeps no write time, so there the creation time stands in for `updated_at`.
 */
export async function listOwnedEvents(ownerId: string): Promise<OwnedEvent[]> {
  if (!usesDatabase()) {
    return [...state().events.values()]
      .filter((event) => event.owner_id === ownerId)
      .map((event) => ({ id: event.id, title: event.title, status: event.status, invite_code: event.invite_code, updated_at: event.created_at, demo: event.demo }))
      .reverse();
  }
  const db = await getDatabase();
  const rows = await db.query(
    `select id, invite_code, updated_at, data #>> '{events,0,1,title}' as title, data #>> '{events,0,1,status}' as status, data #>> '{events,0,1,demo}' as demo
     from events where owner_id = $1 order by updated_at desc`,
    [ownerId]
  );
  return rows.map((row) => ({ id: row.id as string, title: row.title as string, status: row.status as Event["status"], invite_code: row.invite_code as string | null, updated_at: new Date(row.updated_at as string | Date).toISOString(), demo: row.demo === "true" }));
}

/** Resolves once the enclosing request's row is written, or at once outside a persisted request. */
export function afterCommit(): Promise<void> {
  return commits.getStore() ?? Promise.resolve();
}
