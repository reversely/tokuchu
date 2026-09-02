/**
 * Registers Tokuchu's tools on `document.modelContext` and routes each call to the API with the
 * organizer's identity (the page's own session). A result is MCP-shaped: text content, isError on
 * a failed request. Aborting `signal` unregisters every tool.
 */
import type { AttributeDefinition, GuestStatus } from "../domain/types";
import { sendRsvp } from "../app/i/[code]/send-rsvp";
import { buildRequest, rsvpAnswers, rsvpInputSchema, TOOLS, type ToolArgs, type ToolDefinition } from "./tools";
import { withDemoHeaders } from "../demo/token";

export interface ToolResult {
  content: [{ type: "text"; text: string }];
  isError?: true;
}
export type ToolCallEvent = { name: string; args: ToolArgs; result: ToolResult; ok: boolean; duration_ms: number };
export type RegisterResult = { supported: false } | { supported: true; toolNames: string[] };

function textResult(payload: unknown, isError: boolean): ToolResult {
  const result: ToolResult = { content: [{ type: "text", text: JSON.stringify(payload) }] };
  if (isError) result.isError = true;
  return result;
}

export async function executeThroughApi(tool: ToolDefinition, eventId: string, args: ToolArgs, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<ToolResult> {
  const { url, init } = buildRequest(tool, eventId, args ?? {});
  try {
    const response = await fetchImpl(url, withDemoHeaders({ ...init, signal }));
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text };
    }
    if (!response.ok) return textResult({ error: (body as { error?: string })?.error ?? response.statusText ?? `HTTP ${response.status}`, status: response.status }, true);
    return textResult(body, false);
  } catch (cause) {
    return textResult({ error: cause instanceof Error ? cause.message : String(cause) }, true);
  }
}

export async function registerTokuchuTools({ eventId, fetchImpl, signal, onToolCall }: { eventId: string; fetchImpl?: typeof fetch; signal: AbortSignal; onToolCall?: (event: ToolCallEvent) => void }): Promise<RegisterResult> {
  const modelContext = document.modelContext;
  if (!modelContext) return { supported: false };
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const organizerTools = TOOLS.filter((t) => t.scopes.includes("organizer"));
  for (const tool of organizerTools) {
    await modelContext.registerTool(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (args, options) => {
          const started = Date.now();
          const result = await executeThroughApi(tool, eventId, (args ?? {}) as ToolArgs, doFetch, options?.signal);
          onToolCall?.({ name: tool.name, args: (args ?? {}) as ToolArgs, result, ok: !result.isError, duration_ms: Date.now() - started });
          return result;
        }
      },
      { signal }
    );
  }
  return { supported: true, toolNames: organizerTools.map((t) => t.name) };
}

/**
 * Registers submit_rsvp on the invite page with a schema built from the questions the attendee is
 * asked. A call runs the same sendRsvp the form runs; the link's guest id is the default record, and
 * a 400 constraint failure comes back as an error result with the route's detail.
 */
export async function registerRsvpTool({ eventId, guestId, definitions, responseOptions, fetchImpl, signal, onToolCall }: { eventId: string; guestId: string | null; definitions: AttributeDefinition[]; responseOptions: GuestStatus[]; fetchImpl?: typeof fetch; signal: AbortSignal; onToolCall?: (event: ToolCallEvent) => void }): Promise<RegisterResult> {
  const modelContext = document.modelContext;
  if (!modelContext) return { supported: false };
  const tool = TOOLS.find((t) => t.name === "submit_rsvp")!;
  const keyOf = new Map(definitions.map((d) => [d.id, d.key]));
  await modelContext.registerTool(
    {
      name: tool.name,
      description: tool.description,
      inputSchema: rsvpInputSchema(definitions, responseOptions),
      execute: async (raw) => {
        const started = Date.now();
        const args = (raw ?? {}) as ToolArgs;
        const outcome = await sendRsvp({ eventId, guestId: typeof args.guest_id === "string" && args.guest_id ? args.guest_id : guestId, displayName: String(args.display_name ?? ""), status: args.status as GuestStatus, answers: rsvpAnswers(definitions, args) }, fetchImpl ?? globalThis.fetch.bind(globalThis));
        const result = outcome.ok
          ? textResult({ guest_id: outcome.guest.id, display_name: outcome.guest.display_name, status: outcome.guest.status, answers: Object.fromEntries(Object.entries(outcome.guest.values).map(([id, value]) => [keyOf.get(id) ?? id, value])) }, false)
          : textResult({ error: outcome.error, status: outcome.status }, true);
        onToolCall?.({ name: tool.name, args, result, ok: !result.isError, duration_ms: Date.now() - started });
        return result;
      }
    },
    { signal }
  );
  return { supported: true, toolNames: [tool.name] };
}
