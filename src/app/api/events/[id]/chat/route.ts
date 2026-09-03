import { NextResponse } from "next/server";
import { chatTurn } from "../../../../../agent/event-chat";
import { messagesFor } from "../../../../../server/chat";
import { BadRequestError, errorResponse, requireEvent } from "../../../../../server/api";
import { llmEnabled } from "../../../../../server/flags";
import { withOwnedEvent } from "../../../../../server/ownership";
import { withPersistedEvent } from "../../../../../server/persistence";

type Params = { params: Promise<{ id: string }> };

/** The event's thread in order, for a panel that reads it apart from the snapshot. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withOwnedEvent(id, () => NextResponse.json({ messages: messagesFor(requireEvent(id).id) }));
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * One chat turn (#31). Body: { message: string }. Returns { message, tool_calls } with the
 * assistant's stored line; with ?stream=1 the same turn arrives as NDJSON, one
 * { kind: "tool", tool, label } per tool start and a final { kind: "done", message, tool_calls },
 * so the panel can name the running tool. With LLM_ENABLED off the route answers 501 before
 * reading the body, so no run starts and the agent SDK stays unloaded.
 */
export async function POST(request: Request, { params }: Params) {
  if (!llmEnabled()) return NextResponse.json({ error: "The assistant is switched off on this server" }, { status: 501 });
  try {
    const { id } = await params;
    const body = (await request.json()) as { message?: string };
    const message = body.message?.trim();
    if (!message) throw new BadRequestError("Send a message.");
    if (new URL(request.url).searchParams.get("stream") === "1") {
      await withOwnedEvent(id, () => requireEvent(id));
      return streamTurn(id, message);
    }
    return await withOwnedEvent(id, async () => NextResponse.json(await chatTurn(requireEvent(id).id, message)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** The turn runs in its own persisted scope, which writes the event before the final line goes out; the ownership check ran before the stream opened. */
function streamTurn(eventId: string, message: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      withPersistedEvent(eventId, () => chatTurn(eventId, message, { onTool: (call) => send({ kind: "tool", ...call }) }))
        .then((turn) => send({ kind: "done", ...turn }))
        .catch((e) => send({ kind: "error", error: e instanceof Error ? e.message : String(e) }))
        .finally(() => controller.close());
    }
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
