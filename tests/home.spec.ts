/** The landing page groups WebMCP tools into four utilities and explains the Stagehand browser-agent runtime. */
import { expect, test } from "@playwright/test";

const TOOLS = ["get_customization", "set_gift_customization", "add_customized_to_cart"];

test("the root renders the two-site flow and Stagehand architecture and the primary action opens a draft", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("main > section").first()).toHaveAttribute("data-testid", "codex-entry");
  await expect(page.getByTestId("codex-entry")).toContainText('tab.capabilities.get("webmcp")');
  await expect(page.getByTestId("codex-entry")).toContainText('tools.call("create_event"');
  await expect(page.locator('meta[name="tokuchu-codex-entry"]')).toHaveAttribute("content", /fetchTools/);
  await expect(page.getByTestId("sites").locator("article")).toHaveCount(2);
  await expect(page.getByTestId("sites")).toContainText("Tokuchu: RSVP Application with Attendee States");
  await expect(page.getByTestId("sites")).toContainText("Customworks: Shopify Store with WebMCP-enabled Customization");
  await expect(page.getByTestId("walkthrough-step")).toHaveCount(4);
  for (const tool of TOOLS) await expect(page.getByTestId("walkthrough").locator("code", { hasText: tool }).first()).toBeVisible();
  await expect(page.getByTestId("arch-grid")).toContainText('tab.capabilities.get("webmcp")');
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
  await expect(page.getByText(/separate Stagehand runtime/)).toBeVisible();

  await page.goto("/docs/architecture");
  await expect(page.getByRole("heading", { name: /One record model supports two runtime modes/ })).toBeVisible();
  await expect(page.locator(".architecture-stage")).toHaveCount(4);
  await expect(page.getByText("Prompt 1 · Create the event")).toBeVisible();
  await expect(page.getByText("Page.tools()").first()).toBeVisible();
  await expect(page.getByText("get_customization").first()).toBeVisible();

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Information Tokuchu handles" })).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Agents and automated actions" })).toBeVisible();
});
