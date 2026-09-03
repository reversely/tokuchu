import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createEvent, resetState, state, type EventInput } from "../domain/store";
import { demoCookieValue, newDemoId } from "./demo-session";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "./errors";
import { callerFor, currentCaller, LOCAL_ORGANIZER_ID, openEvent, resolveAccess, setDemoIdReader, setSessionReader, withEventOwnedBy } from "./ownership";
import { listOwnedEvents } from "./persistence";

const INPUT: EventInput = { type: "party", title: "Owned event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" }, spots: null, cost_per_person_cents: null, rsvp_deadline: null, description: "", invite_extras: [], response_options: ["going", "cant_go"], settings: { guest_approval: false, reminders: false, reask_on_change: false, order_approval: true }, delivery: { destination: "venue", address: null, needed_by: null }, segments: [] };

const DEV = { has_database: false, is_production: false };
const DEPLOYED = { has_database: true, is_production: true };
const owner = { id: "user_a", is_local: false, is_demo: false };
const other = { id: "user_b", is_local: false, is_demo: false };
const guest = { id: "demo_abc", is_local: false, is_demo: true };
const local = { id: LOCAL_ORGANIZER_ID, is_local: true, is_demo: false };

beforeEach(resetState);

describe("callerFor", () => {
  it("names the session user wherever one is signed in", () => {
    expect(callerFor("user_a", null, DEV)).toEqual(owner);
    expect(callerFor("user_a", null, DEPLOYED)).toEqual(owner);
  });

  it("runs a request without a session as the local organizer only without a database outside production", () => {
    expect(callerFor(undefined, null, DEV)).toEqual(local);
    expect(callerFor(undefined, null, { has_database: true, is_production: false })).toBeNull();
    expect(callerFor(undefined, null, { has_database: false, is_production: true })).toBeNull();
    expect(callerFor(undefined, null, DEPLOYED)).toBeNull();
  });

  it("runs a request with a guest id as the guest in every mode and lets a session win", () => {
    expect(callerFor(undefined, "demo_abc", DEV)).toEqual(guest);
    expect(callerFor(undefined, "demo_abc", DEPLOYED)).toEqual(guest);
    expect(callerFor("user_a", "demo_abc", DEPLOYED)).toEqual(owner);
  });
});

describe("currentCaller", () => {
  afterAll(() => {
    setSessionReader(null);
    setDemoIdReader(null);
  });

  it("reads the session user and falls back to the local organizer without a session or a database", async () => {
    setDemoIdReader(async () => null);
    setSessionReader(async () => "user_a");
    expect(await currentCaller()).toEqual(owner);
    setSessionReader(async () => null);
    expect(await currentCaller()).toEqual(local);
  });

  it("reads the guest cookie before the local fallback", async () => {
    setDemoIdReader(async () => guest.id);
    setSessionReader(async () => null);
    expect(await currentCaller()).toEqual(guest);
  });

  it("reads a signed token given outside the request before the cookie and rejects a forged one", async () => {
    setDemoIdReader(async () => null);
    setSessionReader(async () => null);
    expect(await currentCaller(demoCookieValue(guest.id))).toEqual(guest);
    expect(await currentCaller(`${guest.id}.${"0".repeat(64)}`)).toEqual(local);
    setDemoIdReader(async () => "demo_from_cookie");
    expect(await currentCaller(demoCookieValue(guest.id))).toEqual(guest);
  });

  it("hands the guest's events to the session's account once and then treats the guest id as no caller", async () => {
    const guestId = newDemoId();
    const mine = createEvent(INPUT, "evt_guest", guestId, true);
    const theirs = createEvent(INPUT, "evt_other", other.id);
    setDemoIdReader(async () => guestId);
    setSessionReader(async () => "user_a");
    expect(await currentCaller()).toEqual(owner);
    expect(state().events.get(mine.id)).toMatchObject({ owner_id: "user_a", demo: true });
    expect(state().events.get(theirs.id)?.owner_id).toBe(other.id);
    expect((await listOwnedEvents("user_a")).map((e) => e.id)).toEqual([mine.id]);

    // The consumed id resolves to no guest: a later session does not take the event again and a bare token gets the local fallback.
    setSessionReader(async () => "user_b");
    expect(await currentCaller()).toEqual(other);
    expect(state().events.get(mine.id)?.owner_id).toBe("user_a");
    setSessionReader(async () => null);
    expect(await currentCaller()).toEqual(local);
    expect(await currentCaller(demoCookieValue(guestId))).toEqual(local);
  });
});

describe("resolveAccess", () => {
  const event = () => createEvent(INPUT, "evt_owned", owner.id);

  it("allows the owner", () => {
    expect(resolveAccess(event().id, owner)).toEqual({ kind: "allowed" });
  });

  it("refuses another signed-in user as forbidden", () => {
    expect(resolveAccess(event().id, other)).toEqual({ kind: "forbidden" });
  });

  it("lets a guest into its own event and refuses it every other event", () => {
    expect(resolveAccess(createEvent(INPUT, "evt_demo", guest.id, true).id, guest)).toEqual({ kind: "allowed" });
    expect(resolveAccess(event().id, guest)).toEqual({ kind: "forbidden" });
    expect(resolveAccess(createEvent(INPUT, "evt_local", LOCAL_ORGANIZER_ID).id, guest)).toEqual({ kind: "forbidden" });
  });

  it("sends a request with no caller to sign in", () => {
    expect(resolveAccess(event().id, null)).toEqual({ kind: "sign_in" });
  });

  it("lets the local organizer into its own events and sends it to sign in for an account's event", () => {
    expect(resolveAccess(createEvent(INPUT, "evt_local", LOCAL_ORGANIZER_ID).id, local)).toEqual({ kind: "allowed" });
    expect(resolveAccess(event().id, local)).toEqual({ kind: "sign_in" });
  });

  it("answers not found for an id no event has", () => {
    expect(resolveAccess("evt_missing", owner)).toEqual({ kind: "not_found" });
  });
});

describe("openEvent", () => {
  it("returns the handler's value for the owner and the refusal for everyone else", async () => {
    const event = createEvent(INPUT, "evt_owned", owner.id);
    expect(await openEvent(owner, event.id, () => 1)).toEqual({ kind: "allowed", value: 1 });
    expect(await openEvent(other, event.id, () => 1)).toEqual({ kind: "forbidden" });
    expect(await openEvent(null, event.id, () => 1)).toEqual({ kind: "sign_in" });
    expect(await openEvent(owner, "evt_missing", () => 1)).toEqual({ kind: "not_found" });
  });

  it("passes a not-found error from inside the handler through", async () => {
    const event = createEvent(INPUT, "evt_owned", owner.id);
    await expect(openEvent(owner, event.id, () => { throw new NotFoundError("No gift."); })).rejects.toThrow("No gift.");
  });
});

describe("withEventOwnedBy", () => {
  it("runs the handler for the owner and rejects everyone else before the handler runs", async () => {
    const event = createEvent(INPUT, "evt_owned", owner.id);
    let ran = 0;
    expect(await withEventOwnedBy(owner, event.id, () => ++ran)).toBe(1);
    await expect(withEventOwnedBy(other, event.id, () => ++ran)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withEventOwnedBy(null, event.id, () => ++ran)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(withEventOwnedBy(owner, "evt_missing", () => ++ran)).rejects.toBeInstanceOf(NotFoundError);
    expect(ran).toBe(1);
  });
});

describe("listOwnedEvents", () => {
  it("lists only the caller's events with the newest first", async () => {
    createEvent(INPUT, "evt_first", owner.id);
    createEvent({ ...INPUT, title: "Second" }, "evt_second", owner.id);
    createEvent({ ...INPUT, title: "Theirs" }, "evt_theirs", other.id);
    const mine = await listOwnedEvents(owner.id);
    expect(mine.map((e) => e.id)).toEqual(["evt_second", "evt_first"]);
    expect(mine[0]).toMatchObject({ title: "Second", status: "draft", invite_code: null, demo: false });
    expect(await listOwnedEvents("user_c")).toEqual([]);
  });
});
