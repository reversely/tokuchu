import { beforeEach, describe, expect, it } from "vitest";
import { createGift } from "./gifts";
import { createEvent, createGuest, createParty, definitionsFor, deserializeState, freshState, newId, resetState, runWithState, serializeState, setGuestStatus, state, transactionally, writeValue, type EventInput, type State } from "./store";
import type { CallerToken, VendorUpdate } from "./types";

const EVENT: EventInput = {
  type: "event",
  title: "Test event",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" },
  spots: 10,
  cost_per_person_cents: 1000,
  rsvp_deadline: "2030-01-03",
  description: "",
  invite_extras: [],
  response_options: ["going", "maybe", "cant_go"],
  settings: { guest_approval: false, reminders: true, reask_on_change: true, order_approval: true },
  segments: [],
  delivery: { destination: "venue", address: null, needed_by: "2030-01-08" }
};

/** Fills every map and the change log of the current State. */
function populate(): void {
  const s = state();
  const event = createEvent(EVENT);
  const [name] = definitionsFor(event.id);
  const party = createParty(event.id, { contact: { email: "one@example.com" } });
  const guest = createGuest(event.id, party.id, { display_name: "Guest One", status: "going" });
  writeValue("guest", guest.id, name.id, "Ana", "guest");
  setGuestStatus(guest.id, "maybe", "guest");
  const gift = createGift(event.id, { product_id: "prod_1", shop_domain: "shop.example", product_title: "Mug", recipients: [], mapping: [], default_variant_id: null, variants: [{ id: "var_1", title: "Mug", price_cents: 1200, currency: "CAD" }], missing_value_fallback: "default", post_lock_cancellation: "keep", cutoff: null, cart_id: null, checkout_id: null, order_id: null, rules: [] });
  const update: VendorUpdate = { id: newId("upd"), event_id: event.id, gift_id: gift.id, caller: "vendor", kind: "confirmed", text: "Confirmed", expected_date: null, reference: null, asset: null, guest_id: null, created_at: "2030-01-01T00:00:00Z", seq: s.seq + 1 };
  s.updates.set(update.id, update);
  s.changes.push({ kind: "update", seq: update.seq, at: update.created_at, event_id: event.id, update_id: update.id, gift_id: gift.id, update_kind: update.kind, caller: update.caller });
  s.seq = update.seq;
  const token: CallerToken = { id: newId("tok"), event_id: event.id, holder: "vendor", gift_ids: [gift.id], readable_definition_ids: [name.id], callable_tools: ["list_guests"], expires_at: null, last_profile_url: null };
  s.tokens.set(token.id, token);
}

describe("state scoping", () => {
  beforeEach(resetState);

  it("returns the scoped State under runWithState and the global one outside", () => {
    const scoped = freshState();
    const global = state();
    expect(runWithState(scoped, state)).toBe(scoped);
    expect(state()).toBe(global);
  });

  it("writes through newId, transactionally, and resetState land in the scoped State", () => {
    const scoped = freshState();
    runWithState(scoped, () => {
      expect(newId("evt")).toBe("evt_1");
      expect(() => transactionally(() => { createEvent(EVENT); throw new Error("rollback"); })).toThrow("rollback");
      expect(scoped.events.size).toBe(0);
      expect(scoped.ids).toBe(1);
      createEvent(EVENT);
      resetState();
      expect(state()).toBe(scoped);
      expect(scoped.events.size).toBe(0);
    });
    expect(state().ids).toBe(0);
  });
});

describe("state serialization", () => {
  beforeEach(resetState);

  it("round-trips a populated State through JSON", () => {
    populate();
    const s = state();
    for (const key of ["events", "parties", "guests", "definitions", "values", "updates", "gifts", "tokens"] as const) expect(s[key].size).toBeGreaterThan(0);
    expect(s.changes.length).toBeGreaterThan(0);
    const restored = deserializeState(JSON.parse(JSON.stringify(serializeState(s))));
    expect(restored).toEqual(s);
    expect(restored.events).not.toBe(s.events);
  });

  it("rejects a document without the State shape", () => {
    expect(() => deserializeState({ events: [], seq: 0 })).toThrow();
    expect(() => deserializeState({ ...serializeState(freshState()), guests: [["g", { id: "g" }]] })).toThrow();
    const doc = serializeState(freshState()) as unknown as Record<string, unknown>;
    doc.seq = "1";
    expect(() => deserializeState(doc)).toThrow();
  });
});
