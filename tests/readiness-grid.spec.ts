/**
 * The readiness grid (#49): each cell of the Attendees records grid shows the requirement's resolution
 * status from the fulfilment manifest. One attendee's caption exceeds the field's length (invalid),
 * one attendee never gave the star map location (missing), the store posts needs_information on that
 * gap and invalid_value on a third attendee's caption through the MCP tools of a grant (an open
 * exception each and a cell rejected by the store), a re-read schema changes the engraving field
 * (mapping unresolved), the organizer approves and an attendee then changes a value (changed after
 * approval). The Procurement's status and revisions sit above the grid, the legend under it names every
 * state, and the exceptions list carries each correction request's state until an answer resolves one.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const EVENT = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const FIELDS = [
  { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
  { key: "caption", label: "Text 2", kind: "text", required: true, constraints: { max_length: 20 } },
  { key: "engraving", label: "Engraving", kind: "text", required: false, constraints: { max_length: 30 } }
];
const GIFT = {
  product_id: "gid://shopify/Product/1",
  shop_domain: "example-store.myshopify.com",
  product_title: "Customized Crewneck",
  variants: [
    { id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] },
    { id: "v-l", title: "L", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "L" }] }
  ],
  personalization: { fields: FIELDS, schema_id: "example-store.myshopify.com/gid://shopify/Product/1", schema_version: "1" },
  default_variant_id: "v-m"
};

type Definition = { id: string; key: string; constraints: Record<string, unknown> };
type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };

/** Runs one of the store page's WebMCP tools, which the page routes through the event's MCP endpoint under the grant's token. */
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

/** Three going attendees: a caption over the limit, a missing location, and a complete row. */
async function seed(request: APIRequestContext) {
  const { id } = (await (await request.post("/api/events", { data: EVENT })).json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);
  const gift = (await (await request.post(`/api/events/${id}/gifts`, { data: GIFT })).json()) as { id: string };
  await request.post(`/api/events/${id}/gifts/${gift.id}/request-fields`);
  const { definitions } = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: Definition[] };
  // The organizer's question for the caption drops the store's length cap, so an answer over it reaches the manifest and grades invalid there.
  const loosened = await request.put(`/api/events/${id}/definitions`, { data: { definitions: definitions.map((d) => (d.key === "caption" ? { ...d, constraints: {} } : d)) } });
  expect(loosened.ok()).toBe(true);
  const def = (key: string) => definitions.find((d) => d.key === key)!;
  const size = def("variant_size");
  const location = def("star_map_location");
  const caption = def("caption");
  const engraving = def("engraving");
  const reply = async (name: string, answers: Record<string, string>) =>
    ((await (await request.post(`/api/events/${id}/rsvp`, { data: { party: { contact: { email: `${name.toLowerCase()}@b.co` } }, guests: [{ display_name: name, status: "going", answers }] } })).json()) as { guest_ids: string[] }).guest_ids[0];
  await reply("Avery", { [size.id]: "m", [location.id]: "Toronto", [caption.id]: "A caption far longer than twenty", [engraving.id]: "Clear skies" });
  const blair = await reply("Blair", { [size.id]: "l", [caption.id]: "Blair", [engraving.id]: "Clear skies" });
  const casey = await reply("Casey", { [size.id]: "m", [location.id]: "Ottawa", [caption.id]: "Casey", [engraving.id]: "Clear skies" });
  return { id, giftId: gift.id, location, blair, casey };
}

test("the grid shows every requirement state from the manifest with the legend and the exceptions list", async ({ page, request }) => {
  const { id, giftId, location, blair, casey } = await seed(request);

  // The store's agent posts two typed updates through the grant's tools: a question on Blair's location and a rejection of Casey's caption.
  const grant = (await (await request.post(`/api/events/${id}/grants`, { data: { procurement_id: giftId, grantee_type: "vendor", grantee_id: "example-store.myshopify.com", permissions: ["manifest:read", "updates:read", "updates:write"] } })).json()) as { id: string; link: string };
  await page.goto(grant.link);
  await page.goto(`/store/${grant.id}?webmcp=polyfill`);
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const question = await execute(page, "post_procurement_update", { procurement_id: giftId, type: "needs_information", attendee_ref: blair, requirement_id: "star_map_location", message: "Which city is the star map for" });
  expect(question.isError).toBe(false);
  const rejection = await execute(page, "post_procurement_update", { procurement_id: giftId, type: "invalid_value", attendee_ref: casey, requirement_id: "caption", message: "Please give the full name" });
  expect(rejection.isError).toBe(false);

  // A re-read schema changes the engraving field's limit; its mapping waits to be settled again.
  const reread = await request.patch(`/api/events/${id}/gifts/${giftId}`, { data: { personalization: { fields: FIELDS.map((f) => (f.key === "engraving" ? { ...f, constraints: { max_length: 24 } } : f)), schema_id: GIFT.personalization.schema_id, schema_version: "2" } } });
  expect(reread.ok()).toBe(true);

  await page.goto(`/events/${id}`);
  await page.getByTestId("tab-attendees").click();
  await expect(page.getByTestId("attendee-row")).toHaveCount(3);
  const grid = page.getByTestId("attendees-grid");
  await expect(grid).not.toHaveAttribute("data-manifest", "");

  const cell = (guest: string, key: string) => grid.locator(`tr[data-testid="attendee-row"]`).filter({ hasText: guest }).locator(`td[data-requirement="${key}"] [data-state]`).first();
  await expect(cell("Avery", "caption")).toHaveAttribute("data-state", "invalid");
  await expect(cell("Avery", "caption")).toContainText("allows 20 characters");
  await expect(cell("Avery", "star_map_location")).toHaveAttribute("data-state", "resolved");
  await expect(cell("Avery", "star_map_location")).toHaveText("Toronto");
  await expect(cell("Blair", "star_map_location")).toHaveAttribute("data-state", "missing");
  await expect(cell("Blair", "caption")).toHaveAttribute("data-state", "resolved");
  await expect(cell("Casey", "caption")).toHaveAttribute("data-state", "vendor_rejected");
  await expect(cell("Casey", "caption")).toContainText("Please give the full name");
  await expect(cell("Casey", "engraving")).toHaveAttribute("data-state", "mapping_unresolved");

  // The Procurement's status and revisions above the grid.
  const state = page.getByTestId("procurement-state");
  await expect(state).toHaveAttribute("data-status", "collecting");
  await expect(state).toHaveAttribute("data-approved", "");
  await expect(page.getByTestId("procurement-approved")).toHaveText("not approved");

  // The exceptions list: each with the attendee, the requirement, the store's message, and the correction request's state.
  const exceptions = page.getByTestId("exception");
  await expect(exceptions).toHaveCount(2);
  const onBlair = exceptions.filter({ has: page.locator(`[data-testid="exception-attendee"]`, { hasText: "Blair" }) });
  await expect(onBlair.getByTestId("exception-requirement")).toHaveText("Enter Location for Star Map 1");
  await expect(onBlair.getByTestId("exception-message")).toHaveText("Which city is the star map for");
  await expect(onBlair).toHaveAttribute("data-correction", "sent");
  await expect(onBlair.getByTestId("exception-correction")).toHaveText("correction sent");
  const onCasey = exceptions.filter({ has: page.locator(`[data-testid="exception-attendee"]`, { hasText: "Casey" }) });
  await expect(onCasey.getByTestId("exception-message")).toHaveText("Please give the full name");
  await expect(onCasey).toHaveAttribute("data-correction", "sent");

  // Approve, then Casey changes the location: the cell reads changed after approval and the stale warning stays in the approve block.
  await page.getByTestId("approve-send").click();
  await expect(page.getByTestId("specs-approved")).toBeVisible();
  await expect(state).toHaveAttribute("data-status", "approved");
  const approved = Number(await state.getAttribute("data-approved"));
  expect(approved).toBeGreaterThan(0);
  await expect(page.getByTestId("procurement-approved")).toHaveText(`approved at revision ${approved}`);
  await request.patch(`/api/events/${id}/rsvp/${casey}`, { data: { answers: { [location.id]: "Kingston" } } });
  await expect(cell("Casey", "star_map_location")).toHaveAttribute("data-state", "changed_after_approval", { timeout: 10_000 });
  await expect(cell("Casey", "star_map_location")).toContainText("Kingston");
  await expect(page.getByTestId("approval-stale")).toBeVisible();
  await expect(page.getByTestId("re-approve")).toBeVisible();
  const current = Number(await state.getAttribute("data-current"));
  expect(current).toBeGreaterThan(approved);
  await expect(page.getByTestId("procurement-revision")).toHaveText(`revision ${current}`);

  // The legend names each state under the grid.
  const legend = page.getByTestId("records-legend");
  for (const s of ["resolved", "missing", "invalid", "mapping_unresolved", "needs_confirmation", "vendor_rejected", "changed_after_approval"]) await expect(legend.locator(`li[data-state="${s}"]`)).toHaveCount(1);
  await expect(legend.locator(`li[data-state="vendor_rejected"]`)).toContainText("rejected by the store");

  if (process.env.CAPTURE) {
    // The progress capture at 1440 wide with the grid and the exceptions in view; docs/progress carries the quantized copy.
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.getByTestId("attendees").scrollIntoViewIfNeeded();
    await page.getByTestId("attendees").screenshot({ path: "test-results/issue-49-readiness-grid.png" });
  }

  // Blair answers the location: the answer resolves the store's question and the correction reads answered.
  await request.patch(`/api/events/${id}/rsvp/${blair}`, { data: { answers: { [location.id]: "Halifax" } } });
  await expect(cell("Blair", "star_map_location")).toHaveAttribute("data-state", "changed_after_approval", { timeout: 10_000 });
  await expect(onBlair).toHaveAttribute("data-correction", "answered");
  await expect(onBlair).toHaveAttribute("data-status", "resolved");
  await expect(onCasey).toHaveAttribute("data-correction", "sent");
});
