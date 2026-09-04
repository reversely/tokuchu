/**
 * The hand-off from a guest to an account: the first request that carries both a session and a valid
 * guest token moves every event the guest owns under the session's user id and records the guest id
 * as consumed, so the token never names a caller again. The database keeps consumed ids in
 * `consumed_guests`; the in-memory store keeps them on the State.
 */
import { state } from "../domain/store";
import { getDatabase, hasDatabase } from "./db";

function usesDatabase(): boolean {
  return hasDatabase() || process.env.NODE_ENV === "production";
}

/** Whether an account already took the guest id over. */
export async function isConsumedGuest(guestId: string): Promise<boolean> {
  if (!usesDatabase()) return state().consumed_guests.has(guestId);
  const db = await getDatabase();
  const rows = await db.query("select 1 from consumed_guests where id = $1", [guestId]);
  return rows.length > 0;
}

/**
 * Moves the guest's events under the user and consumes the guest id; a second call for the same
 * guest changes nothing. Only an event created through the explicit `/demo` walkthrough keeps
 * `demo: true`, so ordinary agent-created guest events never mount the tour.
 */
export async function handOffGuest(guestId: string, userId: string): Promise<void> {
  if (await isConsumedGuest(guestId)) return;
  if (!usesDatabase()) {
    const s = state();
    for (const [id, event] of s.events) if (event.owner_id === guestId) s.events.set(id, { ...event, owner_id: userId });
    s.consumed_guests.add(guestId);
    return;
  }
  const db = await getDatabase();
  // The owner sits in the column and inside the document, so both change in one statement.
  await db.query(
    "update events set owner_id = $2, data = jsonb_set(data, '{events,0,1,owner_id}', to_jsonb($2::text)), updated_at = now() where owner_id = $1",
    [guestId, userId]
  );
  await db.query("insert into consumed_guests (id) values ($1) on conflict (id) do nothing", [guestId]);
}
