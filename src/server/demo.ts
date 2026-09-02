/**
 * The demo organizer's event: `/demo` creates one from the seed the first time a cookie's id shows
 * up and reuses it after that. The sweep deletes demo events after `DEMO_TTL_HOURS`: the script
 * runs it against the database, and the in-memory store runs it inside the `/demo` handler.
 */
import { DEMO_EVENT } from "../demo/seed";
import { publishEvent, state, type State } from "../domain/store";
import { createEventFromBody } from "./api";
import type { Database } from "./db";
import { DEMO_ID_PREFIX, DEMO_TTL_HOURS, isDemoId } from "./demo-session";
import { createPersistedEvent, listOwnedEvents } from "./persistence";

/** The id of the demo organizer's event, created and published from the seed when none exists. */
export async function demoEventFor(demoId: string): Promise<string> {
  const [existing] = await listOwnedEvents(demoId);
  if (existing) return existing.id;
  return createPersistedEvent(() => publishEvent(createEventFromBody(DEMO_EVENT, demoId).id).id);
}

/** Deletes the demo events last written more than `olderThanHours` ago and returns how many went. */
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
  for (const map of [s.parties, s.guests, s.definitions, s.updates, s.gifts, s.tokens, s.requests]) {
    for (const [id, row] of map) if (row.event_id === eventId) map.delete(id);
  }
  for (const [key, value] of s.values) if (subjects.has(value.subject_id)) s.values.delete(key);
  s.changes = s.changes.filter((change) => change.event_id !== eventId);
  s.events.delete(eventId);
}

/** The in-memory counterpart: drops the demo events created more than `olderThanHours` ago and every row that names them. */
export function sweepDemoState(olderThanHours = DEMO_TTL_HOURS, now = new Date()): number {
  const s = state();
  const cutoff = now.getTime() - olderThanHours * 60 * 60 * 1000;
  const stale = [...s.events.values()].filter((event) => isDemoId(event.owner_id) && Date.parse(event.created_at) < cutoff);
  for (const event of stale) removeEvent(s, event.id);
  return stale.length;
}
