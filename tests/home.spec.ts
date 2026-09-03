/** The landing page at the root: the Why WebMCP cards name a tool on each page and the primary action opens the draft at /events/new. */
import { expect, test } from "@playwright/test";

const TOOLS = ["get_customization", "set_gift_customization", "add_customized_to_cart"];

test("the root renders the walkthrough and its clips and the primary action leads to the draft", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("walkthrough-step")).toHaveCount(9);
  for (const tool of TOOLS) await expect(page.getByTestId("tools").getByText(tool, { exact: true })).toBeVisible();
  for (const src of await page.getByTestId("walkthrough").locator("img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")))) {
    expect(src).toMatch(/^\/media\//);
    expect((await request.get(src!)).status(), src!).toBe(200);
  }
  await expect(page.getByTestId("start")).toHaveAttribute("href", "/events/new");
  await page.getByTestId("start").click();
  await expect(page).toHaveURL(/\/events\/new$/);
  await expect(page.getByTestId("publish")).toBeDisabled();
});
