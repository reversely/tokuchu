/**
 * The cart fill for a plain product: approval of a gift with no customization fields goes through
 * the store's UCP cart tools, and the checkout link lands on the gift with the job's posts in the
 * progress log; a failure reads as a failed cart_fill with the reason.
 */
import { CatalogError, type CatalogClient } from "@webmcp/shopify-ucp";
import { beforeEach, describe, expect, it } from "vitest";
import { liveDeps, type CartDeps } from "../agent/cart";
import { publishEvent, resetState } from "../domain/store";
import { approveSpecs, createEventFromBody, createGiftFromBody, giftView, submitRsvp, updatesFor } from "./api";
import { setCartDeps } from "./cart-api";
import { runCartFill } from "./cart-job";
import { runCatalogCartFill } from "./catalog-cart";

const BODY = {
  title: "Astronomy Symposium",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" },
  cost_per_person_cents: 5000,
  delivery: { destination: "venue", address: null, needed_by: "2030-01-08" }
};

/** A shop whose cart tools answer from memory; `failOn` makes that tool reject, and `incomplete` makes create_checkout answer as a tool error that still carries the checkout. */
function fakeShop(failOn: string | null = null, incomplete = false) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const cart = (lines: { item: { id: string }; quantity: number }[]) => ({ id: "cart_1", currency: "CAD", line_items: lines.map((l, i) => ({ id: `line_${i}`, item: { id: l.item.id, title: "Dessert Box", price: 2500 }, quantity: l.quantity, totals: [{ type: "total", amount: 2500 * l.quantity }] })), totals: [{ type: "total", amount: lines.reduce((s, l) => s + 2500 * l.quantity, 0) }] });
  const client = {
    endpoint: "https://treats.myshopify.com/api/ucp/mcp",
    profileUrl: "https://tokuchu.example/agent.json",
    withEndpoint: () => client,
    async callTool(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === failOn) throw new Error(`${name} refused`);
      const input = (args.cart ?? args.checkout) as { line_items: { item: { id: string }; quantity: number }[] };
      if (name === "create_cart" || name === "update_cart") return cart(input.line_items);
      if (name === "create_checkout" && incomplete) throw new CatalogError("tool", "checkout incomplete", { data: JSON.stringify({ ...cart(input.line_items), id: "chk_1", status: "incomplete", continue_url: "https://treats.myshopify.com/cart/c/abc?key=1", messages: [{ type: "error", content: "Missing a valid contact method." }, { type: "error", content: "Enter a phone number to use this delivery method" }] }) });
      if (name === "create_checkout") return { ...cart(input.line_items), id: "chk_1", continue_url: "https://treats.myshopify.com/checkouts/cn/abc" };
      throw new Error(`No fake for ${name}`);
    }
  } as unknown as CatalogClient;
  const deps: CartDeps = { client: () => client, now: () => new Date("2029-12-01T10:00:00Z") };
  return { calls, deps };
}

function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const gift = createGiftFromBody(event.id, {
    product_id: "gid://shopify/Product/9",
    shop_domain: "treats.myshopify.com",
    product_title: "Dessert Box",
    variants: [{ id: "v-box", title: "Box of 12", price_cents: 2500, currency: "CAD", available: true, options: [] }],
    default_variant_id: "v-box",
    delivery_window: { earliest: "2029-12-20", latest: "2029-12-28" }
  });
  submitRsvp(event.id, { party: {}, guests: [{ display_name: "Avery Chen", status: "going" }, { display_name: "Blake Rivera", status: "going" }, { display_name: "Carmen Diaz", status: "maybe" }] });
  return { event, gift };
}

describe("the UCP cart fill for a plain product", () => {
  beforeEach(() => resetState());

  it("creates the cart from the going count, records the approval and the cutoff, creates the checkout, and stores its link", async () => {
    const { event, gift } = seed();
    const shop = fakeShop();
    approveSpecs(event.id, gift.id, new Date("2029-12-01T10:00:00Z"));
    await runCatalogCartFill(event.id, gift.id, shop.deps);
    expect(shop.calls.map((c) => c.name)).toEqual(["create_cart", "create_checkout"]);
    expect((shop.calls[0].args.cart as { line_items: unknown[] }).line_items).toEqual([{ item: { id: "v-box" }, quantity: 2 }]);
    const view = giftView(event.id, gift.id);
    expect(view).toMatchObject({ cart_id: "cart_1", checkout_id: "chk_1", checkout_url: "https://treats.myshopify.com/checkouts/cn/abc", locked_at: "2029-12-01", cart_fill: { status: "done", reason: null } });
    // The event needs the box on 2030-01-08; the window ends 27 days out and the buffer is 3, so the cutoff is 30 days before.
    expect(view.cutoff).toBe("2029-12-09");
    expect(updatesFor(event.id, gift.id).map((u) => u.text)).toEqual(["Cart created at treats.myshopify.com with 1 line through create_cart", "The checkout at treats.myshopify.com is ready to review through create_checkout"]);
    expect(updatesFor(event.id, gift.id).at(-1)?.reference).toBe("https://treats.myshopify.com/checkouts/cn/abc");
  });

  it("reads as a failed fill with the store's words when a cart tool refuses", async () => {
    const { event, gift } = seed();
    const shop = fakeShop("create_checkout");
    approveSpecs(event.id, gift.id);
    await runCatalogCartFill(event.id, gift.id, shop.deps);
    const view = giftView(event.id, gift.id);
    expect(view.cart_fill).toMatchObject({ status: "failed", reason: "The store did not fill the cart: create_checkout refused" });
    expect(view.checkout_url).toBeNull();
    expect(updatesFor(event.id, gift.id).at(-1)).toMatchObject({ kind: "issue", text: "The store did not fill the cart: create_checkout refused" });
  });

  it("keeps the link of a checkout the store marks as an error but returns with recoverable messages", async () => {
    const { event, gift } = seed();
    const shop = fakeShop(null, true);
    approveSpecs(event.id, gift.id);
    await runCatalogCartFill(event.id, gift.id, shop.deps);
    const view = giftView(event.id, gift.id);
    expect(view).toMatchObject({ checkout_id: "chk_1", checkout_url: "https://treats.myshopify.com/cart/c/abc?key=1", locked_at: "2029-12-01", cart_fill: { status: "done" } });
    expect(updatesFor(event.id, gift.id).map((u) => u.text)).toContain("The checkout at treats.myshopify.com waits for details the organizer gives at the store: Missing a valid contact method.; Enter a phone number to use this delivery method");
  });

  it("refuses a second fill once the checkout exists and points at the progress log", async () => {
    const { event, gift } = seed();
    const shop = fakeShop();
    approveSpecs(event.id, gift.id);
    await runCatalogCartFill(event.id, gift.id, shop.deps);
    approveSpecs(event.id, gift.id);
    await runCatalogCartFill(event.id, gift.id, shop.deps);
    expect(shop.calls).toHaveLength(2);
    expect(giftView(event.id, gift.id).cart_fill).toMatchObject({ status: "failed", reason: "The checkout at treats.myshopify.com already exists; its link is in the progress log" });
  });

  it("is the path the cart job takes for a gift with no customization fields", async () => {
    const { event, gift } = seed();
    const shop = fakeShop();
    setCartDeps(shop.deps);
    try {
      approveSpecs(event.id, gift.id);
      await runCartFill(event.id, gift.id, { withPage: async () => { throw new Error("no store page for a plain product"); } });
    } finally {
      setCartDeps(liveDeps);
    }
    expect(shop.calls.map((c) => c.name)).toEqual(["create_cart", "create_checkout"]);
    expect(giftView(event.id, gift.id).checkout_url).toBe("https://treats.myshopify.com/checkouts/cn/abc");
  });
});
