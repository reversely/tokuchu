/**
 * The event's chat thread: the organizer's lines, the assistant's answers, and the system's posts
 * about what changed. One store for the panel, the assistant's history, the scheduler, and the
 * proactive posts, so every writer appends the same shape.
 */
import { newId, state } from "../domain/store";
import type { ChatMessage, ChatRole } from "../domain/types";

export type PostOptions = { tool_calls?: { tool: string; label: string }[]; schedule_id?: string | null; at?: string };

/** Appends one line to the event's thread and returns it. */
export function postMessage(eventId: string, role: ChatRole, text: string, options: PostOptions = {}): ChatMessage {
  const message: ChatMessage = { id: newId("msg"), event_id: eventId, role, text, at: options.at ?? new Date().toISOString(), tool_calls: options.tool_calls ?? [], schedule_id: options.schedule_id ?? null };
  state().messages.set(message.id, message);
  return message;
}

/** The thread in order; `limit` keeps the newest lines. */
export function messagesFor(eventId: string, limit?: number): ChatMessage[] {
  const all = [...state().messages.values()].filter((m) => m.event_id === eventId).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return limit ? all.slice(-limit) : all;
}

/** The newest system line, so a proactive post can avoid repeating it. */
export function lastSystemMessage(eventId: string): ChatMessage | null {
  const lines = messagesFor(eventId).filter((m) => m.role === "system");
  return lines[lines.length - 1] ?? null;
}
