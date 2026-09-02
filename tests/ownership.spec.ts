/**
 * Ownership through the browser: the organizer signs in through the logged magic link, creates an
 * event, and sees it in the list at /events; once signed out the dashboard sends the browser to sign in, the
 * event API answers 401, and the invite link still opens. The server runs without DATABASE_URL, so
 * a request with no session is the local organizer; an event a signed-in account owns still turns
 * such a request away.
 */
import { expect, test } from "@playwright/test";

const ORGANIZER = "organizer@example.com";
const BODY = { title: "Owned event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };

test("an organizer's event stays theirs after they sign out and the invite stays public", async ({ page, request }) => {
  await page.goto("/sign-in");
  await page.getByTestId("sign-in-email").fill(ORGANIZER);
  await page.getByTestId("sign-in-submit").click();
  await expect(page.getByTestId("sign-in-sent")).toBeVisible();
  const link = await request.get(`/api/dev/magic-link?email=${ORGANIZER}`);
  expect(link.ok(), "the server must run with ORGANIZER_EMAILS listing organizer@example.com").toBe(true);
  await page.goto(((await link.json()) as { url: string }).url);
  await expect(page.getByTestId("session-email")).toHaveText(ORGANIZER);

  // page.request carries the session cookie; the bare request fixture has none.
  const created = await page.request.post("/api/events", { data: BODY });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const published = await page.request.post(`/api/events/${id}/publish`);
  const { invite_path } = (await published.json()) as { invite_path: string };

  const listed = (await (await page.request.get("/api/events")).json()) as { events: { id: string; title: string; status: string; invite_code: string }[] };
  expect(listed.events.map((e) => e.id)).toContain(id);
  await page.goto("/events");
  await expect(page.getByTestId("my-events").locator(`a[href="/events/${id}"]`)).toHaveText(BODY.title);
  await page.goto(`/events/${id}`);
  await expect(page.getByTestId("status")).toHaveText("Published");

  // A request with no session is the local organizer, who does not own this account's event.
  expect((await request.get(`/api/events/${id}`)).status()).toBe(401);

  await page.goto("/");
  await page.getByTestId("sign-out").click();
  await expect(page.getByTestId("sign-in-link")).toBeVisible();
  await page.goto(`/events/${id}`);
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(`/events/${id}`)}`));
  expect((await page.request.get(`/api/events/${id}`)).status()).toBe(401);
  expect((await page.request.post(`/api/events/${id}/publish`)).status()).toBe(401);

  await page.goto(invite_path);
  await expect(page.getByTestId("invite-title")).toContainText(BODY.title);
  const invite = (await (await page.request.get(`/api/invite/${invite_path.split("/i/")[1]}`)).json()) as { event: Record<string, unknown> };
  expect(invite.event).not.toHaveProperty("owner_id");
});
