/**
 * The flow demo: one coherent recorded walk through the real platform screens, one organizer browser
 * context to tests/videos, captioned per step.
 *
 *   1. Create the event (the draft page).
 *   2. Search the catalog (real UCP calls); the store's product ranks in the results; the organizer
 *      physically picks it; the picked store's own get_personalization_schema returns its fields.
 *   3. The Attendees tab shows the information requested from attendees and a records grid, one row per
 *      attendee and one column per answer. A fake attendee dataset (tests/fixtures/demo-attendees.json)
 *      is injected through the normal RSVP API to stand in for collected responses. The admin approves
 *      the specs and sends them to the vendor.
 *   4. The vendor (the store) receives the items: the batch fills the storefront cart with a configured
 *      unit per attendee.
 *
 * The only simulated part is the collected attendee dataset (the fixture); the screens, the search, the
 * approval gate, and the handoff are the real app and the real store. Gated on LIVE_CUSTOMILY=1; needs
 * the dev server on 3113 with CUSTOMILY_SHOP_URL and OPENAI_API_KEY, and docs/demo-event.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { runPersonalization, type EventContext } from "../scripts/personalize-agent";

test.describe.configure({ mode: "serial" });
test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run the live flow demo.");

const PRODUCT_URL = "https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt";
const PRODUCT_ID = "10242071789817";
const SHOP_DOMAIN = "springbuilt.myshopify.com";
// The store's own WebMCP adapter and the polyfill, loaded into a page so get_personalization_schema
// can be called live against the product the organizer picks (no local copy of the fields).
const POLYFILL = fileURLToPath(new URL("../src/webmcp/polyfill.js", import.meta.url));
const ADAPTER = fileURLToPath(new URL("../integrations/customily/webmcp-customily.js", import.meta.url));
const ATTENDEES = (JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/demo-attendees.json", import.meta.url)), "utf8")) as { attendees: { display_name: string; printed_name: string; size: string }[] }).attendees;

type DemoEvent = { title: string; host: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; cost: string; deadline: string; needed_by: string; choices: string[]; search: string; curate: string };
const DEMO_PATH = process.env.DEMO_EVENT ?? "docs/demo-event.json";
test.skip(!existsSync(DEMO_PATH), `No demo event at ${DEMO_PATH}.`);
const EVENT = JSON.parse(readFileSync(DEMO_PATH, "utf8")) as DemoEvent;

const KEY_DELAY_MS = 18;
const READ_MS = 1800;
const LIVE_MS = 240_000;

let browserRef: Browser;
let ctx: BrowserContext;
let page: Page;
let eventId = "";
let giftId = "";
let flowToken = "";
let storeName = "the store"; // captured from the result the organizer picks in step 2

type StoreSchema = { product_id: string; title: string; fields: { key: string; label: string; kind: string; required: boolean }[]; variants: { id: string; title: string }[] };

const TUTORIAL = process.env.TUTORIAL === "1";

async function caption(text: string) {
  if (TUTORIAL) return; // the large tutorial overlay narrates instead.
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:9999;padding:8px 16px;border-radius:8px;background:#0B3D6E;color:#fff;font:500 15px/1.4 Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none;max-width:64vw;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text).catch(() => undefined);
}

/** A large step banner for the tutorial cut: a step label, a big title, and a sentence. Holds so it reads. */
async function tut(step: string, title: string, body: string, holdMs = 4500) {
  if (!TUTORIAL) return;
  await page.evaluate(({ step, title, body }) => {
    let el = document.getElementById("demo-tut");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-tut";
      el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:26px 40px 30px;background:linear-gradient(180deg,rgba(11,16,32,0),rgba(11,16,32,.92) 40%);color:#fff;pointer-events:none;text-align:center";
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="font:600 15px Inter,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8FD0FF;margin-bottom:8px">${step}</div>` +
      `<div style="font:600 34px/1.2 Inter,system-ui,sans-serif;margin-bottom:10px">${title}</div>` +
      `<div style="font:400 20px/1.45 Inter,system-ui,sans-serif;color:#DCE7F2;max-width:70vw;margin:0 auto">${body}</div>`;
  }, { step, title, body }).catch(() => undefined);
  await page.waitForTimeout(holdMs);
}
const rest = (ms = READ_MS) => page.waitForTimeout(TUTORIAL ? ms + 1200 : ms);
async function typeInto(locator: Locator, text: string) {
  await locator.click();
  await page.keyboard.type(text, { delay: KEY_DELAY_MS });
}

/** A translucent overlay that names the WebMCP calls behind a step, so the video shows the wire, not just the screen. */
async function webmcpOverlay(title: string, lines: string[], holdMs = 6000) {
  await page.evaluate(({ title, lines }) => {
    let el = document.getElementById("demo-webmcp");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-webmcp";
      el.style.cssText = "position:fixed;top:88px;right:30px;z-index:9998;width:520px;max-width:42vw;padding:16px 18px 18px;border-radius:12px;background:rgba(11,16,32,.74);color:#EAF3FC;font:12.5px/1.75 ui-monospace,Menlo,monospace;box-shadow:0 16px 44px rgba(0,0,0,.4);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);pointer-events:none";
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#8FD0FF;margin-bottom:10px">${title}</div>` + lines.map((l) => `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l}</div>`).join("");
  }, { title, lines }).catch(() => undefined);
  await page.waitForTimeout(holdMs);
}
async function clearWebmcpOverlay() {
  await page.evaluate(() => document.getElementById("demo-webmcp")?.remove()).catch(() => undefined);
}

/** Asks the picked store for its customization options: loads its product page and calls the store's own
 * WebMCP get_personalization_schema tool. This is the only source of the fields; nothing is read locally. */
async function fetchStoreSchema(productUrl: string, productId: string): Promise<StoreSchema> {
  const c = await browserRef.newContext();
  await c.addInitScript({ path: POLYFILL });
  await c.addInitScript({ path: ADAPTER });
  const p = await c.newPage();
  await p.goto(productUrl, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => {
    const ctx = (document as unknown as { modelContext?: { getTools(): Promise<{ name: string }[]> } }).modelContext;
    return ctx ? ctx.getTools().then((ts) => ts.some((t) => t.name === "get_personalization_schema")) : false;
  }, undefined, { timeout: 60_000 });
  const text = await p.evaluate(async (pid) => {
    const ctx = (document as unknown as { modelContext: { getTools(): Promise<{ name: string }[]>; executeTool(t: unknown, a: unknown): Promise<{ content: { text: string }[] }> } }).modelContext;
    const tool = (await ctx.getTools()).find((t) => t.name === "get_personalization_schema");
    const r = await ctx.executeTool(tool, { product_id: pid });
    return r.content[0]?.text ?? "null";
  }, productId);
  await c.close();
  return JSON.parse(text) as StoreSchema;
}
const EVENT_CONTEXT: EventContext = { venue: EVENT.venue, delivery: { destination: "venue", address: null, needed_by: EVENT.needed_by }, contact: { email: null, phone: null } };

type LiveVariant = { id: string; title: string; price_cents: number; available: boolean; options: { name: string; label: string }[] };
async function liveVariants(request: APIRequestContext): Promise<LiveVariant[]> {
  const res = await request.get(`${PRODUCT_URL}.js`);
  expect(res.ok()).toBe(true);
  const product = (await res.json()) as { options?: (string | { name: string })[]; variants: { id: number; title: string; price: number; available?: boolean; options?: string[] }[] };
  const names = (product.options ?? []).map((o) => (typeof o === "string" ? o : o.name));
  return product.variants.map((v) => ({ id: String(v.id), title: v.title, price_cents: v.price, available: v.available !== false, options: (v.options ?? []).map((label, i) => ({ name: names[i] ?? `Option ${i + 1}`, label: String(label) })) }));
}

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  ctx = await browserRef.newContext({ viewport: { width: 1440, height: 940 }, recordVideo: { dir: "tests/videos", size: { width: 1440, height: 940 } } });
  page = await ctx.newPage();
});
test.afterAll(async () => {
  const video = page.video();
  await ctx.close();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await video?.saveAs(`tests/videos/flow-demo${TUTORIAL ? "-tutorial" : ""}-${stamp}.webm`);
  await video?.delete();
});

test("1: create the event", async () => {
  test.setTimeout(LIVE_MS);
  await page.goto("/");
  await tut("Step 1 of 5", "Create the event", "The organizer fills in the event details and publishes it, which creates a link attendees reply through.");
  await caption("1. Create the event");
  await typeInto(page.getByTestId("title"), EVENT.title);
  await page.getByTestId("starts_at").fill(EVENT.starts_at);
  await typeInto(page.getByTestId("host"), EVENT.host);
  await typeInto(page.getByTestId("venue_name"), EVENT.venue.name);
  await typeInto(page.getByTestId("line1"), EVENT.venue.line1);
  await page.getByTestId("city").fill(EVENT.venue.city);
  await page.getByTestId("region").fill(EVENT.venue.region);
  await page.getByTestId("postal_code").fill(EVENT.venue.postal_code);
  await page.getByTestId("country").fill(EVENT.venue.country);
  await page.getByTestId("spots").fill(EVENT.spots);
  await page.getByTestId("cost").fill(EVENT.cost);
  await page.getByTestId("deadline").fill(EVENT.deadline);
  await page.getByTestId("needed_by").fill(EVENT.needed_by);
  // The questions attendees answer come from the product the agent selects (step 3), not a fixed list.
  // Remove the seeded dietary choice so the only questions are the name and the product's Size.
  await page.getByRole("button", { name: /Remove Allergies and dietary/ }).click();
  await page.getByTestId("publish").click();
  await page.waitForURL(/\/events\/evt_/);
  eventId = page.url().split("/events/")[1];
  await page.goto(`/events/${eventId}?webmcp=polyfill`);
  await expect(page.getByTestId("status")).toHaveText("Published");
  await caption("1. Event published");
  await rest();
});

test("2: the organizer searches the catalog, physically picks the store, and the store returns its options", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  const request = page.request;
  await page.getByTestId("tab-experience").click();
  await tut("Step 2 of 5", "Search the catalog over WebMCP", "The organizer describes the merch. The search calls Shopify's UCP catalog and the store's own endpoint and returns a ranked list of real products.", 5000);
  await caption("2. Search the catalog over WebMCP");
  await typeInto(page.getByTestId("sentence"), EVENT.search);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: LIVE_MS });
  await expect(page.getByTestId("result").first()).toBeVisible();

  // Reveal the store's product in the real ranked results (it ranks near the top; page on if needed).
  const storeResult = page.getByTestId("result").filter({ hasText: "Customworks" }).first();
  for (let i = 0; i < 6 && (await storeResult.count()) === 0; i++) await page.getByTestId("show-more").click().catch(() => undefined);
  await expect(storeResult).toBeVisible({ timeout: 10_000 });

  // Honest overlay: the real endpoints the search calls, the real per-source counts, and the real titles returned.
  const funnelData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="funnel"] .row')).map((r) => (r.textContent || "").replace(/\s+/g, " ").trim());
    const names = Array.from(document.querySelectorAll('[data-testid="result"] .name')).slice(0, 5).map((n) => (n.textContent || "").trim());
    return { rows, names };
  });
  const rankedCount = await page.getByTestId("result").count();
  await webmcpOverlay("search_catalog", ["catalog.shopify.com/api/ucp/mcp", `${SHOP_DOMAIN}/api/ucp/mcp`, ...funnelData.rows.map((r) => `→ ${r}`), `← ${rankedCount} ranked products`, ...funnelData.names.map((n) => `• ${n}`)], 6500);
  await clearWebmcpOverlay();

  // Physically pick the store's product from the results, then confirm it onto the gift list.
  storeName = (await storeResult.locator(".meta").first().textContent())?.trim() || SHOP_DOMAIN;
  await tut("Step 2 of 5", "Pick the store", `The organizer picks ${storeName}'s crewneck from the results.`, 4000);
  await caption(`2. Pick ${storeName}'s crewneck from the results`);
  await storeResult.scrollIntoViewIfNeeded();
  await storeResult.click();
  await expect(page.getByTestId("recipients")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("next").click();
  await expect(page.getByTestId("confirm")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("confirm").click();
  await expect(page.getByTestId("gift")).toHaveCount(1, { timeout: 15_000 });
  const snap = (await (await request.get(`/api/events/${eventId}`)).json()) as { gifts: { id: string }[]; definitions: { id: string; key: string }[] };
  giftId = snap.gifts[0].id;
  const printedName = snap.definitions.find((d) => d.key === "printed_name")!;

  // The next call goes to the store the organizer picked: its own WebMCP get_personalization_schema tool.
  await tut("Step 2 of 5", "Ask the store for its options", "The next page calls the picked store's own WebMCP tool, get_personalization_schema, to read the fields the product needs.", 4500);
  await caption(`2. Ask ${storeName} for its customization options`);
  const schema = await fetchStoreSchema(PRODUCT_URL, PRODUCT_ID);
  await webmcpOverlay(`get_personalization_schema · ${SHOP_DOMAIN}`, [`product ${schema.title}`, ...schema.fields.map((f) => `• ${f.label} (${f.kind})`), `← ${schema.variants.length} variants`, ...schema.variants.slice(0, 6).map((v) => `• ${v.title}`)], 6500);
  await clearWebmcpOverlay();

  // Configure the gift from what the store returned: its fields, and its variants read live from the product.
  const variants = await liveVariants(request);
  await request.patch(`/api/events/${eventId}/gifts/${giftId}`, { data: { shop_domain: SHOP_DOMAIN, variants: variants.map((v) => ({ id: v.id, title: v.title, price_cents: v.price_cents, currency: "USD", available: v.available, options: v.options })), default_variant_id: variants[0].id, personalization: { fields: schema.fields.map((f) => ({ key: f.key, label: f.label, kind: f.kind, required: f.required })) } } });
  const mappings = schema.fields.map((f) => f.kind === "location"
    ? { vendor_field_key: f.key, source: { type: "event", key: "venue" }, transform: "location_query" }
    : f.kind === "date"
    ? { vendor_field_key: f.key, source: { type: "event", key: "starts_at" }, transform: "date_only" }
    : { vendor_field_key: f.key, source: { type: "definition", definition_id: printedName.id, subject_scope: "guest" } });
  await request.post(`/api/events/${eventId}/gifts/${giftId}/personalization`, { data: { mappings } });
  await caption("2. The store's options are mapped; the item is on the gift list");
  await rest(1500);
});

test("3: the organizer requests the product's fields, the responses fill the records, and the specs are approved", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  const request = page.request;

  await page.getByTestId("tab-attendees").click();
  await expect(page.getByTestId("requested-info")).toBeVisible({ timeout: 10_000 });
  await tut("Step 3 of 5", "Request the details from attendees", "The shirt's own options become the questions. The organizer requests the size, whose choices come from the product's variants over WebMCP, not a fixed list.", 5500);
  await caption("3. The organizer requests the size and name the shirt needs");
  await page.getByTestId("request-fields").click();
  await expect(page.getByTestId("requested-field").filter({ hasText: "Size" })).toBeVisible({ timeout: 10_000 });
  await rest(2500);

  // Bypass the survey: inject the fake dataset (each attendee's name and chosen size) through the normal
  // RSVP API, as if the collected responses were hand-loaded into the backend. Nothing branches on it.
  const snap = (await (await request.get(`/api/events/${eventId}`)).json()) as { definitions: { id: string; key: string; constraints: { options?: { value: string; label: string }[] } }[] };
  const printedName = snap.definitions.find((d) => d.key === "printed_name")!;
  const sizeDef = snap.definitions.find((d) => d.key === "variant_size")!;
  const sizeValue = (label: string) => sizeDef.constraints.options?.find((o) => o.label.toLowerCase() === label.toLowerCase())?.value ?? sizeDef.constraints.options?.[0]?.value;
  const rsvp = await request.post(`/api/events/${eventId}/rsvp`, { data: { guests: ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going", answers: { [printedName.id]: a.printed_name, [sizeDef.id]: sizeValue(a.size) } })) } });
  expect(rsvp.ok(), await rsvp.text()).toBe(true);

  await expect(page.getByTestId("attendee-row")).toHaveCount(ATTENDEES.length, { timeout: 10_000 });
  await tut("Step 4 of 5", "Review the responses and the routing", "Each response fills a row in the records grid, one column per answer. The panel below names the WebMCP routing that carries the order to the vendor.", 6000);
  await caption("4. The records grid, and the WebMCP routing to the vendor");
  await page.getByTestId("webmcp-routing").scrollIntoViewIfNeeded();
  await rest(4500);

  // The prepared order .json is the manifest; write it beside the video.
  const token = (await (await request.post(`/api/events/${eventId}/tokens`, { data: { holder: SHOP_DOMAIN, gift_ids: [giftId], readable_definition_ids: [printedName.id, sizeDef.id], callable_tools: ["get_manifest", "post_update"] } })).json()) as { id: string };
  flowToken = token.id;
  const manifestRes = await request.post(`/api/events/${eventId}/mcp`, { headers: { Authorization: `Bearer ${token.id}` }, data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_manifest", arguments: { gift_id: giftId } } } });
  const manifest = JSON.parse(((await manifestRes.json()) as { result: { content: { text: string }[] } }).result.content[0].text);
  writeFileSync("tests/videos/collected-results.json", JSON.stringify(manifest, null, 2));

  await tut("Step 4 of 5", "Approve and send to the vendor", "One click locks every attendee's answers and hands the collected specs to the vendor.", 3500);
  await caption("4. The admin approves the specs and sends them to the vendor");
  await page.getByTestId("approve-send").scrollIntoViewIfNeeded();
  await page.getByTestId("approve-send").click();
  await expect(page.getByTestId("specs-approved")).toBeVisible({ timeout: 25_000 });
  // The cart-review link appears once the snapshot carries the recorded cart URL; capture it if present.
  const cartLink = page.getByTestId("review-cart");
  await cartLink.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
  if (await cartLink.isVisible().catch(() => false)) await caption("4. Approved and sent; the cart is ready to review at the vendor");
  await rest(3000);
});

test("4: the vendor receives the items and the cart fills", async () => {
  test.setTimeout(20 * 60_000);
  await tut("Step 5 of 5", "The vendor receives the order", `The approved specs go to ${storeName} over WebMCP, and the store's cart fills with a personalized unit for every attendee.`, 5000);
  await caption(`5. ${storeName} receives the items (live WebMCP handoff)`);
  const base = new URL(page.url()).origin;
  const result = await runPersonalization({ base, eventId, token: flowToken, giftId, productUrl: PRODUCT_URL, event: EVENT_CONTEXT, placeOrder: false, videoDir: "tests/videos" });
  expect(result.ready).toBe(ATTENDEES.length);
  expect(result.batch.status).toBe("prepared");
  expect(result.cart).toHaveLength(ATTENDEES.length);
  await caption("5. The store's cart holds a configured unit per attendee");
  await rest(5000);
});
