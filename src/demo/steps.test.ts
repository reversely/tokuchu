/**
 * The tour resumes where the event's state leaves off and backs up to the step that introduces the
 * next action; each step's wire names the calls in flight from the snapshot, the page, and the progress
 * logs; the three gifts are told apart by store and title.
 */
import { describe, expect, it } from "vitest";
import { DEMO_CORRECTION, DEMO_STORE } from "./seed";
import { demoGifts, EMPTY_STORE, startIndex, STEPS, type TourGift, type TourState, type WireContext } from "./steps";

const going = (n: number) => Array.from({ length: n }, () => ({ status: "going" }));
const id = (i: number) => STEPS[i].id;
const step = (stepId: string) => STEPS.find((s) => s.id === stepId)!;

const CREWNECK: TourGift = {
  id: "gift_c",
  shop_domain: DEMO_STORE.shop_domain,
  product_title: "Customized Crewneck",
  requested_at: null,
  approved_at: "2026-09-02T00:00:00Z",
  personalization: { fields: [{ label: "Star Map Location", kind: "text" }, { label: "Caption", kind: "text", constraints: { max_length: 20 } }] },
  variants: [{ title: "S" }, { title: "M" }],
  checkout_url: null,
  cart_lines: null
};
const MUG: TourGift = { id: "gift_m", shop_domain: DEMO_STORE.shop_domain, product_title: "Custom Ceramic Mug", requested_at: null, approved_at: null, personalization: { fields: [{ label: "Image Upload 1", kind: "image" }] }, variants: [{ title: "Default Title" }], checkout_url: null };
const FOOD: TourGift = { id: "gift_f", shop_domain: "treats.myshopify.com", product_title: "Dessert Box", requested_at: null, approved_at: null, personalization: null, variants: [{ title: "Box of 12" }], checkout_url: null };

const ALL = [CREWNECK, MUG, FOOD];
const withAll = (over: Partial<TourGift>) => ALL.map((g) => ({ ...g, ...over }));

/** A fake context: three going attendees, no requests, the given gifts, and whatever the test overrides. */
function context(over: Partial<WireContext> = {}, gifts: TourGift[] = [CREWNECK]): WireContext {
  const guests = [{ id: "g_a", status: "going", display_name: "Avery Chen" }, { id: "g_b", status: "going", display_name: "Blake Rivera" }, { id: "g_c", status: "going", display_name: "Carmen Diaz" }];
  return { snap: { event: { id: "evt_1", invite_code: "abc" }, guests, requests: [], definitions: [], gifts, grants: [], exceptions: [] }, gifts: demoGifts(gifts), page: { funnelRows: [], rankedCount: 0, askedLabels: [], attendeeRows: 0 }, updates: {}, phase: "running", store: EMPTY_STORE, ...over };
}

describe("demoGifts", () => {
  it("tells the three gifts apart by store and title", () => {
    expect(demoGifts(ALL)).toEqual({ crewneck: CREWNECK, mug: MUG, food: FOOD });
    expect(demoGifts([MUG])).toEqual({ crewneck: null, mug: MUG, food: null });
    expect(demoGifts([{ ...FOOD, shop_domain: "https://treats.myshopify.com" }]).food?.id).toBe("gift_f");
  });
});

describe("wire", () => {
  it("lists the search endpoints and the sentence while the search runs and the funnel once results arrive", () => {
    const waiting = step("search").wire!(context()).map((l) => l.text);
    expect(waiting).toEqual([`Global Catalog  search_catalog  catalog.shopify.com/api/ucp/mcp`, `store UCP endpoint  search_catalog  ${DEMO_STORE.shop_domain}/api/ucp/mcp`, `→ "${DEMO_STORE.search}"`]);
    const found = step("search").wire!(context({ page: { funnelRows: ["Distinct products 41", "Checked for delivery to the venue 12"], rankedCount: 9, askedLabels: [], attendeeRows: 0 } }));
    expect(found.map((l) => l.text).slice(3)).toEqual(["→ Distinct products 41", "→ Checked for delivery to the venue 12", "← 9 ranked products"]);
    expect(found.at(-1)?.state).toBe("done");
  });
  it("names the demo store's three surfaces on the pick step", () => {
    const lines = step("pick").wire!(context({}, [])).map((l) => l.text);
    expect(lines[0]).toBe(`demo store  ${DEMO_STORE.shop_domain}  trading as ${DEMO_STORE.shop_name}`);
    expect(lines).toContain(`store UCP endpoint  ${DEMO_STORE.shop_domain}/api/ucp/mcp`);
    expect(lines).toContain("Shopify page tool  search_catalog get_product get_cart update_cart and the rest");
    expect(lines).toContain("store page tool  get_customization add_customized_to_cart");
  });
  it("shows the mug's image field once the store answered", () => {
    const lines = step("pick_mug").wire!(context({ phase: "ready" }, [CREWNECK, MUG])).map((l) => l.text);
    expect(lines).toContain("store page tool  get_customization  Custom Ceramic Mug");
    expect(lines).toContain("• Image Upload 1  image");
    expect(lines.at(-1)).toBe("← 1 field  1 variant");
  });
  it("names the food category search and the store's UCP cart tools for the plain product", () => {
    const searching = step("pick_food").wire!(context({ page: { funnelRows: ['"dessert box gift" in fb 40 of 120 in the catalog'], rankedCount: 12, askedLabels: [], attendeeRows: 0 } }, [CREWNECK, MUG]));
    expect(searching.map((l) => l.text)).toEqual(["Global Catalog  search_catalog  catalog.shopify.com/api/ucp/mcp  category fb", '→ "dessert box gift" in fb 40 of 120 in the catalog', "← 12 ranked products"]);
    const picked = step("pick_food").wire!(context({ phase: "ready" }, ALL)).map((l) => l.text);
    expect(picked).toContain("Global Catalog  get_product  Dessert Box");
    expect(picked).toContain("← 1 variant  no customization tool  treats.myshopify.com");
    expect(picked.at(-1)).toBe("store UCP endpoint  create_cart create_checkout  treats.myshopify.com/api/ucp/mcp");
  });
  it("reads the fields and constraints the store answered from the gift", () => {
    expect(step("requirements").wire!(context()).map((l) => l.text)).toEqual(["store page tool  get_customization  Customized Crewneck", "• Star Map Location  text", "• Caption  text  max 20", "← 2 variants  S M"]);
  });
  it("shows every gift's hops on approval, each progress log's posts, and the checkout hosts as they arrive", () => {
    const filling = step("cart").wire!(context({ updates: { gift_c: [{ text: "Filling the cart at springbuilt.myshopify.com with 3 items" }] } }, withAll({ approved_at: "2026-09-02T00:00:00Z" })));
    expect(filling.map((l) => l.text)).toEqual([
      "Tokuchu page tool  approve_specs  Customized Crewneck for 3 attendees",
      "store page tool  add_customized_to_cart  3 items",
      "← Filling the cart at springbuilt.myshopify.com with 3 items",
      "Tokuchu page tool  approve_specs  Custom Ceramic Mug for 3 attendees",
      "store page tool  add_customized_to_cart  3 items",
      "Tokuchu page tool  approve_specs  Dessert Box for 3 attendees",
      "store UCP endpoint  create_cart create_checkout  3 lines  treats.myshopify.com"
    ]);
    expect(filling[1].state).toBe("working");
    expect(filling[6].state).toBe("working");
    const ready = step("cart").wire!(context({ phase: "ready" }, withAll({ approved_at: "2026-09-02T00:00:00Z", checkout_url: "https://springbuilt.myshopify.com/cart/c/abc?key=1", cart_lines: [{ guest_id: "g1" }, { guest_id: "g2" }, { guest_id: "g3" }] })));
    expect(ready.filter((l) => l.text === "← checkout_url  springbuilt.myshopify.com")).toHaveLength(3);
    expect(ready.some((l) => l.state === "working")).toBe(false);
  });
  it("lists the store page's tools and the manifest rows the store's agent read", () => {
    const registering = step("store").wire!(context());
    expect(registering.map((l) => l.text)).toEqual(["store page  springbuilt.myshopify.com opens the signed link", "store page tools  registering", "store page tool  get_fulfillment_manifest  Customized Crewneck"]);
    expect(registering[1].state).toBe("working");
    const read = step("store").wire!(context({ store: { ...EMPTY_STORE, tools: ["get_fulfillment_manifest", "post_procurement_update"], manifest: { revision: 12, approved_revision: 12, attendees: [{ attendee_ref: "g_c", status: "ready", values: { variant_size: "xl", star_map_location: "Cambridge", caption: "Carmen Diaz" } }] } } }));
    expect(read.map((l) => l.text)).toEqual(["store page  springbuilt.myshopify.com opens the signed link", "store page tools  get_fulfillment_manifest post_procurement_update", "store page tool  get_fulfillment_manifest  Customized Crewneck", "← revision 12  approved 12  1 attendee", "• g_c  ready  variant_size=xl  star_map_location=Cambridge  caption=Carmen Diaz"]);
    expect(read.some((l) => l.state === "working")).toBe(false);
  });
  it("names the questioned attendee from the manifest and the exception's revision once posted", () => {
    const manifest = { revision: 12, approved_revision: 12, attendees: [{ attendee_ref: "g_c", status: "ready", values: { star_map_location: "Cambridge" } }] };
    const posting = step("exception").wire!(context({ store: { ...EMPTY_STORE, manifest } }));
    expect(posting.map((l) => l.text)).toEqual(["store page tool  post_procurement_update  needs_information", "→ attendee_ref g_c  requirement_id star_map_location", `→ "${DEMO_CORRECTION.message}"`]);
    expect(posting[0].state).toBe("working");
    const posted = step("exception").wire!(context({ store: { ...EMPTY_STORE, manifest, posted: { revision: 13 } } }));
    expect(posted.slice(3).map((l) => l.text)).toEqual(["← exception opened  revision 13", "← attendee incomplete  correction emailed with the store's question"]);
  });
  it("shows the corrected answer and then the changes read after the approved revision", () => {
    const base = context();
    const resolved = { procurement_id: "gift_c", requirement_id: "star_map_location", status: "resolved", resolved_revision: 15 };
    const gifts = [{ ...CREWNECK, approval: { approved_revision: 12, current_revision: 15, stale: true } }];
    const waiting = step("correction").wire!({ ...base, snap: { ...base.snap, gifts, exceptions: [resolved] }, gifts: demoGifts(gifts) });
    expect(waiting.map((l) => l.text)).toEqual(["invite page tool  submit_rsvp  PATCH /api/events/evt_1/rsvp/g_c", `→ star_map_location "${DEMO_CORRECTION.corrected}"`, "← exception resolved  revision 15", "store page tool  get_changes  after_revision 12"]);
    expect(waiting[3].state).toBe("working");
    const read = step("correction").wire!({ ...base, snap: { ...base.snap, gifts, exceptions: [resolved] }, gifts: demoGifts(gifts), store: { ...EMPTY_STORE, changes: [{ revision: 13, type: "exception_opened", summary: "The store asked" }, { revision: 15, type: "exception_resolved", summary: "star_map_location answered again" }] } });
    expect(read.slice(4).map((l) => l.text)).toEqual(["← 2 changes", "• 13  exception_opened  The store asked", "• 15  exception_resolved  star_map_location answered again"]);
  });
});

describe("startIndex", () => {
  const state = (over: Partial<TourState>): TourState => ({ guests: [], requests: [], gifts: [], ...over });
  it("opens on the published step for a fresh event", () => {
    expect(id(startIndex(state({})))).toBe("published");
  });
  it("opens on the mug pick once the crewneck exists and on the food pick once the mug does", () => {
    expect(id(startIndex(state({ gifts: [CREWNECK] })))).toBe("pick_mug");
    expect(id(startIndex(state({ gifts: [CREWNECK, MUG] })))).toBe("pick_food");
  });
  it("opens on the requirements once all three gifts exist", () => {
    expect(id(startIndex(state({ gifts: ALL })))).toBe("requirements");
  });
  it("opens on the mug's request once the crewneck's went out and on the plain step once both did", () => {
    const requested = { ...CREWNECK, requested_at: "2026-09-01T00:00:00Z" };
    expect(id(startIndex(state({ gifts: [requested, MUG, FOOD] })))).toBe("request_mug");
    expect(id(startIndex(state({ gifts: [requested, { ...MUG, requested_at: "2026-09-01T00:00:00Z" }, FOOD] })))).toBe("plain");
  });
  it("opens on approval once three attendees answered", () => {
    expect(id(startIndex(state({ guests: going(3), requests: [{ gift_id: "gift_c", complete: true }], gifts: withAll({ requested_at: "2026-09-01T00:00:00Z", approved_at: null }) })))).toBe("approve");
  });
  it("opens on the cart wait after every approval and on the store access once every link exists", () => {
    const answered = { guests: going(3), requests: [{ gift_id: "gift_c", complete: true }] };
    expect(id(startIndex(state({ ...answered, gifts: withAll({ requested_at: "2026-09-01T00:00:00Z", approved_at: "2026-09-02T00:00:00Z" }) })))).toBe("cart");
    expect(id(startIndex(state({ ...answered, gifts: withAll({ requested_at: "2026-09-01T00:00:00Z", approved_at: "2026-09-02T00:00:00Z", checkout_url: "https://store/cart/c/1" }) })))).toBe("share");
  });
  it("walks the store's side: the store page once the grant exists, the correction once the exception is open, the re-approval once it resolved, and the checkout once re-approved", () => {
    const approval = (stale: boolean) => ({ approved_revision: 12, current_revision: stale ? 15 : 16, stale });
    const filled = (stale: boolean) => withAll({ requested_at: "2026-09-01T00:00:00Z", approved_at: "2026-09-02T00:00:00Z", checkout_url: "https://store/cart/c/1", approval: approval(stale) });
    const answered = { guests: going(3), requests: [{ gift_id: "gift_c", complete: true }], grants: [{ procurement_id: "gift_c", status: "active", link: "/s/x" }] };
    expect(id(startIndex(state({ ...answered, gifts: filled(false) })))).toBe("store");
    expect(id(startIndex(state({ ...answered, gifts: filled(true), exceptions: [{ procurement_id: "gift_c", requirement_id: "star_map_location", status: "open" }] })))).toBe("correction");
    expect(id(startIndex(state({ ...answered, gifts: filled(true), exceptions: [{ procurement_id: "gift_c", requirement_id: "star_map_location", status: "resolved" }] })))).toBe("reapprove");
    expect(id(startIndex(state({ ...answered, gifts: filled(false), exceptions: [{ procurement_id: "gift_c", requirement_id: "star_map_location", status: "resolved" }] })))).toBe("checkout");
  });
});
