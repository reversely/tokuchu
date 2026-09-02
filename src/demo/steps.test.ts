/**
 * The tour resumes where the event's state leaves off and backs up to the step that introduces the
 * next action; each step's wire names the calls in flight from the snapshot, the page, and the thread.
 */
import { describe, expect, it } from "vitest";
import { DEMO_STORE } from "./seed";
import { startIndex, STEPS, type TourState, type WireContext, type WireGift } from "./steps";

const going = (n: number) => Array.from({ length: n }, () => ({ status: "going" }));
const gift = (over: Partial<TourState["gifts"][number]> = {}) => [{ locked_at: null, checkout_url: null, ...over }];
const id = (i: number) => STEPS[i].id;
const step = (stepId: string) => STEPS.find((s) => s.id === stepId)!;

const CREWNECK: WireGift = {
  shop_domain: DEMO_STORE.shop_domain,
  product_title: "Celestial Map Crewneck",
  locked_at: "2026-09-02T00:00:00Z",
  personalization: { fields: [{ label: "Star Map Location", kind: "text" }, { label: "Caption", kind: "text", constraints: { max_length: 20 } }] },
  variants: [{ title: "S" }, { title: "M" }],
  checkout_url: null,
  cart_lines: null
};

/** A fake context: three going attendees, no requests, one gift, and whatever the test overrides. */
function context(over: Partial<WireContext> = {}, gift: WireGift | null = CREWNECK): WireContext {
  const guests = [{ status: "going", display_name: "Avery Chen" }, { status: "going", display_name: "Blake Rivera" }, { status: "going", display_name: "Carmen Diaz" }];
  return { snap: { event: { id: "evt_1", invite_code: "abc" }, guests, requests: [], definitions: [], gifts: gift ? [gift] : [] }, gift, page: { funnelRows: [], rankedCount: 0, askedLabels: [], attendeeRows: 0 }, updates: [], phase: "running", ...over };
}

describe("wire", () => {
  it("lists the search endpoints and the sentence while the search runs and the funnel once results arrive", () => {
    const waiting = step("search").wire!(context()).map((l) => l.text);
    expect(waiting).toEqual([`Global Catalog  search_catalog  catalog.shopify.com/api/ucp/mcp`, `store UCP endpoint  search_catalog  ${DEMO_STORE.shop_domain}/api/ucp/mcp`, `→ "${DEMO_STORE.search}"`]);
    const found = step("search").wire!(context({ page: { funnelRows: ["Distinct products 41", "Checked for delivery to the venue 12"], rankedCount: 9, askedLabels: [], attendeeRows: 0 } }));
    expect(found.map((l) => l.text).slice(3)).toEqual(["→ Distinct products 41", "→ Checked for delivery to the venue 12", "← 9 ranked products"]);
    expect(found.at(-1)?.state).toBe("done");
  });
  it("names the demo store's three surfaces on the pick step", () => {
    const lines = step("pick").wire!(context({}, null)).map((l) => l.text);
    expect(lines[0]).toBe(`demo store  ${DEMO_STORE.shop_domain}  trading as ${DEMO_STORE.shop_name}`);
    expect(lines).toContain(`store UCP endpoint  ${DEMO_STORE.shop_domain}/api/ucp/mcp`);
    expect(lines).toContain("Shopify page tool  search_catalog get_product get_cart update_cart and the rest");
    expect(lines).toContain("store page tool  get_customization add_customized_to_cart");
  });
  it("reads the fields and constraints the store answered from the gift", () => {
    expect(step("requirements").wire!(context()).map((l) => l.text)).toEqual(["store page tool  get_customization  Celestial Map Crewneck", "• Star Map Location  text", "• Caption  text  max 20", "← 2 variants  S M"]);
  });
  it("shows both hops of the approval, the thread's posts, and the checkout host as they arrive", () => {
    const filling = step("cart").wire!(context({ updates: [{ text: "Filling the cart at springbuilt.myshopify.com with 3 items" }] }));
    expect(filling.map((l) => l.text)).toEqual(["Tokuchu page tool  approve_specs  Celestial Map Crewneck for 3 attendees", "store page tool  add_customized_to_cart  3 items", "← Filling the cart at springbuilt.myshopify.com with 3 items"]);
    expect(filling[1].state).toBe("working");
    const ready = step("cart").wire!(context({ phase: "ready" }, { ...CREWNECK, checkout_url: "https://springbuilt.myshopify.com/cart/c/abc?key=1", cart_lines: [{ guest_id: "g1" }, { guest_id: "g2" }, { guest_id: "g3" }] }));
    expect(ready.at(-1)?.text).toBe("← checkout_url  springbuilt.myshopify.com");
    expect(ready.some((l) => l.state === "working")).toBe(false);
  });
});

describe("startIndex", () => {
  it("opens on the published step for a fresh event", () => {
    expect(id(startIndex({ guests: [], requests: [], gifts: [] }))).toBe("published");
  });
  it("opens on the requirements once the gift exists", () => {
    expect(id(startIndex({ guests: [], requests: [], gifts: gift() }))).toBe("requirements");
  });
  it("opens on the answers once the request went out", () => {
    expect(id(startIndex({ guests: [], requests: [{ complete: false }], gifts: gift() }))).toBe("answers");
  });
  it("opens on approval once three attendees answered", () => {
    expect(id(startIndex({ guests: going(3), requests: [{ complete: true }, { complete: true }, { complete: true }], gifts: gift() }))).toBe("approve");
  });
  it("opens on the cart wait after approval and on the checkout once the link exists", () => {
    const answered = { guests: going(3), requests: [{ complete: true }] };
    expect(id(startIndex({ ...answered, gifts: gift({ locked_at: "2026-09-02T00:00:00Z" }) }))).toBe("cart");
    expect(id(startIndex({ ...answered, gifts: gift({ locked_at: "2026-09-02T00:00:00Z", checkout_url: "https://store/cart/c/1" }) }))).toBe("checkout");
  });
});
