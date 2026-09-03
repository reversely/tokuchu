/**
 * Ownership through the browser: the organizer signs in through the logged magic link, creates an
 * event, and sees it in the list at /events; once signed out the dashboard sends the browser to sign in, the
 * event API answers 401, and the invite link still opens. A guest who signs in from the demo keeps
 * the demo event under the new account and the guest token stops working. The server runs without
 * DATABASE_URL, so a request with no session is the local organizer; an event a signed-in account
 * owns still turns such a request away.
 */
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { DEMO_HEADER } from "../src/demo/token";

const ORGANIZER = "organizer@example.com";
const BODY = { title: "Owned event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const DEMO_TITLE = "8th Annual Eastern Canada Astronomy Symposium";

/** Sends the magic link from the sign-in page the browser is on and follows it from the server log. */
async function followMagicLink(page: Page, request: APIRequestContext): Promise<void> {
  await page.getByTestId("sign-in-email").fill(ORGANIZER);
  await page.getByTestId("sign-in-submit").click();
  await expect(page.getByTestId("sign-in-sent")).toBeVisible();
  const link = await request.get(`/api/dev/magic-link?email=${ORGANIZER}`);
  expect(link.ok(), "the server must run with ORGANIZER_EMAILS listing organizer@example.com").toBe(true);
  await page.goto(((await link.json()) as { url: string }).url);
}

test("an organizer's event stays theirs after they sign out and the invite stays public", async ({ page, request }) => {
  await page.goto("/sign-in");
  await expect(page.getByTestId("sign-in-lead")).toHaveText("Enter your email to get a sign-in link. A first sign-in creates your account.");
  await expect(page.getByTestId("sign-in-demo")).toHaveAttribute("href", "/demo");
  await followMagicLink(page, request);
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

test("a guest who creates an account keeps the demo event and the guest token stops working", async ({ page, request }) => {
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/events\/[^/?]+\?t=demo_[^&]+$/);
  const landed = new URL(page.url());
  const id = landed.pathname.split("/")[2];
  const token = landed.searchParams.get("t")!;
  await page.getByTestId("intro-skip").click();
  await page.getByTestId("keep-event-link").click();
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await followMagicLink(page, request);

  // The link returns to the event with the token; the signed-in render hands the event over and drops the token from the address.
  await expect(page).toHaveURL(`/events/${id}`);
  await expect(page.getByTestId("session-email")).toHaveText(ORGANIZER);
  await expect(page.getByTestId("guest-pill")).toHaveCount(0);
  await expect(page.getByTestId("event-title")).toHaveText(DEMO_TITLE);
  await expect(page.getByTestId("tour-step")).toHaveAttribute("data-step", "1");

  await page.goto("/events");
  const row = page.getByTestId("my-events").locator(`a[href="/events/${id}"]`);
  await expect(row).toHaveText(DEMO_TITLE);
  await expect(row.locator("xpath=..")).toContainText("Demo");
  await page.goto("/demo");
  await expect(page).toHaveURL(`/events/${id}`);

  // The consumed token names no guest: with it the bare fixture is the local organizer and the account's event refuses it.
  expect((await request.get(`/api/events/${id}`, { headers: { [DEMO_HEADER]: token } })).status()).toBe(401);
  expect((await request.get(`/api/events/${id}?t=${encodeURIComponent(token)}`, { headers: { [DEMO_HEADER]: token } })).status()).toBe(401);
  const fresh = await request.get(`/demo?t=${encodeURIComponent(token)}`, { maxRedirects: 0 });
  expect(fresh.headers().location).not.toContain(`/events/${id}`);
});
