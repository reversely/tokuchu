/**
 * The flow demo: one coherent recorded walk through the real platform screens, one organizer browser
 * context to tests/videos, captioned per step.
 *
 *   1. Create the event (the draft page).
 *   2. Describe the personalized shirts; the curation agent searches once, the store's shirt ranks and
 *      is selected, and the fields are mapped. Approve the item.
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
const customshop = JSON.parse(readFileSync(fileURLToPath(new URL("../src/agent/customshop.json", import.meta.url)), "utf8")) as { shop_name: string; products: Record<string, { fields: { key: string; label: string; kind: string; required: boolean }[] }> };
const FIELDS = customshop.products[PRODUCT_ID].fields;
const SHOP_NAME = customshop.shop_name;
const ATTENDEES = (JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/demo-attendees.json", import.meta.url)), "utf8")) as { attendees: { display_name: string; printed_name: string }[] }).attendees;

type DemoEvent = { title: string; host: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; cost: string; deadline: string; needed_by: string; choices: string[]; curate: string };
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
const EVENT_CONTEXT: EventContext = { venue: EVENT.venue, delivery: { destination: "venue", address: null, needed_by: EVENT.needed_by }, contact: { email: null, phone: null } };

async function liveVariants(request: APIRequestContext): Promise<{ id: string; title: string; price_cents: number }[]> {
  const res = await request.get(`${PRODUCT_URL}.js`);
  expect(res.ok()).toBe(true);
  const product = (await res.json()) as { variants: { id: number; title: string; price: number }[] };
  return product.variants.map((v) => ({ id: String(v.id), title: v.title, price_cents: v.price }));
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
  await tut("Step 1 of 4", "Create the event", "The organizer fills in the event details and publishes it, which creates a link attendees reply through.");
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
  const choiceInput = page.getByTestId("questions").getByLabel(/Add a choice to/).first();
  for (const c of EVENT.choices.filter(Boolean)) {
    await typeInto(choiceInput, c);
    await choiceInput.press("Enter");
  }
  await page.getByTestId("publish").click();
  await page.waitForURL(/\/events\/evt_/);
  eventId = page.url().split("/events/")[1];
  await page.goto(`/events/${eventId}?webmcp=polyfill`);
  await expect(page.getByTestId("status")).toHaveText("Published");
  await caption("1. Event published");
  await rest();
});

test("2: curation searches once, selects the store's shirt, maps the fields, and the item is approved", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await page.getByTestId("tab-experience").click();
  await tut("Step 2 of 4", "Find and personalize the product", "Describe the merch in plain words. The agent searches your store and the catalog through WebMCP, selects the ranked shirt, and maps each field to an event or attendee value.");
  await caption("2. Describe the personalized shirts; the agent searches and selects");
  await typeInto(page.getByTestId("curate"), EVENT.curate);
  await page.getByTestId("curate-run").click();
  await expect(page.getByTestId("curate-proposal")).toBeVisible({ timeout: LIVE_MS });
  await expect(page.getByTestId("curate-mapping").first()).toBeVisible();
  await page.getByTestId("curate-proposal").scrollIntoViewIfNeeded();
  await caption(`2. The agent selected ${SHOP_NAME}'s shirt and mapped the fields`);
  await rest(3500);
  await page.getByTestId("curate-approve").click();
  await expect(page.getByTestId("gift")).toHaveCount(1, { timeout: 10_000 });
  const request = page.request;
  const snap = (await (await request.get(`/api/events/${eventId}`)).json()) as { gifts: { id: string }[]; definitions: { id: string; key: string }[] };
  giftId = snap.gifts[0].id;
  const printedName = snap.definitions.find((d) => d.key === "printed_name")!;
  // Bind the live variants and store the schema and mappings the vendor run and the records view read.
  const variants = await liveVariants(request);
  await request.patch(`/api/events/${eventId}/gifts/${giftId}`, { data: { variants: variants.map((v) => ({ id: v.id, title: v.title, price_cents: v.price_cents, currency: "USD" })), default_variant_id: variants[0].id, personalization: { fields: FIELDS } } });
  await request.post(`/api/events/${eventId}/gifts/${giftId}/personalization`, { data: { mappings: [
    { vendor_field_key: "star_map_location", source: { type: "event", key: "venue" }, transform: "location_query" },
    { vendor_field_key: "star_map_date", source: { type: "event", key: "starts_at" }, transform: "date_only" },
    { vendor_field_key: "caption", source: { type: "definition", definition_id: printedName.id, subject_scope: "guest" } }
  ] } });
  await caption("2. The item is approved and on the gift list");
  await rest(1500);
});

test("3: the Attendees records show the responses, and the admin approves and sends the specs", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  const request = page.request;
  const snap = (await (await request.get(`/api/events/${eventId}`)).json()) as { definitions: { id: string; key: string }[] };
  const printedName = snap.definitions.find((d) => d.key === "printed_name")!;
  // Bypass the survey: inject the fake dataset through the normal RSVP API, as if the collected
  // responses were hand-loaded into the backend. Nothing in the app knows this is a demo.
  const rsvp = await request.post(`/api/events/${eventId}/rsvp`, { data: { guests: ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going", answers: { [printedName.id]: a.printed_name } })) } });
  expect(rsvp.ok(), await rsvp.text()).toBe(true);

  await page.getByTestId("tab-attendees").click();
  await expect(page.getByTestId("attendees-grid")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("attendee-row")).toHaveCount(ATTENDEES.length);
  await tut("Step 3 of 4", "Review the attendee responses", "The information the product needs is requested from attendees, and each response fills a row in the records grid. The admin reviews it before anything reaches the vendor.", 6000);
  await caption("3. The information requested from attendees, and their responses");
  await rest(4500);

  // The prepared order .json is the manifest; write it beside the video.
  const token = (await (await request.post(`/api/events/${eventId}/tokens`, { data: { holder: SHOP_DOMAIN, gift_ids: [giftId], readable_definition_ids: [printedName.id], callable_tools: ["get_manifest", "post_update"] } })).json()) as { id: string };
  flowToken = token.id;
  const manifestRes = await request.post(`/api/events/${eventId}/mcp`, { headers: { Authorization: `Bearer ${token.id}` }, data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_manifest", arguments: { gift_id: giftId } } } });
  const manifest = JSON.parse(((await manifestRes.json()) as { result: { content: { text: string }[] } }).result.content[0].text);
  writeFileSync("tests/videos/collected-results.json", JSON.stringify(manifest, null, 2));

  await tut("Step 3 of 4", "Approve and send to the vendor", "One click locks every attendee's answers and hands the collected specs to the vendor.", 3500);
  await caption("3. The admin approves the specs and sends them to the vendor");
  await page.getByTestId("approve-send").scrollIntoViewIfNeeded();
  await page.getByTestId("approve-send").click();
  await expect(page.getByTestId("specs-approved")).toBeVisible({ timeout: 10_000 });
  await rest(3000);
});

test("4: the vendor receives the items", async () => {
  test.setTimeout(20 * 60_000);
  await tut("Step 4 of 4", "The vendor receives the order", `The approved specs go to ${SHOP_NAME} over WebMCP, and the store's cart fills with a personalized unit for every attendee.`, 5000);
  await caption(`4. ${SHOP_NAME} receives the items (live WebMCP handoff)`);
  const base = new URL(page.url()).origin;
  const result = await runPersonalization({ base, eventId, token: flowToken, giftId, productUrl: PRODUCT_URL, event: EVENT_CONTEXT, placeOrder: false, videoDir: "tests/videos" });
  expect(result.ready).toBe(ATTENDEES.length);
  expect(result.batch.status).toBe("prepared");
  expect(result.cart).toHaveLength(ATTENDEES.length);
  await caption(`4. The store's cart holds a configured unit per attendee (order ${`#TOKU-${1000 + ATTENDEES.length}`} accepted, simulated)`);
  await rest(5000);
});
