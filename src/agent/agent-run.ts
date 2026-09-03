/**
 * The browser agent runtime (#60): an OpenAI Agents SDK loop whose only tools open a tab, list the
 * WebMCP tools a page registers, call one, and switch tabs. The model reads docs/agent-runtime.md
 * as its instructions and chooses every call itself; nothing here names a Tokuchu or store tool.
 * The tabs are Stagehand pages, reached through the browser context's `newPage` and
 * `setActivePage`, and a test passes fake pages with the same shape.
 *
 * This module stays free of app imports and of TypeScript syntax Node cannot strip, because
 * scripts/agent-run.mjs imports it straight into Node.
 */
import type { Model } from "@openai/agents";
import { z } from "zod";

export const DEFAULT_MODEL = "gpt-5.6-luna";

/** What Stagehand's `WebMCPInvocation.result()` resolves to. */
export type WebMcpToolResponse = { status: "Completed" | "Canceled" | "Error"; output?: unknown; errorText?: string };
/** Stagehand's `WebMCPTool`: the descriptor Chrome reports plus `invoke`. */
export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  frameId: string;
  invoke(options?: { input?: Record<string, unknown> }): Promise<{ result(options?: { timeout?: number }): Promise<WebMcpToolResponse> }>;
}
/** The part of a Stagehand `Page` the runtime uses. */
export interface AgentPage {
  url(): Promise<string>;
  tools(options?: { timeout?: number }): Promise<WebMcpTool[]>;
}
/** The part of a Stagehand `BrowserContext` the runtime uses. */
export interface AgentBrowserContext {
  newPage(url?: string): Promise<AgentPage>;
  setActivePage(page: AgentPage): Promise<void>;
}

export type RunEvent =
  | { kind: "call"; seq: number; at: string; tool: string; args: Record<string, unknown> }
  | { kind: "result"; seq: number; at: string; tool: string; ok: boolean; summary: string; output: unknown }
  | { kind: "message"; seq: number; at: string; text: string };

/** A RunEvent before the runtime stamps its sequence number and time. */
type PendingEvent = { [K in RunEvent["kind"]]: Omit<Extract<RunEvent, { kind: K }>, "seq" | "at"> }[RunEvent["kind"]];

export type RunOptions = {
  context: AgentBrowserContext;
  goal: string;
  /** The instruction text (docs/agent-runtime.md); the runtime appends its own short rules. */
  playbook: string;
  /** A model name, or a Model instance; a test passes a scripted one. */
  model?: string | Model;
  maxTurns?: number;
  /** Called for every function call, every result, and the final message, in order. */
  onEvent?: (event: RunEvent) => void;
  /** How long list_webmcp_tools waits for a first tool and call_webmcp_tool waits for the requested one. */
  toolsTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type RunOutcome = { final_output: string; turns: number; calls: number; checkout_url: string | null; events: RunEvent[] };

export const RULES = `

## Rules for this runtime

You operate the pages only through five functions: open_page, list_webmcp_tools, call_webmcp_tool, record_checkout, and switch_tab. The checkout link a cart fill returns is held by the runtime and shown to you as a placeholder; record it with record_checkout and never type it. There is no DOM access; the WebMCP tools a page registers are the whole interface. Call list_webmcp_tools on a tab before the first call_webmcp_tool on it, and read each tool's inputSchema before calling it. Pass call_webmcp_tool's arguments as one JSON object encoded as a string. A result with is_error true carries the error text; resolve it from the text when the playbook's error table says how, and stop at the first error you cannot resolve, reporting the call and the error. When add_customized_to_cart returns a checkout_url, record it on the gift with post_update and end your reply with the checkout link on its own line.`;

/** One line for the terminal: a payload cut to a readable width. */
export function short(value: unknown, width = 160): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > width ? `${text.slice(0, width - 3)}...` : text;
}

/** The text payload and error flag of a WebMCP response, whatever shape the page's tool returned. */
export function textOf(response: WebMcpToolResponse): { text: string; is_error: boolean } {
  if (response.status !== "Completed") return { text: response.errorText ?? `The call ended with status ${response.status}.`, is_error: true };
  const output = response.output as { content?: { type?: string; text?: string }[]; isError?: boolean } | undefined;
  if (output && Array.isArray(output.content)) {
    const text = output.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    return { text, is_error: output.isError === true };
  }
  return { text: output === undefined ? "" : typeof output === "string" ? output : JSON.stringify(output), is_error: false };
}

/** What the model sees in place of a checkout URL; the runtime keeps the real one. */
export const CHECKOUT_PLACEHOLDER = "[checkout link captured by the runtime; call record_checkout to store it]";

/** A checkout link in a tool's text payload, if the payload carries one. */
function checkoutUrlIn(text: string): string | null {
  try {
    const payload = JSON.parse(text) as { checkout_url?: unknown };
    return typeof payload?.checkout_url === "string" && payload.checkout_url ? payload.checkout_url : null;
  } catch {
    return null;
  }
}

export async function runBrowserAgent(options: RunOptions): Promise<RunOutcome> {
  const sdk = await import("@openai/agents");
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const toolsTimeout = options.toolsTimeoutMs ?? 20_000;
  const tabs = new Map<string, AgentPage>();
  const events: RunEvent[] = [];
  let checkoutUrl: string | null = null;
  let calls = 0;

  const emit = (event: PendingEvent): void => {
    const full = { ...event, seq: events.length + 1, at: new Date().toISOString() } as RunEvent;
    events.push(full);
    options.onEvent?.(full);
  };

  /** Runs one function tool's body, recording the call and the result around it. */
  async function traced<T>(tool: string, args: Record<string, unknown>, body: () => Promise<{ ok: boolean; summary: string; output: T }>): Promise<T> {
    calls += 1;
    emit({ kind: "call", tool, args });
    try {
      const { ok, summary, output } = await body();
      emit({ kind: "result", tool, ok, summary, output });
      return output;
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      emit({ kind: "result", tool, ok: false, summary: error, output: { error } });
      return { error } as T;
    }
  }

  function pageOf(tabId: string): AgentPage {
    const page = tabs.get(tabId);
    if (!page) throw new Error(`No tab ${tabId}; open_page returns the tab ids in use.`);
    return page;
  }

  /** The page's tools, waiting for a page whose scripts have not registered any yet. */
  async function toolsOf(page: AgentPage): Promise<WebMcpTool[]> {
    const deadline = Date.now() + toolsTimeout;
    let tools = await page.tools();
    while (tools.length === 0 && Date.now() < deadline) {
      await sleep(500);
      tools = await page.tools();
    }
    return tools;
  }

  /**
   * One tool by name and frame, waiting until the timeout for a tool a page registers after its first
   * ones. A name two frames share needs the frame_id; without it the answer names the frames.
   */
  async function toolNamed(page: AgentPage, name: string, frameId: string | undefined): Promise<{ tool: WebMcpTool } | { error: string }> {
    const deadline = Date.now() + toolsTimeout;
    for (;;) {
      const matches = (await page.tools()).filter((t) => t.name === name && (frameId === undefined || t.frameId === frameId));
      if (matches.length === 1) return { tool: matches[0] };
      if (matches.length > 1) return { error: `The page registers ${name} in ${matches.length} frames (${matches.map((t) => t.frameId).join(", ")}); pass frame_id.` };
      if (Date.now() >= deadline) return { error: `The page registers no tool ${name}${frameId ? ` in frame ${frameId}` : ""}; call list_webmcp_tools.` };
      await sleep(500);
    }
  }

  const tools = [
    sdk.tool({
      name: "open_page",
      description: "Opens a URL in a new browser tab and returns its tab_id. Each tab keeps its own page and its own WebMCP tools.",
      parameters: z.object({ url: z.string().describe("The absolute URL to open") }),
      execute: ({ url }) =>
        traced("open_page", { url }, async () => {
          const page = await options.context.newPage(url);
          const tabId = `tab${tabs.size + 1}`;
          tabs.set(tabId, page);
          const landed = await page.url();
          return { ok: true, summary: `${tabId} at ${landed}`, output: { tab_id: tabId, url: landed } };
        })
    }),
    sdk.tool({
      name: "list_webmcp_tools",
      description: "Lists the WebMCP tools the page in a tab registers: each tool's name, description, inputSchema, and frame_id. Call it before the first call_webmcp_tool on a tab. Two frames may register the same name; frame_id tells them apart.",
      parameters: z.object({ tab_id: z.string().describe("A tab_id from open_page") }),
      execute: ({ tab_id }) =>
        traced("list_webmcp_tools", { tab_id }, async () => {
          const found = await toolsOf(pageOf(tab_id));
          const listed = found.map((t) => ({ name: t.name, frame_id: t.frameId, description: t.description, inputSchema: t.inputSchema ?? null }));
          return { ok: true, summary: `${listed.length} tools: ${listed.map((t) => t.name).join(" ")}`, output: { tab_id, tools: listed } };
        })
    }),
    sdk.tool({
      name: "call_webmcp_tool",
      description: "Calls one WebMCP tool on the page in a tab and returns its text payload with is_error. The arguments are one JSON object, encoded as a string, that fits the tool's inputSchema.",
      parameters: z.object({
        tab_id: z.string().describe("A tab_id from open_page"),
        name: z.string().describe("A tool name from list_webmcp_tools on that tab"),
        frame_id: z.string().nullable().describe("The tool's frame_id from list_webmcp_tools; null when the name is unique on the page"),
        arguments: z.string().describe("The tool's arguments as a JSON object encoded as a string")
      }),
      execute: ({ tab_id, name, frame_id, arguments: raw }) =>
        traced("call_webmcp_tool", { tab_id, name, frame_id, arguments: parseArgs(raw) }, async () => {
          const input = parseArgs(raw);
          if (input === null) return { ok: false, summary: "arguments is not a JSON object", output: { text: JSON.stringify({ error: "arguments must be a JSON object encoded as a string" }), is_error: true } };
          const found = await toolNamed(pageOf(tab_id), name, frame_id ?? undefined);
          if ("error" in found) return { ok: false, summary: `no tool ${name} on ${tab_id}`, output: { text: JSON.stringify({ error: `The page in ${tab_id}: ${found.error}` }), is_error: true } };
          const invocation = await found.tool.invoke({ input });
          const result = textOf(await invocation.result({ timeout: 120_000 }));
          const captured = checkoutUrlIn(result.text);
          if (captured) checkoutUrl = captured;
          // The model never sees the checkout token, so it cannot mistype it; record_checkout carries the URL.
          const shown = captured ? { ...result, text: result.text.split(captured).join(CHECKOUT_PLACEHOLDER) } : result;
          return { ok: !result.is_error, summary: result.is_error ? `error: ${short(result.text)}` : short(result.text), output: shown };
        })
    }),
    sdk.tool({
      name: "record_checkout",
      description: "Records the checkout link the store returned onto the gift in Tokuchu by calling that page's post_update with kind confirmed. The runtime holds the link from add_customized_to_cart; you never copy it. Call this after the cart fill succeeds.",
      parameters: z.object({
        tab_id: z.string().describe("The Tokuchu tab_id"),
        gift_id: z.string().describe("The gift the checkout belongs to")
      }),
      execute: ({ tab_id, gift_id }) =>
        traced("record_checkout", { tab_id, gift_id }, async () => {
          if (!checkoutUrl) return { ok: false, summary: "no checkout link captured yet", output: { text: JSON.stringify({ error: "No checkout link has been captured; call add_customized_to_cart on the store's page first." }), is_error: true } };
          const found = await toolNamed(pageOf(tab_id), "post_update", undefined);
          if ("error" in found) return { ok: false, summary: `no post_update on ${tab_id}`, output: { text: JSON.stringify({ error: `The page in ${tab_id}: ${found.error}` }), is_error: true } };
          const invocation = await found.tool.invoke({ input: { gift_id, kind: "confirmed", text: "The cart is ready to review", reference: checkoutUrl } });
          const result = textOf(await invocation.result({ timeout: 120_000 }));
          return { ok: !result.is_error, summary: result.is_error ? `error: ${short(result.text)}` : `checkout recorded on ${gift_id}`, output: result.is_error ? result : { ...result, text: result.text.split(checkoutUrl).join(CHECKOUT_PLACEHOLDER) } };
        })
    }),
    sdk.tool({
      name: "switch_tab",
      description: "Brings a tab to the front. The tools of every open tab stay callable whichever tab is in front.",
      parameters: z.object({ tab_id: z.string().describe("A tab_id from open_page") }),
      execute: ({ tab_id }) =>
        traced("switch_tab", { tab_id }, async () => {
          const page = pageOf(tab_id);
          await options.context.setActivePage(page);
          return { ok: true, summary: `${tab_id} in front`, output: { tab_id, url: await page.url() } };
        })
    })
  ];

  const agent = new sdk.Agent({ name: "BrowserAgent", model: options.model ?? DEFAULT_MODEL, instructions: options.playbook + RULES, tools });
  const result = await sdk.run(agent, options.goal, { maxTurns: options.maxTurns ?? 60 });
  const finalOutput = typeof result.finalOutput === "string" ? result.finalOutput : JSON.stringify(result.finalOutput ?? "");
  emit({ kind: "message", text: finalOutput });
  return { final_output: finalOutput, turns: result.rawResponses.length, calls, checkout_url: checkoutUrl ?? checkoutLinkIn(finalOutput), events };
}

/** The arguments string as an object, or null when it is not one. */
function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = raw.trim() === "" ? {} : JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** A checkout link in the model's final message, when no tool result carried one. */
function checkoutLinkIn(text: string): string | null {
  const match = text.match(/https?:\/\/\S*checkout\S*/i);
  return match ? match[0].replace(/[).,]+$/, "") : null;
}
