/**
 * The invite's submit_rsvp tool through Chrome's polyfill (PRD Section 7): an attendee's agent reads
 * the questions as a schema and answers through executeTool.
 */
import { expect, test, type Page } from "@playwright/test";

type Ctx = { getTools(): Promise<{ name: string; inputSchema: { properties: Record<string, unknown>; required: string[] } }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
async function execute(page: Page, args: Record<string, unknown>) {
  return page.evaluate(async (args) => {
    const ctx = document.modelContext as unknown as Ctx;
    const tool = (await ctx.getTools()).find((t) => t.name === "submit_rsvp");
    if (!tool) throw new Error("submit_rsvp is not registered");
    const result = await ctx.executeTool(tool, args);
    return { text: result.content[0]?.text ?? "", isError: result.isError === true };
  }, args);
}

test("the invite registers submit_rsvp with the requested questions; a call records the answers and an answer over the limit is an error", async ({ page, request }) => {
  const created = await request.post("/api/events", { data: { title: "Test event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } } });
  const { id } = (await created.json()) as { id: string };
  const snap = (await (await request.get(`/api/events/${id}`)).json()) as { definitions: { key: string }[] };
  const kept = snap.definitions.filter((d) => d.key !== "printed_name");
  await request.put(`/api/events/${id}/definitions`, {
    data: {
      definitions: [
        ...kept,
        { key: "name_on_map", label: "Name on the map", scope: "guest", value_type: "text", constraints: { max_length: 20 }, required_rule: "going" },
        { key: "variant_size", label: "Size", scope: "guest", value_type: "enum", constraints: { options: [{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }] }, required_rule: "going" }
      ]
    }
  });
  const published = (await (await request.post(`/api/events/${id}/publish`)).json()) as { event: { invite_code: string } };

  await page.goto(`/i/${published.event.invite_code}?webmcp=polyfill`);
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const tools = await page.evaluate(async () => (await (document.modelContext as unknown as Ctx).getTools()).map((t) => ({ name: t.name, schema: t.inputSchema })));
  expect(tools.map((t) => t.name)).toEqual(["submit_rsvp"]);
  const { schema } = tools[0];
  expect(schema.properties.name_on_map).toMatchObject({ type: "string", maxLength: 20 });
  expect(schema.properties.variant_size).toMatchObject({ type: "string", enum: ["s", "m", "l"] });
  expect(schema.properties.status).toMatchObject({ enum: ["going", "maybe", "cant_go"] });
  expect(schema.required).toEqual(expect.arrayContaining(["display_name", "status", "name_on_map", "variant_size"]));

  const recorded = await execute(page, { display_name: "Maya", status: "going", name_on_map: "Maya M.", variant_size: "m" });
  expect(recorded.isError).toBe(false);
  const reply = JSON.parse(recorded.text) as { guest_id: string; status: string; answers: Record<string, unknown> };
  expect(reply.guest_id).toMatch(/^guest_/);
  expect(reply.answers).toMatchObject({ name_on_map: "Maya M.", variant_size: "m" });

  const guests = (await (await request.get(`/api/events/${id}`)).json()) as { guests: { id: string; display_name: string; status: string; values: Record<string, unknown> }[] };
  expect(guests.guests).toHaveLength(1);
  expect(guests.guests[0]).toMatchObject({ id: reply.guest_id, display_name: "Maya", status: "going" });
  expect(Object.values(guests.guests[0].values)).toEqual(expect.arrayContaining(["Maya M.", "m"]));

  // The returned guest id edits the same record; the edit shows on the dashboard.
  const edited = await execute(page, { guest_id: reply.guest_id, display_name: "Maya", status: "going", variant_size: "l" });
  expect(edited.isError).toBe(false);
  await page.goto(`/events/${id}`);
  await page.getByTestId("tab-attendees").click();
  await expect(page.getByTestId("attendees-grid")).toContainText("L");

  await page.goto(`/i/${published.event.invite_code}?webmcp=polyfill`);
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const tooLong = await execute(page, { guest_id: reply.guest_id, display_name: "Maya", status: "going", name_on_map: "A".repeat(25) });
  expect(tooLong.isError).toBe(true);
  expect(JSON.parse(tooLong.text)).toMatchObject({ status: 400 });
  expect(JSON.parse(tooLong.text).error).toContain("20");
});
