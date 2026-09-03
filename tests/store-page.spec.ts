/**
 * The store-facing page (#47): the organizer's grant answers with a signed link, the link sets the
 * store session and opens the Procurement with only the granted blocks and definitions, the form
 * posts an update as the grant's actor, and a revoked grant lands on the not-found page.
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

/** An event with the crewneck gift requested from one going attendee, and the size definition's id. */
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

test("the signed link opens the grant's page with only the granted fields; a revoked grant lands on not-found", async ({ page, request }) => {
  const { id, giftId, size, guestId } = await seed(request);
  const created = await request.post(`/api/events/${id}/grants`, { data: { procurement_id: giftId, grantee_type: "vendor", grantee_id: "example-store.myshopify.com", permissions: ["manifest:read", "updates:read", "updates:write"], allowed_attribute_ids: [size.id] } });
  expect(created.status()).toBe(201);
  const grant = (await created.json()) as { id: string; link: string };
  expect(grant.link).toMatch(/^\/s\/[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);

  await page.goto(grant.link);
  await expect(page).toHaveURL(`/store/${grant.id}`);
  const cookie = (await page.context().cookies()).find((c) => c.name === "tokuchu_store");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });

  await expect(page.getByTestId("store-product")).toHaveText("Customized Crewneck");
  await expect(page.getByTestId("store-grantee")).toHaveText("example-store.myshopify.com");
  await expect(page.getByTestId("store-status")).toHaveText("collecting");
  await expect(page.getByTestId("store-schema")).toHaveText("example-store.myshopify.com/gid://shopify/Product/1");
  await expect(page.getByTestId("store-procurement-id")).toHaveText(giftId);
  await expect(page.getByTestId("store-manifest-row")).toHaveCount(1);
  await expect(page.getByTestId("store-manifest-row")).toHaveAttribute("data-attendee", guestId);
  const keys = await page.getByTestId("store-manifest-key").allTextContents();
  expect(keys.sort()).toEqual(["caption", "variant_size"]);
  await expect(page.getByTestId("store-manifest")).not.toContainText("star_map_location");
  await expect(page.getByTestId("store-requirements")).toHaveCount(0);
  await expect(page.getByTestId("store-exceptions")).toContainText("No open exceptions");
  await expect(page.getByTestId("store-updates")).toContainText("No updates posted yet");

  await page.getByTestId("store-type").selectOption("needs_information");
  await page.getByTestId("store-attendee").selectOption(guestId);
  await page.getByTestId("store-requirement-field").selectOption("variant_size");
  await page.getByTestId("store-message").fill("Please confirm the size");
  await page.getByTestId("store-submit").click();
  await expect(page.getByTestId("store-update")).toHaveCount(1);
  await expect(page.getByTestId("store-update")).toHaveAttribute("data-kind", "question");
  await expect(page.getByTestId("store-exception")).toHaveCount(1);
  await expect(page.getByTestId("store-manifest-row")).toHaveAttribute("data-status", "exception");
  const changes = (await (await request.get(`/api/events/${id}/changes?gift=${giftId}&after=0`)).json()) as { changes: { type: string; actor_type: string }[] };
  expect(changes.changes.at(-1)).toMatchObject({ type: "exception_opened", actor_type: "vendor" });

  // A second link opens the same session; a tampered link opens nothing.
  await page.goto(`${grant.link.slice(0, -4)}0000`);
  await expect(page.getByTestId("not-found-title")).toHaveText("Page not found");

  const revoked = await request.delete(`/api/events/${id}/grants/${grant.id}`);
  expect(revoked.ok()).toBe(true);
  await page.goto(`/store/${grant.id}`);
  await expect(page.getByTestId("not-found-title")).toHaveText("Page not found");
  await page.goto(grant.link);
  await expect(page.getByTestId("not-found-title")).toHaveText("Page not found");
});
