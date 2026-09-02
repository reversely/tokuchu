import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_EVENT } from "../demo/seed";
import { createEvent, resetState, state, type EventInput } from "../domain/store";
import { createEventFromBody, importGuests, snapshot } from "./api";
import { pgliteDatabase, setDatabase, type Database } from "./db";
import { demoEventFor, sweepDemoEvents, sweepDemoState } from "./demo";
import { DEMO_ID_PREFIX, demoCookieValue, demoIdFromCookie, isDemoId, newDemoId } from "./demo-session";
import { migrate } from "./migrations";
import { createPersistedEvent, listOwnedEvents, withPersistedEvent } from "./persistence";

const SECRET = "test-secret"; // pragma: allowlist secret
const INPUT: EventInput = { type: "party", title: "Owned event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" }, spots: null, cost_per_person_cents: null, rsvp_deadline: null, description: "", invite_extras: [], response_options: ["going", "cant_go"], settings: { guest_approval: false, reminders: false, reask_on_change: false, order_approval: true }, delivery: { destination: "venue", address: null, needed_by: null }, segments: [] };

describe("demo session", () => {
  it("mints a prefixed id of 16 url-safe characters", () => {
    const id = newDemoId();
    expect(id).toMatch(new RegExp(`^${DEMO_ID_PREFIX}[A-Za-z0-9_-]{16}$`));
    expect(newDemoId()).not.toBe(id);
    expect(isDemoId(id)).toBe(true);
    expect(isDemoId("user_a")).toBe(false);
    expect(isDemoId(null)).toBe(false);
  });

  it("round-trips an id through the signed cookie and rejects a forged or unsigned value", () => {
    const id = newDemoId();
    const value = demoCookieValue(id, SECRET);
    expect(demoIdFromCookie(value, SECRET)).toBe(id);
    expect(demoIdFromCookie(value, "other-secret")).toBeNull();
    expect(demoIdFromCookie(`${newDemoId()}.${value.split(".")[1]}`, SECRET)).toBeNull();
    expect(demoIdFromCookie(id, SECRET)).toBeNull();
    expect(demoIdFromCookie(demoCookieValue("user_a", SECRET), SECRET)).toBeNull();
    expect(demoIdFromCookie(undefined, SECRET)).toBeNull();
  });
});

describe("in memory", () => {
  beforeEach(resetState);

  it("creates one published event from the seed per demo id and reuses it", async () => {
    const id = newDemoId();
    const eventId = await demoEventFor(id);
    expect(await demoEventFor(id)).toBe(eventId);
    const snap = snapshot(eventId);
    expect(snap.event).toMatchObject({ title: DEMO_EVENT.title, owner_id: id, status: "published" });
    expect(snap.event.invite_code).toMatch(/^[A-Z0-9]{6}$/);
    expect(snap.demo).toBe(true);
    expect(snapshot(createEvent(INPUT, "evt_owned", "user_a").id).demo).toBe(false);
  });

  it("sweeps a stale demo event with its rows and leaves a fresh one and an account's event", async () => {
    const stale = createEventFromBody(DEMO_EVENT, newDemoId());
    importGuests(stale.id, { lines: ["Ana", "Ben"] });
    const fresh = createEventFromBody(DEMO_EVENT, newDemoId());
    const owned = createEvent(INPUT, "evt_owned", "user_a");
    const s = state();
    s.events.set(stale.id, { ...stale, created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() });
    expect(sweepDemoState(24)).toBe(1);
    expect([...s.events.keys()].sort()).toEqual([fresh.id, owned.id].sort());
    expect([...s.guests.values()].some((g) => g.event_id === stale.id)).toBe(false);
    expect([...s.definitions.values()].some((d) => d.event_id === stale.id)).toBe(false);
    expect(sweepDemoState(24)).toBe(0);
  });
});

describe("in the database", () => {
  let db: Database;

  beforeAll(async () => {
    db = await pgliteDatabase();
    await migrate(db);
    setDatabase(db);
  }, 30_000);

  afterAll(async () => {
    setDatabase(null);
    await db.close();
  });

  it("creates the demo event as a row the demo organizer owns and reuses it", async () => {
    const id = newDemoId();
    const eventId = await demoEventFor(id);
    expect(await demoEventFor(id)).toBe(eventId);
    expect((await listOwnedEvents(id)).map((e) => e.id)).toEqual([eventId]);
    expect((await withPersistedEvent(eventId, () => snapshot(eventId))).event.status).toBe("published");
  });

  it("sweeps the demo rows older than the window and leaves the rest", async () => {
    const stale = await demoEventFor(newDemoId());
    const fresh = await demoEventFor(newDemoId());
    const owned = await createPersistedEvent(() => createEventFromBody(DEMO_EVENT, "user_a"));
    await db.query("update events set updated_at = now() - interval '25 hours' where id in ($1, $2)", [stale, owned.id]);
    expect(await sweepDemoEvents(db, 24)).toBe(1);
    const ids = (await db.query("select id from events order by id")).map((r) => r.id);
    expect(ids).not.toContain(stale);
    expect(ids).toContain(fresh);
    expect(ids).toContain(owned.id);
  });
});
