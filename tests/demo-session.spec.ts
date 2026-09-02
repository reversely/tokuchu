/**
 * The guest session through the browser: `/demo` sets the signed cookie, creates the seeded event,
 * and lands on its dashboard; a second visit lands on the same event; the demo organizer lists only
 * its event, cannot create a second one, and gets 403 on an event another organizer owns. The
 * server runs without DATABASE_URL, so a request with no cookie is the local organizer. The tour
 * mounts on the demo event with its first step and stays off an ordinary event.
 */
import { expect, test } from "@playwright/test";
import { STEPS } from "../src/demo/steps";

const BODY = { title: "Someone else's event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const DEMO_TITLE = "8th Annual Eastern Canada Astronomy Symposium";

test("a visitor gets one demo event and keeps it across visits", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("demo")).toHaveAttribute("href", "/demo");
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/events\/[^/?]+\?demo=1$/);
  const id = new URL(page.url()).pathname.split("/")[2];
  await expect(page.getByTestId("status")).toHaveText("Published");
  await expect(page.getByTestId("event-title")).toHaveText(DEMO_TITLE);
  await expect(page.getByTestId("tour-narration")).toHaveText(STEPS[0].narration);
  await expect(page.getByTestId("tour-step")).toHaveAttribute("data-step", "1");
  await expect(page.getByTestId("tour-autoplay")).not.toBeChecked();

  const cookie = (await page.context().cookies()).find((c) => c.name === "tokuchu_demo");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  expect(cookie!.value).toMatch(/^demo_[A-Za-z0-9_-]{16}\.[0-9a-f]{64}$/);

  await page.goto("/demo");
  await expect(page).toHaveURL(`/events/${id}?demo=1`);
  expect((await page.context().cookies()).find((c) => c.name === "tokuchu_demo")?.value).toBe(cookie!.value);

  const snap = (await (await page.request.get(`/api/events/${id}`)).json()) as { demo: boolean; event: { title: string } };
  expect(snap.demo).toBe(true);
  expect(snap.event.title).toBe(DEMO_TITLE);

  const listed = (await (await page.request.get("/api/events")).json()) as { events: { id: string }[] };
  expect(listed.events.map((e) => e.id)).toEqual([id]);
  const second = await page.request.post("/api/events", { data: BODY });
  expect(second.status()).toBe(403);
  expect(await second.json()).toMatchObject({ error: "The demo holds one event." });

  // The bare request fixture carries no cookie, so it is the local organizer and its event is not the demo's.
  const theirs = (await (await request.post("/api/events", { data: BODY })).json()) as { id: string };
  expect((await page.request.get(`/api/events/${theirs.id}`)).status()).toBe(403);
  await page.goto(`/events/${theirs.id}`);
  await expect(page.getByTestId("not-found-title")).toBeVisible();
});

test("the tour stays off an event that is not the demo's", async ({ page }) => {
  const theirs = (await (await page.request.post("/api/events", { data: BODY })).json()) as { id: string };
  await page.goto(`/events/${theirs.id}`);
  await expect(page.getByTestId("event-title")).toHaveText(BODY.title);
  await expect(page.getByTestId("tour")).toHaveCount(0);
});
