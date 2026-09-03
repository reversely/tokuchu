/**
 * Static mode (#56): the agent plays across Tokuchu's event page and the store's product page with
 * the polyfill on both. Runs with `TOKUCHU_STATIC=1` in the shell (`npm run test:static`), which
 * the config turns into a static dev server on port 3114. The Tokuchu half always runs; the store
 * half (get_customization and add_customized_to_cart on the live store) runs with LIVE_CUSTOMILY=1
 * and a fixture payload stands in for the store's answer otherwise. CAPTURE=1 writes the handoff
 * card and the agent notes to docs/progress.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.skip(!process.env.TOKUCHU_STATIC, "Set TOKUCHU_STATIC=1 to run the static-mode agent flow against a static server.");

const LIVE = process.env.LIVE_CUSTOMILY === "1";
const CAPTURE = process.env.CAPTURE === "1";
const SHOP_DOMAIN = "springbuilt.myshopify.com";
const STORE = `https://${SHOP_DOMAIN}`;
const PRODUCT_ID = "10242071789817";
const HANDLE = "1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt";
const PRODUCT_URL = `${STORE}/products/${HANDLE}`;
const POLYFILL = readFileSync("src/webmcp/polyfill.js", "utf8");
const STATIC_OFF = ["search_gifts", "send_to_vendor", "approve"];

type Attendee = { display_name: string; size: string; location: string; time: string };
const ATTENDEES = (JSON.parse(readFileSync("tests/fixtures/demo-attendees.json", "utf8")) as { attendees: Attendee[] }).attendees;
const email = (a: Attendee) => `${a.display_name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;

/** The store's get_customization answer for the crewneck, as recorded on 2026-09-03; the live run replaces it with the page's own. */
const FIXTURE_PAYLOAD = {
  product_id: PRODUCT_ID,
  title: "Customized Crewneck",
  fields: [
    { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
    { key: "star_map_time", label: "Pick a time for Star Map 1", kind: "time", required: true, constraints: {} },
    { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
  ],
  variants: ["S", "M", "L", "XL", "2XL", "3XL"].map((size, i) => ({ id: String(51000000000 + i), title: size, price_cents: 5000, available: true, options: [{ name: "Size", label: size }] })),
  selected_variant_id: "51000000000"
};

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
type Payload = typeof FIXTURE_PAYLOAD;
type Gift = { id: string; product_id: string; product_url: string | null; approved_at: string | null; cart_fill: unknown; checkout_url: string | null; personalization: { fields: { key: string }[] } | null; variants: { id: string }[] };
type Definition = { id: string; key: string; scope: string; required_rule: string; constraints: { options?: { value: string; label: string }[] } };
type Manifest = { attendees: { attendee_ref: string; status: string }[]; cart_items: { recipient_ref: string; variant_id: string; values: Record<string, string> }[] };

/** Runs one WebMCP tool on a page through the polyfill, as an agent would. */
async function call(page: Page, name: string, args: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, args }) => {
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      return { text: result.content[0]?.text ?? "", isError: result.isError === true };
    },
    { name, args }
  );
}
async function ok<T>(page: Page, name: string, args: Record<string, unknown>): Promise<T> {
  const { text, isError } = await call(page, name, args);
  expect(isError, `${name}: ${text}`).toBe(false);
  return JSON.parse(text) as T;
}
const toolNames = (page: Page) => page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name).sort());

/** The store's product page with the polyfill injected before its scripts, so the merchant tools register. */
async function openStore(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript({ content: POLYFILL });
  const page = await ctx.newPage();
  await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const ctx = document.modelContext as unknown as Ctx | undefined;
    return ctx ? ctx.getTools().then((tools) => ["get_customization", "add_customized_to_cart"].every((n) => tools.some((t) => t.name === n))) : false;
  }, undefined, { timeout: 60_000 });
  return { ctx, page };
}

let page: Page;
let eventId = "";
let giftId = "";
let guestIds: string[] = [];
let cartItems: Manifest["cart_items"] = [];
let approvedAt = "";

const snapshot = async () => (await (await page.request.get(`/api/events/${eventId}`)).json()) as { static: boolean; definitions: Definition[]; gifts: Gift[] };

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  const created = await page.request.post("/api/events", { data: { title: "Static agent run", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" }, delivery: { destination: "venue", address: null, needed_by: "2029-12-20" } } });
  eventId = ((await created.json()) as { id: string }).id;
  await page.request.post(`/api/events/${eventId}/publish`);
  const snap = await snapshot();
  expect(snap.static, "The server is not in static mode; start it with TOKUCHU_STATIC=1 (npm run test:static).").toBe(true);
  const reply = await page.request.post(`/api/events/${eventId}/rsvp`, { data: { guests: ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going" })) } });
  guestIds = ((await reply.json()) as { guest_ids: string[] }).guest_ids;
});
test.afterAll(async () => {
  await page?.close();
});

test("1: the event page registers the static tool set and carries the agent's task", async () => {
  await page.goto(`/events/${eventId}?webmcp=polyfill`);
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const names = await toolNames(page);
  expect(names).toContain("set_gift_customization");
  expect(names).toContain("set_gift_plan");
  for (const off of STATIC_OFF) expect(names).not.toContain(off);
  await expect(page.locator(`meta[name="tokuchu-agent-task"]`)).toHaveAttribute("content", /set_gift_customization/);

  await page.getByTestId("tab-experience").click();
  await expect(page.getByTestId("cards")).toHaveCount(0);
  await expect(page.getByTestId("sentence")).toHaveCount(0);
  await expect(page.getByTestId("curate")).toHaveCount(0);
  await expect(page.getByTestId("chat-panel")).toHaveCount(0);
  await expect(page.getByTestId("handoff")).toBeVisible();
  await expect(page.getByTestId("handoff-next-store")).toHaveText("get_customization");
  await expect(page.getByTestId("agent-notes")).toBeVisible();
  await expect(page.getByTestId("agent-notes")).toContainText("add_customized_to_cart");
});

test("2: the agent creates the gift with set_gift_plan and hands the store's customization over", async ({ browser }) => {
  test.setTimeout(180_000);
  const created = await ok<Gift>(page, "set_gift_plan", { rules: [{ filter: [{ field: "status", op: "eq", value: "going" }], product_id: PRODUCT_ID }], shop_domain: SHOP_DOMAIN, product_title: "Customized Crewneck", product_url: PRODUCT_URL });
  giftId = created.id;
  expect(created.product_url).toBe(PRODUCT_URL);
  // No store read ran on the server: the gift has the fields the agent gives it and nothing else yet.
  expect(created.personalization ?? null).toBeNull();
  const handoff = page.locator(`[data-testid="handoff"][data-gift="${giftId}"]`);
  await expect(handoff).toBeVisible();
  await expect(handoff.getByTestId("handoff-url")).toHaveText(PRODUCT_URL);
  await expect(handoff.getByTestId("handoff-handle")).toHaveText(HANDLE);
  await expect(handoff.getByTestId("handoff-gift")).toHaveText(giftId);
  await expect(handoff.getByTestId("handoff-next-store")).toHaveText("get_customization");
  await expect(handoff.getByTestId("handoff-next-here")).toHaveText("set_gift_customization");

  let payload: Payload = FIXTURE_PAYLOAD;
  if (LIVE) {
    const store = await openStore(browser);
    try {
      payload = await ok<Payload>(store.page, "get_customization", { product_id: PRODUCT_ID });
    } finally {
      await store.ctx.close();
    }
    expect(payload.fields.map((f) => f.key)).toEqual(["star_map_location", "star_map_time", "caption"]);
  }
  const gift = await ok<Gift>(page, "set_gift_customization", { gift_id: giftId, ...payload });
  expect(gift.personalization?.fields.map((f) => f.key)).toEqual(["star_map_location", "star_map_time", "caption"]);
  expect(gift.variants.map((v) => v.id)).toEqual(payload.variants.map((v) => String(v.id)));
  await expect(handoff.getByTestId("handoff-next-here")).toHaveText("get_requirements");

  // A payload for another product is refused with the field and both ids named.
  const wrong = await call(page, "set_gift_customization", { gift_id: giftId, product_id: "1", fields: [] });
  expect(wrong.isError).toBe(true);
  expect(JSON.parse(wrong.text).error).toMatch(/product_id 1 is not gift/);
});

test("3: requirements and requests on Tokuchu; the manifest reads ready with cart_items; approval fills no cart", async () => {
  test.setTimeout(120_000);
  const { requirements } = await ok<{ requirements: { key: string; already: boolean }[] }>(page, "get_requirements", { gift_id: giftId });
  expect(requirements.map((r) => r.key).sort()).toEqual(["caption", "star_map_location", "star_map_time", "variant_size"]);
  await ok(page, "request_from_attendees", { gift_id: giftId });
  const { definitions } = await snapshot();
  const asked = definitions.filter((d) => d.scope === "guest" && d.required_rule === "going");
  const byKey = new Map(asked.map((d) => [d.key, d]));
  // The caption resolves from the RSVP name and needs no question; the size and the star map fields do.
  for (const key of ["variant_size", "star_map_location", "star_map_time"]) {
    const missing = await ok<{ guests: unknown[] }>(page, "list_missing", { definition_id: byKey.get(key)!.id, filter: "status:eq:going" });
    expect(missing.guests, key).toHaveLength(ATTENDEES.length);
  }

  // The attendees answer through their reply links; the values are the fixture's.
  for (const [i, a] of ATTENDEES.entries()) {
    const size = byKey.get("variant_size")!.constraints.options?.find((o) => o.label.toLowerCase() === a.size.toLowerCase())?.value;
    const answers = { [byKey.get("variant_size")!.id]: size, [byKey.get("star_map_location")!.id]: a.location, [byKey.get("star_map_time")!.id]: a.time };
    const res = await page.request.patch(`/api/events/${eventId}/rsvp/${guestIds[i]}`, { data: { email: email(a), answers } });
    expect(res.ok(), await res.text()).toBe(true);
  }

  const manifest = await ok<Manifest>(page, "get_fulfillment_manifest", { gift_id: giftId });
  expect(manifest.attendees.map((a) => a.status)).toEqual(ATTENDEES.map(() => "ready"));
  expect(manifest.cart_items).toHaveLength(ATTENDEES.length);
  const gift = (await snapshot()).gifts.find((g) => g.id === giftId)!;
  for (const item of manifest.cart_items) {
    expect(guestIds).toContain(item.recipient_ref);
    expect(gift.variants.map((v) => v.id)).toContain(item.variant_id);
    expect(Object.keys(item.values).sort()).toEqual(["caption", "star_map_location", "star_map_time"]);
    expect(ATTENDEES.map((a) => a.display_name)).toContain(item.values.caption);
  }
  cartItems = manifest.cart_items;

  const approved = await ok<Gift>(page, "approve_specs", { gift_id: giftId });
  expect(approved.approved_at).toBeTruthy();
  approvedAt = approved.approved_at!;
  await page.waitForTimeout(1500);
  const after = (await snapshot()).gifts.find((g) => g.id === giftId)!;
  expect(after.cart_fill ?? null).toBeNull();
  expect(after.checkout_url ?? null).toBeNull();
  const handoff = page.locator(`[data-testid="handoff"][data-gift="${giftId}"]`);
  await expect(handoff.getByTestId("handoff-next-store")).toHaveText("add_customized_to_cart");
  await expect(handoff.getByTestId("handoff-cart-items")).toHaveText(String(ATTENDEES.length));

  if (CAPTURE) {
    await handoff.scrollIntoViewIfNeeded();
    await handoff.screenshot({ path: "docs/progress/2026-09-03-issue-56-handoff.png" });
    await page.getByTestId("agent-notes").scrollIntoViewIfNeeded();
    await page.getByTestId("agent-notes").screenshot({ path: "docs/progress/2026-09-03-issue-56-agent-notes.png" });
  }
});

test("4: the agent takes cart_items to the store's page and add_customized_to_cart returns the checkout", async ({ browser }) => {
  test.skip(!LIVE, "Set LIVE_CUSTOMILY=1 to fill the live store's cart.");
  test.setTimeout(180_000);
  const store = await openStore(browser);
  try {
    const reply = await ok<{ ready: { recipient_ref: string }[]; blocked: unknown[]; checkout_url: string | null }>(store.page, "add_customized_to_cart", { items: cartItems, idempotency_key: `${giftId}:${approvedAt}` });
    expect(reply.ready.map((r) => r.recipient_ref).sort()).toEqual([...guestIds].sort());
    expect(reply.blocked).toEqual([]);
    expect(reply.checkout_url).toContain("/cart/c/");
    // The agent records the store's checkout on the gift's progress log.
    await ok(page, "post_update", { gift_id: giftId, kind: "in_production", text: `The cart at ${SHOP_DOMAIN} is ready to review`, reference: reply.checkout_url });
    const { updates } = await ok<{ updates: { reference: string | null }[] }>(page, "get_updates", { gift_id: giftId });
    expect(updates.at(-1)?.reference).toBe(reply.checkout_url);
  } finally {
    await store.ctx.close();
  }
});
