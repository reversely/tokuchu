/**
 * The flow demo: a recorded walk through the survey-first path, one organizer browser context to
 * tests/videos, captioned per step. It records the real app where the app runs it and simulates only
 * the collected attendee responses.
 *
 *   1. Create the event (the real draft page).
 *   2. WebMCP search finds the store by name and its star shirt; the shirt's customizations are
 *      fetched and shown as the survey fields the attendees would receive.
 *   3. A fake attendee dataset (tests/fixtures/demo-attendees.json) is injected through the existing
 *      RSVP API, standing in for collected responses as if hand-loaded into the backend. The
 *      collected results are shown and written to tests/videos/collected-results.json.
 *   4. The results are handed to the store through WebMCP (create_personalized_batch), and the
 *      order-accepted response is simulated.
 *
 * The simulation lives entirely in this spec and its fixture: the app modules are untouched, no route
 * or branch knows about it, and the injection uses the normal RSVP API. Gated on LIVE_CUSTOMILY=1;
 * needs the dev server on 3113 with CUSTOMILY_SHOP_URL and OPENAI_API_KEY, and event details from the
 * gitignored docs/demo-event.json (the apparel/curation fields).
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
const customshop = JSON.parse(readFileSync(fileURLToPath(new URL("../src/agent/customshop.json", import.meta.url)), "utf8")) as { shop_name: string; products: Record<string, { fields: { key: string; label: string; kind: string; required: boolean }[] }> };
const FIELDS = customshop.products[PRODUCT_ID].fields;
const SHOP_NAME = customshop.shop_name;

const ATTENDEES = (JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/demo-attendees.json", import.meta.url)), "utf8")) as { attendees: { display_name: string; printed_name: string }[] }).attendees;

type DemoEvent = { title: string; host: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; cost: string; deadline: string; needed_by: string; choices: string[]; search: string; curate: string };
const DEMO_PATH = process.env.DEMO_EVENT ?? "docs/demo-event.json";
test.skip(!existsSync(DEMO_PATH), `No demo event at ${DEMO_PATH}.`);
const EVENT = JSON.parse(readFileSync(DEMO_PATH, "utf8")) as DemoEvent;

const KEY_DELAY_MS = 30;
const READ_MS = 2500;
const LIVE_MS = 240_000;

let browserRef: Browser;
let ctx: BrowserContext;
let page: Page;
let eventId = "";
let giftId = "";
let flowToken = "";

/** A caption strip at the foot of the page, naming the step being recorded. */
async function caption(text: string) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:9999;padding:8px 14px;border-radius:8px;background:#0B3D6E;color:#fff;font:500 15px/1.4 Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none;max-width:74vw;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text).catch(() => undefined);
}

/** A demo overlay panel: a heading and preformatted content, used to show fetched fields, the collected .json, and the order response. Rendered only in the recording. */
async function panel(title: string, lines: string[]) {
  await page.evaluate(({ title, lines }) => {
    let el = document.getElementById("demo-panel");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-panel";
      el.style.cssText = "position:fixed;right:24px;top:96px;z-index:9998;width:420px;max-height:70vh;overflow:auto;padding:16px 18px;border-radius:12px;background:#0B1020;color:#EAF3FC;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 8px 28px rgba(0,0,0,.35)";
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="font:600 13px Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#4DA3E8;margin-bottom:10px">${title}</div>` + lines.map((l) => `<div>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("");
  }, { title, lines }).catch(() => undefined);
}
async function clearPanel() {
  await page.evaluate(() => document.getElementById("demo-panel")?.remove()).catch(() => undefined);
}

const rest = (ms = READ_MS) => page.waitForTimeout(ms);
async function typeInto(locator: Locator, text: string) {
  await locator.click();
  await page.keyboard.type(text, { delay: KEY_DELAY_MS });
}

const EVENT_CONTEXT: EventContext = { venue: EVENT.venue, delivery: { destination: "venue", address: null, needed_by: EVENT.needed_by }, contact: { email: null, phone: null } };

async function liveVariants(request: APIRequestContext): Promise<{ id: string; title: string; price_cents: number }[]> {
  const res = await request.get(`${PRODUCT_URL}.js`);
  expect(res.ok()).toBe(true);
  const product = (await res.json()) as { variants: { id: number; title: string; price: number }[] };
  return product.variants.map((v) => ({ id: String(v.id), title: v.title, price_cents: v.price }));
}

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  ctx = await browserRef.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "tests/videos", size: { width: 1440, height: 900 } } });
  page = await ctx.newPage();
});

test.afterAll(async () => {
  const video = page.video();
  await ctx.close();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await video?.saveAs(`tests/videos/flow-demo-${stamp}.webm`);
  await video?.delete();
});

test("1: create the event", async () => {
  test.setTimeout(LIVE_MS);
  await page.goto("/");
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
  // Publishing needs the seeded choice question to carry options.
  const choiceInput = page.getByTestId("questions").getByLabel(/Add a choice to/).first();
  for (const c of EVENT.choices.filter(Boolean)) {
    await typeInto(choiceInput, c);
    await choiceInput.press("Enter");
  }
  await rest();
  await page.getByTestId("publish").click();
  await page.waitForURL(/\/events\/evt_/);
  eventId = page.url().split("/events/")[1];
  await page.goto(`/events/${eventId}?webmcp=polyfill`);
  await expect(page.getByTestId("status")).toHaveText("Published");
  await caption("1. Event published with an invite link");
  await rest();
});

test("2: WebMCP search finds the store and the star shirt, and its customizations become the survey fields", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await page.getByTestId("tab-experience").click();
  await caption(`2. WebMCP search finds ${SHOP_NAME} and its star shirt`);
  await typeInto(page.getByTestId("sentence"), EVENT.search);
  await page.getByTestId("sentence").press("Enter");
  await expect(page.getByTestId("result").first()).toBeVisible({ timeout: LIVE_MS });
  for (let i = 0; i < 3; i++) {
    const more = page.getByTestId("show-more");
    if (!(await more.isVisible().catch(() => false))) break;
    await more.click();
    await rest(500);
  }
  const storeRow = page.getByTestId("result").filter({ hasText: SHOP_NAME }).first();
  await expect(storeRow, `a result from ${SHOP_NAME} is visible`).toBeVisible({ timeout: 15_000 });
  await storeRow.scrollIntoViewIfNeeded();
  await rest(2500);
  // The star shirt's customizations, fetched from the store's schema, are the fields attendees fill.
  await caption("2. Fetch the shirt's customizations: these become the survey fields");
  await panel("Customizations fetched from the store", FIELDS.map((f) => `${f.key} (${f.kind})${f.required ? " *" : ""}  ${f.label}`));
  await rest(5000);
  await clearPanel();
});

test("3: the curation request selects the product and maps the fields", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await caption("3. Describe the personalized shirts; the agent selects and maps");
  await typeInto(page.getByTestId("curate"), EVENT.curate);
  await rest(800);
  await page.getByTestId("curate-run").click();
  await expect(page.getByTestId("curate-proposal")).toBeVisible({ timeout: LIVE_MS });
  await expect(page.getByTestId("curate-mapping").first()).toBeVisible();
  await page.getByTestId("curate-proposal").scrollIntoViewIfNeeded();
  await rest(3500);
  await page.getByTestId("curate-approve").click();
  await expect(page.getByTestId("gift")).toHaveCount(1, { timeout: 10_000 });
  const snap = (await (await page.request.get(`/api/events/${eventId}`)).json()) as { gifts: { id: string }[] };
  giftId = snap.gifts[0].id;
  await caption("3. The personalized shirt is on the gift list");
  await rest();
});

test("4: inject the collected attendee responses and prepare the .json", async () => {
  test.setTimeout(120_000);
  const request = page.request;
  const snap1 = (await (await request.get(`/api/events/${eventId}`)).json()) as { definitions: { id: string; key: string }[] };
  const printedName = snap1.definitions.find((d) => d.key === "printed_name")!;
  // Bypass the survey: inject the fake dataset through the normal RSVP API, as if the collected
  // responses were hand-loaded into the backend. Nothing in the app knows this is a demo.
  await caption("4. Attendee responses collected (a demo dataset stands in)");
  const rsvp = await request.post(`/api/events/${eventId}/rsvp`, {
    data: { guests: ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going", answers: { [printedName.id]: a.printed_name } })) }
  });
  expect(rsvp.ok(), await rsvp.text()).toBe(true);
  await page.reload();
  await page.getByTestId("tab-experience").click().catch(() => undefined);
  await panel("Collected responses", ATTENDEES.map((a) => `${a.display_name}  ->  name: "${a.printed_name}"`));
  await rest(3500);

  // The manifest is the prepared .json handed to the store; write it beside the video and show it.
  const token = (await (await request.post(`/api/events/${eventId}/tokens`, { data: { holder: SHOP_DOMAIN, gift_ids: [giftId], readable_definition_ids: [printedName.id], callable_tools: ["get_manifest", "post_update"] } })).json()) as { id: string };
  const manifestRes = await request.post(`/api/events/${eventId}/mcp`, {
    headers: { Authorization: `Bearer ${token.id}` },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_manifest", arguments: { gift_id: giftId } } }
  });
  const manifest = JSON.parse(((await manifestRes.json()) as { result: { content: { text: string }[] } }).result.content[0].text) as { rows: { display_name: string; personalization?: Record<string, { value: unknown }> }[] };
  writeFileSync("tests/videos/collected-results.json", JSON.stringify(manifest, null, 2));
  await caption("4. The responses are prepared as the order .json");
  await panel("Prepared .json (get_manifest)", manifest.rows.slice(0, 6).map((r) => `${r.display_name}: ${JSON.stringify(Object.fromEntries(Object.entries(r.personalization ?? {}).map(([k, v]) => [k, v.value])))}`));
  await rest(5000);
  await clearPanel();
  // Keep the token for the handoff step.
  flowToken = token.id;
});

test("5: the .json goes to the store through WebMCP and the order is accepted", async () => {
  test.setTimeout(20 * 60_000);
  const request = page.request;
  const variants = await liveVariants(request);
  await request.patch(`/api/events/${eventId}/gifts/${giftId}`, {
    data: { variants: variants.map((v) => ({ id: v.id, title: v.title, price_cents: v.price_cents, currency: "USD" })), default_variant_id: variants[0].id, personalization: { fields: FIELDS } }
  });
  const snap = (await (await request.get(`/api/events/${eventId}`)).json()) as { definitions: { id: string; key: string }[] };
  const printedName = snap.definitions.find((d) => d.key === "printed_name")!;
  await request.post(`/api/events/${eventId}/gifts/${giftId}/personalization`, {
    data: { mappings: [
      { vendor_field_key: "star_map_location", source: { type: "event", key: "venue" }, transform: "location_query" },
      { vendor_field_key: "star_map_date", source: { type: "event", key: "starts_at" }, transform: "date_only" },
      { vendor_field_key: "caption", source: { type: "definition", definition_id: printedName.id, subject_scope: "guest" } }
    ] }
  });
  const token = flowToken;

  await caption("5. The .json is handed to the store through WebMCP");
  const base = new URL(page.url()).origin;
  const result = await runPersonalization({ base, eventId, token, giftId, productUrl: PRODUCT_URL, event: EVENT_CONTEXT, placeOrder: false, videoDir: "tests/videos" });
  expect(result.ready).toBe(ATTENDEES.length);
  expect(result.batch.status).toBe("prepared");
  expect(result.cart).toHaveLength(ATTENDEES.length);

  // Simulate the store accepting the order: the real handoff filled the cart with a configured unit
  // per attendee; the accepted-order response is the simulated part.
  const orderName = `#TOKU-${String(1000 + ATTENDEES.length)}`;
  await caption("5. The store accepts the order (simulated response)");
  await panel("Order accepted (simulated)", [
    `order: ${orderName}`,
    `status: accepted`,
    `units: ${result.ready}`,
    ...Object.entries(result.batch.preview_urls).slice(0, 6).map(([ref]) => `${ref}: preview ready`)
  ]);
  await rest(6000);
});
