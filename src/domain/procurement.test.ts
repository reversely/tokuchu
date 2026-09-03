import { beforeEach, describe, expect, it } from "vitest";
import { createGift } from "./gifts";
import { changesAfter, currentRevision, recordProcurementChange } from "./procurement";
import { createEvent, createGuest, createParty, resetState, setGuestStatus, upsertDefinition, writeValue, type EventInput } from "./store";

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

function seed() {
  const event = createEvent(EVENT);
  const location = upsertDefinition(event.id, { namespace: "organizer", key: "star_map_location", label: "Location", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer", vendor_field: { key: "star_map_location", label: "Location", kind: "location" } });
  const dietary = upsertDefinition(event.id, { namespace: "organizer", key: "dietary", label: "Dietary", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer" });
  const party = createParty(event.id, { contact: { email: "one@example.com" } });
  const guest = createGuest(event.id, party.id, { display_name: "Guest One", status: "going" });
  const gift = createGift(event.id, {
    product_id: "prod_1",
    shop_domain: "shop.myshopify.com",
    product_title: "Crewneck",
    recipients: [{ field: "status", op: "eq", value: "going" }],
    rules: [{ filter: [{ field: "status", op: "eq", value: "going" }], product_id: "prod_1" }],
    mapping: [],
    default_variant_id: "var_1",
    variants: [],
    personalization: { fields: [{ key: "star_map_location", label: "Location", kind: "location", required: true }] },
    personalization_mappings: [{ vendor_field_key: "star_map_location", source: { type: "definition", definition_id: location.id, subject_scope: "guest" } }],
    missing_value_fallback: "default",
    post_lock_cancellation: "keep",
    cutoff: null,
    cart_id: null,
    checkout_id: null,
    order_id: null
  });
  return { event, location, dietary, guest, gift };
}

describe("the procurement change reader", () => {
  beforeEach(resetState);

  it("returns exactly the changes after a revision with the actor and the requirement each concerns", () => {
    const { location, guest, gift } = seed();
    const first = writeValue("guest", guest.id, location.id, "Vancouver", "guest");
    const atFirst = changesAfter(gift.id, 0);
    expect(atFirst.current_revision).toBe(first.seq);
    expect(atFirst.changes.map((c) => c.type)).toEqual(["reply_changed", "answer_changed"]);
    expect(atFirst.changes.at(-1)).toMatchObject({ revision: first.seq, actor_type: "attendee", attendee_ref: guest.id, requirement_id: "star_map_location", summary: "Location answered" });

    setGuestStatus(guest.id, "maybe", "guest");
    const opened = recordProcurementChange(gift.id, "exception_opened", "token:tok_1", "The store needs a location", { attendee_ref: guest.id, requirement_id: "star_map_location" });
    const after = changesAfter(gift.id, first.seq);
    expect(after).toMatchObject({ procurement_id: gift.id, from_revision: first.seq, current_revision: opened.seq });
    expect(after.changes.map((c) => c.type)).toEqual(["reply_changed", "exception_opened"]);
    expect(after.changes[1]).toMatchObject({ actor_type: "vendor", actor_id: "tok_1", attendee_ref: guest.id, requirement_id: "star_map_location" });
    expect(changesAfter(gift.id, opened.seq).changes).toEqual([]);
    expect(currentRevision(gift.id)).toBe(opened.seq);
  });

  it("keeps a value the gift does not map, or the holder may not read, out of the gift's changes", () => {
    const { location, dietary, guest, gift } = seed();
    writeValue("guest", guest.id, dietary.id, "none", "guest");
    const answered = writeValue("guest", guest.id, location.id, "Vancouver", "guest");
    expect(changesAfter(gift.id, 0).changes.map((c) => c.type)).toEqual(["reply_changed", "answer_changed"]);
    expect(currentRevision(gift.id)).toBe(answered.seq);
    const hidden = changesAfter(gift.id, 0, [dietary.id]);
    expect(hidden.changes.map((c) => c.type)).toEqual(["reply_changed"]);
    expect(hidden.current_revision).toBeLessThan(answered.seq);
  });
});
