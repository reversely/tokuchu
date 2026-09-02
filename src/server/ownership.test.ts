import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createEvent, resetState, type EventInput } from "../domain/store";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "./errors";
import { assertOwner, callerFor, currentCaller, LOCAL_ORGANIZER_ID, setSessionReader, withEventOwnedBy } from "./ownership";
import { listOwnedEvents } from "./persistence";

const INPUT: EventInput = { type: "party", title: "Owned event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" }, spots: null, cost_per_person_cents: null, rsvp_deadline: null, description: "", invite_extras: [], response_options: ["going", "cant_go"], settings: { guest_approval: false, reminders: false, reask_on_change: false, order_approval: true }, delivery: { destination: "venue", address: null, needed_by: null }, segments: [] };

const DEV = { has_database: false, is_production: false };
const DEPLOYED = { has_database: true, is_production: true };
const owner = { id: "user_a", is_local: false };
const other = { id: "user_b", is_local: false };

beforeEach(resetState);

describe("callerFor", () => {
  it("names the session user wherever one is signed in", () => {
    expect(callerFor("user_a", DEV)).toEqual(owner);
    expect(callerFor("user_a", DEPLOYED)).toEqual(owner);
  });

  it("runs a request without a session as the local organizer only without a database outside production", () => {
    expect(callerFor(undefined, DEV)).toEqual({ id: LOCAL_ORGANIZER_ID, is_local: true });
    expect(callerFor(undefined, { has_database: true, is_production: false })).toBeNull();
    expect(callerFor(undefined, { has_database: false, is_production: true })).toBeNull();
    expect(callerFor(undefined, DEPLOYED)).toBeNull();
  });
});

describe("currentCaller", () => {
  afterAll(() => setSessionReader(null));

  it("reads the session user and falls back to the local organizer without a session or a database", async () => {
    setSessionReader(async () => "user_a");
    expect(await currentCaller()).toEqual(owner);
    setSessionReader(async () => null);
    expect(await currentCaller()).toEqual({ id: LOCAL_ORGANIZER_ID, is_local: true });
  });
});

describe("assertOwner", () => {
  const event = () => createEvent(INPUT, "evt_owned", owner.id);

  it("allows the owner", () => {
    expect(() => assertOwner(event(), owner)).not.toThrow();
  });

  it("denies another signed-in user with 403", () => {
    expect(() => assertOwner(event(), other)).toThrow(ForbiddenError);
  });

  it("denies a request with no session with 401", () => {
    expect(() => assertOwner(event(), null)).toThrow(UnauthorizedError);
  });

  it("lets the local organizer into its own events and sends it to sign in for an account's event", () => {
    const local = callerFor(undefined, DEV);
    expect(() => assertOwner(createEvent(INPUT, "evt_local", LOCAL_ORGANIZER_ID), local)).not.toThrow();
    expect(() => assertOwner(event(), local)).toThrow(UnauthorizedError);
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
    expect(mine[0]).toMatchObject({ title: "Second", status: "draft", invite_code: null });
    expect(await listOwnedEvents("user_c")).toEqual([]);
  });
});
