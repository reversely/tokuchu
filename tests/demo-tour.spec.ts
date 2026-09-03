/**
 * The guided tour run live: a fresh browser opens `/demo?autoplay=1`, the tour drives the dashboard
 * through the search, the three picks, the requests, the replies, the approvals, the store's side
 * (the access grant, the manifest read and the exception posted through the store page's tools in
 * the inline frame, the attendee's correction, and the re-approval) on its own, and ends with a
 * checkout link per gift. The crewneck's link opens in another fresh browser with one line per
 * attendee, and the mug's and the food's links are on the gifts. Gated on LIVE_CUSTOMILY=1; needs
 * the dev server with CUSTOMILY_SHOP_URL and OPENAI_API_KEY.
 */
import { expect, test } from "@playwright/test";
import { DEMO_ATTENDEES, DEMO_CORRECTION, DEMO_GIFT_ORDER } from "../src/demo/seed";
import { demoGifts, STEPS, type TourGift } from "../src/demo/steps";

test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run the live tour.");

const TOUR_MS = 960_000;

test("the tour runs the flow to a checkout link per gift and the store's crewneck cart names every attendee", async ({ browser }) => {
  test.setTimeout(TOUR_MS + 120_000);
  const organizer = await browser.newContext();
  const shopper = await browser.newContext();
  try {
    const page = await organizer.newPage();
    await page.goto("/demo?autoplay=1");
    await expect(page).toHaveURL(/\/events\/[^/?]+\?autoplay=1&t=demo_[^&]+$/);
    const eventId = new URL(page.url()).pathname.split("/")[2];
    await expect(page.getByTestId("tour-autoplay")).toBeChecked();
    await expect(page.getByTestId("tour-narration")).toHaveText(STEPS[0].narration);
    // A step that fails stops the tour; its reason is the only clue, so it goes to the report before the assertion.
    await Promise.race([
      page.locator('[data-testid="tour"][data-step="checkout"]').waitFor({ state: "attached", timeout: TOUR_MS }),
      page.locator('[data-testid="tour"][data-phase="failed"]').waitFor({ state: "attached", timeout: TOUR_MS }).then(async () => {
        throw new Error(`The tour failed at step ${await page.getByTestId("tour").getAttribute("data-step")}: ${await page.getByTestId("tour-error").textContent().catch(() => "")} ${await page.getByTestId("tour-note").textContent().catch(() => "")}`);
      })
    ]);
    await expect(page.getByTestId("tour")).toHaveAttribute("data-step", "checkout", { timeout: TOUR_MS });
    const href = await page.getByTestId("tour-checkout").getAttribute("href");
    expect(href).toContain("/cart/c/");
    await expect(page.getByTestId("tour-checkout-mug")).toHaveAttribute("href", /\/cart\/c\//);
    await expect(page.getByTestId("tour-checkout-food")).toHaveAttribute("href", /^https:\/\//);

    type Snap = { gifts: TourGift[]; grants: { procurement_id: string; status: string }[]; exceptions: { procurement_id: string; requirement_id: string | null; status: string }[]; guests: { display_name: string; values: Record<string, unknown> }[]; definitions: { id: string; key: string }[] };
    const snap = (await (await page.request.get(`/api/events/${eventId}`)).json()) as Snap;
    const gifts = demoGifts(snap.gifts);
    for (const key of DEMO_GIFT_ORDER) expect(gifts[key], key).toMatchObject({ cart_fill: { status: "done" } });
    expect(gifts.crewneck?.cart_lines).toHaveLength(DEMO_ATTENDEES.length);
    expect(gifts.mug?.cart_lines).toHaveLength(DEMO_ATTENDEES.length);

    // The store's side ran: the grant is active, the store's exception on the star map location resolved, the corrected value stands, and the approval is fresh.
    expect(snap.grants.filter((g) => g.procurement_id === gifts.crewneck!.id && g.status === "active")).toHaveLength(1);
    expect(snap.exceptions.filter((e) => e.procurement_id === gifts.crewneck!.id).map((e) => [e.requirement_id, e.status])).toEqual([[DEMO_CORRECTION.requirement, "resolved"]]);
    const location = snap.definitions.find((d) => d.key === DEMO_CORRECTION.requirement)!;
    expect(snap.guests.find((g) => g.display_name === DEMO_CORRECTION.attendee)?.values[location.id]).toBe(DEMO_CORRECTION.corrected);
    expect(gifts.crewneck?.approval).toMatchObject({ stale: false });

    const checkout = await shopper.newPage();
    await checkout.goto(href!, { waitUntil: "domcontentloaded" });
    for (const a of DEMO_ATTENDEES) await expect(checkout.locator("body")).toContainText(a.display_name, { timeout: 60_000 });
  } finally {
    await organizer.close();
    await shopper.close();
  }
});
