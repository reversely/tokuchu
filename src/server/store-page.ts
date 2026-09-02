/**
 * A headless page of the store with the merchant tools registered, for the server paths that call
 * `get_customization` and `add_customized_to_cart`. The page loads the WebMCP polyfill as an init
 * script so the store's own theme asset registers the merchant tools on `document.modelContext`,
 * waits for them, and exposes one `call` that runs `executeTool` in the page and parses the text
 * payload it returns.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type StoreCall = { payload: Record<string, unknown>; isError: boolean };
export type StorePage = { call(name: string, args: Record<string, unknown>): Promise<StoreCall> };

export const MERCHANT_TOOLS = ["get_customization", "add_customized_to_cart"];
const INIT_SCRIPTS = ["src/webmcp/polyfill.js"];
const TOOLS_TIMEOUT_MS = 60_000;

type PageContext = { getTools(): Promise<{ name: string }[]>; executeTool(tool: unknown, args: unknown): Promise<{ content: { text: string }[]; isError?: boolean }> };
type EvaluatingPage = { evaluate<R, A>(fn: (arg: A) => Promise<R> | R, arg: A): Promise<R> };

/** One tool call inside the page; a throw inside the page (a navigation, a challenge page) comes back as an error payload. */
async function callTool(page: EvaluatingPage, name: string, args: Record<string, unknown>): Promise<StoreCall> {
  try {
    const raw = await page.evaluate(async ({ name, args }: { name: string; args: Record<string, unknown> }) => {
      const ctx = document.modelContext as unknown as PageContext;
      const tool = (await ctx.getTools()).find((t) => t.name === name);
      if (!tool) throw new Error(`Tool ${name} is not registered`);
      const result = await ctx.executeTool(tool, args);
      return { text: result.content[0]?.text ?? "null", isError: result.isError === true };
    }, { name, args });
    return { payload: (JSON.parse(raw.text) as Record<string, unknown> | null) ?? {}, isError: raw.isError };
  } catch (error) {
    return { payload: { error: error instanceof Error ? error.message : String(error) }, isError: true };
  }
}

/**
 * Opens one browser context on `pageUrl` with the merchant tools registered and runs `fn` against
 * it; the browser closes when `fn` settles. The cart the tools build belongs to this context.
 *
 * Raises:
 *   Error: when the page does not list the merchant tools within the timeout.
 */
export async function withStorePage<T>(pageUrl: string, fn: (page: StorePage) => Promise<T>): Promise<T> {
  // Playwright loads here rather than at module load so a route bundle never carries a browser.
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    for (const script of INIT_SCRIPTS) await context.addInitScript({ content: readFileSync(resolve(process.cwd(), script), "utf8") });
    const page = await context.newPage();
    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      (expected: string[]) => {
        const ctx = document.modelContext as unknown as PageContext | undefined;
        return ctx ? ctx.getTools().then((tools) => expected.every((name) => tools.some((t) => t.name === name))) : false;
      },
      MERCHANT_TOOLS,
      { timeout: TOOLS_TIMEOUT_MS }
    );
    return await fn({ call: (name, args) => callTool(page, name, args) });
  } finally {
    await browser.close();
  }
}
