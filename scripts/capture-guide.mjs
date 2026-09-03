/**
 * Captures the screens the user guide (docs/guide.md) shows, in the order an organizer meets them,
 * against a dev server on GUIDE_BASE (default http://localhost:3119) with no database, where every
 * request runs as the local organizer. The search, the store's get_customization, and the cart fill
 * are live, so the run needs the network and the demo store. Output: docs/media/guide/*.png.
 *
 *   node scripts/capture-guide.mjs
 */
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.GUIDE_BASE ?? "http://localhost:3119";
const OUT = "docs/media/guide";
const EVENT = JSON.parse(readFileSync("docs/demo-event.json", "utf8"));
const ATTENDEES = JSON.parse(readFileSync("tests/fixtures/demo-attendees.json", "utf8")).attendees;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const shot = async (name, opts = {}) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log("captured", name);
};

// Sign-in, the events list, and the form.
await page.goto(`${BASE}/sign-in`);
await shot("01-sign-in", { fullPage: true });
await page.goto(`${BASE}/events`);
await shot("02-your-events");
await page.goto(`${BASE}/events/new`);
await page.getByTestId("title").fill(EVENT.title);
await page.getByTestId("starts_at").fill(EVENT.starts_at);
await page.getByTestId("host").fill(EVENT.host);
await page.getByTestId("venue_name").fill(EVENT.venue.name);
await page.getByTestId("line1").fill(EVENT.venue.line1);
await page.getByTestId("city").fill(EVENT.venue.city);
await page.getByTestId("region").fill(EVENT.venue.region);
await page.getByTestId("postal_code").fill(EVENT.venue.postal_code);
await page.getByTestId("country").fill(EVENT.venue.country);
await page.getByTestId("spots").fill(EVENT.spots);
await page.getByTestId("deadline").fill(EVENT.deadline);
await page.getByTestId("needed_by").fill(EVENT.needed_by);
await shot("03-new-event", { fullPage: true });
await page.getByTestId("publish").click();
await page.waitForURL(/\/events\/evt_/);
const eventId = page.url().split("/events/")[1].split("?")[0];
await page.goto(`${BASE}/events/${eventId}?webmcp=polyfill`);
await page.getByTestId("status").waitFor();
await page.getByTestId("webmcp-status").waitFor();
await shot("04-overview");

// The invite as an attendee sees it, with the email field.
const snap0 = await (await page.request.get(`${BASE}/api/events/${eventId}`)).json();
const invite = `${BASE}/i/${snap0.event.invite_code}`;
const guestPage = await ctx.newPage();
await guestPage.goto(invite);
await guestPage.getByTestId("guest-name").fill(ATTENDEES[0].display_name);
await guestPage.getByTestId("guest-email").fill("attendee@example.com");
await guestPage.getByTestId("status").getByRole("button", { name: "Going" }).click();
await guestPage.waitForTimeout(500);
await guestPage.screenshot({ path: `${OUT}/05-invite.png`, fullPage: true });
console.log("captured 05-invite");
await guestPage.close();

// The search over WebMCP and its funnel.
await page.getByTestId("tab-experience").click();
await page.getByTestId("sentence").fill(EVENT.search);
await page.getByRole("button", { name: "Search", exact: true }).click();
await page.getByTestId("results").waitFor({ timeout: 240_000 });
await page.getByTestId("result").first().waitFor();
const storeResult = page.getByTestId("result").filter({ hasText: "Customworks" }).first();
for (let i = 0; i < 6 && (await storeResult.count()) === 0; i++) await page.getByTestId("show-more").click().catch(() => undefined);
await storeResult.waitFor({ timeout: 10_000 });
await page.getByTestId("funnel").scrollIntoViewIfNeeded();
await shot("06-search-funnel");
await storeResult.scrollIntoViewIfNeeded();
await shot("07-search-results");

// Picking the store's product, the recipients and variants steps, and the gift with the store's fields.
await storeResult.click();
await page.getByTestId("recipients").waitFor({ timeout: 10_000 });
await shot("08-recipients");
await page.getByTestId("next").click();
await page.getByTestId("confirm").waitFor({ timeout: 10_000 });
await shot("09-variants");
await page.getByTestId("confirm").click();
await page.getByTestId("gift").waitFor({ timeout: 180_000 });
await shot("10-gift-with-customization");

// The request to attendees, the records grid, the routing, and the approval.
await page.getByTestId("tab-attendees").click();
await page.getByTestId("requested-info").waitFor({ timeout: 10_000 });
await page.getByTestId("requested-field").filter({ hasText: "Size" }).waitFor({ timeout: 10_000 });
await shot("11-requested-fields");
await page.getByTestId("request-fields").click();
await page.getByTestId("requested-field").filter({ hasText: "Size" }).and(page.locator('[data-source="definition"]')).waitFor({ timeout: 10_000 });
await page.waitForTimeout(1500);
await shot("12-request-sent");

const snap = await (await page.request.get(`${BASE}/api/events/${eventId}`)).json();
const def = (key) => snap.definitions.find((d) => d.key === key);
const sizeDef = def("variant_size");
const sizeValue = (label) => sizeDef.constraints.options?.find((o) => o.label.toLowerCase() === label.toLowerCase())?.value ?? sizeDef.constraints.options?.[0]?.value;
const rsvp = await page.request.post(`${BASE}/api/events/${eventId}/rsvp`, { data: { party: { contact: { email: "attendees@example.com" } }, guests: ATTENDEES.map((a) => ({ display_name: a.display_name, status: "going", answers: { [sizeDef.id]: sizeValue(a.size), [def("star_map_location").id]: a.location, [def("star_map_time").id]: a.time } })) } });
if (!rsvp.ok()) throw new Error(await rsvp.text());
await page.reload();
await page.getByTestId("tab-attendees").click();
await page.getByTestId("attendee-row").first().waitFor({ timeout: 10_000 });
await page.getByTestId("attendees-grid").scrollIntoViewIfNeeded();
await shot("13-records-grid");
await page.getByTestId("webmcp-routing").scrollIntoViewIfNeeded();
await shot("14-webmcp-routing");
await page.getByTestId("approve-send").scrollIntoViewIfNeeded();
await page.getByTestId("approve-send").click();
await page.getByTestId("specs-approved").waitFor({ timeout: 25_000 });
const cartLink = page.getByTestId("review-cart");
await cartLink.waitFor({ timeout: 180_000 });
await cartLink.scrollIntoViewIfNeeded();
await shot("15-approved-cart-link");
const checkoutUrl = await cartLink.getAttribute("href");

// The store's cart, one line per attendee.
const store = await ctx.newPage();
await store.goto(checkoutUrl, { waitUntil: "domcontentloaded" });
await store.waitForTimeout(4000);
await store.screenshot({ path: `${OUT}/16-store-cart.png` });
console.log("captured 16-store-cart");
await browser.close();
