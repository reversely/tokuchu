/**
 * Static mode (#56): the flag switches the assistant off, the gift write skips the store read, the
 * agent's customization payload lands on the gift the way the server's read would, and the
 * fulfillment manifest carries one cart item per ready attendee in the cart tool's shape.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGift, getGift } from "../domain/gifts";
import { publishEvent, resetState } from "../domain/store";
import { approveSpecs, createEventFromBody, patchRsvp, requestFromAttendees, snapshot, submitRsvp } from "./api";
import { setGiftCustomization, withStoreCustomization } from "./customization";
import { llmEnabled, staticMode } from "./flags";
import { fulfillmentManifest } from "./procurement";

const BODY = { title: "Test event", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const GOING = [{ field: "status", op: "eq", value: "going" }] as const;
/** The payload the store's get_customization answers for the crewneck, as the agent hands it over. */
const PAYLOAD = {
  product_id: "10242071789817",
  title: "Customized Crewneck",
  fields: [
    { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
    { key: "star_map_time", label: "Pick a time for Star Map 1", kind: "time", required: true, constraints: {} },
    { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } },
    { key: "hologram", label: "Hologram", kind: "hologram", required: false, constraints: {} }
  ],
  variants: [
    { id: 51, title: "M", price_cents: 5000, available: true, options: [{ name: "Size", label: "M" }] },
    { id: 52, title: "L", price_cents: 5000, available: false, options: [{ name: "Size", label: "L" }] }
  ],
  selected_variant_id: 51
};

function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const gift = createGift(event.id, { product_id: "gid://shopify/Product/10242071789817", shop_domain: "springbuilt.myshopify.com", product_title: "", recipients: [...GOING], rules: [{ filter: [...GOING], product_id: "gid://shopify/Product/10242071789817" }], mapping: [{ definition_id: "def_old", value: "m", variant_id: "catalog-m" }], default_variant_id: "catalog-m", variants: [{ id: "catalog-m", title: "M", price_cents: 4000, currency: "CAD" }], missing_value_fallback: "default", post_lock_cancellation: "keep", cutoff: null, cart_id: null, checkout_id: null, order_id: null } as never);
  return { event, gift };
}

describe("the static flag", () => {
  afterEach(() => {
    delete process.env.TOKUCHU_STATIC;
  });
  it("reads TOKUCHU_STATIC and keeps the assistant off", () => {
    expect(staticMode("1")).toBe(true);
    expect(staticMode("true")).toBe(true);
    expect(staticMode(undefined)).toBe(false);
    expect(llmEnabled("1", true)).toBe(false);
    expect(llmEnabled("1", false)).toBe(true);
  });
  it("passes a gift body through without a store read", async () => {
    process.env.TOKUCHU_STATIC = "1";
    const body = { product_id: "1", shop_domain: "springbuilt.myshopify.com" };
    expect(await withStoreCustomization(body, () => Promise.reject(new Error("the store page opened")))).toBe(body);
  });
});

describe("set_gift_customization", () => {
  beforeEach(resetState);
  it("stores the store's fields and variants the way the server's read would", () => {
    const { event, gift } = seed();
    setGiftCustomization(event.id, gift.id, PAYLOAD);
    const stored = getGift(gift.id);
    expect(stored.personalization?.fields.map((f) => f.key)).toEqual(["star_map_location", "star_map_time", "caption"]);
    expect(stored.personalization?.fields[2].constraints?.max_length).toBe(20);
    expect(stored.personalization?.schema_id).toBe("springbuilt.myshopify.com/10242071789817");
    expect(stored.variants.map((v) => [v.id, v.currency, v.available])).toEqual([["51", "CAD", true], ["52", "CAD", false]]);
    // The catalog's variant rows drop with the catalog's ids, and the store's selected variant is the default.
    expect(stored.mapping).toEqual([]);
    expect(stored.default_variant_id).toBe("51");
    expect(stored.product_title).toBe("Customized Crewneck");
  });
  it("keeps a default the store lists and the gift's own title", () => {
    const { event, gift } = seed();
    setGiftCustomization(event.id, gift.id, { ...PAYLOAD, variants: [...PAYLOAD.variants, { id: "catalog-m", title: "M", price_cents: 5000, available: true, options: [] }], title: "Other" });
    const stored = getGift(gift.id);
    expect(stored.default_variant_id).toBe("catalog-m");
    expect(stored.mapping).toHaveLength(1);
    expect(stored.product_title).toBe("Other");
    setGiftCustomization(event.id, gift.id, { ...PAYLOAD, title: "Renamed" });
    expect(getGift(gift.id).product_title).toBe("Other");
  });
});

describe("the manifest's cart_items", () => {
  beforeEach(resetState);
  afterEach(() => {
    delete process.env.TOKUCHU_STATIC;
  });
  it("carries one item per ready attendee in the cart tool's shape and no cart job runs in static mode", async () => {
    process.env.TOKUCHU_STATIC = "1";
    const { event, gift } = seed();
    setGiftCustomization(event.id, gift.id, PAYLOAD);
    submitRsvp(event.id, { guests: [{ display_name: "Avery Chen", status: "going" }, { display_name: "Blake Rivera", status: "going" }] });
    await requestFromAttendees(event.id, gift.id);
    const { definitions, guests } = snapshot(event.id);
    const byKey = Object.fromEntries(definitions.map((d) => [d.key, d.id]));
    expect(fulfillmentManifest(event.id, gift.id).cart_items).toEqual([]);
    patchRsvp(event.id, guests[0].id, { answers: { [byKey.variant_size]: "l", [byKey.star_map_location]: "Toronto", [byKey.star_map_time]: "21:00" } });
    const manifest = fulfillmentManifest(event.id, gift.id);
    expect(manifest.attendees.map((a) => a.status)).toEqual(["ready", "incomplete"]);
    expect(manifest.cart_items).toEqual([{ recipient_ref: guests[0].id, variant_id: "52", values: { star_map_location: "Toronto", star_map_time: "21:00", caption: "Avery Chen" } }]);
    // The caption comes from the guest row and no question; a reader who may not see the location's definition gets the item without it.
    const cut = fulfillmentManifest(event.id, gift.id, [byKey.variant_size, byKey.star_map_time]);
    expect(cut.cart_items[0].values).toEqual({ star_map_time: "21:00", caption: "Avery Chen" });
    const approved = approveSpecs(event.id, gift.id);
    expect(approved.approved_at).toBeTruthy();
    expect(approved.cart_fill ?? null).toBeNull();
    expect(approved.checkout_url ?? null).toBeNull();
  });
});
