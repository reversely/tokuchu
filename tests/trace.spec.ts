/**
 * The agent trace (#55): a search against the live catalog records `search_catalog` entries on the
 * event, pricing a gift at a store records the cart call against the gift, and the drawer in the
 * band and the lines under the results heading and the gift show them. No CUSTOMILY_SHOP_URL is
 * set, so the catalog call is the only live one and the search may return nothing.
 */
import { expect, test } from "@playwright/test";

type Trace = { tool: string; side: string; transport: string; endpoint: string; ok: boolean; gift_id: string | null };

test("a search and a cart call show in the drawer and inline under the results and the gift", async ({ page, request }) => {
  test.setTimeout(180_000);
  const created = await request.post("/api/events", { data: { title: "Trace event", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" }, cost_per_person_cents: 2000, delivery: { destination: "venue", address: null, needed_by: "2030-01-08" } } });
  const { id } = (await created.json()) as { id: string };
  await request.post(`/api/events/${id}/publish`);
  await request.post(`/api/events/${id}/rsvp`, { data: { guests: [{ display_name: "Guest One", status: "going" }] } });

  // The catalog call is live: one probe keeps the run short, and the trace records the search whatever it returns.
  const searched = await request.post(`/api/events/${id}/search`, { data: { sentence: "tea", probe: 1 }, timeout: 120_000 });
  expect(searched.ok()).toBe(true);
  const snap = (await (await request.get(`/api/events/${id}`)).json()) as { traces: Trace[] };
  const searches = snap.traces.filter((t) => t.tool === "search_catalog");
  expect(searches.length).toBeGreaterThan(0);
  expect(searches[0]).toMatchObject({ side: "catalog", transport: "ucp", endpoint: "https://catalog.shopify.com/api/ucp/mcp", gift_id: null });

  // A plain gift at a store that answers nothing: pricing it calls create_cart at the store's endpoint and the refusal records against the gift.
  const gift = (await (await request.post(`/api/events/${id}/gifts`, { data: { product_id: "gid://shopify/Product/1", shop_domain: "example-store.myshopify.com", product_title: "Tea box", variants: [{ id: "v1", title: "Box", price_cents: 1500, currency: "CAD" }], default_variant_id: "v1" } })).json()) as { id: string };

  await page.goto(`/events/${id}`);
  await page.getByTestId("trace-toggle").click();
  await expect(page.getByTestId("trace-drawer")).toBeVisible();
  await expect(page.locator('[data-testid="trace-entry"][data-tool="search_catalog"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="trace-entry"][data-tool="search_catalog"]').first()).toHaveAttribute("data-side", "catalog");

  // The drawer stays open across the tabs and the page's search shows the search's calls under the results heading.
  await page.route(`**/api/events/${id}/search`, (route) => route.fulfill({ json: { searches: [{ query: "tea" }], found: 0, probed: 0, duration_ms: 1, ranked: [], excluded: [] } }));
  await page.getByTestId("tab-experience").click();
  await expect(page.getByTestId("trace-drawer")).toBeVisible();
  await page.getByTestId("add-gift").click();
  await page.getByTestId("sentence").fill("tea");
  await page.getByTestId("search").click();
  await expect(page.getByTestId("trace-inline-results")).toBeVisible();
  await expect(page.getByTestId("trace-inline-results").locator('[data-tool="search_catalog"]').first()).toBeVisible();

  // Pricing the gift records create_cart against it; the line under the gift and the drawer show the failed call.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back to the gifts" }).click();
  await page.getByTestId("send-gift").click();
  await expect(page.getByTestId("trace-inline-gift")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId("trace-inline-gift").locator('[data-tool="create_cart"]')).toHaveCount(1);
  await expect(page.getByTestId("trace-inline-gift").locator('[data-tool="create_cart"]')).toHaveAttribute("data-ok", "false");
  const entry = page.locator(`[data-testid="trace-entry"][data-tool="create_cart"][data-gift="${gift.id}"]`).first();
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("data-side", "store");
  await entry.locator("summary").click();
  await expect(entry).toContainText("example-store.myshopify.com/api/ucp/mcp");

  // The trace lives on the event, so the endpoint carries it too, newest first.
  const after = (await (await request.get(`/api/events/${id}`)).json()) as { traces: Trace[] };
  expect(after.traces[0]).toMatchObject({ tool: "create_cart", side: "store", transport: "ucp", ok: false, gift_id: gift.id });

  // Below 900px the drawer opens over the page from the band's button and Close collapses it.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("trace-drawer")).toBeVisible();
  await page.getByTestId("trace-close").click();
  await expect(page.getByTestId("trace-drawer")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});
