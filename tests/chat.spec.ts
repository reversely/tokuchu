/**
 * The event chat (#31) on a server without LLM_ENABLED: the panel and its drawer button stay off
 * the page on every tab, the Guest Experience keeps its own ask bar, a message posted to the route
 * answers 501 with the reason, and the thread route still reads the stored thread.
 */
import { expect, test } from "@playwright/test";

test("with the assistant off the panel is absent on every tab and the chat route explains the 501", async ({ page, request }) => {
  const created = await request.post("/api/events", { data: { title: "Chat event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);

  await page.goto(`/events/${id}`);
  await expect(page.getByTestId("copy-invite")).toBeVisible();
  for (const tab of ["tab-overview", "tab-experience", "tab-attendees"]) {
    await page.getByTestId(tab).click();
    await expect(page.getByTestId("chat-panel")).toHaveCount(0);
    await expect(page.getByTestId("chat-toggle")).toHaveCount(0);
  }
  await expect(page.locator("main.sheet")).not.toHaveClass(/with-chat/);

  const posted = await request.post(`/api/events/${id}/chat?stream=1`, { data: { message: "Who has not replied?" } });
  expect(posted.status()).toBe(501);
  expect(await posted.json()).toEqual({ error: "The assistant is switched off on this server" });

  const thread = await request.get(`/api/events/${id}/chat`);
  expect(thread.status()).toBe(200);
  expect(await thread.json()).toEqual({ messages: [] });
  const snap = (await (await request.get(`/api/events/${id}`)).json()) as { messages: unknown[]; llm_enabled: boolean };
  expect(snap.llm_enabled).toBe(false);
  expect(snap.messages).toEqual([]);
});
