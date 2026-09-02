/**
 * Live test for the API-backed Customily tools (integrations/customily/webmcp-customily.js). It
 * drives the real storefront, so it runs only with LIVE_CUSTOMILY=1: it injects the WebMCP polyfill
 * and the adapter into the crewneck page, reads the product's customization, adds two customized
 * lines, opens the returned checkout_url in a fresh browser context, and replays the add. The
 * checkout page is read and never submitted.
 */
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const CREWNECK_URL = "https://springbuilt.myshopify.com/products/1566-comfort-colors-garment-dyed-adult-crewneck-sweatshirt";
const CREWNECK_ID = "10242071789817";
const POLYFILL = fileURLToPath(new URL("../src/webmcp/polyfill.js", import.meta.url));

test.skip(!process.env.LIVE_CUSTOMILY, "Set LIVE_CUSTOMILY=1 to run against the live Customily storefront.");

type Ctx = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };

type Customization = {
  product_id: string;
  title: string;
  fields: { key: string; label: string; kind: string; required: boolean; constraints: { max_length?: number } }[];
  variants: { id: string; title: string; price_cents: number; available: boolean; options: { name: string; label: string }[] }[];
  selected_variant_id: string | null;
};

type Added = {
  batch_id: string;
  status: string;
  ready: { recipient_ref: string; cart_line_key: string; variant_id: string; replayed?: boolean }[];
  blocked: { recipient_ref: string; issues: unknown[] }[];
  subtotal: number;
  currency: string;
  checkout_url: string | null;
};

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

async function cartLineCount(page: Page) {
  return page.evaluate(async () => ((await (await fetch("/cart.js")).json()) as { items: unknown[] }).items.length);
}

test("the crewneck page answers its customization, adds two customized lines with a shareable checkout, and replays nothing", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.addInitScript({ path: POLYFILL });
  await page.goto(CREWNECK_URL, { waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => page.evaluate(async () => (await document.modelContext!.getTools()).map((t) => t.name)), { timeout: 30_000 })
    .toEqual(expect.arrayContaining(["get_customization", "add_customized_to_cart"]));

  const read = await execute(page, "get_customization", { product_id: CREWNECK_ID });
  expect(read.isError, read.text).toBe(false);
  const customization = JSON.parse(read.text) as Customization;
  expect(customization.product_id).toBe(CREWNECK_ID);
  expect(customization.fields.map((f) => f.key)).toEqual(["star_map_location", "star_map_time", "caption"]);
  expect(customization.fields.find((f) => f.key === "caption")?.constraints.max_length).toBe(20);
  expect(customization.variants).toHaveLength(6);
  expect(customization.selected_variant_id).toBe(customization.variants[0].id);

  const [small, medium] = customization.variants;
  const idempotencyKey = `tools-${Date.now()}`;
  const addArgs = {
    batch_id: "batch-tools-1",
    idempotency_key: idempotencyKey,
    items: [
      { recipient_ref: "guest-maya", variant_id: small.id, values: { star_map_location: "Toronto", star_map_time: "21:00", caption: "Maya" } },
      { recipient_ref: "guest-jordan", variant_id: medium.id, values: { star_map_location: "Vancouver", star_map_time: "22:30", caption: "Jordan" } }
    ]
  };

  const rejected = await execute(page, "add_customized_to_cart", {
    ...addArgs,
    items: [addArgs.items[0], { recipient_ref: "guest-bad", variant_id: "1", values: { caption: "A caption that runs past twenty", banner: "no" } }]
  });
  expect(rejected.isError).toBe(true);
  const rejection = JSON.parse(rejected.text) as { items: { recipient_ref: string; issues: { field_key?: string; message: string }[] }[] };
  expect(rejection.items[0].issues).toHaveLength(0);
  expect(rejection.items[1].issues.map((i) => i.message).join(" ")).toContain("variant_id");

  const linesBefore = await cartLineCount(page);
  const added = await execute(page, "add_customized_to_cart", addArgs);
  expect(added.isError, added.text).toBe(false);
  const batch = JSON.parse(added.text) as Added;
  expect(batch.batch_id).toBe("batch-tools-1");
  expect(batch.status).toBe("prepared");
  expect(batch.ready.map((r) => r.recipient_ref)).toEqual(["guest-maya", "guest-jordan"]);
  expect(batch.ready.map((r) => r.variant_id)).toEqual([small.id, medium.id]);
  expect(batch.blocked).toHaveLength(0);
  expect(batch.subtotal).toBeGreaterThan(0);
  expect(batch.currency).toMatch(/^[A-Z]{3}$/);
  expect(batch.checkout_url).toContain("/cart/c/");
  expect(await cartLineCount(page)).toBe(linesBefore + 2);

  const fresh = await browser.newContext();
  try {
    const checkout = await fresh.newPage();
    await checkout.goto(batch.checkout_url!, { waitUntil: "domcontentloaded" });
    await expect(checkout.locator("body")).toContainText("Maya", { timeout: 60_000 });
    await expect(checkout.locator("body")).toContainText("Jordan");
  } finally {
    await fresh.close();
  }

  const replayed = await execute(page, "add_customized_to_cart", addArgs);
  expect(replayed.isError, replayed.text).toBe(false);
  const replay = JSON.parse(replayed.text) as Added;
  expect(replay.ready.map((r) => r.replayed)).toEqual([true, true]);
  expect(replay.ready.map((r) => r.cart_line_key)).toEqual(batch.ready.map((r) => r.cart_line_key));
  expect(await cartLineCount(page)).toBe(linesBefore + 2);
});
