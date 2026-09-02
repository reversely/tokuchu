/**
 * One event per row: a request loads its event's document into a State, runs the domain code under
 * `runWithState`, and writes the document back when it changed. A handler that throws writes nothing.
 * Without `DATABASE_URL` outside production the handler runs against the in-memory global State, so
 * the dev server and the browser suites need no database.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { deserializeState, freshState, runWithState, serializeState, type State } from "../domain/store";
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
  const [row] = await db.query(`select id, data from events where ${column} = $1`, [value]);
  return row;
}

function stateOf(row: Row): State {
  return deserializeState(typeof row.data === "string" ? JSON.parse(row.data) : row.data);
}

async function upsert(db: Database, s: State, eventId: string, document: string): Promise<void> {
  const inviteCode = s.events.get(eventId)?.invite_code ?? null;
  await db.query(
    `insert into events (id, invite_code, data, updated_at) values ($1, $2, $3::jsonb, now())
     on conflict (id) do update set invite_code = excluded.invite_code, data = excluded.data, updated_at = now()`,
    [eventId, inviteCode, document]
  );
}

/**
 * Runs the handler under the State and then persists it. The event id comes from a callback because
 * a create handler mints it during the run. An unchanged document skips the write, so a poll never
 * touches the row.
 */
async function persisted<T>(db: Database, s: State, handler: Handler<T>, eventIdOf: () => string): Promise<T> {
  const before = JSON.stringify(serializeState(s));
  let settle!: () => void;
  const committed = new Promise<void>((resolve) => (settle = resolve));
  try {
    const result = await commits.run(committed, () => runWithState(s, handler));
    const after = JSON.stringify(serializeState(s));
    if (after !== before) await upsert(db, s, eventIdOf(), after);
    return result;
  } finally {
    settle();
  }
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
  const row = await loadRow(db, "id", eventId);
  if (!row) throw new NotFoundError(`No event ${eventId}.`);
  return persisted(db, stateOf(row), handler, () => eventId);
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
  const row = await loadRow(db, "invite_code", code.toUpperCase());
  if (!row) throw new NotFoundError(`No published event with code ${code}.`);
  return persisted(db, stateOf(row), handler, () => row.id as string);
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
  });
}

/** Resolves once the enclosing request's row is written, or at once outside a persisted request. */
export function afterCommit(): Promise<void> {
  return commits.getStore() ?? Promise.resolve();
}
