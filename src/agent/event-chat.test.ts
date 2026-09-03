/**
 * A chat turn over a scripted model (#31): the prior thread reaches the model as input items in
 * order, the organizer's line and the assistant's reply land on the thread with the tools the run
 * called, and nothing reaches the network.
 */
import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { beforeEach, describe, expect, it } from "vitest";
import { resetState } from "../domain/store";
import { createEventFromBody } from "../server/api";
import { messagesFor, postMessage } from "../server/chat";
import { chatTurn, HISTORY_LIMIT } from "./event-chat";

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

type Item = { type?: string; role?: string; content?: unknown };

/** The message items of a request as role and text pairs, in order. */
function transcript(request: ModelRequest): [string, string][] {
  return (request.input as Item[])
    .filter((i) => i.role)
    .map((i) => [i.role!, typeof i.content === "string" ? i.content : (i.content as { text: string }[]).map((c) => c.text).join("")]);
}

const BODY = { title: "Chat event", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };

describe("chatTurn (#31)", () => {
  beforeEach(resetState);

  it("passes the thread so far as history, stores both lines, and keeps the tool calls on the reply", async () => {
    const event = createEventFromBody(BODY);
    postMessage(event.id, "organizer", "How many are going?", { at: "2026-09-01T10:00:00.000Z" });
    postMessage(event.id, "assistant", "Nobody has replied yet.", { at: "2026-09-01T10:00:05.000Z" });
    postMessage(event.id, "system", "The request for the caption went out to two attendees.", { at: "2026-09-01T11:00:00.000Z" });

    const model = scriptedModel((request, turn) => {
      if (turn === 1) return [call("c1", "read_status", {})];
      return [say("Still nobody going; both requests are open.")];
    });
    const seen: string[] = [];
    const turn = await chatTurn(event.id, "Any change?", { model, onTool: (c) => seen.push(c.label) });

    // The model saw the whole thread in order, with the system post as a system line and the new message last.
    expect(transcript(model.requests[0])).toEqual([
      ["user", "How many are going?"],
      ["assistant", "Nobody has replied yet."],
      ["system", "The request for the caption went out to two attendees."],
      ["user", "Any change?"]
    ]);
    expect(model.requests[0].systemInstructions).toMatch(/Lead with the most salient fact/);
    expect(model.requests[0].systemInstructions).toMatch(/cannot schedule/);
    expect(seen).toEqual(["Reading the event's status"]);

    // The thread carries the organizer's line and the reply with its tool calls.
    const thread = messagesFor(event.id);
    expect(thread.map((m) => [m.role, m.text])).toEqual([
      ["organizer", "How many are going?"],
      ["assistant", "Nobody has replied yet."],
      ["system", "The request for the caption went out to two attendees."],
      ["organizer", "Any change?"],
      ["assistant", "Still nobody going; both requests are open."]
    ]);
    expect(turn.message).toMatchObject({ role: "assistant", tool_calls: [{ tool: "read_status", label: "Reading the event's status" }] });
    expect(thread[4].id).toBe(turn.message.id);
  });

  it("sends only the newest lines of a long thread", async () => {
    const event = createEventFromBody(BODY);
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) postMessage(event.id, "organizer", `Line ${i}`, { at: `2026-09-01T10:${String(i).padStart(2, "0")}:00.000Z` });
    const model = scriptedModel(() => [say("Noted.")]);
    await chatTurn(event.id, "Latest", { model });
    const lines = transcript(model.requests[0]);
    expect(lines).toHaveLength(HISTORY_LIMIT + 1);
    expect(lines[0]).toEqual(["user", "Line 5"]);
    expect(lines[lines.length - 1]).toEqual(["user", "Latest"]);
  });

  it("keeps the organizer's line and adds no reply when the run fails", async () => {
    const event = createEventFromBody(BODY);
    const model = scriptedModel(() => {
      throw new Error("model down");
    });
    await expect(chatTurn(event.id, "Hello", { model })).rejects.toThrow(/model down/);
    expect(messagesFor(event.id).map((m) => m.role)).toEqual(["organizer"]);
  });
});
