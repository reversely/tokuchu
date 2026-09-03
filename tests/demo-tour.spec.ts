/**
 * The guided tour run live: a fresh browser opens `/demo?autoplay=1`, the tour drives the dashboard
 * through the search, the three picks, the requests, the replies, and the approvals on its own, and
 * ends with a checkout link per gift. The crewneck's link opens in another fresh browser with one line
 * per attendee, and the mug's and the food's links are on the gifts. Gated on LIVE_CUSTOMILY=1; needs
 * the dev server with CUSTOMILY_SHOP_URL and OPENAI_API_KEY.
 */
import { expect, test } from "@playwright/test";
import { DEMO_ATTENDEES, DEMO_GIFT_ORDER } from "../src/demo/seed";
import { demoGifts, STEPS, type TourGift } from "../src/demo/steps";

test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run the live tour.");

const TOUR_MS = 720_000;

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
    await expect(page.getByTestId("tour")).toHaveAttribute("data-step", "checkout", { timeout: TOUR_MS });
    const href = await page.getByTestId("tour-checkout").getAttribute("href");
    expect(href).toContain("/cart/c/");
    await expect(page.getByTestId("tour-checkout-mug")).toHaveAttribute("href", /\/cart\/c\//);
    await expect(page.getByTestId("tour-checkout-food")).toHaveAttribute("href", /^https:\/\//);

    const snap = (await (await page.request.get(`/api/events/${eventId}`)).json()) as { gifts: TourGift[] };
    const gifts = demoGifts(snap.gifts);
    for (const key of DEMO_GIFT_ORDER) expect(gifts[key], key).toMatchObject({ cart_fill: { status: "done" } });
    expect(gifts.crewneck?.cart_lines).toHaveLength(DEMO_ATTENDEES.length);
    expect(gifts.mug?.cart_lines).toHaveLength(DEMO_ATTENDEES.length);

    const checkout = await shopper.newPage();
    await checkout.goto(href!, { waitUntil: "domcontentloaded" });
    for (const a of DEMO_ATTENDEES) await expect(checkout.locator("body")).toContainText(a.display_name, { timeout: 60_000 });
  } finally {
    await organizer.close();
    await shopper.close();
  }
});
