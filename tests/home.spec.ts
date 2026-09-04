/** The landing page leads with ChatGPT prompts and groups WebMCP tools into four utilities. */
import { expect, test } from "@playwright/test";

const TOOLS = ["get_customization", "set_gift_customization", "add_customized_to_cart"];

test("the root renders the ChatGPT prompts, two-site flow, and the primary action opens a draft", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("stage-bubbles")).toBeVisible();
  await expect(page.getByTestId("stage-bubbles").locator(".stage-bubble")).toHaveCount(3);
  await expect(page.getByTestId("stage-bubbles")).toContainText("Create the event");
  await expect(page.getByTestId("stage-bubbles")).toContainText("Review a recommendation");
  await expect(page.getByTestId("stage-bubbles")).toContainText("Prepare the checkout");
  await expect(page.getByTestId("sites").locator("article")).toHaveCount(2);
  await expect(page.getByTestId("sites")).toContainText("Tokuchu");
  await expect(page.getByTestId("sites")).toContainText("Customworks");
  await expect(page.getByTestId("walkthrough-step")).toHaveCount(4);
  for (const tool of TOOLS) await expect(page.getByTestId("walkthrough").locator("code", { hasText: tool }).first()).toBeVisible();
  await expect(page.getByTestId("arch-diagram")).toBeVisible();
  await expect(page.locator("footer a", { hasText: "Architecture" })).toHaveAttribute("href", "/docs/architecture");
  await expect(page.locator("footer a", { hasText: "Privacy" })).toHaveAttribute("href", "/privacy");
  for (const src of await page.getByTestId("walkthrough").locator("img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")))) {
    expect(src).toMatch(/^\/media\//);
    expect((await request.get(src!)).status(), src!).toBe(200);
  }
  await expect(page.getByTestId("start")).toHaveAttribute("href", "/events/new");
  await page.getByTestId("start").click();
  await expect(page).toHaveURL(/\/events\/new$/);
  await expect(page.getByTestId("publish")).toBeDisabled();
});

test("the public architecture and policy pages render", async ({ page }) => {
  await page.goto("/docs/codex");
  await expect(page.getByRole("heading", { name: "Discover the homepage tools before following its links." })).toBeVisible();
  await expect(page.getByText('tab.capabilities.get("webmcp")').first()).toBeVisible();
  await expect(page.getByText(/browser agent with WebMCP support/)).toBeVisible();

  await page.goto("/docs/architecture");
  await expect(page.getByRole("heading", { name: /One record model/ })).toBeVisible();
  await expect(page.locator(".architecture-stage")).toHaveCount(4);
  await expect(page.getByText("Prompt 1").first()).toBeVisible();
  await expect(page.getByText("Page.tools()").first()).toBeVisible();
  await expect(page.getByText("get_customization").first()).toBeVisible();

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Information Tokuchu handles" })).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Agents and automated actions" })).toBeVisible();
});
