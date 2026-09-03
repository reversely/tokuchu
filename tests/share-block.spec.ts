/**
 * The Share fulfilment data block on the Attendees tab: the organizer names the store, keeps the
 * four kinds of access, creates the store access, copies the signed link, and a second browser
 * opens the store page through it. A revoke turns the row Revoked and the same link then lands on
 * the not-found page.
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

/** An event with the crewneck requested from one going attendee. */
async function seed(request: APIRequestContext) {
  const { id } = (await (await request.post("/api/events", { data: EVENT })).json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);
  const gift = (await (await request.post(`/api/events/${id}/gifts`, { data: GIFT })).json()) as { id: string };
  await request.post(`/api/events/${id}/gifts/${gift.id}/request-fields`);
  const { definitions } = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: { id: string; key: string }[] };
  const size = definitions.find((d) => d.key === "variant_size")!;
  await request.post(`/api/events/${id}/rsvp`, { data: { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "l" } }] } });
  return { id, giftId: gift.id };
}

test("the organizer creates store access and copies a link a store opens until the organizer revokes it", async ({ page, request, browser, context, baseURL }) => {
  const { id, giftId } = await seed(request);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`/events/${id}`);
  await page.getByTestId("tab-attendees").click();
  await expect(page.getByTestId("attendee-row")).toHaveCount(1);

  const block = page.getByTestId("share-block");
  await expect(block).toHaveAttribute("data-gift", giftId);
  await expect(page.getByTestId("share-store")).toHaveValue("example-store.myshopify.com");
  for (const key of ["personalization", "manifest", "changes", "updates"]) await expect(page.getByTestId(`share-access-${key}`)).toBeChecked();
  await expect(page.getByTestId("share-expiry")).toHaveValue("fulfilment");
  await expect(page.getByTestId("share-grant")).toHaveCount(0);

  await page.getByTestId("share-create").click();
  const grant = page.getByTestId("share-grant");
  await expect(grant).toHaveCount(1);
  await expect(grant).toHaveAttribute("data-status", "active");
  await expect(page.getByTestId("share-grant-store")).toHaveText("example-store.myshopify.com");
  await expect(page.getByTestId("share-grant-status")).toHaveText("Active");
  // The size and the location map to definitions; the caption reads the RSVP name and is no field of the grant.
  await expect(page.getByTestId("share-grant-access")).toHaveText("2 fields1 fulfilment recordthe gift");
  await expect(block).not.toContainText("tok_");

  // The grant behind the row carries every permission and the mapped definitions.
  const { grants } = (await (await request.get(`/api/events/${id}/grants?procurement=${giftId}`)).json()) as { grants: { permissions: string[]; allowed_attribute_ids: string[]; expires_at: string | null; grantee_type: string }[] };
  expect(grants[0]).toMatchObject({ grantee_type: "vendor", expires_at: null });
  expect(grants[0].permissions.sort()).toEqual(["changes:read", "manifest:read", "requirements:read", "updates:read", "updates:write"]);
  expect(grants[0].allowed_attribute_ids).toHaveLength(2);

  if (process.env.CAPTURE) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await block.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/issue-46-share-block.png" });
  }

  const copy = page.getByTestId("share-copy");
  const link = (await copy.getAttribute("data-link"))!;
  expect(link).toMatch(/^\/s\/[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
  await copy.click();
  await expect(copy).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}${link}`);

  const store = await browser.newContext();
  const storePage = await store.newPage();
  await storePage.goto(`${baseURL}${link}`);
  await expect(storePage.getByTestId("store-product")).toHaveText("Customized Crewneck");
  await expect(storePage.getByTestId("store-grantee")).toHaveText("example-store.myshopify.com");
  await expect(storePage.getByTestId("store-manifest-row")).toHaveCount(1);

  await page.getByTestId("share-revoke").click();
  await expect(grant).toHaveAttribute("data-status", "revoked");
  await expect(page.getByTestId("share-grant-status")).toHaveText("Revoked");
  await expect(page.getByTestId("share-copy")).toHaveCount(0);
  await expect(page.getByTestId("share-revoke")).toHaveCount(0);

  await storePage.reload();
  await expect(storePage.getByTestId("not-found-title")).toHaveText("Page not found");
  await storePage.goto(`${baseURL}${link}`);
  await expect(storePage.getByTestId("not-found-title")).toHaveText("Page not found");
  await store.close();
});

test("unchecking the personalization access grants no attendee field and the expiry select sets a date", async ({ page, request }) => {
  const { id, giftId } = await seed(request);
  await page.goto(`/events/${id}`);
  await page.getByTestId("tab-attendees").click();
  await page.getByTestId("share-access-personalization").uncheck();
  await page.getByTestId("share-access-updates").uncheck();
  await page.getByTestId("share-expiry").selectOption("7");
  await page.getByTestId("share-create").click();
  await expect(page.getByTestId("share-grant")).toHaveAttribute("data-status", "active");
  await expect(page.getByTestId("share-grant-access")).toContainText("0 fields");
  const { grants } = (await (await request.get(`/api/events/${id}/grants?procurement=${giftId}`)).json()) as { grants: { permissions: string[]; allowed_attribute_ids: string[]; expires_at: string | null }[] };
  expect(grants[0].permissions.sort()).toEqual(["changes:read", "manifest:read"]);
  expect(grants[0].allowed_attribute_ids).toEqual([]);
  const days = (Date.parse(grants[0].expires_at!) - Date.now()) / (24 * 60 * 60 * 1000);
  expect(days).toBeGreaterThan(6.9);
  expect(days).toBeLessThan(7.1);
});
