/**
 * The proactive posts (#34) over a scripted model, on the curation agent test's pattern: the
 * script answers from the tool results, and the assertions check the chat lines the posts wrote.
 */
import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishEvent, resetState } from "../domain/store";
import type { PersonalizationField } from "../domain/types";
import { approveSpecs, createEventFromBody, createGiftFromBody, patchRsvp, requestFromAttendees, snapshot, submitRsvp } from "./api";
import { runCartFill, type CartJobDeps } from "./cart-job";
import { messagesFor, postMessage } from "./chat";
import { configureProactive, flushProactive } from "./proactive";
import type { StoreCall } from "./store-page";

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

/** Every tool result in the request so far, keyed by the tool's name through its callId. */
function outputsByName(request: ModelRequest): Record<string, unknown[]> {
  const items = request.input as { type?: string; name?: string; callId?: string; output?: { text?: string } }[];
  const nameByCall = new Map(items.filter((i) => i.type === "function_call").map((i) => [i.callId, i.name ?? ""]));
  const out: Record<string, unknown[]> = {};
  for (const i of items) {
    if (i.type !== "function_call_result") continue;
    (out[nameByCall.get(i.callId) ?? "unknown"] ??= []).push(JSON.parse(String(i.output?.text ?? "{}")));
  }
  return out;
}

/** The user turn's text in a request, whichever shape the runtime gave it. */
function userText(request: ModelRequest): string {
  return JSON.stringify(request.input);
}

const BODY = {
  title: "Astronomy Symposium",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "Toronto", region: "ON", postal_code: "M5V 1A1", country: "CA" },
  cost_per_person_cents: 5000
};

const FIELDS: PersonalizationField[] = [
  { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
  { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
];

function fakeStore(reply: (args: Record<string, unknown>) => StoreCall): CartJobDeps {
  return { withPage: async (_url, fn) => fn({ call: async (_name, args) => reply(args) }) };
}

/** A published event with a gift whose values were requested and one going guest who answered. */
async function seedCart() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const gift = createGiftFromBody(event.id, {
    product_id: "gid://shopify/Product/1",
    shop_domain: "springbuilt.myshopify.com",
    product_title: "Customized Crewneck",
    variants: [{ id: "101", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] }],
    personalization: { fields: FIELDS },
    default_variant_id: "101"
  });
  await requestFromAttendees(event.id, gift.id);
  const defs = snapshot(event.id).definitions;
  const id = (key: string) => defs.find((d) => d.key === key)!.id;
  submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [id("star_map_location")]: "Toronto" } }] });
  await flushProactive(event.id);
  return { event, gift };
}

describe("proactive posts (#34)", () => {
  beforeEach(() => {
    resetState();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    configureProactive({ delayMs: 60_000, llm: false });
  });
  afterEach(() => configureProactive(null));

  it("turns a burst of replies into one deterministic post that says what arrived and what is missing", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going" }] });
    submitRsvp(event.id, { party: {}, guests: [{ display_name: "Blake Rivera", status: "going" }] });
    submitRsvp(event.id, { party: { contact: { email: "c@b.co" } }, guests: [{ display_name: "Casey Park", status: "cant_go" }] });
    expect(messagesFor(event.id)).toEqual([]);
    await flushProactive(event.id);
    const lines = messagesFor(event.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ role: "system", schedule_id: null, text: "3 replies arrived: 2 going, 1 not going. 1 going guest has no email address, so a request cannot reach them." });
    // A flush with nothing noted posts nothing more.
    await flushProactive(event.id);
    expect(messagesFor(event.id)).toHaveLength(1);
  });

  it("counts only the replies since the last system line and never repeats it", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going" }] });
    await flushProactive(event.id);
    expect(messagesFor(event.id).map((m) => m.text)).toEqual(["1 reply arrived: 1 going. Nothing is waiting on you."]);
    await new Promise((r) => setTimeout(r, 2));
    const { guest_ids } = submitRsvp(event.id, { party: { contact: { email: "b@b.co" } }, guests: [{ display_name: "Blake Rivera", status: "maybe" }] });
    await flushProactive(event.id);
    expect(messagesFor(event.id).map((m) => m.text)).toEqual(["1 reply arrived: 1 going. Nothing is waiting on you.", "1 reply arrived: 1 maybe. Nothing is waiting on you."]);
    // An edit that changes no status and writes no answer has nothing to say.
    await new Promise((r) => setTimeout(r, 2));
    patchRsvp(event.id, guest_ids[0], { status: "maybe" });
    await flushProactive(event.id);
    expect(messagesFor(event.id)).toHaveLength(2);
  });

  it("posts the cart's outcome after the job reports, with the checkout link or the failure", async () => {
    const { event, gift } = await seedCart();
    approveSpecs(event.id, gift.id, new Date("2030-01-01T10:00:00Z"));
    await runCartFill(event.id, gift.id, fakeStore((args) => {
      const items = args.items as { recipient_ref: string; variant_id: string }[];
      return { isError: false, payload: { ready: items.map((i, n) => ({ recipient_ref: i.recipient_ref, cart_line_key: `key-${n}`, variant_id: i.variant_id })), blocked: [], checkout_url: "https://springbuilt.myshopify.com/cart/c/tok?key=abc" } };
    }));
    await flushProactive(event.id);
    const lines = messagesFor(event.id).map((m) => m.text);
    expect(lines[lines.length - 1]).toBe("The cart for Customized Crewneck at springbuilt.myshopify.com is ready to review: https://springbuilt.myshopify.com/cart/c/tok?key=abc.");

    await new Promise((r) => setTimeout(r, 2));
    await runCartFill(event.id, gift.id, fakeStore(() => ({ isError: true, payload: { error: "the store is closed" } })));
    await flushProactive(event.id);
    const after = messagesFor(event.id).map((m) => m.text);
    expect(after[after.length - 1]).toBe("The cart for Customized Crewneck failed: The store did not fill the cart: the store is closed. Fix the rows it names and approve again.");
  });

  it("with the model on, asks the agent to read the state and say only what changed, naming the last system line", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    postMessage(event.id, "system", "Status: nothing yet.");
    const model = scriptedModel((request, turn) => {
      if (turn === 1) return [call("c1", "read_event", {})];
      const counts = (outputsByName(request).read_event![0] as { counts: { going: number; maybe: number } }).counts;
      return [say(`${counts.going} going and ${counts.maybe} maybe replied; ask the maybe to decide before the deadline.`)];
    });
    configureProactive({ delayMs: 60_000, llm: true, model });
    submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going" }, { display_name: "Blake Rivera", status: "maybe" }] });
    submitRsvp(event.id, { party: { contact: { email: "c@b.co" } }, guests: [{ display_name: "Casey Park", status: "going" }] });
    await flushProactive(event.id);
    expect(model.requests).toHaveLength(2);
    const asked = userText(model.requests[0]);
    expect(asked).toMatch(/RSVP replies were written/);
    expect(asked).toMatch(/say only what changed and what to do about it/);
    expect(asked).toMatch(/The last system line said: \\"Status: nothing yet\.\\"\. Do not repeat it\./);
    expect(messagesFor(event.id).map((m) => [m.role, m.text])).toEqual([
      ["system", "Status: nothing yet."],
      ["system", "2 going and 1 maybe replied; ask the maybe to decide before the deadline."]
    ]);
  });

  it("with the model on, a cart result names the gift in the prompt and NOTHING posts no line", async () => {
    const { event, gift } = await seedCart();
    const model = scriptedModel((request) => {
      expect(userText(request)).toMatch(new RegExp(`the cart job reported on gift ${gift.id}`));
      return [say("NOTHING")];
    });
    configureProactive({ delayMs: 60_000, llm: true, model });
    const before = messagesFor(event.id).length;
    approveSpecs(event.id, gift.id);
    await runCartFill(event.id, gift.id, fakeStore(() => ({ isError: true, payload: { error: "closed" } })));
    await flushProactive(event.id);
    expect(model.requests).toHaveLength(1);
    expect(messagesFor(event.id)).toHaveLength(before);
  });
});
