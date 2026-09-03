/**
 * The agent trace (#55): one entry per WebMCP or UCP call the app makes or answers, on the event
 * it concerns. Every call path records through `traced`, which times the call and summarizes its
 * arguments and result, or through `traceClient`, which wraps a catalog client so each of its
 * calls records itself. Summaries keep top-level scalars and the shapes of nested values, so a
 * secret in a header or an attendee's full row never lands in the store.
 */
import type { CatalogClient } from "@webmcp/shopify-ucp";
import { GLOBAL_CATALOG_ENDPOINT } from "@webmcp/shopify-ucp";
import { newId, state } from "../domain/store";
import type { AccessGrant, TraceEntry, TraceSide, TraceTransport } from "../domain/types";
import type { StorePage } from "./store-page";

/** How many entries the snapshot carries, newest first. */
export const TRACE_SNAPSHOT_CAP = 200;
/** How many entries one event keeps; the oldest drop past it so a document stays bounded. */
export const TRACE_STORE_CAP = 500;
/** The longest summary stored. */
export const SUMMARY_LENGTH = 300;
/** The longest single string kept inside a summary. */
const SCALAR_LENGTH = 80;

export type TraceDraft = Omit<TraceEntry, "id" | "event_id" | "at" | "gift_id" | "guest_id" | "caller"> & { at?: string; gift_id?: string | null; guest_id?: string | null; caller?: string | null };

/** Appends one entry and returns it; past the store cap the oldest entry of the event drops. */
export function recordTrace(eventId: string, draft: TraceDraft): TraceEntry {
  const s = state();
  const entry: TraceEntry = { ...draft, id: newId("trace"), event_id: eventId, at: draft.at ?? new Date().toISOString(), gift_id: draft.gift_id ?? null, guest_id: draft.guest_id ?? null, caller: draft.caller ?? null };
  s.traces.set(entry.id, entry);
  const own = [...s.traces.values()].filter((t) => t.event_id === eventId);
  for (const old of own.slice(0, Math.max(0, own.length - TRACE_STORE_CAP))) s.traces.delete(old.id);
  return entry;
}

export type TraceQuery = { gift?: string; since?: string; limit?: number };

/** The event's entries newest first; `gift` keeps one gift's, `since` those after an ISO time, and `limit` the newest few. */
export function tracesFor(eventId: string, query: TraceQuery = {}): TraceEntry[] {
  const rows = [...state().traces.values()].filter((t) => t.event_id === eventId && (query.gift === undefined || t.gift_id === query.gift) && (query.since === undefined || t.at > query.since));
  rows.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return query.limit === undefined ? rows : rows.slice(0, query.limit);
}

/** The entries a grant's holder may see: the calls about the grant's procurement and nothing about the rest of the event. */
export function tracesForGrant(eventId: string, grant: Pick<AccessGrant, "procurement_id">, query: Omit<TraceQuery, "gift"> = {}): TraceEntry[] {
  return tracesFor(eventId, { ...query, gift: grant.procurement_id });
}

/* ---- Summaries ---- */

const clip = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);

/** Merchant and attendee prose the agent tools mark as untrusted stays out of a summary. */
const hidden = (key: string) => key.startsWith("untrusted_");

/**
 * A short JSON-like description of a value: a scalar as itself, an array as its length, an object
 * as its top-level scalars with each nested value reduced to its shape. Nested rows stay out, so
 * a manifest summarizes as `attendees: [3]` and never as the attendees' values.
 */
export function summarize(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return clip(value, SUMMARY_LENGTH);
  if (typeof value !== "object" || value === null) return clip(JSON.stringify(value), SUMMARY_LENGTH);
  if (Array.isArray(value)) return `[${value.length}]`;
  const parts: string[] = [];
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (hidden(key) || v === undefined) continue;
    if (Array.isArray(v)) parts.push(`${key}: [${v.length}]`);
    else if (v !== null && typeof v === "object") parts.push(`${key}: {${Object.keys(v as object).length}}`);
    else parts.push(`${key}: ${typeof v === "string" ? JSON.stringify(clip(v, SCALAR_LENGTH)) : String(v)}`);
  }
  return clip(`{ ${parts.join(", ")} }`, SUMMARY_LENGTH);
}

/** The message of a throw, for a failed entry's result. */
export function errorSummary(e: unknown): string {
  return clip(e instanceof Error ? e.message : String(e), SUMMARY_LENGTH);
}

/* ---- The timing helper ---- */

export type TraceCall = { side: TraceSide; transport: TraceTransport; endpoint: string; tool: string; args: unknown; gift_id?: string | null; guest_id?: string | null; caller?: string | null };

export type TraceOptions<T> = {
  /** The argument summary, when the default would carry too much (a cart's items) or too little. */
  args?: string;
  /** The result summary from the value, when the default shape reads poorly. */
  result?: (value: T) => string;
  /** Whether a returned value counts as success; a tool reply with `isError` does not. */
  ok?: (value: T) => boolean;
  /** Where the entry goes; the default writes to the current State, and a call outside a persisted scope hands in its own writer. */
  record?: (draft: TraceDraft) => void | Promise<void>;
};

/**
 * Runs `run`, times it, and records one entry: ok with the result's summary, or failed with the
 * error's message before the error propagates.
 */
export async function traced<T>(eventId: string, call: TraceCall, run: () => Promise<T>, options: TraceOptions<T> = {}): Promise<T> {
  const started = Date.now();
  const record = options.record ?? ((draft: TraceDraft) => void recordTrace(eventId, draft));
  const base = { side: call.side, transport: call.transport, endpoint: call.endpoint, tool: call.tool, args: options.args ?? summarize(call.args), gift_id: call.gift_id ?? null, guest_id: call.guest_id ?? null, caller: call.caller ?? null };
  try {
    const value = await run();
    await record({ ...base, ok: options.ok ? options.ok(value) : true, result: options.result ? options.result(value) : summarize(value), duration_ms: Date.now() - started });
    return value;
  } catch (e) {
    await record({ ...base, ok: false, result: errorSummary(e), duration_ms: Date.now() - started });
    throw e;
  }
}

/* ---- Wrappers for the two clients ---- */

/** The side an endpoint belongs to: Shopify's Global Catalog, or a store's own UCP endpoint. */
export function sideOf(endpoint: string): TraceSide {
  return endpoint === GLOBAL_CATALOG_ENDPOINT ? "catalog" : "store";
}

export type ClientTrace = { gift_id?: string | null; record?: TraceOptions<unknown>["record"] };

/** The same client with every call recorded on the event; a client derived with `withEndpoint` records too. */
export function traceClient(eventId: string, client: CatalogClient, meta: ClientTrace = {}): CatalogClient {
  const wrap = <T>(tool: string, args: unknown, run: () => Promise<T>) => traced(eventId, { side: sideOf(client.endpoint), transport: "ucp", endpoint: client.endpoint, tool, args, gift_id: meta.gift_id }, run, { record: meta.record });
  return {
    endpoint: client.endpoint,
    profileUrl: client.profileUrl,
    searchCatalog: (params) => wrap("search_catalog", params, () => client.searchCatalog(params)),
    lookupCatalog: (ids, options) => wrap("lookup_catalog", { ids, ...options }, () => client.lookupCatalog(ids, options)),
    getProduct: (id, options) => wrap("get_product", { id, ...options }, () => client.getProduct(id, options)),
    callTool: (name, args, schema) => wrap(name, args, () => client.callTool(name, args, schema)),
    withEndpoint: (other) => traceClient(eventId, client.withEndpoint(other), meta)
  };
}

export type PageTrace = { gift_id?: string | null; record?: TraceOptions<unknown>["record"] };

/** A store page whose every merchant-tool call records as a page-tool entry against the page's URL. */
export function tracePage(eventId: string, pageUrl: string, page: StorePage, meta: PageTrace = {}): StorePage {
  return {
    call: (name, args) =>
      traced(eventId, { side: "store", transport: "page-tool", endpoint: pageUrl, tool: name, args, gift_id: meta.gift_id }, () => page.call(name, args), {
        ok: (reply) => !reply.isError,
        result: (reply) => summarize(reply.payload),
        record: meta.record
      })
  };
}

/** The `withStorePage` shape with the page traced, for a caller that takes the opener as a dependency. */
export function tracedStorePage(eventId: string, withPage: <T>(pageUrl: string, fn: (page: StorePage) => Promise<T>) => Promise<T>, meta: PageTrace = {}): <T>(pageUrl: string, fn: (page: StorePage) => Promise<T>) => Promise<T> {
  return (pageUrl, fn) => withPage(pageUrl, (page) => fn(tracePage(eventId, pageUrl, page, meta)));
}
