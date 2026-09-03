/**
 * The dev sign-in path: an address off the allowlist lands on the not-found page with the demo link, the server logs a magic link for one on
 * it, and following the link puts the address in the band. The Playwright server runs with
 * ORGANIZER_EMAILS including organizer@example.com and the link comes from the dev-only endpoint.
 */
import { expect, test } from "@playwright/test";

const ORGANIZER = "organizer@example.com";

test("a listed address signs in through the logged magic link and signs out again", async ({ page, request }) => {
  await page.goto("/sign-in");
  await page.getByTestId("sign-in-email").fill("stranger@example.com");
  await page.getByTestId("sign-in-submit").click();
  await expect(page.getByTestId("not-found-title")).toHaveText("Page not found");
  await expect(page.getByTestId("not-found-demo")).toHaveAttribute("href", "/demo");
  expect((await request.get(`/api/dev/magic-link?email=stranger@example.com`)).status()).toBe(404);

  await page.goto("/sign-in");
  await page.getByTestId("sign-in-email").fill(ORGANIZER);
  await page.getByTestId("sign-in-submit").click();
  await expect(page.getByTestId("sign-in-sent")).toHaveText("The sign-in link is in the server log");

  const link = await request.get(`/api/dev/magic-link?email=${ORGANIZER}`);
  expect(link.ok(), "the server must run with ORGANIZER_EMAILS listing organizer@example.com").toBe(true);
  const { url } = (await link.json()) as { url: string };
  await page.goto(url);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("session-email")).toHaveText(ORGANIZER);

  await page.reload();
  await expect(page.getByTestId("session-email")).toHaveText(ORGANIZER);

  await page.getByTestId("sign-out").click();
  await expect(page.getByTestId("sign-in-link")).toBeVisible();
});
