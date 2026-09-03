/**
 * The flow demo: one coherent recorded walk through the real platform screens, one organizer browser
 * context to tests/videos, captioned per step.
 *
 *   1. Create the event (the draft page).
 *   2. Search the catalog (real UCP calls); the store's crewneck ranks in the results; the organizer
 *      physically picks it; the app reads the store's fields and variants through the store's own
 *      get_customization tool and the gift carries them. The organizer goes back to the results and
 *      picks the store's mug, whose one field is a photo, then runs the food and drink card and picks
 *      the first result whose delivery check passed, a plain product with no customization tool.
 *   3. The Attendees tab shows one gift at a time: the information requested from attendees and a
 *      records grid, one row per attendee and one column per answer. A fake attendee dataset
 *      (tests/fixtures/demo-attendees.json) is injected through the normal RSVP API to stand in for
 *      collected responses. The organizer approves each gift: the crewneck and the mug fill the store's
 *      cart through add_customized_to_cart, and the food fills the store's own UCP cart and checkout.
 *   4. The crewneck's cart link opens in a fresh browser with one line per attendee.
 *
 * The only simulated part is the collected attendee dataset (the fixture); the screens, the search, the
 * store's tools, and the carts are the real app and the real stores. Gated on LIVE_CUSTOMILY=1; needs the
 * dev server with CUSTOMILY_SHOP_URL and OPENAI_API_KEY, and docs/demo-event.json.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run the live flow demo.");

const SHOP_DOMAIN = "springbuilt.myshopify.com";
const ATTENDEES = (JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/demo-attendees.json", import.meta.url)), "utf8")) as { attendees: { display_name: string; size: string; location: string; time: string; photo: string }[] }).attendees;

type DemoEvent = { title: string; host: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; cost: string; deadline: string; needed_by: string; search: string; curate: string; card?: string };
const DEMO_PATH = process.env.DEMO_EVENT ?? "docs/demo-event.json";
test.skip(!existsSync(DEMO_PATH), `No demo event at ${DEMO_PATH}.`);
const EVENT = JSON.parse(readFileSync(DEMO_PATH, "utf8")) as DemoEvent;
const FOOD_CARD = EVENT.card ?? "food_drink";

const KEY_DELAY_MS = 18;
const READ_MS = 1800;
const LIVE_MS = 240_000;

let browserRef: Browser;
let ctx: BrowserContext;
let page: Page;
let eventId = "";
let storeName = "the store"; // captured from the result the organizer picks in step 2
const gifts: Record<"crewneck" | "mug" | "food", string> = { crewneck: "", mug: "", food: "" };
const checkouts: Record<"crewneck" | "mug" | "food", string> = { crewneck: "", mug: "", food: "" };

type Gift = { id: string; product_title: string; shop_domain: string; personalization: { fields: { key: string; label: string; kind: string; required: boolean; constraints?: { max_length?: number } }[] } | null; variants: { id: string; title: string }[]; checkout_url?: string | null; cart_fill?: { status: string; reason: string | null } | null };
type Definition = { id: string; key: string; value_type: string; required_rule: string; creator: string; scope: string; constraints: { options?: { value: string; label: string }[] } };

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

async function allGifts(): Promise<Gift[]> {
  return ((await (await page.request.get(`/api/events/${eventId}`)).json()) as { gifts: Gift[] }).gifts;
}

async function gift(id: string): Promise<Gift> {
  const found = (await allGifts()).find((g) => g.id === id);
  if (!found) throw new Error(`No gift ${id} on the event`);
  return found;
}

/** The real per-source rows of the search funnel and the first titles shown, read off the page for the overlay. */
async function funnelData() {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="funnel"] .row')).map((r) => (r.textContent || "").replace(/\s+/g, " ").trim());
    const names = Array.from(document.querySelectorAll('[data-testid="result"] .name')).slice(0, 5).map((n) => (n.textContent || "").trim());
    return { rows, names };
  });
}

/** Reveals pages of results until the card is on the page. */
async function reveal(card: Locator) {
  for (let i = 0; i < 12 && (await card.count()) === 0; i++) {
    const more = page.getByTestId("show-more");
    if ((await more.count()) === 0) break;
    await more.click();
  }
  await expect(card).toBeVisible({ timeout: 10_000 });
}

/** The pick flow from a result card: the recipients, the variants, and the confirm that saves the gift. */
async function pickCard(card: Locator, expectedGifts: number) {
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("recipients")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("next").click();
  await expect(page.getByTestId("confirm")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("confirm").click();
  await expect(page.getByTestId("gift")).toHaveCount(expectedGifts, { timeout: 120_000 });
}

/** Selects one gift on the Attendees tab. */
async function selectGift(id: string) {
  const tab = page.locator(`[data-testid="gift-tab"][data-gift="${id}"]`);
  if ((await tab.count()) > 0) await tab.click();
  await expect(page.locator(`[data-testid="requested-info"][data-gift="${id}"]`)).toBeVisible({ timeout: 10_000 });
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

test("2: the organizer searches the catalog, picks the store's crewneck and mug, and adds a food gift from the catalog", async () => {
  test.setTimeout(LIVE_MS * 2 + 120_000);
  await page.getByTestId("tab-experience").click();
  await tut("Step 2 of 5", "Search the catalog over WebMCP", "The organizer describes the item. The search calls Shopify's Global Catalog and the store's own endpoint and returns a ranked list of real products.", 5000);
  await caption("2. Search the catalog over WebMCP");
  await typeInto(page.getByTestId("sentence"), EVENT.search);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: LIVE_MS });
  await expect(page.getByTestId("result").first()).toBeVisible();

  // Reveal the store's crewneck in the real ranked results (it ranks near the top; page on if needed).
  const storeResult = page.locator(`[data-testid="result"][data-shop="${SHOP_DOMAIN}"]`).filter({ hasText: /crewneck/i }).first();
  await reveal(storeResult);

  // Honest overlay: the real endpoints the search calls, the real per-source counts, and the real titles returned.
  const funnel = await funnelData();
  const rankedCount = await page.getByTestId("result").count();
  await webmcpOverlay("search_catalog", ["catalog.shopify.com/api/ucp/mcp", `${SHOP_DOMAIN}/api/ucp/mcp`, ...funnel.rows.map((r) => `→ ${r}`), `← ${rankedCount} ranked products`, ...funnel.names.map((n) => `• ${n}`)], 6500);
  await clearWebmcpOverlay();

  // Physically pick the store's crewneck from the results, then confirm it onto the gift list. The
  // confirm opens the store's page on the server and calls its get_customization tool.
  storeName = (await storeResult.locator(".meta").first().textContent())?.trim() || SHOP_DOMAIN;
  await tut("Step 2 of 5", "Pick the store", `The organizer picks ${storeName}'s crewneck from the results.`, 4000);
  await caption(`2. Pick ${storeName}'s crewneck from the results`);
  await tut("Step 2 of 5", "Ask the store for its options", "Confirming the pick calls the store's own WebMCP tool get_customization on its product page. The fields and the variants the store answers land on the gift.", 4500);
  await caption(`2. Ask ${storeName} for its customization options`);
  await pickCard(storeResult, 1);
  const crewneck = (await allGifts()).find((g) => /crewneck/i.test(g.product_title))!;
  gifts.crewneck = crewneck.id;

  // The app stored what the store answered: three fields with their constraints and six variants, with no test-side write.
  const fields = crewneck.personalization?.fields ?? [];
  expect(fields.map((f) => f.key)).toEqual(["star_map_location", "star_map_time", "caption"]);
  expect(fields.find((f) => f.key === "caption")?.constraints?.max_length).toBe(20);
  expect(crewneck.variants).toHaveLength(6);
  await webmcpOverlay(`get_customization at ${SHOP_DOMAIN}`, [`product ${crewneck.product_title}`, ...fields.map((f) => `• ${f.label} (${f.kind}${f.constraints?.max_length ? `, max ${f.constraints.max_length}` : ""})`), `← ${crewneck.variants.length} variants`, ...crewneck.variants.map((v) => `• ${v.title}`)], 6500);
  await clearWebmcpOverlay();
  await caption("2. The store's fields and variants are on the gift");
  await rest(1500);

  // Back to the same results for the store's mug: one field, a photo each attendee supplies.
  await tut("Step 2 of 5", "Pick the favour", `The same results list ${storeName}'s other customizable products. The organizer picks the ceramic mug, whose one field is a photo.`, 4500);
  await caption(`2. Back to the results for ${storeName}'s mug`);
  await page.getByTestId("add-gift").click();
  await page.getByTestId("last-results").click();
  const mugResult = page.locator(`[data-testid="result"][data-shop="${SHOP_DOMAIN}"]`).filter({ hasText: /mug/i }).first();
  await reveal(mugResult);
  await pickCard(mugResult, 2);
  const mug = (await allGifts()).find((g) => /mug/i.test(g.product_title))!;
  gifts.mug = mug.id;
  expect(mug.personalization?.fields.map((f) => [f.key, f.kind])).toEqual([["photo", "image"]]);
  expect(mug.variants).toHaveLength(1);
  await webmcpOverlay(`get_customization at ${SHOP_DOMAIN}`, [`product ${mug.product_title}`, ...(mug.personalization?.fields ?? []).map((f) => `• ${f.label} (${f.kind})`), `← ${mug.variants.length} variant`], 5500);
  await clearWebmcpOverlay();

  // The food and drink card: Shopify's catalog in its food and beverage category, each product checked for delivery to the venue.
  await tut("Step 2 of 5", "Add something to eat", "The food and drink card searches Shopify's catalog in its food and beverage category and checks that each product ships to the venue by the date. The organizer picks the first result whose delivery check passed.", 5000);
  await caption("2. The food and drink card searches the catalog's food and beverage category");
  await page.getByTestId("add-gift").click();
  await page.getByTestId(`card-${FOOD_CARD}`).click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: LIVE_MS });
  // The first result whose delivery check passed: the store's checkout quoted shipping to the venue.
  const foodResult = page.locator('[data-testid="result"][data-delivery="quoted"]').first();
  await reveal(foodResult);
  const foodFunnel = await funnelData();
  await webmcpOverlay("search_catalog", ["catalog.shopify.com/api/ucp/mcp", "category fb", ...foodFunnel.rows.map((r) => `→ ${r}`), `← ${await page.getByTestId("result").count()} ranked products`, ...foodFunnel.names.map((n) => `• ${n}`)], 6000);
  await clearWebmcpOverlay();
  await pickCard(foodResult, 3);
  const food = (await allGifts()).find((g) => g.shop_domain.replace(/^https?:\/\//, "") !== SHOP_DOMAIN)!;
  gifts.food = food.id;
  expect(food.personalization?.fields ?? []).toEqual([]);
  await caption(`2. ${food.product_title} from ${food.shop_domain} has no customization tool`);
  await rest(1500);
});

test("3: the organizer requests the products' fields, the responses fill the records, and the approvals fill each store's cart", async () => {
  test.setTimeout(LIVE_MS * 3 + 120_000);
  const request = page.request;

  await page.getByTestId("tab-attendees").click();
  await selectGift(gifts.crewneck);
  await tut("Step 3 of 5", "Request the details from attendees", "The store's fields become the requirements. The name comes from the RSVP. The star map location and time and the size go to each attendee as questions with the store's limits and choices.", 5500);
  await caption("3. The organizer requests the size and the star map details");
  await expect(page.getByTestId("requested-field").filter({ hasText: "Size" })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("request-fields").click();
  await expect(page.getByTestId("requested-field").filter({ hasText: "Size" })).toHaveAttribute("data-source", "definition", { timeout: 10_000 });
  await expect(page.getByTestId("requested-field").filter({ hasText: "Star Map" }).first()).toHaveAttribute("data-source", "definition");
  await rest(2500);

  await selectGift(gifts.mug);
  await tut("Step 3 of 5", "Request the photo for the mug", "The mug's one field is an image. The same request turns it into a file question on the form.", 4500);
  await caption("3. The organizer requests the photo for the mug");
  await expect(page.getByTestId("requested-field").filter({ hasText: "Image" })).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("request-fields").click();
  await expect(page.getByTestId("requested-field").filter({ hasText: "Image" })).toHaveAttribute("data-source", "definition", { timeout: 10_000 });
  await rest(2000);

  await selectGift(gifts.food);
  await caption("3. The food gift has nothing to ask");
  await rest(2000);

  // Bypass the survey: inject the fake dataset (each attendee's printed name, size, location, time, and photo) through
  // the normal RSVP API, as if the collected responses were hand-loaded into the backend. Nothing branches on it.
  const snap = (await (await request.get(`/api/events/${eventId}`)).json()) as { definitions: Definition[] };
  const asked = snap.definitions.filter((d) => d.scope === "guest" && d.required_rule === "going" && d.creator === "organizer");
  const answer = (def: Definition, a: (typeof ATTENDEES)[number]): unknown => {
    const option = (label: string) => def.constraints.options?.find((o) => o.label.toLowerCase() === label.toLowerCase())?.value ?? def.constraints.options?.[0]?.value;
    if (def.key === "variant_size") return option(a.size);
    if (def.key === "star_map_location") return a.location;
    if (def.key === "star_map_time") return a.time;
    if (def.value_type === "file") return a.photo;
    if (def.value_type === "enum") return def.constraints.options?.[0]?.value;
    if (def.value_type === "multi_enum") return def.constraints.options?.[0] ? [def.constraints.options[0].value] : [];
    return a.display_name;
  };
  const rsvp = await request.post(`/api/events/${eventId}/rsvp`, { data: { guests: ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going", answers: Object.fromEntries(asked.map((d) => [d.id, answer(d, a)])) })) } });
  expect(rsvp.ok(), await rsvp.text()).toBe(true);

  await selectGift(gifts.crewneck);
  await expect(page.getByTestId("attendee-row")).toHaveCount(ATTENDEES.length, { timeout: 10_000 });
  await expect(page.locator('[data-state="missing"]')).toHaveCount(0);
  await tut("Step 4 of 5", "Review the responses and the routing", "Each response fills a row in the records grid with one column per answer. The panel below names the WebMCP tools that carry the order to the store.", 6000);
  await caption("4. The records grid and the WebMCP routing to the store");
  await page.getByTestId("webmcp-routing").scrollIntoViewIfNeeded();
  await rest(4500);

  // The manifest the crewneck's cart is built from, written beside the video.
  const manifest = await (await request.get(`/api/events/${eventId}/gifts/${gifts.crewneck}/manifest`)).json();
  writeFileSync("tests/videos/collected-results.json", JSON.stringify(manifest, null, 2));

  await tut("Step 4 of 5", "Approve and fill the carts", "One click per gift records the approval. The crewneck and the mug go to the store's add_customized_to_cart with one item per attendee; the food goes to its store's own cart and checkout.", 4000);
  for (const key of ["crewneck", "mug", "food"] as const) {
    await selectGift(gifts[key]);
    await caption(`4. The organizer approves ${key === "food" ? "the food" : `the ${key}`} and the app fills the store's cart`);
    await page.getByTestId("approve-send").scrollIntoViewIfNeeded();
    await page.getByTestId("approve-send").click();
    await expect(page.getByTestId("specs-approved")).toBeVisible({ timeout: 25_000 });
    const cartLink = page.getByTestId("review-cart");
    await expect(cartLink).toBeVisible({ timeout: 180_000 });
    checkouts[key] = (await cartLink.getAttribute("href")) ?? "";
    const filled = await gift(gifts[key]);
    expect(filled.cart_fill?.status).toBe("done");
    if (key === "food") {
      expect(checkouts.food).toMatch(/^https:\/\//);
      await webmcpOverlay(`create_cart and create_checkout at ${filled.shop_domain}`, [`${ATTENDEES.length} units of ${filled.product_title}`, `← checkout_url ${checkouts.food.split("?")[0]}`], 5500);
    } else {
      expect(checkouts[key]).toContain("/cart/c/");
      await webmcpOverlay(`add_customized_to_cart at ${SHOP_DOMAIN}`, [`${ATTENDEES.length} items, one per attendee`, ...ATTENDEES.map((a) => (key === "mug" ? `• ${a.display_name}: ${a.photo.split("/").pop()}` : `• ${a.display_name}: ${a.size}, ${a.location}, ${a.time}`)), `← checkout_url ${checkouts[key].split("?")[0]}`], 5500);
    }
    await clearWebmcpOverlay();
  }
  await caption(`4. Three gifts approved; the carts are ready to review at ${storeName} and at the food store`);
  await rest(3000);
});

test("4: the store's crewneck cart holds one line per attendee", async () => {
  test.setTimeout(LIVE_MS);
  await tut("Step 5 of 5", "The cart at the store", "The link the store returned opens its checkout in any browser with a personalized line for every attendee.", 5000);
  await caption(`5. ${storeName}'s cart holds a configured unit per attendee`);
  const fresh = await browserRef.newContext({ viewport: { width: 1440, height: 940 }, recordVideo: { dir: "tests/videos", size: { width: 1440, height: 940 } } });
  try {
    const checkout = await fresh.newPage();
    await checkout.goto(checkouts.crewneck, { waitUntil: "domcontentloaded" });
    for (const a of ATTENDEES) await expect(checkout.locator("body")).toContainText(a.display_name, { timeout: 60_000 });
    await checkout.waitForTimeout(5000);
  } finally {
    await fresh.close();
  }
  await rest(2000);
});
