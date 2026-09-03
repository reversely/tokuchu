/**
 * The browser agent runtime over a scripted model and fake Stagehand pages (#60): the script picks
 * each function call from the results the earlier calls returned, so the test checks the loop, the
 * four tools' contracts, the error path, and the checkout link, with no browser and no network.
 */
import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { describe, expect, it } from "vitest";
import { RULES, runBrowserAgent, textOf, type AgentBrowserContext, type AgentPage, type RunEvent, type WebMcpTool, type WebMcpToolResponse } from "./agent-run";

type Script = (request: ModelRequest, turn: number) => ModelResponse["output"];

function scriptedModel(script: Script): Model & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async getResponse(request) {
      requests.push(request);
      return { usage: new Usage(), output: script(request, requests.length) };
    },
    // eslint-disable-next-line require-yield
    async *getStreamedResponse() {
      throw new Error("streaming is not scripted");
    }
  };
}

const call = (id: string, name: string, args: unknown) => ({ type: "function_call" as const, callId: id, name, status: "completed" as const, arguments: JSON.stringify(args) });
const say = (text: string) => ({ type: "message" as const, role: "assistant" as const, status: "completed" as const, content: [{ type: "output_text" as const, text }] });

/** The function results so far, by callId, parsed from the request the model received. */
function outputsById(request: ModelRequest): Record<string, unknown> {
  const items = request.input as { type?: string; callId?: string; output?: { text?: string } | string }[];
  const out: Record<string, unknown> = {};
  for (const i of items) {
    if (i.type !== "function_call_result" || !i.callId) continue;
    const text = typeof i.output === "string" ? i.output : i.output?.text ?? "{}";
    out[i.callId] = JSON.parse(text);
  }
  return out;
}

const mcp = (payload: unknown, isError = false): WebMcpToolResponse => ({ status: "Completed", output: { content: [{ type: "text", text: JSON.stringify(payload) }], ...(isError ? { isError: true } : {}) } });

/** A fake WebMCP tool: `answer` maps the input to the response the page would return. */
function fakeTool(name: string, answer: (input: Record<string, unknown>) => WebMcpToolResponse, calls: { name: string; input: Record<string, unknown> }[]): WebMcpTool {
  return {
    name,
    description: `${name} on the fake page`,
    inputSchema: { type: "object", properties: {} },
    frameId: "frame-1",
    async invoke({ input = {} } = {}) {
      calls.push({ name, input });
      return { async result() { return answer(input); } };
    }
  };
}

/** Fake pages keyed by URL prefix; a page registers its tools after `registersAfter` polls, like a mounting React page. */
function fakeContext(pages: Record<string, { tools: WebMcpTool[]; registersAfter?: number }>) {
  const opened: string[] = [];
  const active: string[] = [];
  const context: AgentBrowserContext = {
    async newPage(url = "about:blank") {
      opened.push(url);
      const key = Object.keys(pages).find((prefix) => url.startsWith(prefix));
      if (!key) throw new Error(`No fake page for ${url}`);
      let polls = 0;
      const page: AgentPage & { key: string } = {
        key,
        async url() { return url; },
        async tools() {
          polls += 1;
          return polls > (pages[key].registersAfter ?? 0) ? pages[key].tools : [];
        }
      };
      return page;
    },
    async setActivePage(page) {
      active.push((page as AgentPage & { key: string }).key);
    }
  };
  return { context, opened, active };
}

const TOKUCHU = "http://tokuchu.test/events/evt_1";
const STORE = "https://store.test/products/crewneck";
const PLAYBOOK = "# Agent playbook\n\nThe order of operations for the test.";

describe("the browser agent runtime (#60)", () => {
  it("runs the model's calls through the four tools across two tabs and ends on the checkout link", async () => {
    const webmcpCalls: { name: string; input: Record<string, unknown> }[] = [];
    const { context, opened, active } = fakeContext({
      [TOKUCHU]: {
        registersAfter: 2,
        tools: [
          fakeTool("list_guests", () => mcp({ guests: [{ id: "g1", display_name: "Avery Chen" }] }), webmcpCalls),
          fakeTool("set_gift_plan", (input) => (input.product_title ? mcp({ id: "gift_1", product_title: input.product_title }) : mcp({ error: "product_id: Invalid input" }, true)), webmcpCalls),
          fakeTool("post_update", (input) => { expect(input).toMatchObject({ kind: "confirmed", reference: "https://store.test/checkouts/abc" }); return mcp({ id: "upd_1", reference: input.reference }); }, webmcpCalls)
        ]
      },
      [STORE]: {
        tools: [
          fakeTool("get_customization", () => mcp({ product_id: "p1", title: "Customized Crewneck", fields: [], variants: [] }), webmcpCalls),
          fakeTool("add_customized_to_cart", () => mcp({ ready: [{ recipient_ref: "g1" }], blocked: [], checkout_url: "https://store.test/checkouts/abc" }), webmcpCalls)
        ]
      }
    });

    const model = scriptedModel((request, turn) => {
      const results = outputsById(request);
      switch (turn) {
        case 1:
          return [call("c1", "open_page", { url: TOKUCHU })];
        case 2:
          expect(results.c1).toEqual({ tab_id: "tab1", url: TOKUCHU });
          return [call("c2", "list_webmcp_tools", { tab_id: "tab1" })];
        case 3:
          expect((results.c2 as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(["list_guests", "set_gift_plan", "post_update"]);
          return [call("c3", "call_webmcp_tool", { tab_id: "tab1", name: "list_guests", frame_id: null, arguments: JSON.stringify({ filter: "status:eq:going" }) })];
        case 4:
          expect(results.c3).toEqual({ text: JSON.stringify({ guests: [{ id: "g1", display_name: "Avery Chen" }] }), is_error: false });
          return [call("c4", "open_page", { url: STORE })];
        case 5:
          return [call("c5", "list_webmcp_tools", { tab_id: "tab2" }), call("c6", "call_webmcp_tool", { tab_id: "tab2", name: "get_customization", frame_id: null, arguments: JSON.stringify({ product_id: "p1" }) })];
        case 6: {
          // A failing call comes back with is_error and the page's error text, and the model corrects it.
          expect(results.c6).toMatchObject({ is_error: false });
          return [call("c7", "switch_tab", { tab_id: "tab1" }), call("c8", "call_webmcp_tool", { tab_id: "tab1", name: "set_gift_plan", frame_id: null, arguments: JSON.stringify({ rules: [] }) })];
        }
        case 7:
          expect(results.c8).toEqual({ text: JSON.stringify({ error: "product_id: Invalid input" }), is_error: true });
          return [call("c9", "call_webmcp_tool", { tab_id: "tab1", name: "set_gift_plan", frame_id: null, arguments: JSON.stringify({ rules: [{ product_id: "p1" }], product_title: "Customized Crewneck" }) })];
        case 8:
          expect(results.c9).toMatchObject({ is_error: false });
          return [call("c10", "call_webmcp_tool", { tab_id: "tab2", name: "add_customized_to_cart", frame_id: null, arguments: JSON.stringify({ items: [{ recipient_ref: "g1" }], idempotency_key: "gift_1:now" }) })];
        case 9: {
          const cart = JSON.parse((results.c10 as { text: string }).text) as { checkout_url: string };
          expect(cart.checkout_url).not.toContain("checkouts/abc");
          return [call("c11", "record_checkout", { tab_id: "tab1", gift_id: "gift_1" })];
        }
        default:
          return [say("Done. The cart is ready.\nhttps://store.test/checkouts/abc")];
      }
    });

    const events: RunEvent[] = [];
    const outcome = await runBrowserAgent({ context, goal: "Order the crewneck for everyone going.", playbook: PLAYBOOK, model, onEvent: (e) => events.push(e), sleep: async () => {} });

    // The instructions are the playbook plus the runtime's rules, and only the four functions are offered.
    const first = model.requests[0];
    expect(first.systemInstructions).toBe(PLAYBOOK + RULES);
    expect(first.tools.map((t) => t.name).sort()).toEqual(["call_webmcp_tool", "list_webmcp_tools", "open_page", "record_checkout", "switch_tab"]);

    // The tabs opened in order, the switch brought the Tokuchu tab forward, and the pages saw the calls.
    expect(opened).toEqual([TOKUCHU, STORE]);
    expect(active).toEqual([TOKUCHU]);
    expect(webmcpCalls.map((c) => c.name)).toEqual(["list_guests", "get_customization", "set_gift_plan", "set_gift_plan", "add_customized_to_cart", "post_update"]);
    expect(webmcpCalls[0].input).toEqual({ filter: "status:eq:going" });

    // Every call and result is an event, in order, and the outcome counts the turns and the calls.
    expect(events.filter((e) => e.kind === "call")).toHaveLength(11);
    expect(events.filter((e) => e.kind === "result")).toHaveLength(11);
    expect(events.at(-1)).toMatchObject({ kind: "message", text: expect.stringContaining("checkouts/abc") });
    const failed = events.find((e) => e.kind === "result" && !e.ok);
    expect(failed).toMatchObject({ tool: "call_webmcp_tool", summary: expect.stringContaining("product_id: Invalid input") });
    expect(outcome).toMatchObject({ turns: 10, calls: 11, checkout_url: "https://store.test/checkouts/abc" });
    expect(outcome.final_output).toMatch(/checkouts\/abc/);
  });

  it("answers an unknown tab, an unknown tool, and bad arguments as errors the model can read", async () => {
    const { context } = fakeContext({ [TOKUCHU]: { tools: [fakeTool("list_guests", () => mcp({ guests: [] }), [])] } });
    const model = scriptedModel((request, turn) => {
      const results = outputsById(request);
      if (turn === 1) return [call("c1", "list_webmcp_tools", { tab_id: "tab9" })];
      if (turn === 2) {
        expect(results.c1).toEqual({ error: "No tab tab9; open_page returns the tab ids in use." });
        return [call("c2", "open_page", { url: TOKUCHU })];
      }
      if (turn === 3) return [call("c3", "call_webmcp_tool", { tab_id: "tab1", name: "missing_tool", frame_id: null, arguments: "{}" })];
      if (turn === 4) {
        expect(results.c3).toMatchObject({ is_error: true, text: expect.stringContaining("registers no tool missing_tool") });
        return [call("c4", "call_webmcp_tool", { tab_id: "tab1", name: "list_guests", frame_id: null, arguments: "not json" })];
      }
      expect(results.c4).toMatchObject({ is_error: true, text: expect.stringContaining("JSON object") });
      return [say("Stopped: the last call could not be made.")];
    });
    const outcome = await runBrowserAgent({ context, goal: "Read the guests.", playbook: PLAYBOOK, model, sleep: async () => {}, toolsTimeoutMs: 50 });
    expect(outcome).toMatchObject({ turns: 5, calls: 4, checkout_url: null });
  });

  it("reads Stagehand's response shapes into text and is_error", () => {
    expect(textOf(mcp({ a: 1 }))).toEqual({ text: '{"a":1}', is_error: false });
    expect(textOf(mcp({ error: "no" }, true))).toEqual({ text: '{"error":"no"}', is_error: true });
    expect(textOf({ status: "Error", errorText: "The tool threw." })).toEqual({ text: "The tool threw.", is_error: true });
    expect(textOf({ status: "Completed", output: { plain: true } })).toEqual({ text: '{"plain":true}', is_error: false });
  });
});
