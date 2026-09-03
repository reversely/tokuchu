import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { moveProcurement } from "../domain/procurement";
import { procurementFor, publishEvent, resetState } from "../domain/store";
import { updateGift, type GiftInput } from "../domain/gifts";
import { approveSpecs, createEventFromBody, createGiftFromBody, requestFromAttendees, submitRsvp, updatesFor } from "./api";
import { createGrant, grantsFor, grantStatus } from "./grants";
import { movesFor, ordersDue, resetOrderSync, syncOrders } from "./order-sync";
import type { OrderState } from "./store-orders";
import { tick } from "./tick";

const BODY = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const NOW = new Date("2026-09-03T14:00:00Z");
const LATER = new Date("2026-09-03T14:01:00Z");
const CHECKOUT = "https://springbuilt.myshopify.com/cart/c/demo-cart-token-01?key=0123abcd";

const placed = (fulfillment_status: string): OrderState => ({ status: "ordered", order_id: "6001", order_name: "#1042", created_at: "2026-09-03T13:00:00Z", updated_at: "2026-09-03T13:30:00Z", financial_status: "paid", fulfillment_status, line_items: [], fulfillments: [] });

/** A scripted order reader that answers the queued states in order and records the checkouts it was asked about. */
function scripted(states: OrderState[]) {
  const asked: (string | null | undefined)[] = [];
  let i = 0;
  const lookup = async (query: { checkout_url?: string | null }) => {
    asked.push(query.checkout_url);
    return states[Math.min(i++, states.length - 1)];
  };
  return Object.assign(lookup, { asked });
}

/** An approved crewneck gift whose cart returned a checkout, as the cart job leaves it. */
async function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const gift = createGiftFromBody(event.id, { product_id: "gid://shopify/Product/1", shop_domain: "springbuilt.myshopify.com", product_title: "Customized Crewneck", variants: [{ id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] }], default_variant_id: "v-m" });
  await requestFromAttendees(event.id, gift.id);
  submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going" }] });
  approveSpecs(event.id, gift.id);
  updateGift(gift.id, { checkout_url: CHECKOUT } as Partial<GiftInput>);
  moveProcurement(gift.id, "ordered", "tokuchu", { patch: { checkout_url: CHECKOUT } });
  return { event, gift };
}

const ENV_KEYS = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET"] as const;

describe("the tick's order check (#59)", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    resetState();
    resetOrderSync();
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.SHOPIFY_STORE_DOMAIN = "example.myshopify.com";
    process.env.SHOPIFY_API_KEY = "key"; // pragma: allowlist secret
    process.env.SHOPIFY_API_SECRET = "secret"; // pragma: allowlist secret
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("names the moves each order state calls for", () => {
    expect(movesFor({ status: "not_ordered" }, "ordered")).toEqual([]);
    expect(movesFor(placed("unfulfilled"), "ordered")).toEqual(["production_started"]);
    expect(movesFor(placed("unfulfilled"), "in_production")).toEqual([]);
    expect(movesFor(placed("fulfilled"), "ordered")).toEqual(["production_started", "fulfilled"]);
    expect(movesFor(placed("fulfilled"), "in_production")).toEqual(["fulfilled"]);
    expect(movesFor(placed("fulfilled"), "fulfilled")).toEqual([]);
  });

  it("asks once per interval and leaves a not_ordered checkout where it stands", async () => {
    const { event, gift } = await seed();
    expect(ordersDue(event.id, NOW).map((g) => g.id)).toEqual([gift.id]);
    const lookup = scripted([{ status: "not_ordered" }]);
    expect(await syncOrders(event.id, NOW, lookup)).toEqual([]);
    expect(lookup.asked).toEqual([CHECKOUT]);
    expect(procurementFor(gift.id).status).toBe("ordered");
    expect(ordersDue(event.id, NOW)).toEqual([]);
    expect(ordersDue(event.id, LATER).map((g) => g.id)).toEqual([gift.id]);
  });

  it("moves the Procurement to in_production and then to fulfilled from the store's answers and expires the grants", async () => {
    const { event, gift } = await seed();
    createGrant(event.id, { procurement_id: gift.id, grantee_type: "agent", grantee_id: "store-agent", permissions: ["manifest:read"] });
    const lookup = scripted([placed("unfulfilled"), placed("fulfilled")]);

    expect(await syncOrders(event.id, NOW, lookup)).toEqual([gift.id]);
    expect(procurementFor(gift.id)).toMatchObject({ status: "in_production", external_order_id: "#1042" });
    const first = updatesFor(event.id, gift.id).at(-1)!;
    expect(first).toMatchObject({ kind: "in_production", caller: "springbuilt.myshopify.com", reference: "#1042" });

    expect(await syncOrders(event.id, LATER, lookup)).toEqual([gift.id]);
    expect(procurementFor(gift.id).status).toBe("fulfilled");
    expect(updatesFor(event.id, gift.id).at(-1)).toMatchObject({ kind: "delivered", reference: "#1042" });
    expect(grantsFor(event.id).map((g) => grantStatus(g))).toEqual(["expired"]);
    // A fulfilled Procurement is asked no more.
    expect(ordersDue(event.id, new Date("2026-09-03T15:00:00Z"))).toEqual([]);
  });

  it("runs from the tick with the reader it is given", async () => {
    const { event, gift } = await seed();
    await tick(event.id, { now: NOW, llm: false, orders: scripted([placed("fulfilled")]) });
    expect(procurementFor(gift.id).status).toBe("fulfilled");
  });

  it("asks nothing without Admin credentials", async () => {
    const { event } = await seed();
    delete process.env.SHOPIFY_API_SECRET;
    expect(ordersDue(event.id, NOW)).toEqual([]);
  });
});
