import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetState, publishEvent } from "../domain/store";
import type { PersonalizationField } from "../domain/types";
import { approveSpecs, createEventFromBody, createGiftFromBody, followUp, giftRequirements, giftView, requestFromAttendees, setPersonalizationMappings, snapshot, submitRsvp } from "./api";

const BODY = {
  title: "Astronomy Symposium",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" },
  spots: 10,
  cost_per_person_cents: 5000,
  rsvp_deadline: "2030-01-03"
};

/** The crewneck's fields as the store's get_customization returns them. */
const CREWNECK_FIELDS: PersonalizationField[] = [
  { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
  { key: "star_map_time", label: "Pick a time for Star Map 1", kind: "time", required: true, constraints: {} },
  { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
];

function seedGift(eventId: string, fields: PersonalizationField[] = CREWNECK_FIELDS) {
  return createGiftFromBody(eventId, {
    product_id: "gid://shopify/Product/1",
    shop_domain: "springbuilt.myshopify.com",
    product_title: "Customized Crewneck",
    variants: [
      { id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] },
      { id: "v-l", title: "L", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "L" }] },
      { id: "v-xl", title: "XL", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "XL" }] }
    ],
    personalization: { fields },
    default_variant_id: "v-m"
  });
}

function seedAttendees(eventId: string, answers: Record<string, unknown> = {}) {
  return submitRsvp(eventId, {
    party: { contact: { email: "a@b.co" } },
    guests: [
      { display_name: "Avery Chen", status: "going", answers },
      { display_name: "Blake Rivera", status: "going", answers }
    ]
  });
}

describe("comparing the store's fields with what the event holds", () => {
  beforeEach(() => {
    resetState();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("asks for the size, the location, and the time; the name comes from the RSVP", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    const byKey = Object.fromEntries(giftRequirements(event.id, gift.id).map((r) => [r.key, r]));
    expect(byKey.variant_size).toMatchObject({ label: "Size", kind: "variant", source: "question", already: false });
    expect(byKey.variant_size.question!.constraints.options!.map((o) => o.value)).toEqual(["m", "l", "xl"]);
    expect(byKey.caption).toMatchObject({ source: "guest", already: true });
    expect(byKey.star_map_location).toMatchObject({ source: "question", already: false, question: { value_type: "text" } });
    expect(byKey.star_map_time).toMatchObject({ source: "question", already: false, question: { value_type: "text" } });
  });

  it("keeps a stored mapping to the event ahead of a question", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    setPersonalizationMappings(event.id, gift.id, { mappings: [{ vendor_field_key: "star_map_location", source: { type: "event", key: "venue" }, transform: "location_query" }, { vendor_field_key: "star_map_time", source: { type: "literal", value: "21:00" } }, { vendor_field_key: "caption", source: { type: "guest", key: "display_name" } }] });
    const location = giftRequirements(event.id, gift.id).find((r) => r.key === "star_map_location")!;
    expect(location).toMatchObject({ source: "event", already: true });
  });

  it("carries the store's max_length onto the question it creates", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id, [{ key: "motto", label: "Motto", kind: "text", required: true, constraints: { max_length: 20 } }]);
    requestFromAttendees(event.id, gift.id);
    const motto = snapshot(event.id).definitions.find((d) => d.key === "motto")!;
    expect(motto).toMatchObject({ scope: "guest", value_type: "text", constraints: { max_length: 20 }, required_rule: "going", creator: "organizer", vendor_field: { key: "motto", kind: "text" } });
    expect(giftView(event.id, gift.id).personalization_mappings).toContainEqual({ vendor_field_key: "motto", source: { type: "definition", definition_id: motto.id, subject_scope: "guest" } });
  });
});

describe("requesting the missing values from attendees", () => {
  beforeEach(() => {
    resetState();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("creates the questions, wires the size to the variants, and records a request per attendee with the missing questions", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    seedAttendees(event.id);
    requestFromAttendees(event.id, gift.id);

    const snap = snapshot(event.id);
    const size = snap.definitions.find((d) => d.key === "variant_size")!;
    expect(size).toMatchObject({ scope: "guest", value_type: "enum", required_rule: "going" });
    expect(giftView(event.id, gift.id).mapping.filter((m) => m.definition_id === size.id)).toHaveLength(3);
    expect(giftView(event.id, gift.id).personalization_mappings).toContainEqual({ vendor_field_key: "caption", source: { type: "guest", key: "display_name" } });

    const location = snap.definitions.find((d) => d.key === "star_map_location")!;
    const time = snap.definitions.find((d) => d.key === "star_map_time")!;
    expect(snap.requests).toHaveLength(2);
    for (const r of snap.requests) {
      expect(r.definition_ids.sort()).toEqual([size.id, location.id, time.id].sort());
      expect(r.answered).toEqual({ [size.id]: false, [location.id]: false, [time.id]: false });
      expect(r).toMatchObject({ gift_id: gift.id, follow_ups: 0, complete: false });
    }
    expect(console.info).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.info).mock.calls[0][0]).toContain(`/i/${event.invite_code}?guest=`);
  });

  it("flips each answered flag as the attendee replies and sends a follow-up only to the incomplete", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    seedAttendees(event.id);
    requestFromAttendees(event.id, gift.id);
    const defs = snapshot(event.id).definitions;
    const size = defs.find((d) => d.key === "variant_size")!;
    const location = defs.find((d) => d.key === "star_map_location")!;
    const time = defs.find((d) => d.key === "star_map_time")!;

    submitRsvp(event.id, { party: {}, guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "m", [location.id]: "Toronto", [time.id]: "21:00" } }] });
    submitRsvp(event.id, { party: {}, guests: [{ display_name: "Blake Rivera", status: "going", answers: { [size.id]: "l" } }] });

    const before = snapshot(event.id);
    const avery = before.guests.find((g) => g.display_name === "Avery Chen")!;
    const blake = before.guests.find((g) => g.display_name === "Blake Rivera")!;
    expect(before.requests.find((r) => r.guest_id === avery.id)).toMatchObject({ complete: true, answered: { [size.id]: true, [location.id]: true, [time.id]: true } });
    expect(before.requests.find((r) => r.guest_id === blake.id)).toMatchObject({ complete: false, answered: { [size.id]: true, [location.id]: false, [time.id]: false } });

    vi.mocked(console.info).mockClear();
    const after = followUp(event.id, gift.id);
    expect(after.requests.find((r) => r.guest_id === avery.id)!.follow_ups).toBe(0);
    expect(after.requests.find((r) => r.guest_id === blake.id)!.follow_ups).toBe(1);
    expect(console.info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.info).mock.calls[0][0]).toContain(`guest=${blake.id}`);
  });

  it("issues the request to an attendee who replies after it was sent", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    requestFromAttendees(event.id, gift.id);
    expect(snapshot(event.id).requests).toHaveLength(0);
    seedAttendees(event.id);
    expect(snapshot(event.id).requests).toHaveLength(2);
    const sizeId = snapshot(event.id).definitions.find((d) => d.key === "variant_size")!.id;
    const late = submitRsvp(event.id, { party: { contact: { email: "c@d.co" } }, guests: [{ display_name: "Casey Park", status: "going", answers: { [sizeId]: "m" } }] });
    const row = snapshot(event.id).requests.find((r) => r.guest_id === late.guest_ids[0])!;
    expect(row).toBeDefined();
    expect(row.definition_ids).not.toContain(sizeId);
    expect(row.complete).toBe(false);
    expect(snapshot(event.id).requests).toHaveLength(3);
  });

  it("refuses a time that is not HH:MM on the question the time field created", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    requestFromAttendees(event.id, gift.id);
    const time = snapshot(event.id).definitions.find((d) => d.key === "star_map_time")!;
    expect(() => submitRsvp(event.id, { party: {}, guests: [{ display_name: "Avery Chen", status: "going", answers: { [time.id]: "9pm" } }] })).toThrow(/required form/);
  });

  it("records the vendor cart link on approval", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    requestFromAttendees(event.id, gift.id);
    const size = snapshot(event.id).definitions.find((d) => d.key === "variant_size")!;
    submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "m" } }] });
    approveSpecs(event.id, gift.id);
    expect(giftView(event.id, gift.id).checkout_url).toContain("springbuilt.myshopify.com/cart");
  });
});
