/**
 * The store page's CSV export and the acknowledgement cursor (#52): the grant holder downloads the
 * manifest as CSV with only the granted columns, marks the current revision as seen through the
 * acknowledge_changes tool, and the organizer's Attendees tab reads the revision the store has seen.
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
  personalization: { fields: [{ key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} }, { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }] },
  default_variant_id: "v-m"
};

type Definition = { id: string; key: string };

/** An event with the crewneck requested from one going attendee who answered the size and the location. */
async function seed(request: APIRequestContext) {
  const { id } = (await (await request.post("/api/events", { data: EVENT })).json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);
  const gift = (await (await request.post(`/api/events/${id}/gifts`, { data: GIFT })).json()) as { id: string };
  await request.post(`/api/events/${id}/gifts/${gift.id}/request-fields`);
  const { definitions } = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: Definition[] };
  const size = definitions.find((d) => d.key === "variant_size")!;
  const location = definitions.find((d) => d.key === "star_map_location")!;
  const reply = (await (await request.post(`/api/events/${id}/rsvp`, { data: { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "l", [location.id]: "Vancouver" } }] } })).json()) as { guest_ids: string[] };
  return { id, giftId: gift.id, size, guestId: reply.guest_ids[0] };
}

test("the store page's CSV link downloads the granted columns and the acknowledged revision reaches the organizer", async ({ page, request }) => {
  const { id, giftId, size, guestId } = await seed(request);
  const created = await request.post(`/api/events/${id}/grants`, { data: { procurement_id: giftId, grantee_type: "vendor", grantee_id: "example-store.myshopify.com", permissions: ["manifest:read", "changes:read"], allowed_attribute_ids: [size.id] } });
  const grant = (await created.json()) as { id: string; link: string };

  await page.goto(grant.link);
  await expect(page).toHaveURL(`/store/${grant.id}`);
  await expect(page.getByTestId("store-seen")).toHaveText("none");
  const shown = await page.getByTestId("store-manifest-key").allTextContents();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("store-csv").click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^fulfillment-${giftId}-r\\d+\\.csv$`));
  const text = await (await import("node:fs/promises")).readFile(await download.path(), "utf8");
  const [header, row, trailing] = text.split("\r\n");
  // The page lists the granted keys as the rows carry them; the file lists them in the store's schema order.
  expect([...shown].sort()).toEqual(["caption", "variant_size"]);
  expect(header.split(",")).toEqual(["attendee_ref", "status", "variant_id", "variant_size", "caption", "issues"]);
  expect(header).not.toContain("star_map_location");
  expect(row.split(",")).toEqual([guestId, "ready", "v-l", "l", "Avery Chen", ""]);
  expect(trailing).toBe("");

  // The organizer's CSV through the same projection carries every requirement.
  const mine = await request.get(`/api/events/${id}/gifts/${giftId}/fulfillment.csv`);
  expect(mine.headers()["content-type"]).toContain("text/csv");
  expect((await mine.text()).split("\r\n")[0]).toBe("attendee_ref,status,variant_id,variant_size,star_map_location,caption,issues");

  const revision = Number(await page.getByTestId("store-revision").textContent());
  expect(revision).toBeGreaterThan(0);
  await page.getByTestId("store-ack").click();
  await expect(page.getByTestId("store-seen")).toHaveText(String(revision));
  await expect(page.getByTestId("store-ack-current")).toHaveText("up to date");
  const stored = (await (await request.get(`/api/events/${id}/grants/${grant.id}`)).json()) as { acknowledged_revision: number | null };
  expect(stored.acknowledged_revision).toBe(revision);

  await page.goto(`/events/${id}`);
  await page.getByTestId("tab-attendees").click();
  await expect(page.getByTestId("fulfillment-csv")).toHaveAttribute("href", `/api/events/${id}/gifts/${giftId}/fulfillment.csv`);
  const seen = page.getByTestId("grant-seen");
  await expect(seen).toHaveCount(1);
  await expect(seen).toHaveAttribute("data-seen", String(revision));
  await expect(seen).toHaveText(`example-store.myshopify.com has seen up to revision ${revision}`);
});
