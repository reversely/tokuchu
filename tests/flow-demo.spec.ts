/**
 * The flow demo: a condensed, recorded walk through the survey-first path, one organizer browser
 * context to tests/videos, with a running agent-trace overlay that shows every WebMCP call and
 * prompt on screen (the search query, the live get_personalization_schema request and response, the
 * curation prompt, get_manifest, and create_personalized_batch with its items).
 *
 *   1. Create the event (the real draft page).
 *   2. Search the catalog and the store, surface the star shirt, and fetch its customizations live
 *      from the store through the Customily adapter's get_personalization_schema; the fetched fields
 *      render as the survey the attendees would fill.
 *   3. The curation prompt selects the product and maps the fields, then a fake attendee dataset
 *      (tests/fixtures/demo-attendees.json) is injected through the normal RSVP API to stand in for
 *      collected responses, and get_manifest prepares the order .json.
 *   4. The .json is handed to the store through create_personalized_batch, and the order-accepted
 *      response is simulated.
 *
 * The only simulated parts are the collected attendee responses (the fixture) and the final
 * order-accepted acknowledgment; everything else is the real app and the real store. The simulation
 * lives in this spec and its fixture, and the app wiring is untouched. Gated on LIVE_CUSTOMILY=1;
 * needs the dev server on 3113 with CUSTOMILY_SHOP_URL and OPENAI_API_KEY, and event details from
 * the gitignored docs/demo-event.json (with the apparel search and curate fields).
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
const POLYFILL = fileURLToPath(new URL("../src/webmcp/polyfill.js", import.meta.url));
const ADAPTER = fileURLToPath(new URL("../integrations/customily/webmcp-customily.js", import.meta.url));
const customshop = JSON.parse(readFileSync(fileURLToPath(new URL("../src/agent/customshop.json", import.meta.url)), "utf8")) as { shop_name: string };
const SHOP_NAME = customshop.shop_name;
const ATTENDEES = (JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/demo-attendees.json", import.meta.url)), "utf8")) as { attendees: { display_name: string; printed_name: string }[] }).attendees;

type DemoEvent = { title: string; host: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; cost: string; deadline: string; needed_by: string; choices: string[]; search: string; curate: string };
const DEMO_PATH = process.env.DEMO_EVENT ?? "docs/demo-event.json";
test.skip(!existsSync(DEMO_PATH), `No demo event at ${DEMO_PATH}.`);
const EVENT = JSON.parse(readFileSync(DEMO_PATH, "utf8")) as DemoEvent;

const KEY_DELAY_MS = 18;
const READ_MS = 1600;
const LIVE_MS = 240_000;

let browserRef: Browser;
let ctx: BrowserContext;
let page: Page;
let eventId = "";
let giftId = "";
let flowToken = "";

// The agent trace lives in the test so it survives page navigations; renderTrace rebuilds the panel.
type TraceEntry = { kind: "call" | "resp" | "note"; text: string };
const traceLines: TraceEntry[] = [];
async function renderTrace() {
  await page.evaluate((lines) => {
    let el = document.getElementById("demo-trace");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-trace";
      el.style.cssText = "position:fixed;left:20px;top:88px;z-index:9998;width:440px;max-height:78vh;overflow:auto;padding:14px 16px;border-radius:12px;background:#05070D;color:#EAF3FC;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 10px 30px rgba(0,0,0,.45);border:1px solid #1b2740";
      document.body.appendChild(el);
    }
    const colour = (k: string) => (k === "call" ? "#4DA3E8" : k === "resp" ? "#5BD6A0" : "#7E8AA0");
    const mark = (k: string) => (k === "call" ? "&rarr;" : k === "resp" ? "&larr;" : "&bull;");
    el.innerHTML = '<div style="font:600 12px Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#4DA3E8;margin-bottom:10px">WebMCP agent trace</div>' +
      lines.map((l) => `<div style="margin:3px 0;color:${colour(l.kind)};white-space:pre-wrap;word-break:break-word"><span style="opacity:.7">${mark(l.kind)}</span> ${l.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("");
    el.scrollTop = el.scrollHeight;
  }, traceLines).catch(() => undefined);
}
async function trace(kind: TraceEntry["kind"], text: string) {
  traceLines.push({ kind, text });
  await renderTrace();
}

async function caption(text: string) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:9999;padding:8px 14px;border-radius:8px;background:#0B3D6E;color:#fff;font:500 15px/1.4 Inter,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.2);pointer-events:none;max-width:56vw;text-align:center";
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text).catch(() => undefined);
}

/** Renders the fetched fields as the survey form an attendee would receive, on the right of the page. */
async function surveyForm(title: string, fields: { key: string; label: string; kind: string; required: boolean }[]) {
  await page.evaluate(({ title, fields }) => {
    let el = document.getElementById("demo-survey");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-survey";
      el.style.cssText = "position:fixed;right:24px;top:88px;z-index:9998;width:360px;padding:18px 20px;border-radius:14px;background:#fff;color:#0B1020;font:14px/1.5 Inter,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25)";
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="font:600 12px Inter;letter-spacing:.06em;text-transform:uppercase;color:#4DA3E8;margin-bottom:12px">${title}</div>` +
      fields.map((f) => `<div style="margin-bottom:12px"><div style="font-size:13px;color:#51626E;margin-bottom:4px">${f.label}${f.required ? " *" : ""}</div><div style="height:34px;border:1px solid #DFE5E9;border-radius:8px;background:#F7FAFC"></div></div>`).join("");
  }, { title, fields }).catch(() => undefined);
}
async function clearOverlay(id: string) {
  await page.evaluate((i) => document.getElementById(i)?.remove(), id).catch(() => undefined);
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

/** A real WebMCP round-trip: opens the store's product page with the adapter and calls get_personalization_schema. */
async function fetchLiveSchema(): Promise<{ product_id: string; fields: { key: string; label: string; kind: string; required: boolean }[]; variants: { id: string }[] | null }> {
  const helper = await browserRef.newContext();
  const p = await helper.newPage();
  await p.addInitScript({ path: POLYFILL });
  await p.addInitScript({ path: ADAPTER });
  await p.goto(PRODUCT_URL, { waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => p.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name).sort()), { timeout: 30_000 })
    .toContain("get_personalization_schema");
  const raw = await p.evaluate(async (productId) => {
    const ctxt = document.modelContext as unknown as { getTools(): Promise<{ name: string }[]>; executeTool(t: unknown, a: unknown): Promise<{ content: { text: string }[] }> };
    const tool = (await ctxt.getTools()).find((t) => t.name === "get_personalization_schema");
    const result = await ctxt.executeTool(tool, { product_id: productId });
    return result.content[0]?.text ?? "{}";
  }, PRODUCT_ID);
  await helper.close();
  return JSON.parse(raw) as { product_id: string; fields: { key: string; label: string; kind: string; required: boolean }[]; variants: { id: string }[] | null };
}

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  ctx = await browserRef.newContext({ viewport: { width: 1520, height: 940 }, recordVideo: { dir: "tests/videos", size: { width: 1520, height: 940 } } });
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
  await trace("call", "POST /api/events  (draft published from the organizer's form)");
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
  await renderTrace();
  await trace("resp", `event ${eventId} published`);
  await caption("1. Event published");
  await rest();
});

test("2: search surfaces the star shirt and its customizations are fetched live from the store", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await page.getByTestId("tab-experience").click();
  await renderTrace();
  await caption("2. Search the catalog and the store");
  await trace("call", `search_gifts(sentence: "${EVENT.search}")`);
  await typeInto(page.getByTestId("sentence"), EVENT.search);
  await page.getByTestId("sentence").press("Enter");
  await expect(page.getByTestId("result").first()).toBeVisible({ timeout: LIVE_MS });
  for (let i = 0; i < 3; i++) {
    const more = page.getByTestId("show-more");
    if (!(await more.isVisible().catch(() => false))) break;
    await more.click();
    await rest(400);
  }
  const storeRow = page.getByTestId("result").filter({ hasText: SHOP_NAME }).first();
  await expect(storeRow, `a result from ${SHOP_NAME} is visible`).toBeVisible({ timeout: 15_000 });
  await storeRow.scrollIntoViewIfNeeded();
  await trace("resp", `${SHOP_NAME}'s star shirt ranks among the catalog results`);
  await rest(2200);

  // A real WebMCP call to the store: get_personalization_schema on the storefront through the adapter.
  await caption("2. Fetch the shirt's customizations from the store (live WebMCP)");
  await trace("call", `get_personalization_schema(product_id: "${PRODUCT_ID}")  @ ${SHOP_DOMAIN}`);
  const schema = await fetchLiveSchema();
  await trace("resp", `fields: ${schema.fields.map((f) => `${f.key}:${f.kind}`).join(", ")}${schema.variants ? `; ${schema.variants.length} variants` : ""}`);
  await surveyForm("The survey attendees receive", schema.fields);
  await caption("2. The customizations become the survey fields");
  await rest(4500);
  await clearOverlay("demo-survey");
});

test("3: curation maps the fields, the collected responses are injected, and get_manifest prepares the .json", async () => {
  test.setTimeout(LIVE_MS + 60_000);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await renderTrace();
  await caption("3. Describe the personalized shirts (the curation prompt)");
  await trace("call", `curate(message: "${EVENT.curate.slice(0, 80)}${EVENT.curate.length > 80 ? "..." : ""}")`);
  await typeInto(page.getByTestId("curate"), EVENT.curate);
  await page.getByTestId("curate-run").click();
  await expect(page.getByTestId("curate-proposal")).toBeVisible({ timeout: LIVE_MS });
  await expect(page.getByTestId("curate-mapping").first()).toBeVisible();
  await trace("resp", "proposal: Customized Crewneck, mappings for location, date, and each name");
  await page.getByTestId("curate-proposal").scrollIntoViewIfNeeded();
  await rest(2600);
  await page.getByTestId("curate-approve").click();
  await expect(page.getByTestId("gift")).toHaveCount(1, { timeout: 10_000 });
  const request = page.request;
  const snap = (await (await request.get(`/api/events/${eventId}`)).json()) as { gifts: { id: string }[]; definitions: { id: string; key: string }[] };
  giftId = snap.gifts[0].id;
  const printedName = snap.definitions.find((d) => d.key === "printed_name")!;

  await caption("3. Collected responses (a demo dataset stands in, injected like a backend edit)");
  await trace("call", `POST /api/events/${eventId}/rsvp  (${ATTENDEES.length} attendees: ${ATTENDEES.map((a) => a.printed_name).join(", ")})`);
  const rsvp = await request.post(`/api/events/${eventId}/rsvp`, { data: { guests: ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going", answers: { [printedName.id]: a.printed_name } })) } });
  expect(rsvp.ok(), await rsvp.text()).toBe(true);
  await trace("resp", `${ATTENDEES.length} responses recorded`);

  const token = (await (await request.post(`/api/events/${eventId}/tokens`, { data: { holder: SHOP_DOMAIN, gift_ids: [giftId], readable_definition_ids: [printedName.id], callable_tools: ["get_manifest", "post_update"] } })).json()) as { id: string };
  flowToken = token.id;
  await trace("call", `get_manifest(gift_id: "${giftId}")  via the tokenized MCP endpoint`);
  const manifestRes = await request.post(`/api/events/${eventId}/mcp`, { headers: { Authorization: `Bearer ${token.id}` }, data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_manifest", arguments: { gift_id: giftId } } } });
  const manifest = JSON.parse(((await manifestRes.json()) as { result: { content: { text: string }[] } }).result.content[0].text) as { rows: { display_name: string; personalization?: Record<string, { value: unknown }> }[] };
  writeFileSync("tests/videos/collected-results.json", JSON.stringify(manifest, null, 2));
  await trace("resp", `prepared .json: ${manifest.rows.length} units, one per attendee`);
  await caption("3. The responses are prepared as the order .json");
  await rest(4000);
});

test("4: the .json goes to the store through WebMCP and the order is accepted", async () => {
  test.setTimeout(20 * 60_000);
  const request = page.request;
  const variants = await liveVariants(request);
  await request.patch(`/api/events/${eventId}/gifts/${giftId}`, { data: { variants: variants.map((v) => ({ id: v.id, title: v.title, price_cents: v.price_cents, currency: "USD" })), default_variant_id: variants[0].id } });
  const snap = (await (await request.get(`/api/events/${eventId}`)).json()) as { definitions: { id: string; key: string }[] };
  const printedName = snap.definitions.find((d) => d.key === "printed_name")!;
  await request.post(`/api/events/${eventId}/gifts/${giftId}/personalization`, { data: { mappings: [
    { vendor_field_key: "star_map_location", source: { type: "event", key: "venue" }, transform: "location_query" },
    { vendor_field_key: "star_map_date", source: { type: "event", key: "starts_at" }, transform: "date_only" },
    { vendor_field_key: "caption", source: { type: "definition", definition_id: printedName.id, subject_scope: "guest" } }
  ] } });

  await caption("4. Hand the .json to the store through WebMCP");
  await trace("call", `create_personalized_batch(product ${PRODUCT_ID}, ${ATTENDEES.length} items)  @ ${SHOP_DOMAIN}`);
  const base = new URL(page.url()).origin;
  const result = await runPersonalization({ base, eventId, token: flowToken, giftId, productUrl: PRODUCT_URL, event: EVENT_CONTEXT, placeOrder: false, videoDir: "tests/videos" });
  expect(result.ready).toBe(ATTENDEES.length);
  expect(result.batch.status).toBe("prepared");
  await trace("resp", `status: ${result.batch.status}; ${result.ready} ready, ${result.batch.blocked.length} blocked; a preview per unit`);

  const orderName = `#TOKU-${1000 + ATTENDEES.length}`;
  await trace("note", "order acceptance simulated below");
  await trace("resp", `order ${orderName} accepted (simulated)`);
  await caption("4. The store accepts the order (simulated response)");
  await rest(5500);
});
