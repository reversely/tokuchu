/**
 * The chat route (#31): POST sits behind LLM_ENABLED and never loads the agent SDK while off; GET
 * returns the stored thread for the event's owner. The mock factory runs only when some module first
 * imports `@openai/agents`, so its counter records whether the SDK entered the module graph.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetState } from "../../../../../domain/store";
import { createEventFromBody } from "../../../../../server/api";
import { postMessage } from "../../../../../server/chat";
import { LOCAL_ORGANIZER_ID, setDemoIdReader, setSessionReader } from "../../../../../server/ownership";
import { GET, POST } from "./route";

const sdkLoads = vi.hoisted(() => ({ count: 0 }));

vi.mock("@openai/agents", async (importOriginal) => {
  sdkLoads.count += 1;
  return importOriginal();
});

/** The route runs with no session and no database, so the local organizer is the caller. */
beforeAll(() => {
  setSessionReader(async () => null);
  setDemoIdReader(async () => null);
});
afterAll(() => {
  setSessionReader(null);
  setDemoIdReader(null);
});

const before = process.env.LLM_ENABLED;
afterEach(() => {
  if (before === undefined) delete process.env.LLM_ENABLED;
  else process.env.LLM_ENABLED = before;
  resetState();
});

const BODY = { title: "Chat event", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };

function post(id: string, message = "Who has not replied?") {
  const request = new Request(`http://localhost/api/events/${id}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
  return POST(request, { params: Promise.resolve({ id }) });
}

function get(id: string) {
  return GET(new Request(`http://localhost/api/events/${id}/chat`), { params: Promise.resolve({ id }) });
}

describe("POST /api/events/[id]/chat", () => {
  it("answers 501 with the flag unset and never loads the agent SDK", async () => {
    delete process.env.LLM_ENABLED;
    const res = await post("evt_missing");
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ error: "The assistant is switched off on this server" });
    expect(sdkLoads.count).toBe(0);
  });

  it("passes the gate with the flag on and reaches the event lookup", async () => {
    process.env.LLM_ENABLED = "1";
    const res = await post("evt_missing");
    expect(res.status).toBe(404);
  });

  it("refuses an empty message before any run", async () => {
    process.env.LLM_ENABLED = "1";
    const event = createEventFromBody(BODY, LOCAL_ORGANIZER_ID);
    const res = await post(event.id, "   ");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/events/[id]/chat", () => {
  it("returns the thread in order with each line's role and tool calls", async () => {
    const event = createEventFromBody(BODY, LOCAL_ORGANIZER_ID);
    postMessage(event.id, "organizer", "Who has not replied?", { at: "2026-09-01T10:00:00.000Z" });
    postMessage(event.id, "assistant", "Two guests have not replied.", { at: "2026-09-01T10:00:05.000Z", tool_calls: [{ tool: "read_status", label: "Reading the event's status" }] });
    const res = await get(event.id);
    expect(res.status).toBe(200);
    const { messages } = (await res.json()) as { messages: { role: string; text: string; tool_calls: { tool: string }[] }[] };
    expect(messages.map((m) => m.role)).toEqual(["organizer", "assistant"]);
    expect(messages[1].tool_calls).toEqual([{ tool: "read_status", label: "Reading the event's status" }]);
  });

  it("answers 404 for an event that does not exist", async () => {
    const res = await get("evt_missing");
    expect(res.status).toBe(404);
  });
});
