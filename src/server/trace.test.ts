import { beforeEach, describe, expect, it } from "vitest";
import type { CatalogClient } from "@webmcp/shopify-ucp";
import { GLOBAL_CATALOG_ENDPOINT } from "@webmcp/shopify-ucp";
import { publishEvent, resetState } from "../domain/store";
import { createEventFromBody, createGiftFromBody } from "./api";
import { createGrant } from "./grants";
import { createToken, handleRpc } from "./mcp";
import { TRACE_STORE_CAP, recordTrace, summarize, traceClient, tracePage, traced, tracesFor, tracesForGrant, type TraceDraft } from "./trace";

const BODY = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" } };

const draft = (over: Partial<TraceDraft> = {}): TraceDraft => ({ side: "catalog", transport: "ucp", endpoint: GLOBAL_CATALOG_ENDPOINT, tool: "search_catalog", args: "{ query: \"tea\" }", result: "{ products: [3] }", ok: true, duration_ms: 12, ...over });

function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const gift = createGiftFromBody(event.id, { product_id: "gid://shopify/Product/1", shop_domain: "example-store.myshopify.com", product_title: "Crewneck", variants: [{ id: "v1", title: "M", price_cents: 5000, currency: "CAD" }], default_variant_id: "v1" });
  const other = createGiftFromBody(event.id, { product_id: "gid://shopify/Product/2", shop_domain: "example-store.myshopify.com", product_title: "Mug", variants: [{ id: "v2", title: "One", price_cents: 2000, currency: "CAD" }], default_variant_id: "v2" });
  return { event, gift, other };
}

beforeEach(() => resetState());

describe("the trace store", () => {
  it("records entries with an id and a time and lists them newest first by gift, since a time, and up to a limit", () => {
    const { event, gift } = seed();
    const first = recordTrace(event.id, draft({ at: "2026-09-03T10:00:00.000Z" }));
    recordTrace(event.id, draft({ at: "2026-09-03T10:00:01.000Z", tool: "get_product" }));
    recordTrace(event.id, draft({ at: "2026-09-03T10:00:02.000Z", side: "store", transport: "page-tool", tool: "get_customization", gift_id: gift.id }));
    expect(first).toMatchObject({ event_id: event.id, at: "2026-09-03T10:00:00.000Z", gift_id: null, guest_id: null, caller: null });
    expect(first.id).toMatch(/^trace_/);
    expect(tracesFor(event.id).map((t) => t.tool)).toEqual(["get_customization", "get_product", "search_catalog"]);
    expect(tracesFor(event.id, { gift: gift.id }).map((t) => t.tool)).toEqual(["get_customization"]);
    expect(tracesFor(event.id, { since: "2026-09-03T10:00:00.500Z" }).map((t) => t.tool)).toEqual(["get_customization", "get_product"]);
    expect(tracesFor(event.id, { limit: 1 }).map((t) => t.tool)).toEqual(["get_customization"]);
    expect(tracesFor("evt_other")).toEqual([]);
  });

  it("drops the oldest entry of an event past the store cap", () => {
    const { event } = seed();
    for (let i = 0; i < TRACE_STORE_CAP + 5; i++) recordTrace(event.id, draft({ at: `2026-09-03T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`, tool: `call_${i}` }));
    const rows = tracesFor(event.id);
    expect(rows).toHaveLength(TRACE_STORE_CAP);
    expect(rows.at(-1)?.tool).toBe("call_5");
  });

  it("keeps a grant to the calls about its procurement", () => {
    const { event, gift, other } = seed();
    recordTrace(event.id, draft());
    recordTrace(event.id, draft({ side: "store", transport: "page-tool", tool: "add_customized_to_cart", gift_id: gift.id }));
    recordTrace(event.id, draft({ side: "store", transport: "ucp", tool: "create_cart", gift_id: other.id }));
    const grant = createGrant(event.id, { procurement_id: gift.id, grantee_type: "vendor", grantee_id: "example-store.myshopify.com", permissions: ["manifest:read"] });
    expect(tracesForGrant(event.id, grant).map((t) => t.tool)).toEqual(["add_customized_to_cart"]);
  });
});

describe("summarize", () => {
  it("keeps top-level scalars and reduces nested values to their shape", () => {
    expect(summarize({ query: "tea", filters: { price: { max: 2000 } }, products: [{ id: "p1" }, { id: "p2" }], total: null, ok: true })).toBe('{ query: "tea", filters: {1}, products: [2], total: null, ok: true }');
    expect(summarize([1, 2, 3])).toBe("[3]");
    expect(summarize("plain")).toBe("plain");
    expect(summarize(42)).toBe("42");
    expect(summarize(undefined)).toBe("");
  });

  it("leaves untrusted fields out and clips long strings", () => {
    expect(summarize({ untrusted_name: "Avery", id: "g1" })).toBe('{ id: "g1" }');
    const long = summarize({ text: "x".repeat(200) });
    expect(long.length).toBeLessThan(100);
    expect(summarize("y".repeat(400))).toHaveLength(300);
  });
});

describe("traced", () => {
  it("records an ok entry with the duration and the result summary and returns the value", async () => {
    const { event, gift } = seed();
    const value = await traced(event.id, { side: "store", transport: "ucp", endpoint: "https://example-store.myshopify.com/api/ucp/mcp", tool: "create_cart", args: { cart: { line_items: [{ item: { id: "v1" }, quantity: 2 }] } }, gift_id: gift.id }, async () => ({ id: "cart_1", line_items: [{ id: "l1" }] }));
    expect(value.id).toBe("cart_1");
    const [entry] = tracesFor(event.id);
    expect(entry).toMatchObject({ side: "store", transport: "ucp", tool: "create_cart", ok: true, args: "{ cart: {1} }", result: '{ id: "cart_1", line_items: [1] }', gift_id: gift.id });
    expect(entry.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("records a failed entry with the error's message and rethrows", async () => {
    const { event } = seed();
    await expect(traced(event.id, { side: "catalog", transport: "ucp", endpoint: GLOBAL_CATALOG_ENDPOINT, tool: "search_catalog", args: { query: "tea" } }, async () => { throw new Error("HTTP 503 from the catalog"); })).rejects.toThrow("HTTP 503");
    expect(tracesFor(event.id)[0]).toMatchObject({ ok: false, result: "HTTP 503 from the catalog", args: '{ query: "tea" }' });
  });

  it("takes an ok test, a result summary, and a writer of its own", async () => {
    const { event } = seed();
    const written: TraceDraft[] = [];
    await traced(event.id, { side: "store", transport: "page-tool", endpoint: "https://store/products/crewneck", tool: "get_customization", args: { product_id: "1" } }, async () => ({ isError: true, payload: { error: "no customization" } }), { ok: (r) => !r.isError, result: (r) => summarize(r.payload), record: (d) => void written.push(d) });
    expect(tracesFor(event.id)).toEqual([]);
    expect(written).toEqual([expect.objectContaining({ ok: false, result: '{ error: "no customization" }', tool: "get_customization" })]);
  });
});

/** A fake client that answers every call with what it was asked and can be derived to another endpoint. */
function fakeClient(endpoint: string): CatalogClient & { calls: string[] } {
  const calls: string[] = [];
  const client = {
    calls,
    endpoint,
    profileUrl: "profile",
    async searchCatalog(params: unknown) { calls.push("search_catalog"); return { products: [{}, {}], echo: params } as never; },
    async lookupCatalog() { calls.push("lookup_catalog"); return { products: [] } as never; },
    async getProduct(id: string) { calls.push("get_product"); if (id === "missing") throw new Error("no such product"); return { product: { id } } as never; },
    async callTool(name: string) { calls.push(name); return { id: "cart_1" }; },
    withEndpoint(other: string) { return fakeClient(other); }
  };
  return client as unknown as CatalogClient & { calls: string[] };
}

describe("traceClient", () => {
  it("records each call on the client's side and follows a derived endpoint", async () => {
    const { event, gift } = seed();
    const client = traceClient(event.id, fakeClient(GLOBAL_CATALOG_ENDPOINT), { gift_id: gift.id });
    await client.searchCatalog({ query: "tea" });
    await expect(client.getProduct("missing")).rejects.toThrow("no such product");
    await client.withEndpoint("https://example-store.myshopify.com/api/ucp/mcp").callTool("create_cart", { cart: {} });
    const rows = tracesFor(event.id).reverse();
    expect(rows.map((t) => [t.side, t.tool, t.ok, t.endpoint])).toEqual([
      ["catalog", "search_catalog", true, GLOBAL_CATALOG_ENDPOINT],
      ["catalog", "get_product", false, GLOBAL_CATALOG_ENDPOINT],
      ["store", "create_cart", true, "https://example-store.myshopify.com/api/ucp/mcp"]
    ]);
    expect(rows[0]).toMatchObject({ transport: "ucp", args: '{ query: "tea" }', result: "{ products: [2], echo: {1} }", gift_id: gift.id });
  });
});

describe("tracePage", () => {
  it("records a merchant tool call against the page and reads an error reply as a failure", async () => {
    const { event, gift } = seed();
    const page = tracePage(event.id, "https://example-store.myshopify.com/products/crewneck", { call: async (name) => (name === "get_customization" ? { payload: { title: "Crewneck", fields: [{}, {}] }, isError: false } : { payload: { error: "no cart" }, isError: true }) }, { gift_id: gift.id });
    await page.call("get_customization", { product_id: "1" });
    await page.call("add_customized_to_cart", { items: [{ recipient_ref: "g1", values: { caption: "AVERY" } }] });
    const [cart, read] = tracesFor(event.id);
    expect(read).toMatchObject({ side: "store", transport: "page-tool", endpoint: "https://example-store.myshopify.com/products/crewneck", tool: "get_customization", ok: true, args: '{ product_id: "1" }', result: '{ title: "Crewneck", fields: [2] }', gift_id: gift.id });
    expect(cart).toMatchObject({ tool: "add_customized_to_cart", ok: false, args: "{ items: [1] }", result: '{ error: "no cart" }' });
  });
});

describe("the MCP endpoint", () => {
  const call = (eventId: string, token: { id: string } | null, name: string, args: Record<string, unknown> = {}) => handleRpc(eventId, token as never, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { ...args, meta: { "ucp-agent": { profile: "https://agent/profile.json" } } } } });

  it("records a holder's call on the store side with the token as the caller and a refusal as a failure", async () => {
    const { event, gift, other } = seed();
    const vendor = createToken(event.id, { holder: "example-store.myshopify.com", gift_ids: [gift.id], callable_tools: ["get_updates", "post_update"] });
    await call(event.id, vendor, "get_updates", { gift_id: gift.id });
    await call(event.id, vendor, "post_update", { gift_id: other.id, kind: "question", text: "Which size?" });
    const [refused, read] = tracesFor(event.id);
    expect(read).toMatchObject({ side: "store", transport: "mcp", endpoint: `/api/events/${event.id}/mcp`, tool: "get_updates", ok: true, caller: vendor.id, gift_id: gift.id, args: `{ gift_id: "${gift.id}" }`, result: "{ updates: [0] }" });
    expect(refused).toMatchObject({ tool: "post_update", ok: false, gift_id: other.id, result: `No gift ${other.id} for this token.` });
    expect(read.args).not.toContain("profile");
  });

  it("records the organizer's own token on the organizer side", async () => {
    const { event, gift } = seed();
    const organizer = createToken(event.id, { holder: "organizer", callable_tools: ["set_gift_plan", "get_updates"] });
    await call(event.id, organizer, "get_updates", { gift_id: gift.id });
    expect(tracesFor(event.id)[0]).toMatchObject({ side: "organizer", tool: "get_updates", caller: organizer.id });
  });
});
