/**
 * One chat turn on the event's thread (#31): the organizer's line is stored, the assistant runs
 * with the thread so far as its history, and the assistant's reply is stored with the tools it
 * called. The route streams the tool labels through `onTool` while the run works.
 */
import { messagesFor, postMessage } from "../server/chat";
import type { ChatMessage } from "../domain/types";
import { runCurationAgent, type RunOptions } from "./curation-agent";

/** How much of the thread the model sees: the newest lines, oldest first. */
export const HISTORY_LIMIT = 30;

export type ChatTurn = { message: ChatMessage; tool_calls: { tool: string; label: string }[] };

/**
 * Stores the organizer's line, runs the assistant over the prior thread, and stores its reply.
 * A run that throws leaves the organizer's line in place and no assistant line.
 */
export async function chatTurn(eventId: string, text: string, options: RunOptions = {}): Promise<ChatTurn> {
  const history = messagesFor(eventId, HISTORY_LIMIT);
  postMessage(eventId, "organizer", text);
  const result = await runCurationAgent({ eventId }, text, { ...options, history });
  const message = postMessage(eventId, "assistant", result.response, { tool_calls: result.tool_calls });
  return { message, tool_calls: result.tool_calls };
}
