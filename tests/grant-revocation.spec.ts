/**
 * A revoke mid-session: the store page is open with its tools registered and one call answered,
 * the organizer revokes the grant, and the next tool call, the page's own form, and a reload each
 * answer with the revocation. A fulfilled order does the same through the grant's expiry.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
async function execute(page: Page, name: string, args: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, args }) => {
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      return { text: result.content[0]?.text ?? "", isError: result.isError === true };
    },
    { name, args }
  );
}

const EVENT = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const GIFT = {
  product_id: "gid://shopify/Product/1",
  shop_domain: "example-store.myshopify.com",
  product_title: "Customized Crewneck",
  variants: [{ id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] }],
  personalization: { fields: [{ key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} }] },
  default_variant_id: "v-m"
};

async function seed(request: APIRequestContext) {
  const { id } = (await (await request.post("/api/events", { data: EVENT })).json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);
  const gift = (await (await request.post(`/api/events/${id}/gifts`, { data: GIFT })).json()) as { id: string };
  await request.post(`/api/events/${id}/gifts/${gift.id}/request-fields`);
  await request.post(`/api/events/${id}/rsvp`, { data: { guests: [{ display_name: "Avery Chen", status: "going" }] } });
  return { id, giftId: gift.id };
}

async function open(page: Page, request: APIRequestContext, id: string, giftId: string) {
  const grant = (await (await request.post(`/api/events/${id}/grants`, { data: { procurement_id: giftId, grantee_type: "vendor", grantee_id: "example-store.myshopify.com", permissions: ["manifest:read", "updates:read", "updates:write"] } })).json()) as { id: string; link: string };
  await page.goto(grant.link);
  await page.goto(`/store/${grant.id}?webmcp=polyfill`);
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  return grant;
}

test("a revoke ends the open store session: the next tool call errors and the page reloads to not-found", async ({ page, request }) => {
  const { id, giftId } = await seed(request);
  const grant = await open(page, request, id, giftId);
  const first = await execute(page, "get_procurement", { procurement_id: giftId });
  expect(first.isError).toBe(false);

  const revoked = await request.delete(`/api/events/${id}/grants/${grant.id}`);
  expect((await revoked.json()) as { status: string }).toMatchObject({ status: "revoked", link: null });

  const next = await execute(page, "get_procurement", { procurement_id: giftId });
  expect(next.isError).toBe(true);
  expect(JSON.parse(next.text)).toEqual({ error: "The grant behind this token was revoked." });
  const write = await execute(page, "post_procurement_update", { procurement_id: giftId, type: "accepted" });
  expect(write.isError).toBe(true);

  // The page's own form takes the same answer.
  await page.getByTestId("store-message").fill("Received");
  await page.getByTestId("store-submit").click();
  await expect(page.getByTestId("store-error")).toHaveText("The grant behind this token was revoked.");

  await page.reload();
  await expect(page.getByTestId("not-found-title")).toHaveText("Page not found");
  const { grants } = (await (await request.get(`/api/events/${id}/grants?procurement=${giftId}`)).json()) as { grants: { status: string }[] };
  expect(grants.map((g) => g.status)).toEqual(["revoked"]);
  // The status machine records its own moves (draft to collecting); the revoked store's accepted must not have landed as ordered.
  const changes = (await (await request.get(`/api/events/${id}/changes?gift=${giftId}&after=0`)).json()) as { changes: { type: string; actor_type?: string; summary?: string }[] };
  expect(changes.changes.some((c) => c.type === "status_changed" && /ordered/.test(c.summary ?? ""))).toBe(false);
  expect(changes.changes.some((c) => c.actor_type === "vendor" || c.actor_type === "agent")).toBe(false);
});

test("a fulfilled order expires the grant and the store page ends its own session on the post", async ({ page, request }) => {
  const { id, giftId } = await seed(request);
  const grant = await open(page, request, id, giftId);
  const done = await execute(page, "post_procurement_update", { procurement_id: giftId, type: "fulfilled", reference: "TRACK-1" });
  expect(done.isError).toBe(false);
  expect(JSON.parse(done.text)).toMatchObject({ procurement_status: "fulfilled" });
  const changes = (await (await request.get(`/api/events/${id}/changes?gift=${giftId}&after=0`)).json()) as { changes: { type: string; actor_type: string; actor_id?: string }[] };
  expect(changes.changes.at(-1)).toMatchObject({ type: "status_changed", actor_type: "vendor", actor_id: "example-store.myshopify.com" });

  // The page re-reads its view after a post and the expired grant renders not-found, so the tools leave with it.
  await expect(page.getByTestId("not-found-title")).toHaveText("Page not found");
  const { grants } = (await (await request.get(`/api/events/${id}/grants?procurement=${giftId}`)).json()) as { grants: { status: string; link: string | null }[] };
  expect(grants[0]).toMatchObject({ status: "expired", link: null });
  await page.goto(grant.link);
  await expect(page.getByTestId("not-found-title")).toHaveText("Page not found");
});
