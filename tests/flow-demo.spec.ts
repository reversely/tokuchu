/**
 * The flow demo: one coherent recorded walk through the real platform screens, one organizer browser
 * context to tests/videos, captioned per step.
 *
 *   1. Create the event (the draft page).
 *   2. Search the catalog (real UCP calls); the store's product ranks in the results; the organizer
 *      physically picks it; the app reads the store's fields and variants through the store's own
 *      get_customization tool and the gift carries them.
 *   3. The Attendees tab shows the information requested from attendees and a records grid, one row per
 *      attendee and one column per answer. A fake attendee dataset (tests/fixtures/demo-attendees.json)
 *      is injected through the normal RSVP API to stand in for collected responses. The organizer
 *      approves, and the app fills the store's cart through add_customized_to_cart.
 *   4. The cart link the store returned opens in a fresh browser with one line per attendee.
 *
 * The only simulated part is the collected attendee dataset (the fixture); the screens, the search, the
 * store's tools, and the cart are the real app and the real store. Gated on LIVE_CUSTOMILY=1; needs the
 * dev server on 3113 with CUSTOMILY_SHOP_URL and OPENAI_API_KEY, and docs/demo-event.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run the live flow demo.");

const SHOP_DOMAIN = "springbuilt.myshopify.com";
const ATTENDEES = (JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/demo-attendees.json", import.meta.url)), "utf8")) as { attendees: { display_name: string; size: string; location: string; time: string }[] }).attendees;

type DemoEvent = { title: string; host: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; cost: string; deadline: string; needed_by: string; search: string; curate: string };
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
let checkoutUrl = "";
let storeName = "the store"; // captured from the result the organizer picks in step 2

type Gift = { id: string; product_title: string; personalization: { fields: { key: string; label: string; kind: string; required: boolean; constraints?: { max_length?: number } }[] } | null; variants: { id: string; title: string }[]; checkout_url?: string | null; cart_fill?: { status: string; reason: string | null } | null };
type Definition = { id: string; key: string; constraints: { options?: { value: string; label: string }[] } };

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

async function gift(): Promise<Gift> {
  const snap = (await (await page.request.get(`/api/events/${eventId}`)).json()) as { gifts: Gift[] };
  return snap.gifts.find((g) => g.id === giftId) ?? snap.gifts[0];
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
  await page.goto("/events/new");
  await tut("Step 1 of 5", "Create the event", "The organizer fills in the event details and publishes it. Publishing creates the link attendees reply through.");
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
  await page.getByTestId("publish").click();
  await page.waitForURL(/\/events\/evt_/);
  eventId = page.url().split("/events/")[1];
  await page.goto(`/events/${eventId}?webmcp=polyfill`);
  await expect(page.getByTestId("status")).toHaveText("Published");
  await caption("1. Event published");
  await rest();
});

test("2: the organizer searches the catalog, physically picks the store, and the app reads the store's customization", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await page.getByTestId("tab-experience").click();
  await tut("Step 2 of 5", "Search the catalog over WebMCP", "The organizer describes the item. The search calls Shopify's Global Catalog and the store's own endpoint and returns a ranked list of real products.", 5000);
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

  // Physically pick the store's product from the results, then confirm it onto the gift list. The
  // confirm opens the store's page on the server and calls its get_customization tool.
  storeName = (await storeResult.locator(".meta").first().textContent())?.trim() || SHOP_DOMAIN;
  await tut("Step 2 of 5", "Pick the store", `The organizer picks ${storeName}'s crewneck from the results.`, 4000);
  await caption(`2. Pick ${storeName}'s crewneck from the results`);
  await storeResult.scrollIntoViewIfNeeded();
  await storeResult.click();
  await expect(page.getByTestId("recipients")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("next").click();
  await expect(page.getByTestId("confirm")).toBeVisible({ timeout: 10_000 });
  await tut("Step 2 of 5", "Ask the store for its options", "Confirming the pick calls the store's own WebMCP tool get_customization on its product page. The fields and the variants the store answers land on the gift.", 4500);
  await caption(`2. Ask ${storeName} for its customization options`);
  await page.getByTestId("confirm").click();
  await expect(page.getByTestId("gift")).toHaveCount(1, { timeout: 120_000 });
  const stored = await gift();
  giftId = stored.id;

  // The app stored what the store answered: three fields with their constraints and six variants, with no test-side write.
  const fields = stored.personalization?.fields ?? [];
  expect(fields.map((f) => f.key)).toEqual(["star_map_location", "star_map_time", "caption"]);
  expect(fields.find((f) => f.key === "caption")?.constraints?.max_length).toBe(20);
  expect(stored.variants).toHaveLength(6);
  await webmcpOverlay(`get_customization at ${SHOP_DOMAIN}`, [`product ${stored.product_title}`, ...fields.map((f) => `• ${f.label} (${f.kind}${f.constraints?.max_length ? `, max ${f.constraints.max_length}` : ""})`), `← ${stored.variants.length} variants`, ...stored.variants.map((v) => `• ${v.title}`)], 6500);
  await clearWebmcpOverlay();
  await caption("2. The store's fields and variants are on the gift");
  await rest(1500);
});

test("3: the organizer requests the product's fields, the responses fill the records, and the approval fills the store's cart", async () => {
  test.setTimeout(LIVE_MS + 120_000);
  const request = page.request;

  await page.getByTestId("tab-attendees").click();
  await expect(page.getByTestId("requested-info")).toBeVisible({ timeout: 10_000 });
  await tut("Step 3 of 5", "Request the details from attendees", "The store's fields become the requirements. The name comes from the RSVP. The star map location and time and the size go to each attendee as questions with the store's limits and choices.", 5500);
  await caption("3. The organizer requests the size and the star map details");
  await expect(page.getByTestId("requested-field").filter({ hasText: "Size" })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("request-fields").click();
  await expect(page.getByTestId("requested-field").filter({ hasText: "Size" })).toHaveAttribute("data-source", "definition", { timeout: 10_000 });
  await expect(page.getByTestId("requested-field").filter({ hasText: "Star Map" }).first()).toHaveAttribute("data-source", "definition");
  await rest(2500);

  // Bypass the survey: inject the fake dataset (each attendee's printed name, size, location, and time) through the
  // normal RSVP API, as if the collected responses were hand-loaded into the backend. Nothing branches on it.
  const snap = (await (await request.get(`/api/events/${eventId}`)).json()) as { definitions: Definition[] };
  const def = (key: string) => snap.definitions.find((d) => d.key === key)!;
  const sizeDef = def("variant_size");
  const sizeValue = (label: string) => sizeDef.constraints.options?.find((o) => o.label.toLowerCase() === label.toLowerCase())?.value ?? sizeDef.constraints.options?.[0]?.value;
  const rsvp = await request.post(`/api/events/${eventId}/rsvp`, { data: { guests: ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going", answers: { [sizeDef.id]: sizeValue(a.size), [def("star_map_location").id]: a.location, [def("star_map_time").id]: a.time } })) } });
  expect(rsvp.ok(), await rsvp.text()).toBe(true);

  await expect(page.getByTestId("attendee-row")).toHaveCount(ATTENDEES.length, { timeout: 10_000 });
  await expect(page.locator('[data-state="missing"]')).toHaveCount(0);
  await tut("Step 4 of 5", "Review the responses and the routing", "Each response fills a row in the records grid with one column per answer. The panel below names the WebMCP tools that carry the order to the store.", 6000);
  await caption("4. The records grid and the WebMCP routing to the store");
  await page.getByTestId("webmcp-routing").scrollIntoViewIfNeeded();
  await rest(4500);

  // The manifest the cart is built from, written beside the video.
  const manifest = await (await request.get(`/api/events/${eventId}/gifts/${giftId}/manifest`)).json();
  writeFileSync("tests/videos/collected-results.json", JSON.stringify(manifest, null, 2));

  await tut("Step 4 of 5", "Approve and fill the cart", "One click locks every attendee's answers. The app then opens the store's page and calls add_customized_to_cart once with one item per attendee.", 3500);
  await caption("4. The organizer approves and the app fills the store's cart");
  await page.getByTestId("approve-send").scrollIntoViewIfNeeded();
  await page.getByTestId("approve-send").click();
  await expect(page.getByTestId("specs-approved")).toBeVisible({ timeout: 25_000 });
  const cartLink = page.getByTestId("review-cart");
  await expect(cartLink).toBeVisible({ timeout: 180_000 });
  checkoutUrl = (await cartLink.getAttribute("href")) ?? "";
  expect(checkoutUrl).toContain("/cart/c/");
  const filled = await gift();
  expect(filled.cart_fill?.status).toBe("done");
  await webmcpOverlay(`add_customized_to_cart at ${SHOP_DOMAIN}`, [`${ATTENDEES.length} items, one per attendee`, ...ATTENDEES.map((a) => `• ${a.display_name}: ${a.size}, ${a.location}, ${a.time}`), `← checkout_url ${checkoutUrl.split("?")[0]}`], 6500);
  await clearWebmcpOverlay();
  await caption(`4. Approved; the cart is ready to review at ${storeName}`);
  await rest(3000);
});

test("4: the store's cart holds one line per attendee", async () => {
  test.setTimeout(LIVE_MS);
  await tut("Step 5 of 5", "The cart at the store", "The link the store returned opens its checkout in any browser with a personalized line for every attendee.", 5000);
  await caption(`5. ${storeName}'s cart holds a configured unit per attendee`);
  const fresh = await browserRef.newContext({ viewport: { width: 1440, height: 940 }, recordVideo: { dir: "tests/videos", size: { width: 1440, height: 940 } } });
  try {
    const checkout = await fresh.newPage();
    await checkout.goto(checkoutUrl, { waitUntil: "domcontentloaded" });
    for (const a of ATTENDEES) await expect(checkout.locator("body")).toContainText(a.display_name, { timeout: 60_000 });
    await checkout.waitForTimeout(5000);
  } finally {
    await fresh.close();
  }
  await rest(2000);
});
