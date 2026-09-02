import { beforeEach, describe, expect, it } from "vitest";
import { resetState, publishEvent } from "../domain/store";
import { approveSpecs, createEventFromBody, createGiftFromBody, giftRequestables, giftView, requestFromAttendees, snapshot, submitRsvp } from "./api";

const BODY = {
  title: "Astronomy Symposium",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" },
  spots: 10,
  cost_per_person_cents: 5000,
  rsvp_deadline: "2030-01-03"
};

function seedGift(eventId: string) {
  return createGiftFromBody(eventId, {
    product_id: "gid://shopify/Product/1",
    shop_domain: "springbuilt.myshopify.com",
    product_title: "Customized Crewneck",
    variants: [
      { id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] },
      { id: "v-l", title: "L", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "L" }] },
      { id: "v-xl", title: "XL", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "XL" }] }
    ],
    personalization: { fields: [{ key: "caption", label: "Text 2", kind: "text", required: true }] },
    default_variant_id: "v-m"
  });
}

describe("requesting the product's fields from attendees", () => {
  beforeEach(resetState);

  it("derives a Size choice from the product's variants and a text name field", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    const req = giftRequestables(event.id, gift.id);
    const size = req.find((r) => r.source === "variant")!;
    expect(size).toMatchObject({ label: "Size", value_type: "enum", already: false });
    expect(size.options!.map((o) => o.value)).toEqual(["m", "l", "xl"]);
    // printed_name is a seeded library question, so the name request already exists.
    expect(req.find((r) => r.key === "printed_name")!.already).toBe(true);
  });

  it("creates a guest Size question, wires it to the variants, and collects answers into the grid", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    requestFromAttendees(event.id, gift.id);

    const snap = snapshot(event.id);
    const size = snap.definitions.find((d) => d.key === "variant_size")!;
    expect(size).toMatchObject({ scope: "guest", value_type: "enum", required_rule: "going" });
    expect(size.constraints.options!.map((o) => o.value)).toEqual(["m", "l", "xl"]);
    expect(giftView(event.id, gift.id).mapping.filter((m) => m.definition_id === size.id)).toHaveLength(3);

    const name = snap.definitions.find((d) => d.key === "printed_name")!;
    submitRsvp(event.id, {
      party: { contact: { email: "a@b.co" } },
      guests: [
        { display_name: "Avery Chen", status: "going", answers: { [name.id]: "AVERY", [size.id]: "m" } },
        { display_name: "Blake Rivera", status: "going", answers: { [name.id]: "BLAKE", [size.id]: "l" } }
      ]
    });
    const after = snapshot(event.id);
    const avery = after.guests.find((g) => g.display_name === "Avery Chen")!;
    expect(avery.values[name.id]).toBe("AVERY");
    expect(avery.values[size.id]).toBe("m");
  });

  it("records the vendor cart link on approval", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    requestFromAttendees(event.id, gift.id);
    const name = snapshot(event.id).definitions.find((d) => d.key === "printed_name")!;
    const size = snapshot(event.id).definitions.find((d) => d.key === "variant_size")!;
    submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [name.id]: "AVERY", [size.id]: "m" } }] });
    approveSpecs(event.id, gift.id);
    expect(giftView(event.id, gift.id).checkout_url).toContain("springbuilt.myshopify.com/cart");
  });
});
