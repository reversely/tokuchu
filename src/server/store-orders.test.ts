import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BadRequestError } from "./errors";
import { resetAdminToken } from "./shopify-admin";
import { allowedStoreOrigins, cartTokenFrom, corsHeaders, lookupOrder, orderFilter } from "./store-orders";

/** A fetch double that answers the token grant first and then the queued Admin bodies, recording each request. */
function fakeFetch(bodies: unknown[]) {
  const calls: { url: string; body: unknown }[] = [];
  let i = 0;
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), body: init.body ? (typeof init.body === "string" ? JSON.parse(init.body) : String(init.body)) : null });
    if (String(url).includes("/admin/oauth/access_token")) return { status: 200, text: async () => JSON.stringify({ access_token: "shpat_a", expires_in: 86_399 }) } as unknown as Response;
    const body = bodies[Math.min(i, bodies.length - 1)];
    i += 1;
    return { status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

const CHECKOUT = "https://springbuilt.myshopify.com/cart/c/demo-cart-token-01?key=0123abcd";

/** One order as the Admin API answers it: two adapter lines with their properties and one fulfilment with tracking. */
const ORDER_NODE = {
  id: "gid://shopify/Order/6001",
  name: "#1042",
  createdAt: "2026-09-03T14:00:00Z",
  updatedAt: "2026-09-04T09:30:00Z",
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "FULFILLED",
  lineItems: {
    nodes: [
      { title: "Customized Crewneck - M", quantity: 1, variant: { id: "gid://shopify/ProductVariant/501" }, customAttributes: [{ key: "Enter Location for Star Map 1", value: "Toronto" }, { key: "Text 2", value: "Maya" }, { key: "_tokuchu_recipient", value: "guest-maya" }] },
      { title: "Customized Crewneck - L", quantity: 1, variant: null, customAttributes: [{ key: "Text 2", value: "Jordan" }, { key: "_tokuchu_recipient", value: "guest-jordan" }, { key: "_hidden", value: "x" }] }
    ]
  },
  fulfillments: [{ id: "gid://shopify/Fulfillment/7001", status: "SUCCESS", updatedAt: "2026-09-04T09:30:00Z", trackingInfo: [{ company: "Canada Post", number: "CP123", url: "https://track.example/CP123" }] }]
};

const ENV_KEYS = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "CUSTOMILY_SHOP_URL"] as const;

describe("the order lookup behind get_order_updates (#59)", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    process.env.SHOPIFY_STORE_DOMAIN = "example.myshopify.com";
    process.env.SHOPIFY_API_KEY = "key"; // pragma: allowlist secret
    process.env.SHOPIFY_API_SECRET = "secret"; // pragma: allowlist secret
    delete process.env.CUSTOMILY_SHOP_URL;
    resetAdminToken();
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetAdminToken();
  });

  it("reads the cart token out of the checkout URL and drops the key suffix from a /cart.js token", () => {
    expect(cartTokenFrom(CHECKOUT)).toBe("demo-cart-token-01");
    expect(orderFilter({ checkout_url: CHECKOUT })).toBe('cart_token:"demo-cart-token-01"');
    expect(orderFilter({ cart_token: "abc123?key=k" })).toBe('cart_token:"abc123"');
    expect(() => orderFilter({ order_name: "#1042" } as never)).toThrow(BadRequestError);
    expect(() => orderFilter({})).toThrow(BadRequestError);
    expect(() => orderFilter({ checkout_url: "https://shop.example/checkouts/cn/abc" })).toThrow(BadRequestError);
    expect(() => orderFilter({ checkout_url: "not a url" })).toThrow(BadRequestError);
  });

  it("answers the order with its lines' recipient refs and property values and its fulfilments with tracking", async () => {
    const f = fakeFetch([{ data: { orders: { nodes: [ORDER_NODE] } } }]);
    const state = await lookupOrder({ checkout_url: CHECKOUT }, { fetchImpl: f });
    expect(state).toEqual({
      status: "ordered",
      order_id: "6001",
      order_name: "#1042",
      created_at: "2026-09-03T14:00:00Z",
      updated_at: "2026-09-04T09:30:00Z",
      financial_status: "paid",
      fulfillment_status: "fulfilled",
      line_items: [
        { title: "Customized Crewneck - M", variant_id: "501", quantity: 1, recipient_ref: "guest-maya", values: { "Enter Location for Star Map 1": "Toronto", "Text 2": "Maya" } },
        { title: "Customized Crewneck - L", variant_id: null, quantity: 1, recipient_ref: "guest-jordan", values: { "Text 2": "Jordan" } }
      ],
      fulfillments: [{ id: "7001", status: "success", updated_at: "2026-09-04T09:30:00Z", tracking: [{ company: "Canada Post", number: "CP123", url: "https://track.example/CP123" }] }]
    });
    const query = f.calls.find((c) => c.url.includes("/graphql.json"))!.body as { variables: { q: string } };
    expect(query.variables.q).toBe('cart_token:"demo-cart-token-01"');
  });

  it("answers not_ordered while the checkout has no order", async () => {
    const f = fakeFetch([{ data: { orders: { nodes: [] } } }]);
    expect(await lookupOrder({ cart_token: "no-order-yet" }, { fetchImpl: f })).toEqual({ status: "not_ordered" });
  });

  it("admits the demo store's origin and the configured shop's host and no other", () => {
    expect(allowedStoreOrigins()).toEqual(["https://springbuilt.myshopify.com"]);
    process.env.CUSTOMILY_SHOP_URL = "https://custom.example.com/products/x";
    expect(allowedStoreOrigins()).toEqual(["https://springbuilt.myshopify.com", "https://custom.example.com"]);
    expect(corsHeaders("https://custom.example.com")).toMatchObject({ "Access-Control-Allow-Origin": "https://custom.example.com", Vary: "Origin" });
    expect(corsHeaders("https://evil.example.com")).toEqual({});
    expect(corsHeaders(null)).toEqual({});
  });
});
