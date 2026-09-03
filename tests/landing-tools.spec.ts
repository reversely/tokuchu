/**
 * The landing tools (the demo's first prompt): the home page registers create_event and add_guests
 * over WebMCP, a browser with no session creates a published event as a demo guest and lands on it
 * through the URL the reply names, and the event page then registers the organizer tools.
 */
import { expect, test, type Page } from "@playwright/test";

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
async function execute(page: Page, name: string, args: Record<string, unknown>) {
  return page.evaluate(async ({ name, args }) => {
    const ctx = document.modelContext as unknown as Ctx;
    const tool = (await ctx.getTools()).find((t) => t.name === name);
    if (!tool) throw new Error(`${name} is not registered`);
    const result = await ctx.executeTool(tool, args);
    return { isError: !!result.isError, text: result.content[0].text };
  }, { name, args });
}

test("the home page registers create_event and add_guests and a session-less browser gets a guest event it owns", async ({ page }) => {
  await page.goto("/?webmcp=polyfill");
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const names = await page.evaluate(async () => (await (document.modelContext as unknown as Ctx).getTools()).map((t) => t.name).sort());
  expect(names).toEqual(["add_guests", "create_event"]);

  const created = await execute(page, "create_event", { title: "Eastern Canada Astronomy Symposium", starts_at: "2027-03-15T19:00:00-04:00", venue: { name: "Ontario Science Centre", city: "Toronto", region: "ON", country: "CA" }, guests: ["Avery Chen <avery@example.com>", "Blake Rivera"] });
  expect(created.isError).toBe(false);
  const reply = JSON.parse(created.text) as { event_id: string; url: string; invite_url: string; guests_added: number };
  expect(reply).toMatchObject({ guests_added: 2 });
  expect(reply.url).toContain(`/events/${reply.event_id}`);

  const more = await execute(page, "add_guests", { event_id: reply.event_id, guests: ["Carmen Diaz", "Blake Rivera"] });
  expect(more.isError).toBe(false);
  expect(JSON.parse(more.text)).toMatchObject({ added: 1 });

  await page.goto(`${reply.url}${reply.url.includes("?") ? "&" : "?"}webmcp=polyfill`);
  await expect(page.getByTestId("webmcp-status")).toHaveAttribute("data-status", "ready", { timeout: 20_000 });
  const eventTools = await page.evaluate(async () => (await (document.modelContext as unknown as Ctx).getTools()).map((t) => t.name));
  expect(eventTools).toEqual(expect.arrayContaining(["list_guests", "import_guests", "set_gift_plan"]));
  const going = await execute(page, "list_guests", { filter: "status:eq:no_reply" });
  expect((JSON.parse(going.text) as { guests: unknown[] }).guests).toHaveLength(3);
});
