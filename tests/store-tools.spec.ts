/**
 * The store-scoped tools through Chrome's polyfill (#48): the store page registers the tools its
 * grant allows, bound to the MCP endpoint under the grant's token; an organizer-only tool never
 * registers, and a grant without updates:write registers no post tool.
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
const toolNames = (page: Page) => page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name).sort());

const EVENT = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const GIFT = {
  product_id: "gid://shopify/Product/1",
  shop_domain: "springbuilt.myshopify.com",
  product_title: "Customized Crewneck",
  variants: [
    { id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] },
    { id: "v-l", title: "L", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "L" }] }
  ],
  personalization: { fields: [{ key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} }] },
  default_variant_id: "v-m"
};

async function seed(request: APIRequestContext) {
  const { id } = (await (await request.post("/api/events", { data: EVENT })).json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);
  const gift = (await (await request.post(`/api/events/${id}/gifts`, { data: GIFT })).json()) as { id: string };
  await request.post(`/api/events/${id}/gifts/${gift.id}/request-fields`);
  const { definitions } = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: { id: string; key: string }[] };
  const size = definitions.find((d) => d.key === "variant_size")!;
  const reply = (await (await request.post(`/api/events/${id}/rsvp`, { data: { guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "l" } }] } })).json()) as { guest_ids: string[] };
  return { id, giftId: gift.id, guestId: reply.guest_ids[0] };
}

async function open(page: Page, request: APIRequestContext, id: string, body: Record<string, unknown>) {
  const grant = (await (await request.post(`/api/events/${id}/grants`, { data: body })).json()) as { id: string; link: string };
  await page.goto(grant.link);
  await page.goto(`/store/${grant.id}?webmcp=polyfill`);
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  return grant;
}

test("the store page registers the grant's tools and each call runs under the grant's token", async ({ page, request }) => {
  const { id, giftId, guestId } = await seed(request);
  await open(page, request, id, { procurement_id: giftId, grantee_type: "agent", grantee_id: "store-agent", permissions: ["manifest:read", "requirements:read", "changes:read", "updates:read", "updates:write"] });
  expect(await toolNames(page)).toEqual(["get_changes", "get_fulfillment_manifest", "get_manifest", "get_procurement", "get_requirements", "get_updates", "post_procurement_update", "post_update"]);

  const summary = await execute(page, "get_procurement", { procurement_id: giftId });
  expect(summary.isError).toBe(false);
  expect(JSON.parse(summary.text)).toMatchObject({ procurement_id: giftId, product: { title: "Customized Crewneck" }, status: "collecting" });

  const manifest = await execute(page, "get_fulfillment_manifest", { procurement_id: giftId });
  expect(manifest.isError).toBe(false);
  const { attendees } = JSON.parse(manifest.text) as { attendees: { attendee_ref: string; status: string; values: Record<string, unknown> }[] };
  expect(attendees).toHaveLength(1);
  expect(attendees[0]).toMatchObject({ attendee_ref: guestId, status: "incomplete", values: { variant_size: "l", star_map_location: null } });

  const posted = await execute(page, "post_procurement_update", { procurement_id: giftId, type: "accepted", reference: "PO-7" });
  expect(posted.isError).toBe(false);
  expect(JSON.parse(posted.text)).toMatchObject({ procurement_status: "accepted", update: { kind: "confirmed", reference: "PO-7" } });
  await expect(page.getByTestId("store-status")).toHaveText("accepted");
  await expect(page.getByTestId("store-update")).toHaveAttribute("data-kind", "confirmed");
  const changes = await execute(page, "get_changes", { procurement_id: giftId, after_revision: 0 });
  expect((JSON.parse(changes.text).changes as { type: string; actor_type: string }[]).at(-1)).toMatchObject({ type: "status_changed", actor_type: "vendor" });

  const foreign = await execute(page, "get_fulfillment_manifest", { procurement_id: "gift_other" });
  expect(foreign.isError).toBe(true);
});

test("a read-only grant registers no post tool and never an organizer tool", async ({ page, request }) => {
  const { id, giftId } = await seed(request);
  await open(page, request, id, { procurement_id: giftId, grantee_type: "vendor", grantee_id: "springbuilt.myshopify.com", permissions: ["manifest:read", "updates:read"] });
  const names = await toolNames(page);
  expect(names).toEqual(["get_fulfillment_manifest", "get_manifest", "get_procurement", "get_updates"]);
  for (const organizerOnly of ["approve_specs", "request_from_attendees", "list_guests", "set_gift_plan", "search_gifts"]) expect(names).not.toContain(organizerOnly);
  await expect(page.getByTestId("store-post")).toHaveCount(0);
});
