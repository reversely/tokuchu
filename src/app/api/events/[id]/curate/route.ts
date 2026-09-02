import { NextResponse } from "next/server";
import { runCurationAgent } from "../../../../../agent/curation-agent";
import { BadRequestError, errorResponse, requireEvent } from "../../../../../server/api";
import { llmEnabled } from "../../../../../server/flags";
import { withOwnedEvent } from "../../../../../server/ownership";
import { withPersistedEvent } from "../../../../../server/persistence";

type Params = { params: Promise<{ id: string }> };

/**
 * One CurationAgent turn (#120). Body: { message: string }. Returns { response, proposal?,
 * tool_calls, trace_id? }; with ?stream=1 the same run arrives as NDJSON lines, one
 * { kind: "tool", tool, label } per tool start and a final { kind: "done", ...result }, so the
 * page can name the current tool activity while the model works. With LLM_ENABLED off the route
 * answers 501 before reading the body, so no run starts and the agent SDK stays unloaded.
 */
export async function POST(request: Request, { params }: Params) {
  if (!llmEnabled()) return NextResponse.json({ error: "The curation agent is switched off" }, { status: 501 });
  try {
    const { id } = await params;
    const body = (await request.json()) as { message?: string };
    const message = body.message?.trim();
    if (!message) throw new BadRequestError("Send a message.");
    if (new URL(request.url).searchParams.get("stream") === "1") {
      await withOwnedEvent(id, () => requireEvent(id));
      return streamRun(id, message);
    }
    return await withOwnedEvent(id, async () => NextResponse.json(await runCurationAgent({ eventId: requireEvent(id).id }, message)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** The agent runs in its own persisted scope, which writes the event before the final line goes out; the ownership check ran before the stream opened. */
function streamRun(eventId: string, message: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (line: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      withPersistedEvent(eventId, () => runCurationAgent({ eventId }, message, { onTool: (call) => send({ kind: "tool", ...call }) }))
        .then((result) => send({ kind: "done", ...result }))
        .catch((e) => send({ kind: "error", error: e instanceof Error ? e.message : String(e) }))
        .finally(() => controller.close());
    }
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
