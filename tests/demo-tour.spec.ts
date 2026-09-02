/**
 * The guided tour run live: a fresh browser opens `/demo?autoplay=1`, the tour drives the dashboard
 * through the search, the pick, the request, the replies, and the approval on its own, and the
 * checkout link it ends on opens in another fresh browser with one line per attendee. Gated on
 * LIVE_CUSTOMILY=1; needs the dev server with CUSTOMILY_SHOP_URL and OPENAI_API_KEY.
 */
import { expect, test } from "@playwright/test";
import { DEMO_ATTENDEES } from "../src/demo/seed";
import { STEPS } from "../src/demo/steps";

test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run the live tour.");

const TOUR_MS = 240_000;

test("the tour runs the flow to the checkout link and the store's cart names every attendee", async ({ browser }) => {
  test.setTimeout(TOUR_MS + 120_000);
  const organizer = await browser.newContext();
  const shopper = await browser.newContext();
  try {
    const page = await organizer.newPage();
    await page.goto("/demo?autoplay=1");
    await expect(page).toHaveURL(/\/events\/[^/?]+\?demo=1&t=demo_[^&]+&autoplay=1$/);
    await expect(page.getByTestId("tour-autoplay")).toBeChecked();
    await expect(page.getByTestId("tour-narration")).toHaveText(STEPS[0].narration);
    await expect(page.getByTestId("tour")).toHaveAttribute("data-step", "checkout", { timeout: TOUR_MS });
    const href = await page.getByTestId("tour-checkout").getAttribute("href");
    expect(href).toContain("/cart/c/");

    const checkout = await shopper.newPage();
    await checkout.goto(href!, { waitUntil: "domcontentloaded" });
    for (const a of DEMO_ATTENDEES) await expect(checkout.locator("body")).toContainText(a.display_name, { timeout: 60_000 });
  } finally {
    await organizer.close();
    await shopper.close();
  }
});
