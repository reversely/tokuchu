/**
 * The order-status route and the store page's get_order_updates tool (#59). The route half runs on
 * every run: a request that names no checkout answers 400 and CORS admits the store's origin alone.
 * The live half (LIVE_CUSTOMILY=1) opens the store's product page through the polyfill and lists its
 * tools; get_order_updates registers only once the owner installs the updated adapter on the live
 * theme (scripts/install-theme-adapter.ts), so while the tool is absent that test skips with a message
 * and the other test calls the route directly with the checkout URL add_customized_to_cart returns.
 * not_ordered is the expected answer for a checkout nobody has paid.
 */
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const CREWNECK_URL = "https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt";
const CREWNECK_ID = "10242071789817";
const STORE_ORIGIN = "https://springbuilt.myshopify.com";
const POLYFILL = fileURLToPath(new URL("../src/webmcp/polyfill.js", import.meta.url));

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
type OrderState = { status: "not_ordered" } | { status: "ordered"; order_name: string; line_items: { recipient_ref: string | null }[] };

async function execute(page: Page, name: string, args: Record<string, unknown>) {
  return page.evaluate(
    async ({ name, args }) => {
      const ctx = document.modelContext as unknown as Ctx;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      return { text: result.content[0]?.text ?? "", isError: result.isError === true };
    },
    { name, args }
  );
}

const toolNames = (page: Page) => page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name));

/** The store's product page with the polyfill injected and the merchant tools listed. */
async function openStore(page: Page) {
  await page.addInitScript({ path: POLYFILL });
  await page.goto(CREWNECK_URL, { waitUntil: "domcontentloaded" });
  await expect.poll(() => toolNames(page), { timeout: 30_000 }).toEqual(expect.arrayContaining(["get_customization", "add_customized_to_cart"]));
  return toolNames(page);
}

/** One customized line in the store's cart and the checkout URL the cart tool returns for it. */
async function checkoutFor(page: Page) {
  const read = await execute(page, "get_customization", { product_id: CREWNECK_ID });
  expect(read.isError, read.text).toBe(false);
  const { variants } = JSON.parse(read.text) as { variants: { id: string }[] };
  const added = await execute(page, "add_customized_to_cart", {
    idempotency_key: `orders-${Date.now()}`,
    items: [{ recipient_ref: "guest-orders", variant_id: variants[0].id, values: { star_map_location: "Toronto", star_map_time: "21:00", caption: "Orders" } }]
  });
  expect(added.isError, added.text).toBe(false);
  const { checkout_url } = JSON.parse(added.text) as { checkout_url: string | null };
  expect(checkout_url).toMatch(/\/cart\/c\//);
  return checkout_url!;
}

test("the route refuses a request naming no checkout and admits the store's origin alone", async ({ request }) => {
  const empty = await request.get("/api/store/orders");
  expect(empty.status()).toBe(400);
  expect(((await empty.json()) as { error: string }).error).toContain("checkout_url or cart_token or order_name");

  const foreign = await request.get("/api/store/orders?checkout_url=https://shop.example/checkouts/cn/abc");
  expect(foreign.status()).toBe(400);

  const preflight = await request.fetch("/api/store/orders", { method: "OPTIONS", headers: { origin: STORE_ORIGIN, "access-control-request-method": "GET" } });
  expect(preflight.status()).toBe(204);
  expect(preflight.headers()["access-control-allow-origin"]).toBe(STORE_ORIGIN);

  const other = await request.fetch("/api/store/orders", { method: "OPTIONS", headers: { origin: "https://evil.example.com", "access-control-request-method": "GET" } });
  expect(other.status()).toBe(204);
  expect(other.headers()["access-control-allow-origin"]).toBeUndefined();
});

test.describe("live against the demo store", () => {
  test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run against the live Customily storefront.");

  test("the route answers the checkout add_customized_to_cart returns", async ({ page, request }) => {
    test.setTimeout(180_000);
    await openStore(page);
    const checkout = await checkoutFor(page);
    const res = await request.get(`/api/store/orders?checkout_url=${encodeURIComponent(checkout)}`, { headers: { origin: STORE_ORIGIN } });
    expect(res.status(), await res.text()).toBe(200);
    expect(res.headers()["access-control-allow-origin"]).toBe(STORE_ORIGIN);
    const state = (await res.json()) as OrderState;
    expect(["not_ordered", "ordered"]).toContain(state.status);
    if (state.status === "ordered") expect(state.order_name).toMatch(/^#?\d+/);
  });

  test("get_order_updates registers on the store's product page and answers the session's cart", async ({ page }) => {
    test.setTimeout(180_000);
    const names = await openStore(page);
    test.skip(!names.includes("get_order_updates"), "The live theme carries an adapter without get_order_updates; install integrations/customily/webmcp-customily.js with scripts/install-theme-adapter.ts and run again.");
    const checkout = await checkoutFor(page);
    const byCheckout = await execute(page, "get_order_updates", { checkout_url: checkout });
    expect(byCheckout.isError, byCheckout.text).toBe(false);
    expect(["not_ordered", "ordered"]).toContain((JSON.parse(byCheckout.text) as OrderState).status);
    // With no argument the tool reads this session's cart token from /cart.js and lands on the same checkout.
    const bySession = await execute(page, "get_order_updates", {});
    expect(bySession.isError, bySession.text).toBe(false);
    expect((JSON.parse(bySession.text) as OrderState).status).toBe((JSON.parse(byCheckout.text) as OrderState).status);
  });
});
