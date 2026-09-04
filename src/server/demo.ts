/**
 * The seeded walkthrough event: `/demo` creates one for its caller the first time and reuses it after
 * that; the caller is the session user when signed in and a guest id otherwise. The sweep deletes a
 * guest's temporary events after `DEMO_TTL_HOURS`: the script runs it against the database, and the
 * in-memory store runs it inside the `/demo` handler. An event an account took over is no longer a
 * guest's and stays. The `demo` field identifies the explicit scripted walkthrough; it does not
 * identify every event owned by a guest.
 */
import { DEMO_EVENT } from "../demo/seed";
import { DEMO_TOKEN_PARAM } from "../demo/token";
import { publishEvent, state, type State } from "../domain/store";
import { createEventFromBody } from "./api";
import type { Database } from "./db";
import { DEMO_ID_PREFIX, DEMO_TTL_HOURS, demoCookieValue, isDemoId } from "./demo-session";
import { createPersistedEvent, listOwnedEvents } from "./persistence";

/** The id of the caller's demo event, created and published from the seed when none exists. */
export async function demoEventFor(ownerId: string): Promise<string> {
  const existing = (await listOwnedEvents(ownerId)).find((event) => event.demo);
  if (existing) return existing.id;
  return createPersistedEvent(() => publishEvent(createEventFromBody(DEMO_EVENT, ownerId, true).id).id);
}

/** The path a guest returns to after sign-in: its demo event with the signed token, so the hand-off runs on that request. */
export async function guestKeepPath(guestId: string): Promise<string> {
  return `/events/${await demoEventFor(guestId)}?${DEMO_TOKEN_PARAM}=${encodeURIComponent(demoCookieValue(guestId))}`;
}

/** The sign-in page that comes back to `next`. */
export function signInPath(next: string): string {
  return `/sign-in?next=${encodeURIComponent(next)}`;
}

/** Deletes a guest's temporary events last written more than `olderThanHours` ago and returns how many went. */
export async function sweepDemoEvents(db: Database, olderThanHours = DEMO_TTL_HOURS): Promise<number> {
  const rows = await db.query(
    "delete from events where owner_id like $1 and updated_at < now() - make_interval(hours => $2::int) returning id",
    [`${DEMO_ID_PREFIX}%`, olderThanHours]
  );
  return rows.length;
}

function removeEvent(s: State, eventId: string): void {
  const subjects = new Set([eventId]);
  for (const map of [s.parties, s.guests]) {
    for (const [id, row] of map) if (row.event_id === eventId) subjects.add(id);
  }
  for (const map of [s.parties, s.guests, s.definitions, s.updates, s.gifts, s.tokens, s.grants, s.requests]) {
    for (const [id, row] of map) if (row.event_id === eventId) map.delete(id);
  }
  for (const [key, value] of s.values) if (subjects.has(value.subject_id)) s.values.delete(key);
  s.changes = s.changes.filter((change) => change.event_id !== eventId);
  s.events.delete(eventId);
}

/** The in-memory counterpart: drops a guest's temporary events created more than `olderThanHours` ago and every row that names them. */
export function sweepDemoState(olderThanHours = DEMO_TTL_HOURS, now = new Date()): number {
  const s = state();
  const cutoff = now.getTime() - olderThanHours * 60 * 60 * 1000;
  const expired = [...s.events.values()].filter((event) => isDemoId(event.owner_id) && Date.parse(event.created_at) < cutoff);
  for (const event of expired) removeEvent(s, event.id);
  return expired.length;
}
