import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishEvent, resetState } from "../domain/store";
import type { ManifestRow } from "../domain/gifts";
import type { PersonalizationField } from "../domain/types";
import { approveSpecs, createEventFromBody, createGiftFromBody, giftView, requestFromAttendees, snapshot, submitRsvp, updatesFor } from "./api";
import { buildCartItems, recordFromReply, runCartFill, startCartFill, type CartJobDeps } from "./cart-job";
import type { StoreCall } from "./store-page";

const BODY = {
  title: "Astronomy Symposium",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" },
  spots: 10,
  cost_per_person_cents: 5000,
  rsvp_deadline: "2030-01-03"
};

const FIELDS: PersonalizationField[] = [
  { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
  { key: "star_map_time", label: "Pick a time for Star Map 1", kind: "time", required: true, constraints: {} },
  { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
];

const row = (guest: string, extra: Partial<ManifestRow>): ManifestRow => ({ guest_id: guest, display_name: guest, status: "going", values: {}, product_id: "p", variant_id: "v-1", unit_status: "locked", personalization_status: "ready", personalization: {}, personalization_issues: [], ...extra });

describe("building the store's items from the manifest", () => {
  it("sends one item per ready row with every resolved value as a string and names why the others stay out", () => {
    const rows = [
      row("g1", { personalization: { caption: { value: "AVERY", source: { type: "guest", key: "display_name" } }, star_map_location: { value: "Venue, Toronto, ON, CA", source: { type: "event", key: "venue" } } } }),
      row("g2", { personalization_status: "incomplete", personalization_issues: [{ guest_id: "g2", vendor_field_key: "caption", code: "missing_value", message: "Text 2 has no value" }] }),
      row("g3", { variant_id: null, unit_status: "held", reason: "No value for Size; the unit waits for one." }),
      row("g4", { unit_status: "excluded" })
    ];
    expect(buildCartItems(rows)).toEqual({
      items: [{ recipient_ref: "g1", variant_id: "v-1", values: { caption: "AVERY", star_map_location: "Venue, Toronto, ON, CA" } }],
      skipped: [
        { guest_id: "g2", reason: "Text 2 has no value" },
        { guest_id: "g3", reason: "No value for Size; the unit waits for one." }
      ]
    });
  });

  it("records the store's lines and refusals with the field named", () => {
    expect(recordFromReply({ ready: [{ recipient_ref: "g1", cart_line_key: "k1", variant_id: "v-1" }], blocked: [{ recipient_ref: "g2", issues: [{ field_key: "caption", message: "value exceeds 20 characters" }, { message: "variant_id matches no variant" }] }], checkout_url: "https://shop/cart/c/t?key=k" })).toEqual({
      cart_lines: [{ guest_id: "g1", cart_line_key: "k1", variant_id: "v-1" }],
      cart_blocked: [{ guest_id: "g2", issues: ["caption: value exceeds 20 characters", "variant_id matches no variant"] }],
      checkout_url: "https://shop/cart/c/t?key=k"
    });
  });
});

/** A fake store page whose add tool answers the given reply and remembers what it was asked. */
function fakeStore(reply: (args: Record<string, unknown>) => StoreCall) {
  const calls: { url: string; name: string; args: Record<string, unknown> }[] = [];
  const deps: CartJobDeps = {
    withPage: async (url, fn) =>
      fn({
        call: async (name, args) => {
          calls.push({ url, name, args });
          return reply(args);
        }
      })
  };
  return { calls, deps };
}

async function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const gift = createGiftFromBody(event.id, {
    product_id: "gid://shopify/Product/1",
    shop_domain: "springbuilt.myshopify.com",
    product_title: "Customized Crewneck",
    product_url: "https://springbuilt.myshopify.com/products/crewneck",
    variants: [
      { id: "101", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] },
      { id: "102", title: "L", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "L" }] }
    ],
    personalization: { fields: FIELDS },
    default_variant_id: "101"
  });
  await requestFromAttendees(event.id, gift.id);
  const defs = snapshot(event.id).definitions;
  const id = (key: string) => defs.find((d) => d.key === key)!.id;
  submitRsvp(event.id, {
    party: { contact: { email: "a@b.co" } },
    guests: [
      { display_name: "Avery Chen", status: "going", answers: { [id("variant_size")]: "m", [id("star_map_location")]: "Toronto", [id("star_map_time")]: "21:00" } },
      { display_name: "Blake Rivera", status: "going", answers: { [id("variant_size")]: "l", [id("star_map_location")]: "Vancouver", [id("star_map_time")]: "22:30" } }
    ]
  });
  return { event, gift };
}

describe("the cart job after approval", () => {
  beforeEach(() => {
    resetState();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });

  it("calls add_customized_to_cart once on the product page with every ready row and records the checkout link and lines", async () => {
    const { event, gift } = await seed();
    approveSpecs(event.id, gift.id, new Date("2030-01-01T10:00:00Z"));
    const store = fakeStore((args) => {
      const items = args.items as { recipient_ref: string; variant_id: string }[];
      return { isError: false, payload: { batch_id: args.idempotency_key, status: "prepared", ready: items.map((i, n) => ({ recipient_ref: i.recipient_ref, cart_line_key: `key-${n}`, variant_id: i.variant_id })), blocked: [], checkout_url: "https://springbuilt.myshopify.com/cart/c/tok?key=abc" } };
    });
    await runCartFill(event.id, gift.id, store.deps);
    expect(store.calls).toHaveLength(1);
    const [call] = store.calls;
    expect(call.url).toBe("https://springbuilt.myshopify.com/products/crewneck");
    expect(call.name).toBe("add_customized_to_cart");
    expect(call.args.idempotency_key).toBe(`${gift.id}:2030-01-01T10:00:00.000Z`);
    const guests = snapshot(event.id).guests;
    const avery = guests.find((g) => g.display_name === "Avery Chen")!;
    const blake = guests.find((g) => g.display_name === "Blake Rivera")!;
    expect(call.args.items).toEqual([
      { recipient_ref: avery.id, variant_id: "101", values: { star_map_location: "Toronto", star_map_time: "21:00", caption: "Avery Chen" } },
      { recipient_ref: blake.id, variant_id: "102", values: { star_map_location: "Vancouver", star_map_time: "22:30", caption: "Blake Rivera" } }
    ]);
    const view = giftView(event.id, gift.id);
    expect(view.checkout_url).toBe("https://springbuilt.myshopify.com/cart/c/tok?key=abc");
    expect(view.cart_fill).toMatchObject({ status: "done", reason: null });
    expect(view.cart_lines).toEqual([{ guest_id: avery.id, cart_line_key: "key-0", variant_id: "101" }, { guest_id: blake.id, cart_line_key: "key-1", variant_id: "102" }]);
    expect(view.cart_blocked).toEqual([]);
    const thread = updatesFor(event.id, gift.id).map((u) => [u.kind, u.text, u.reference]);
    expect(thread).toEqual([
      ["in_production", "Filling the cart at springbuilt.myshopify.com with 2 items", null],
      ["in_production", "2 items sent to springbuilt.myshopify.com", null],
      ["in_production", "The cart at springbuilt.myshopify.com is ready to review", "https://springbuilt.myshopify.com/cart/c/tok?key=abc"]
    ]);
  });

  it("records a refusal as a failed fill with the store's reason", async () => {
    const { event, gift } = await seed();
    approveSpecs(event.id, gift.id);
    const store = fakeStore((args) => ({ isError: true, payload: { error: "one or more items are invalid and nothing was added", items: (args.items as { recipient_ref: string }[]).map((i) => ({ recipient_ref: i.recipient_ref, issues: [{ field_key: "caption", message: "value exceeds 20 characters" }] })) } }));
    await runCartFill(event.id, gift.id, store.deps);
    const view = giftView(event.id, gift.id);
    expect(view.checkout_url ?? null).toBeNull();
    expect(view.cart_fill).toMatchObject({ status: "failed", reason: "The store did not fill the cart: one or more items are invalid and nothing was added" });
    expect(updatesFor(event.id, gift.id).at(-1)).toMatchObject({ kind: "issue", text: expect.stringContaining("nothing was added") });
  });

  it("keeps one job per gift in flight", async () => {
    const { event, gift } = await seed();
    approveSpecs(event.id, gift.id);
    const store = fakeStore(() => ({ isError: false, payload: { ready: [], blocked: [], checkout_url: null } }));
    const first = startCartFill(event.id, gift.id, store.deps);
    const second = startCartFill(event.id, gift.id, store.deps);
    expect(second).toBe(first);
    await first;
    expect(store.calls).toHaveLength(1);
    expect(giftView(event.id, gift.id).cart_fill).toMatchObject({ status: "failed", reason: "The store added no line" });
  });
});
