/**
 * Approval tied to a revision (#44): the organizer approves on the Attendees tab, an attendee changes an
 * answer through the RSVP endpoint, the tab shows the stale approval with both revisions and a re-approve
 * action, and a re-approval clears it at the new revision. One required question stays unanswered so the
 * cart job settles at once without reaching a store.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

const EVENT = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const GIFT = {
  product_id: "gid://shopify/Product/1",
  shop_domain: "example-store.myshopify.com",
  product_title: "Customized Crewneck",
  variants: [
    { id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] },
    { id: "v-l", title: "L", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "L" }] }
  ],
  personalization: {
    fields: [
      { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
      { key: "star_map_time", label: "Pick a time for Star Map 1", kind: "time", required: true, constraints: {} },
      { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
    ]
  },
  default_variant_id: "v-m"
};

type Definition = { id: string; key: string };

/** An event with the crewneck requested from one going attendee who answered the size and the location but not the time. */
async function seed(request: APIRequestContext) {
  const { id } = (await (await request.post("/api/events", { data: EVENT })).json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);
  const gift = (await (await request.post(`/api/events/${id}/gifts`, { data: GIFT })).json()) as { id: string };
  await request.post(`/api/events/${id}/gifts/${gift.id}/request-fields`);
  const { definitions } = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: Definition[] };
  const size = definitions.find((d) => d.key === "variant_size")!;
  const location = definitions.find((d) => d.key === "star_map_location")!;
  const reply = (await (await request.post(`/api/events/${id}/rsvp`, { data: { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "m", [location.id]: "Toronto" } }] } })).json()) as { guest_ids: string[] };
  return { id, giftId: gift.id, location, guestId: reply.guest_ids[0] };
}

test("an answer after approval shows the stale approval with both revisions until the organizer re-approves", async ({ page, request }) => {
  const { id, giftId, location, guestId } = await seed(request);
  await page.goto(`/events/${id}`);
  await page.getByTestId("tab-attendees").click();
  await expect(page.getByTestId("attendee-row")).toHaveCount(1);

  await page.getByTestId("approve-send").click();
  await expect(page.getByTestId("specs-approved")).toBeVisible();
  const fresh = page.getByTestId("approval-revision");
  await expect(fresh).toBeVisible();
  const approved = Number(await fresh.getAttribute("data-approved"));
  expect(approved).toBeGreaterThan(0);
  await expect(page.getByTestId("re-approve")).toHaveCount(0);

  // The manifest a store's agent reads carries the same approved revision.
  const manifest = async () => (await (await request.get(`/api/events/${id}/gifts/${giftId}/fulfillment`)).json()) as { revision: number; approved_revision: number | null };
  expect((await manifest()).approved_revision).toBe(approved);

  await request.patch(`/api/events/${id}/rsvp/${guestId}`, { data: { answers: { [location.id]: "Calgary" } } });
  const stale = page.getByTestId("approval-stale");
  await expect(stale).toBeVisible({ timeout: 10_000 });
  const current = Number(await stale.getAttribute("data-current"));
  expect(current).toBeGreaterThan(approved);
  await expect(stale).toHaveText(`Approved at revision ${approved}; revision ${current} has changes since`);
  await expect(page.getByTestId("re-approve")).toBeVisible();
  expect(await manifest()).toMatchObject({ approved_revision: approved, revision: current });
  if (process.env.CAPTURE) {
    // The progress capture at 1440 wide with the approve block in view; docs/progress carries the quantized copy.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId("approve-block").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/issue-44-stale-approval.png" });
  }

  await page.getByTestId("re-approve").click();
  await expect(page.getByTestId("approval-stale")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId("approval-revision")).toBeVisible();
  const again = Number(await page.getByTestId("approval-revision").getAttribute("data-approved"));
  expect(again).toBeGreaterThan(current);
  expect((await manifest()).approved_revision).toBe(again);
});
