import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetState, publishEvent } from "../domain/store";
import { updateGift, type GiftInput } from "../domain/gifts";
import type { PersonalizationField } from "../domain/types";
import { approveSpecs, createEventFromBody, createGiftFromBody, followUp, giftRequirements, giftView, inviteView, patchRsvp, requestFromAttendees, setPersonalizationMappings, snapshot, submitRsvp } from "./api";
import { setMailer, type MailMessage } from "./mail";

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

/** A mailer that keeps every message; `failWith` makes each send reject with that text. */
function fakeMailer(failWith?: string) {
  const sent: MailMessage[] = [];
  setMailer({
    async send(message) {
      if (failWith) throw new Error(failWith);
      sent.push(message);
      return "sent";
    }
  });
  return sent;
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
    fakeMailer();
  });
  afterEach(() => setMailer(null));

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

  it("carries the store's max_length onto the question it creates", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id, [{ key: "motto", label: "Motto", kind: "text", required: true, constraints: { max_length: 20 } }]);
    await requestFromAttendees(event.id, gift.id);
    const motto = snapshot(event.id).definitions.find((d) => d.key === "motto")!;
    expect(motto).toMatchObject({ scope: "guest", value_type: "text", constraints: { max_length: 20 }, required_rule: "going", creator: "organizer", vendor_field: { key: "motto", kind: "text" } });
    expect(giftView(event.id, gift.id).personalization_mappings).toContainEqual({ vendor_field_key: "motto", source: { type: "definition", definition_id: motto.id, subject_scope: "guest" } });
  });

  it("creates a vendor-namespace question under the canonical key with the store's field as provenance", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = createGiftFromBody(event.id, { product_id: "gid://shopify/Product/7", shop_domain: "customworks.myshopify.com", product_title: "Star map", personalization: { fields: [{ key: "customworks_star_map_location", label: "Location", kind: "location", required: true, constraints: {} }] } });
    await requestFromAttendees(event.id, gift.id);
    const location = snapshot(event.id).definitions.find((d) => d.vendor_field?.requirement_id === "customworks_star_map_location")!;
    expect(location).toMatchObject({ namespace: "vendor", key: "star_map_location", scope: "guest", vendor_field: { key: "customworks_star_map_location", label: "Location", kind: "location", vendor_id: "customworks.myshopify.com", product_id: "gid://shopify/Product/7", requirement_schema_id: "customworks.myshopify.com/gid://shopify/Product/7", requirement_id: "customworks_star_map_location" } });
    expect(giftView(event.id, gift.id).personalization_mappings).toContainEqual({ vendor_field_key: "customworks_star_map_location", source: { type: "definition", definition_id: location.id, subject_scope: "guest" } });
    // The invite and the snapshot treat the question like any organizer question.
    expect(inviteView(event.invite_code!).questions.map((q) => q.id)).toContain(location.id);
    expect(snapshot(event.id).definitions.filter((d) => d.scope === "guest").map((d) => d.id)).toContain(location.id);
  });

  it("maps a second product's same-meaning field onto the existing definition instead of creating another", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const first = seedGift(event.id);
    await requestFromAttendees(event.id, first.id);
    const before = snapshot(event.id).definitions;
    const location = before.find((d) => d.key === "star_map_location")!;
    const second = createGiftFromBody(event.id, { product_id: "gid://shopify/Product/7", shop_domain: "customworks.myshopify.com", product_title: "Star map", personalization: { fields: [{ key: "customworks_star_map_location", label: "Where the stars were", kind: "location", required: true, constraints: {} }, { key: "customworks_engraving_text", label: "Engraving", kind: "text", required: true, constraints: {} }] } });
    expect(giftRequirements(event.id, second.id).find((r) => r.key === "customworks_star_map_location")).toMatchObject({ source: "definition", definition_id: location.id, already: true });
    expect(giftRequirements(event.id, second.id).find((r) => r.key === "customworks_engraving_text")).toMatchObject({ source: "question", already: false });
    await requestFromAttendees(event.id, second.id);
    const after = snapshot(event.id).definitions;
    expect(after.filter((d) => d.key === "star_map_location")).toHaveLength(1);
    expect(after).toHaveLength(before.length + 1);
    expect(after.find((d) => d.key === "engraving_text")).toMatchObject({ namespace: "vendor", vendor_field: { key: "customworks_engraving_text", vendor_id: "customworks.myshopify.com" } });
    expect(giftView(event.id, second.id).personalization_mappings).toContainEqual({ vendor_field_key: "customworks_star_map_location", source: { type: "definition", definition_id: location.id, subject_scope: "guest" } });
  });

  it("turns the mug's image field into a file question that takes an https address and refuses plain text", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id, [{ key: "photo", label: "Image Upload 1", kind: "image", required: true, constraints: {} }]);
    expect(giftRequirements(event.id, gift.id).find((r) => r.key === "photo")).toMatchObject({ source: "question", already: false, question: { value_type: "file" } });
    await requestFromAttendees(event.id, gift.id);
    const photo = snapshot(event.id).definitions.find((d) => d.key === "photo")!;
    expect(photo).toMatchObject({ scope: "guest", value_type: "file", required_rule: "going", vendor_field: { key: "photo", kind: "image" } });
    expect(() => submitRsvp(event.id, { party: {}, guests: [{ display_name: "Avery Chen", status: "going", answers: { [photo.id]: "a picture of me" } }] })).toThrow(/file address/);
    submitRsvp(event.id, { party: {}, guests: [{ display_name: "Avery Chen", status: "going", answers: { [photo.id]: "https://cdn.example.com/avery.jpg" } }] });
    const [row] = giftView(event.id, gift.id).manifest;
    expect(row).toMatchObject({ personalization_status: "ready", personalization: { photo: { value: "https://cdn.example.com/avery.jpg" } } });
  });
});

describe("requesting the missing values from attendees", () => {
  let sent: MailMessage[];
  beforeEach(() => {
    resetState();
    sent = fakeMailer();
  });
  afterEach(() => setMailer(null));

  it("creates the questions, wires the size to the variants, and records a request per attendee with the missing questions", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    seedAttendees(event.id);
    await requestFromAttendees(event.id, gift.id);

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
      expect(r).toMatchObject({ gift_id: gift.id, follow_ups: 0, complete: false, delivery: "sent", last_error: null });
    }
  });

  it("emails each incomplete attendee the question labels and their own link", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    seedAttendees(event.id);
    await requestFromAttendees(event.id, gift.id);
    expect(sent).toHaveLength(2);
    const { guests } = snapshot(event.id);
    for (const message of sent) {
      expect(message.to).toBe("a@b.co");
      expect(message.subject).toBe("Your details for Astronomy Symposium");
      for (const label of ["Size", "Enter Location for Star Map 1", "Pick a time for Star Map 1"]) expect(message.text).toContain(`- ${label}`);
    }
    expect(sent.map((m) => m.text)).toEqual(expect.arrayContaining(guests.map((g) => expect.stringContaining(`http://localhost:3113/i/${event.invite_code}?guest=${g.id}`))));
  });

  it("records no_address on an attendee whose party has no email and keeps the request", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    submitRsvp(event.id, { party: {}, guests: [{ display_name: "Casey Park", status: "going" }] });
    await requestFromAttendees(event.id, gift.id);
    expect(sent).toHaveLength(0);
    expect(snapshot(event.id).requests).toEqual([expect.objectContaining({ delivery: "no_address", last_error: null, complete: false })]);
  });

  it("records failed with the mailer's message and keeps the request", async () => {
    fakeMailer("Resend answered 422.");
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    seedAttendees(event.id);
    await expect(requestFromAttendees(event.id, gift.id)).resolves.toBeDefined();
    const requests = snapshot(event.id).requests;
    expect(requests).toHaveLength(2);
    for (const r of requests) expect(r).toMatchObject({ delivery: "failed", last_error: "Resend answered 422." });
  });

  it("flips each answered flag as the attendee replies and sends a follow-up only to the incomplete", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    seedAttendees(event.id);
    await requestFromAttendees(event.id, gift.id);
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

    sent.length = 0;
    const after = await followUp(event.id, gift.id);
    expect(after.requests.find((r) => r.guest_id === avery.id)!.follow_ups).toBe(0);
    expect(after.requests.find((r) => r.guest_id === blake.id)!.follow_ups).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Reminder: your details for Astronomy Symposium");
    expect(sent[0].text).toContain("This is a reminder.");
    expect(sent[0].text).toContain(`guest=${blake.id}`);
    expect(sent[0].text).not.toContain("- Size");
    expect(sent[0].text).toContain("- Enter Location for Star Map 1");
  });

  it("issues the request to an attendee who replies after it was sent", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    await requestFromAttendees(event.id, gift.id);
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
    // The late sends go out once the RSVP write commits, on the next turn of the event loop.
    await new Promise((resolve) => setImmediate(resolve));
    expect(sent.map((m) => m.to).sort()).toEqual(["a@b.co", "a@b.co", "c@d.co"]);
    expect(snapshot(event.id).requests.every((r) => r.delivery === "sent")).toBe(true);
  });

  it("refuses a time that is not HH:MM on the question the time field created", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    await requestFromAttendees(event.id, gift.id);
    const time = snapshot(event.id).definitions.find((d) => d.key === "star_map_time")!;
    expect(() => submitRsvp(event.id, { party: {}, guests: [{ display_name: "Avery Chen", status: "going", answers: { [time.id]: "9pm" } }] })).toThrow(/required form/);
  });

  it("accepts an edit after approval, marks the guest changed, and a second approval mints a new key and clears the old checkout link", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    await requestFromAttendees(event.id, gift.id);
    const size = snapshot(event.id).definitions.find((d) => d.key === "variant_size")!;
    const { guest_ids } = submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "m" } }] });
    const first = approveSpecs(event.id, gift.id, new Date("2030-01-01T10:00:00Z"));
    expect(first.approved_at).toBe("2030-01-01T10:00:00.000Z");
    expect(first.locked_at).toBeNull();
    updateGift(gift.id, { checkout_url: "https://springbuilt.myshopify.com/cart/c/old", cart_fill: { status: "done", started_at: "2030-01-01T10:00:01Z", reason: null } } as Partial<GiftInput>);
    const guest = () => snapshot(event.id).guests.find((g) => g.id === guest_ids[0])!;
    expect(guest().changed_since_approval).toBe(false);

    expect(patchRsvp(event.id, guest_ids[0], { answers: { [size.id]: "l" } }).values[size.id]).toBe("l");
    expect(guest().changed_since_approval).toBe(true);

    // The cart job's idempotency key is the gift id and the approval time, so a new time is a new key.
    const second = approveSpecs(event.id, gift.id, new Date("2030-01-02T10:00:00Z"));
    expect(second.approved_at).toBe("2030-01-02T10:00:00.000Z");
    expect(second.approved_seq).toBeGreaterThan(first.approved_seq!);
    expect(second.checkout_url).toBeNull();
    expect(second.cart_fill).toBeNull();
    expect(guest().changed_since_approval).toBe(false);
  });

  it("refuses an approval while the cart job runs", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    approveSpecs(event.id, gift.id, new Date("2030-01-01T10:00:00Z"));
    updateGift(gift.id, { cart_fill: { status: "running", started_at: "2030-01-01T10:00:01Z", reason: null } } as Partial<GiftInput>);
    expect(() => approveSpecs(event.id, gift.id, new Date("2030-01-02T10:00:00Z"))).toThrow(/still running/);
    expect(giftView(event.id, gift.id).approved_at).toBe("2030-01-01T10:00:00.000Z");
  });
});
