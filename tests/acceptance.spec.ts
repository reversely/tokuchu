/**
 * The two-sided acceptance run (#53), live against the demo store and recorded to tests/videos with
 * captions on both sides:
 *
 *   1. The organizer creates and publishes the event with the library's printed name question and a
 *      guest list, and the three attendees reply going with their printed name.
 *   2. The organizer searches the catalog and picks the store's crewneck; the app reads the store's
 *      fields through get_customization. Reconciliation resolves the printed name from the existing
 *      question and leaves the size and the star map fields as questions; the request creates the size
 *      from the variant axis and the star map fields as vendor-namespace definitions with provenance,
 *      and asks each attendee only for what the RSVP list lacks.
 *   3. The attendees answer through the RSVP route, one with the bare "Cambridge". The Procurement
 *      reaches ready at revision N and the organizer approves at N; the store fills the cart.
 *   4. The organizer creates store access from the Share block. A second browser opens the signed
 *      link and, through the store page's own WebMCP tools, reads a manifest that carries only the
 *      attendee reference and the store's requirement values, then posts needs_information on the
 *      Cambridge attendee. The organizer's grid shows the exception and the correction request.
 *   5. The attendee saves "Cambridge, Massachusetts, USA" through the reply link; the exception
 *      resolves; the store reads the correction through get_changes after N; the organizer
 *      re-approves and add_customized_to_cart returns a fresh checkout link.
 *
 * The manifest and the change list are written beside the video. Gated on LIVE_CUSTOMILY=1; needs the
 * dev server with CUSTOMILY_SHOP_URL and OPENAI_API_KEY, and docs/demo-event.json. CAPTURE=1 also
 * writes the guide's four store-side captures beside the videos.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run the live acceptance flow.");

const SHOP_DOMAIN = "springbuilt.myshopify.com";
type Attendee = { display_name: string; size: string; location: string; time: string };
const FIXTURE = (JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/demo-attendees.json", import.meta.url)), "utf8")) as { attendees: Attendee[] }).attendees;
/** The third attendee gives the bare place name the store's agent sends back. */
const CORRECTION = { requirement: "star_map_location", given: "Cambridge", message: "Which Cambridge is the star map for", corrected: "Cambridge, Massachusetts, USA" };
const ATTENDEES: Attendee[] = FIXTURE.map((a, i) => (i === FIXTURE.length - 1 ? { ...a, location: CORRECTION.given } : a));
const email = (a: Attendee) => `${a.display_name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`;

type DemoEvent = { title: string; host: string; starts_at: string; venue: { name: string; line1: string; city: string; region: string; postal_code: string; country: string }; spots: string; deadline: string; needed_by: string; search: string };
const DEMO_PATH = process.env.DEMO_EVENT ?? "docs/demo-event.json";
test.skip(!existsSync(DEMO_PATH), `No demo event at ${DEMO_PATH}.`);
const EVENT = JSON.parse(readFileSync(DEMO_PATH, "utf8")) as DemoEvent;

const KEY_DELAY_MS = 18;
const READ_MS = 1800;
const LIVE_MS = 240_000;
const CAPTURE = process.env.CAPTURE === "1";
const OUT = "tests/videos";

type Gift = { id: string; product_id: string; product_title: string; shop_domain: string; personalization: { fields: { key: string; label: string; kind: string }[] } | null; variants: { id: string; title: string; options?: { name: string; label: string }[] }[]; checkout_url?: string | null; cart_fill?: { status: string; reason: string | null } | null; approval?: { approved_revision: number | null; current_revision: number; stale: boolean } | null };
type Definition = { id: string; key: string; label: string; namespace: string; scope: string; value_type: string; required_rule: string; creator: string; constraints: { options?: { value: string; label: string }[] }; vendor_field?: { key: string; label: string; kind: string; vendor_id?: string; product_id?: string; requirement_id?: string } };
type Requirement = { key: string; label: string; kind: string; source: string; definition_id?: string; already: boolean; question?: { value_type: string; constraints: Record<string, unknown> }; mapping?: { vendor_field_key: string; source: { type: string; definition_id?: string } } };
type Snapshot = { event: { id: string; invite_code: string | null }; definitions: Definition[]; guests: { id: string; display_name: string; status: string }[]; gifts: Gift[]; requests: { guest_id: string; gift_id: string; definition_ids: string[]; complete: boolean }[]; exceptions: { id: string; procurement_id: string; attendee_ref: string | null; requirement_id: string | null; status: string }[] };
type Manifest = { revision: number; approved_revision: number | null; status: string; attendees: { attendee_ref: string; status: string; values: Record<string, unknown>; issues: { requirement_id: string; status: string; message: string }[] }[] };
type Change = { revision: number; type: string; actor_type: string; attendee_ref?: string; requirement_id?: string; summary: string };
type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };

let browserRef: Browser;
let organizer: BrowserContext;
let page: Page;
let storeCtx: BrowserContext;
let storePage: Page;
let eventId = "";
let giftId = "";
let printedName: Definition;
/** The store's label for its name field, as the requested-fields chips show it. */
let captionLabel = "";
let cambridge = { id: "", name: "" };
/** The revision the organizer approved at, N in the ticket's words. */
let approvedAt = 0;
const timings: { step: string; seconds: number }[] = [];

/** A caption at the foot of a page, the flow demo's, so the recording reads. */
async function captionOn(target: Page, text: string) {
  await target.evaluate((t) => {
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
const caption = (text: string) => captionOn(page, text);
const rest = (ms = READ_MS) => page.waitForTimeout(ms);
async function typeInto(locator: Locator, text: string) {
  await locator.click();
  await page.keyboard.type(text, { delay: KEY_DELAY_MS });
}

/** A translucent overlay naming the WebMCP calls behind a step, the flow demo's. */
async function overlay(target: Page, title: string, lines: string[], holdMs = 6000) {
  await target.evaluate(({ title, lines }) => {
    let el = document.getElementById("demo-webmcp");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-webmcp";
      el.style.cssText = "position:fixed;top:88px;right:30px;z-index:9998;width:520px;max-width:42vw;padding:16px 18px 18px;border-radius:12px;background:rgba(11,16,32,.74);color:#EAF3FC;font:12.5px/1.75 ui-monospace,Menlo,monospace;box-shadow:0 16px 44px rgba(0,0,0,.4);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);pointer-events:none";
      document.body.appendChild(el);
    }
    el.innerHTML = `<div style="font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#8FD0FF;margin-bottom:10px">${title}</div>` + lines.map((l) => `<div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l}</div>`).join("");
  }, { title, lines }).catch(() => undefined);
  await target.waitForTimeout(holdMs);
  await target.evaluate(() => document.getElementById("demo-webmcp")?.remove()).catch(() => undefined);
}

/** Runs one of the store page's WebMCP tools through the polyfill, as the store's agent would. */
async function storeTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { text, isError } = await storePage.evaluate(
    async ({ name, args }) => {
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      return { text: result.content[0]?.text ?? "", isError: result.isError === true };
    },
    { name, args }
  );
  expect(isError, text).toBe(false);
  return JSON.parse(text) as T;
}

const snapshot = async () => (await (await page.request.get(`/api/events/${eventId}`)).json()) as Snapshot;
const requirements = async () => ((await (await page.request.get(`/api/events/${eventId}/gifts/${giftId}/request-fields`)).json()) as { requirements: Requirement[] }).requirements;
const manifest = async () => (await (await page.request.get(`/api/events/${eventId}/gifts/${giftId}/fulfillment`)).json()) as Manifest;

/** Reveals pages of results until the card is on the page. */
async function reveal(card: Locator) {
  for (let i = 0; i < 12 && (await card.count()) === 0; i++) {
    const more = page.getByTestId("show-more");
    if ((await more.count()) === 0) break;
    await more.click();
  }
  await expect(card).toBeVisible({ timeout: 10_000 });
}

async function capture(name: string, target: Page = page) {
  if (!CAPTURE) return;
  await target.screenshot({ path: `${OUT}/${name}.png` });
}

/** The grid cell for one attendee's requirement. */
const cell = (guest: string, key: string) => page.getByTestId("attendees-grid").locator('tr[data-testid="attendee-row"]').filter({ hasText: guest }).locator(`td[data-requirement="${key}"] [data-state]`).first();

function timed(step: string) {
  const started = Date.now();
  return () => timings.push({ step, seconds: Math.round((Date.now() - started) / 100) / 10 });
}

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  organizer = await browserRef.newContext({ viewport: { width: 1440, height: 940 }, recordVideo: { dir: OUT, size: { width: 1440, height: 940 } } });
  page = await organizer.newPage();
  storeCtx = await browserRef.newContext({ viewport: { width: 1440, height: 940 }, recordVideo: { dir: OUT, size: { width: 1440, height: 940 } } });
  storePage = await storeCtx.newPage();
});
test.afterAll(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const organizerVideo = page.video();
  const storeVideo = storePage.video();
  await organizer.close();
  await storeCtx.close();
  await organizerVideo?.saveAs(`${OUT}/acceptance-organizer-${stamp}.webm`);
  await organizerVideo?.delete();
  await storeVideo?.saveAs(`${OUT}/acceptance-store-${stamp}.webm`);
  await storeVideo?.delete();
  writeFileSync(`${OUT}/acceptance-timings.json`, JSON.stringify(timings, null, 2));
  console.log(timings.map((t) => `${t.step}: ${t.seconds}s`).join("\n"));
});

test("1: the organizer publishes the event with a printed name question and the attendees reply", async () => {
  test.setTimeout(LIVE_MS);
  const done = timed("1 create and publish");
  await page.goto("/events/new");
  await caption("1. Create the event with the library's printed name question and the guest list");
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
  // The library's printed name question, the one the crewneck's name field resolves from.
  await page.getByRole("button", { name: "Name for printing", exact: true }).click();
  await expect(page.getByTestId("questions").getByLabel(/^Question \d+$/)).toHaveValue("Name for printing");
  await page.getByTestId("guest-list").fill(ATTENDEES.map((a) => a.display_name).join("\n"));
  await page.getByTestId("publish").click();
  await page.waitForURL(/\/events\/evt_/);
  eventId = page.url().split("/events/")[1];
  await page.goto(`/events/${eventId}?webmcp=polyfill`);
  await expect(page.getByTestId("status")).toHaveText("Published");

  // The attendees reply going with their printed name through the invite page's route; no store field exists yet.
  const snap = await snapshot();
  printedName = snap.definitions.find((d) => d.key === "printed_name")!;
  expect(printedName).toMatchObject({ namespace: "organizer", value_type: "text", label: "Name for printing" });
  for (const a of ATTENDEES) {
    const reply = await page.request.post(`/api/events/${eventId}/rsvp`, { data: { party: { contact: { email: email(a) } }, guests: [{ display_name: a.display_name, status: "going", answers: { [printedName.id]: a.display_name } }] } });
    expect(reply.ok(), await reply.text()).toBe(true);
  }
  const replied = await snapshot();
  expect(replied.guests.filter((g) => g.status === "going")).toHaveLength(ATTENDEES.length);
  cambridge = { id: replied.guests.find((g) => g.display_name === ATTENDEES.at(-1)!.display_name)!.id, name: ATTENDEES.at(-1)!.display_name };
  await caption(`1. Published; ${ATTENDEES.length} attendees replied going with their printed name`);
  await rest();
  done();
});

test("2: the organizer picks the crewneck from a real search and the store's fields reconcile against the RSVP list", async () => {
  test.setTimeout(LIVE_MS * 2);
  const done = timed("2 search and pick");
  await page.getByTestId("tab-experience").click();
  await caption("2. Search the catalog over WebMCP");
  await typeInto(page.getByTestId("sentence"), EVENT.search);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: LIVE_MS });
  const storeResult = page.locator(`[data-testid="result"][data-shop="${SHOP_DOMAIN}"]`).filter({ hasText: /crewneck/i }).first();
  await reveal(storeResult);
  await caption("2. Pick the store's crewneck; the confirm calls the store's get_customization");
  await storeResult.scrollIntoViewIfNeeded();
  await storeResult.click();
  await expect(page.getByTestId("recipients")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("next").click();
  await expect(page.getByTestId("confirm")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("confirm").click();
  await expect(page.getByTestId("gift")).toHaveCount(1, { timeout: 120_000 });
  const crewneck = (await snapshot()).gifts.find((g) => /crewneck/i.test(g.product_title))!;
  giftId = crewneck.id;
  const fields = crewneck.personalization?.fields ?? [];
  expect(fields.map((f) => f.key)).toContain("star_map_location");
  expect(fields.find((f) => f.key === "caption")?.kind).toBe("name");
  captionLabel = fields.find((f) => f.key === "caption")!.label;
  const sizes = [...new Set(crewneck.variants.flatMap((v) => (v.options ?? []).filter((o) => /size/i.test(o.name)).map((o) => o.label)))];
  expect(sizes.length).toBeGreaterThan(1);
  await overlay(page, `get_customization at ${SHOP_DOMAIN}`, [`product ${crewneck.product_title}`, ...fields.map((f) => `• ${f.label} (${f.kind})`), `← ${crewneck.variants.length} variants`], 5000);
  done();

  // Reconciliation before any request: the name field maps to the existing printed name question, the size and the star map fields are questions to create.
  const before = await requirements();
  const byKey = (list: Requirement[], key: string) => list.find((r) => r.key === key)!;
  expect(byKey(before, "caption")).toMatchObject({ source: "definition", definition_id: printedName.id, already: true, mapping: { vendor_field_key: "caption", source: { type: "definition", definition_id: printedName.id } } });
  expect(byKey(before, "variant_size")).toMatchObject({ kind: "variant", source: "question", already: false, question: { value_type: "enum" } });
  expect(byKey(before, "star_map_location")).toMatchObject({ kind: "location", source: "question", already: false, question: { value_type: "text" } });
  expect(before.some((r) => "confirmation" in r)).toBe(false);
  await overlay(page, "reconciliation", [`caption → ${printedName.label} (existing question)`, `variant_size → the Size axis (${sizes.join(" ")})`, "star_map_location → new vendor-namespace field", ...before.filter((r) => !["caption", "variant_size", "star_map_location"].includes(r.key)).map((r) => `${r.key} → ${r.source}`)], 6000);
});

test("3: the request creates the size from the variant axis and the star map field with provenance, and asks only for what the RSVP list lacks", async () => {
  test.setTimeout(LIVE_MS);
  const done = timed("3 request");
  await page.getByTestId("tab-attendees").click();
  await expect(page.locator(`[data-testid="requested-info"][data-gift="${giftId}"]`)).toBeVisible({ timeout: 10_000 });
  await caption("3. The printed name is already on the RSVP list; the size and the star map details are requested");
  await expect(page.getByTestId("requested-field").filter({ hasText: captionLabel })).toHaveAttribute("data-source", "definition");
  await page.getByTestId("request-fields").click();
  await expect(page.getByTestId("requested-field").filter({ hasText: "Size" })).toHaveAttribute("data-source", "definition", { timeout: 10_000 });

  const snap = await snapshot();
  const after = await requirements();
  const def = (key: string) => snap.definitions.find((d) => d.id === after.find((r) => r.key === key)?.definition_id)!;
  // The size question comes from the variant axis: one choice per size the product sells.
  const size = def("variant_size");
  expect(size.value_type).toBe("enum");
  const sizes = [...new Set((await snapshot()).gifts[0].variants.flatMap((v) => (v.options ?? []).filter((o) => /size/i.test(o.name)).map((o) => o.label)))];
  expect(size.constraints.options?.map((o) => o.label)).toEqual(sizes);
  // The star map location is a vendor-namespace definition naming the store, the product, and the field it came from.
  const location = def("star_map_location");
  expect(location).toMatchObject({ namespace: "vendor", scope: "guest", value_type: "text", required_rule: "going", vendor_field: { key: "star_map_location", kind: "location", vendor_id: SHOP_DOMAIN, product_id: snap.gifts[0].product_id, requirement_id: "star_map_location" } });
  // The printed name stays the library's question and nobody is asked for it again.
  expect(def("caption").id).toBe(printedName.id);
  const rows = snap.requests.filter((r) => r.gift_id === giftId);
  expect(rows).toHaveLength(ATTENDEES.length);
  for (const row of rows) {
    expect(row.definition_ids).not.toContain(printedName.id);
    expect(row.definition_ids).toContain(location.id);
    expect(row.definition_ids).toContain(size.id);
    expect(row.complete).toBe(false);
  }
  await overlay(page, "request_from_attendees", [`variant_size  enum  ${sizes.join(" ")}`, `star_map_location  vendor field of ${SHOP_DOMAIN}`, `${printedName.key}  already answered by every attendee`, `← ${rows.length} request rows without the printed name`], 6000);
  done();
});

test("4: the attendees answer, one with the bare Cambridge; the Procurement reaches ready at N and the organizer approves at N", async () => {
  test.setTimeout(LIVE_MS * 2);
  const done = timed("4 answers and approval");
  const snap = await snapshot();
  const asked = snap.definitions.filter((d) => d.scope === "guest" && d.required_rule === "going" && d.key !== "printed_name");
  const answer = (d: Definition, a: Attendee): unknown => {
    if (d.key === "variant_size") return d.constraints.options?.find((o) => o.label.toLowerCase() === a.size.toLowerCase())?.value ?? d.constraints.options?.[0]?.value;
    if (d.key === "star_map_location") return a.location;
    if (d.key === "star_map_time") return a.time;
    if (d.value_type === "enum") return d.constraints.options?.[0]?.value;
    if (d.value_type === "multi_enum") return d.constraints.options?.[0] ? [d.constraints.options[0].value] : [];
    return a.display_name;
  };
  await caption(`4. The attendees answer through the RSVP route; ${cambridge.name} gives "${CORRECTION.given}"`);
  for (const a of ATTENDEES) {
    const guest = snap.guests.find((g) => g.display_name === a.display_name)!;
    const patched = await page.request.patch(`/api/events/${eventId}/rsvp/${guest.id}`, { data: { answers: Object.fromEntries(asked.map((d) => [d.id, answer(d, a)])) } });
    expect(patched.ok(), await patched.text()).toBe(true);
  }
  await expect(page.getByTestId("attendee-row")).toHaveCount(ATTENDEES.length, { timeout: 10_000 });
  await expect(page.getByTestId("attendees-grid").locator('[data-state="missing"]')).toHaveCount(0, { timeout: 10_000 });
  await expect(cell(cambridge.name, CORRECTION.requirement)).toHaveText(CORRECTION.given);
  const state = page.getByTestId("procurement-state");
  await expect(state).toHaveAttribute("data-status", "ready", { timeout: 10_000 });
  const ready = Number(await state.getAttribute("data-current"));
  await caption(`4. Every row resolves; the Procurement is ready at revision ${ready}`);
  await rest(2500);

  await page.getByTestId("approve-send").scrollIntoViewIfNeeded();
  await page.getByTestId("approve-send").click();
  await expect(page.getByTestId("specs-approved")).toBeVisible({ timeout: 25_000 });
  await expect(state).toHaveAttribute("data-status", "approved", { timeout: 10_000 });
  approvedAt = Number(await page.getByTestId("approval-revision").getAttribute("data-approved"));
  expect(approvedAt).toBeGreaterThanOrEqual(ready);
  await expect(state).toHaveAttribute("data-approved", String(approvedAt));
  expect((await manifest()).approved_revision).toBe(approvedAt);
  await caption(`4. Approved at revision ${approvedAt}; the store fills the cart`);
  await expect(page.getByTestId("review-cart")).toBeVisible({ timeout: 180_000 });
  expect((await snapshot()).gifts[0].cart_fill?.status).toBe("done");
  done();
});

test("5: the organizer creates store access and the store's agent reads a manifest cut to the attendee reference and the requirement values", async () => {
  test.setTimeout(LIVE_MS);
  const done = timed("5 store access and manifest");
  await caption("5. Create store access: a grant for the store and a signed link");
  const block = page.getByTestId("share-block");
  await block.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("share-store")).toHaveValue(SHOP_DOMAIN);
  await page.getByTestId("share-create").click();
  const grant = page.getByTestId("share-grant");
  await expect(grant).toHaveAttribute("data-status", "active", { timeout: 10_000 });
  await page.getByTestId("share-grants").scrollIntoViewIfNeeded();
  await capture("17-store-access");
  const link = (await page.getByTestId("share-copy").getAttribute("data-link"))!;
  expect(link).toMatch(/^\/s\//);
  await rest();

  // The store's browser: the signed link sets the store session and lands on the grant's page; the polyfill registers the grant's tools.
  await storePage.goto(link);
  await expect(storePage.getByTestId("store-product")).toContainText(/crewneck/i);
  const grantId = new URL(storePage.url()).pathname.split("/store/")[1];
  await storePage.goto(`/store/${grantId}?webmcp=polyfill`);
  await expect(storePage.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  await captionOn(storePage, "The store's agent opens the signed link; the page registers the grant's tools over WebMCP");
  const tools = await storePage.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name).sort());
  expect(tools).toEqual(["get_changes", "get_fulfillment_manifest", "get_manifest", "get_procurement", "get_requirements", "get_updates", "post_procurement_update", "post_update"]);

  const read = await storeTool<Manifest>("get_fulfillment_manifest", { procurement_id: giftId });
  expect(read.approved_revision).toBe(approvedAt);
  expect(read.attendees).toHaveLength(ATTENDEES.length);
  const requirementKeys = ["caption", "star_map_location", "star_map_time", "variant_size"];
  for (const row of read.attendees) {
    expect(Object.keys(row.values).sort()).toEqual(requirementKeys);
    expect(row.status).toBe("ready");
    const attendee = ATTENDEES.find((a) => a.display_name === row.values.caption)!;
    expect(attendee, `row ${row.attendee_ref} carries a printed name`).toBeTruthy();
    expect(row.values.star_map_location).toBe(attendee.location);
    // The reference is the guest id and nothing else about the person travels: no email and no display name outside the printed name value.
    expect(row.attendee_ref).toMatch(/^guest_/);
    expect(JSON.stringify(row)).not.toContain("@");
  }
  expect(Object.keys(read.attendees[0])).toEqual(["attendee_ref", "status", "variant_id", "values", "issues"]);
  writeFileSync(`${OUT}/acceptance-manifest.json`, JSON.stringify(read, null, 2));
  await overlay(storePage, "get_fulfillment_manifest", [`revision ${read.revision}  approved ${read.approved_revision}`, ...read.attendees.map((a) => `• ${a.attendee_ref}  ${a.status}  ${requirementKeys.map((k) => `${k}=${a.values[k]}`).join("  ")}`)], 6000);
  await storePage.getByTestId("store-manifest").scrollIntoViewIfNeeded();
  await capture("18-store-manifest", storePage);
  done();
});

test("6: the store posts needs_information on the Cambridge attendee and the organizer's grid shows the exception", async () => {
  test.setTimeout(LIVE_MS);
  const done = timed("6 exception");
  const read = await storeTool<Manifest>("get_fulfillment_manifest", { procurement_id: giftId });
  const row = read.attendees.find((a) => a.values.star_map_location === CORRECTION.given)!;
  expect(row.attendee_ref).toBe(cambridge.id);
  await captionOn(storePage, `The store's agent posts needs_information on ${row.attendee_ref} for ${CORRECTION.requirement}`);
  const posted = await storeTool<{ current_revision: number; procurement_status: string; exception: { id: string } | null }>("post_procurement_update", { procurement_id: giftId, type: "needs_information", attendee_ref: row.attendee_ref, requirement_id: CORRECTION.requirement, message: CORRECTION.message });
  expect(posted.current_revision).toBeGreaterThan(approvedAt);
  expect(posted.exception).not.toBeNull();
  await storePage.reload();
  await expect(storePage.getByTestId("store-exception")).toHaveCount(1);
  await expect(storePage.locator(`[data-testid="store-manifest-row"][data-attendee="${row.attendee_ref}"]`)).toHaveAttribute("data-status", "exception");

  // The organizer's side: the attendee's cell reads missing with the store's question, the exception carries the correction request, and the Procurement left ready.
  await caption(`6. The store asks about "${CORRECTION.given}"; the grid marks the attendee and the correction request goes out`);
  await page.getByTestId("attendees-grid").scrollIntoViewIfNeeded();
  await expect(cell(cambridge.name, CORRECTION.requirement)).toHaveAttribute("data-state", "missing", { timeout: 15_000 });
  await expect(cell(cambridge.name, CORRECTION.requirement)).toContainText(CORRECTION.message);
  const exception = page.locator(`[data-testid="exception"][data-attendee="${cambridge.id}"]`);
  await expect(exception).toHaveAttribute("data-status", "open");
  await expect(exception).toHaveAttribute("data-correction", "sent");
  await expect(exception.getByTestId("exception-message")).toHaveText(CORRECTION.message);
  await expect(page.getByTestId("procurement-state")).not.toHaveAttribute("data-status", "ready");
  expect((await manifest()).attendees.find((a) => a.attendee_ref === cambridge.id)?.status).toBe("exception");
  await page.getByTestId("exceptions").scrollIntoViewIfNeeded();
  await capture("19-exception");
  await rest(2500);
  done();
});

test("7: the attendee corrects the value through the reply link, the store reads the change after N, and the re-approval refills the cart", async () => {
  test.setTimeout(LIVE_MS * 2);
  const done = timed("7 correction and re-approval");
  const snap = await snapshot();
  const attendee = await browserRef.newContext({ viewport: { width: 1440, height: 940 } });
  try {
    const reply = await attendee.newPage();
    await reply.goto(`/i/${snap.event.invite_code}?guest=${cambridge.id}`);
    const input = reply.getByTestId(`answer-${CORRECTION.requirement}`).locator("input");
    await expect(input).toHaveValue(CORRECTION.given, { timeout: 10_000 });
    await input.fill(CORRECTION.corrected);
    await reply.getByTestId("send").click();
    await expect(reply.getByTestId("saved")).toBeVisible({ timeout: 10_000 });
  } finally {
    await attendee.close();
  }
  await caption(`7. ${cambridge.name} saves "${CORRECTION.corrected}" through the reply link; the exception resolves`);
  const exception = page.locator(`[data-testid="exception"][data-attendee="${cambridge.id}"]`);
  await expect(exception).toHaveAttribute("data-status", "resolved", { timeout: 15_000 });
  await expect(exception).toHaveAttribute("data-correction", "answered");
  await expect(cell(cambridge.name, CORRECTION.requirement)).toHaveAttribute("data-state", "changed_after_approval");
  await expect(cell(cambridge.name, CORRECTION.requirement)).toContainText(CORRECTION.corrected);
  await expect(page.getByTestId("approval-stale")).toBeVisible();
  await expect(page.getByTestId("re-approve")).toBeVisible();

  // The store's agent reads what changed since the revision it approved: the exception, the answer, and its resolution.
  const changes = await storeTool<{ from_revision: number; current_revision: number; changes: Change[] }>("get_changes", { procurement_id: giftId, after_revision: approvedAt });
  expect(changes.from_revision).toBe(approvedAt);
  expect(changes.changes.every((c) => c.revision > approvedAt)).toBe(true);
  expect(changes.changes.some((c) => c.type === "exception_opened" && c.attendee_ref === cambridge.id && c.requirement_id === CORRECTION.requirement)).toBe(true);
  expect(changes.changes.some((c) => c.type === "exception_resolved" && c.attendee_ref === cambridge.id)).toBe(true);
  const corrected = await storeTool<Manifest>("get_fulfillment_manifest", { procurement_id: giftId });
  expect(corrected.attendees.find((a) => a.attendee_ref === cambridge.id)).toMatchObject({ status: "ready", values: { star_map_location: CORRECTION.corrected } });
  writeFileSync(`${OUT}/acceptance-changes.json`, JSON.stringify(changes, null, 2));
  await captionOn(storePage, `get_changes after revision ${approvedAt}: ${changes.changes.length} changes; the manifest now reads "${CORRECTION.corrected}"`);
  await overlay(storePage, `get_changes after_revision ${approvedAt}`, changes.changes.map((c) => `• ${c.revision}  ${c.type}  ${c.summary}`), 6000);

  // The organizer approves the new revision and the store fills the cart again with the corrected line.
  await caption("7. The approval is stale; the organizer re-approves and the store refills the cart");
  await page.getByTestId("re-approve").scrollIntoViewIfNeeded();
  await page.getByTestId("re-approve").click();
  await expect(page.getByTestId("approval-stale")).toHaveCount(0, { timeout: 15_000 });
  const again = Number(await page.getByTestId("approval-revision").getAttribute("data-approved"));
  expect(again).toBeGreaterThan(changes.current_revision - 1);
  const cartLink = page.getByTestId("review-cart");
  await expect(cartLink).toBeVisible({ timeout: 180_000 });
  const gift = (await snapshot()).gifts[0];
  expect(gift.cart_fill?.status).toBe("done");
  expect(gift.checkout_url).toContain("/cart/c/");
  await overlay(page, `add_customized_to_cart at ${SHOP_DOMAIN}`, [`${ATTENDEES.length} items, one per attendee`, ...ATTENDEES.map((a) => `• ${a.display_name}: ${a.size}, ${a.display_name === cambridge.name ? CORRECTION.corrected : a.location}`), `← checkout_url ${gift.checkout_url!.split("?")[0]}`], 5500);
  await page.getByTestId("exceptions").scrollIntoViewIfNeeded();
  await capture("20-corrected");
  await caption(`7. Approved at revision ${again}; the cart at ${SHOP_DOMAIN} holds the corrected line`);
  await rest(2500);

  const fresh = await browserRef.newContext({ viewport: { width: 1440, height: 940 } });
  try {
    const checkout = await fresh.newPage();
    await checkout.goto(gift.checkout_url!, { waitUntil: "domcontentloaded" });
    for (const a of ATTENDEES) await expect(checkout.locator("body")).toContainText(a.display_name, { timeout: 60_000 });
  } finally {
    await fresh.close();
  }
  done();
});
