import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_EVENT } from "../demo/seed";
import { createEvent, resetState, state, type EventInput } from "../domain/store";
import { createEventFromBody, importGuests, snapshot } from "./api";
import { pgliteDatabase, setDatabase, type Database } from "./db";
import { demoEventFor, sweepDemoEvents, sweepDemoState } from "./demo";
import { DEMO_ID_PREFIX, demoCookieValue, demoIdFromCookie, isDemoId, newDemoId } from "./demo-session";
import { handOffGuest, isConsumedGuest } from "./handoff";
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
    expect(snap.event).toMatchObject({ title: DEMO_EVENT.title, owner_id: id, status: "published", demo: true });
    expect(snap.event.invite_code).toMatch(/^[A-Z0-9]{6}$/);
    expect(snap.demo).toBe(true);
    expect(snapshot(createEvent(INPUT, "evt_owned", "user_a").id).demo).toBe(false);
  });

  it("creates the demo event under an account and reuses it beside the account's other events", async () => {
    const owned = createEvent(INPUT, "evt_owned", "user_a");
    const eventId = await demoEventFor("user_a");
    expect(eventId).not.toBe(owned.id);
    expect(await demoEventFor("user_a")).toBe(eventId);
    expect(snapshot(eventId)).toMatchObject({ demo: true, event: { owner_id: "user_a", demo: true } });
    expect((await listOwnedEvents("user_a")).map((e) => [e.id, e.demo])).toEqual([[eventId, true], [owned.id, false]]);
  });

  it("sweeps every expired temporary guest event and leaves a fresh one and an account's walkthrough", async () => {
    const expired = createEventFromBody(DEMO_EVENT, newDemoId(), true);
    importGuests(expired.id, { lines: ["Ana", "Ben"] });
    const expiredWithoutTour = createEventFromBody(DEMO_EVENT, newDemoId(), false);
    const fresh = createEventFromBody(DEMO_EVENT, newDemoId(), true);
    const kept = createEventFromBody(DEMO_EVENT, "user_a", true);
    const s = state();
    const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    s.events.set(expired.id, { ...expired, created_at: dayAgo });
    s.events.set(expiredWithoutTour.id, { ...expiredWithoutTour, created_at: dayAgo });
    s.events.set(kept.id, { ...kept, created_at: dayAgo });
    expect(sweepDemoState(24)).toBe(2);
    expect([...s.events.keys()].sort()).toEqual([fresh.id, kept.id].sort());
    expect([...s.guests.values()].some((g) => g.event_id === expired.id)).toBe(false);
    expect([...s.definitions.values()].some((d) => d.event_id === expired.id)).toBe(false);
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

  it("creates the demo event as a row the guest owns and reuses it", async () => {
    const id = newDemoId();
    const eventId = await demoEventFor(id);
    expect(await demoEventFor(id)).toBe(eventId);
    expect((await listOwnedEvents(id)).map((e) => e.id)).toEqual([eventId]);
    expect((await withPersistedEvent(eventId, () => snapshot(eventId))).event.status).toBe("published");
  });

  it("sweeps all temporary guest rows older than the window and leaves the rest", async () => {
    const expired = await demoEventFor(newDemoId());
    const expiredWithoutTour = await createPersistedEvent(() => createEventFromBody(DEMO_EVENT, newDemoId(), false));
    const fresh = await demoEventFor(newDemoId());
    const owned = await createPersistedEvent(() => createEventFromBody(DEMO_EVENT, "user_a"));
    const kept = await demoEventFor("user_a");
    await db.query("update events set updated_at = now() - interval '25 hours' where id in ($1, $2, $3, $4)", [expired, expiredWithoutTour.id, owned.id, kept]);
    expect(await sweepDemoEvents(db, 24)).toBe(2);
    const ids = (await db.query("select id from events order by id")).map((r) => r.id);
    expect(ids).not.toContain(expired);
    expect(ids).not.toContain(expiredWithoutTour.id);
    expect(ids).toEqual(expect.arrayContaining([fresh, owned.id, kept]));
  });

  it("hands a guest's event to an account once and consumes the guest id", async () => {
    const guest = newDemoId();
    const eventId = await demoEventFor(guest);
    await handOffGuest(guest, "user_b");
    expect(await isConsumedGuest(guest)).toBe(true);
    expect((await listOwnedEvents(guest))).toEqual([]);
    expect((await listOwnedEvents("user_b")).map((e) => [e.id, e.demo])).toEqual([[eventId, true]]);
    expect((await withPersistedEvent(eventId, () => snapshot(eventId))).event.owner_id).toBe("user_b");
    await handOffGuest(guest, "user_c");
    expect((await listOwnedEvents("user_c"))).toEqual([]);
  });
});
