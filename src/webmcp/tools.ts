/**
 * Tokuchu's tools as data (PRD Section 7): one definition per tool, with the API route it maps to.
 * register.ts renders the list onto `document.modelContext` in the organizer's page; the MCP
 * endpoint (#91) serves the same list over HTTP. The model sees only name, description, and
 * inputSchema, so those three carry the whole contract.
 */
import type { AttributeDefinition, GuestStatus } from "../domain/types";

export type ToolArgs = Record<string, unknown>;
export type Scope = "organizer" | "vendor" | "attendee";

export interface JsonSchemaProperty {
  type: "string" | "integer" | "number" | "boolean" | "object" | "array";
  description: string;
  enum?: readonly string[];
  items?: { type: string; enum?: readonly string[] };
  maxLength?: number;
  pattern?: string;
  format?: "date";
  minimum?: number;
  maximum?: number;
}
export interface JsonObjectSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: false;
}
export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH";
  /** Path template; `:eventId` and any argument in braces are substituted at call time. */
  path: string;
  /** Query parameters built from the arguments, for GET. */
  query?: (args: ToolArgs) => Record<string, string | undefined>;
  /** The JSON body built from the arguments, for writes. */
  body?: (args: ToolArgs) => unknown;
}
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonObjectSchema;
  scopes: Scope[];
  route: Route;
}

const REPLY = { type: "string", description: "The attendee's reply", enum: ["going", "maybe", "cant_go"] } as const;
const DISPLAY_NAME = { type: "string", description: "The attendee's name as the organizer's list shows it" } as const;
const EMAIL = { type: "string", description: "The attendee's email address; a later request for missing details goes there. Required for a reply of going or maybe" } as const;
const GUEST_ID = { type: "string", description: "The guest id an earlier reply returned; send it to edit the same record" } as const;

const FILTER = { type: "string", description: "A filter as field:op:value clauses joined by ';' (fields: status, role, attendance.<segment id>, party.size, or a definition id; ops: eq, neq, in, not_in, gt, gte, lt, lte, contains, present, missing). Empty means every guest." } as const;
const FIELDS = { type: "array", description: "Definition ids to include; empty means every value the caller may read.", items: { type: "string" } } as const;
const csv = (v: unknown) => (Array.isArray(v) ? v.map(String).join(",") : typeof v === "string" ? v : undefined);
const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));

export const TOOLS: ToolDefinition[] = [
  {
    name: "submit_rsvp",
    description: "Records the attendee's reply and answers on this invite. The schema lists one property per question the attendee has been asked with the store's limits. A first call creates the guest and returns a guest_id; a call with that guest_id edits the same record.",
    inputSchema: { type: "object", properties: { display_name: DISPLAY_NAME, status: REPLY, email: EMAIL, guest_id: GUEST_ID }, required: ["display_name", "status", "email"], additionalProperties: false },
    scopes: ["attendee"],
    // The invite page rebuilds inputSchema from its questions with rsvpInputSchema and sends an edit as PATCH /rsvp/{guest_id} (send-rsvp.ts).
    route: { method: "POST", path: "/api/events/:eventId/rsvp", body: (a) => ({ ...(a.email ? { party: { contact: { email: a.email } } } : {}), guests: [{ display_name: a.display_name, status: a.status, answers: a.answers ?? {} }] }) }
  },
  {
    name: "get_guest",
    description: "Returns one guest with their status and the answers the caller may read.",
    inputSchema: { type: "object", properties: { guest_id: { type: "string", description: "The guest's id" }, fields: FIELDS }, required: ["guest_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "GET", path: "/api/events/:eventId/guests/{guest_id}", query: (a) => ({ fields: csv(a.fields) }) }
  },
  {
    name: "list_guests",
    description: "Lists the guests a filter matches with their status and answers. Use it to see who is going, who is a maybe, or who has a given value.",
    inputSchema: { type: "object", properties: { filter: FILTER, fields: FIELDS }, additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "GET", path: "/api/events/:eventId/guests", query: (a) => ({ filter: str(a.filter), fields: csv(a.fields) }) }
  },
  {
    name: "count_by",
    description: "Counts guests by one question's answers: per choice for a choice question, sum and buckets for a number, true and false for yes or no. Use it before answering how many guests need each variant.",
    inputSchema: { type: "object", properties: { definition_id: { type: "string", description: "The question's definition id" }, filter: FILTER }, required: ["definition_id"], additionalProperties: false },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/counts", query: (a) => ({ definition: str(a.definition_id), filter: str(a.filter) }) }
  },
  {
    name: "list_missing",
    description: "Lists the guests a filter matches who have not answered one question. Use it to find who still needs to give a value.",
    inputSchema: { type: "object", properties: { definition_id: { type: "string", description: "The question's definition id" }, filter: FILTER }, required: ["definition_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "GET", path: "/api/events/:eventId/missing", query: (a) => ({ definition: str(a.definition_id), filter: str(a.filter) }) }
  },
  {
    name: "get_summary",
    description: "Returns the status counts and count_by for several questions in one call. Use it first when a question needs the whole picture of the replies.",
    inputSchema: { type: "object", properties: { filter: FILTER, definition_ids: FIELDS }, additionalProperties: false },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/summary", query: (a) => ({ filter: str(a.filter), definitions: csv(a.definition_ids) }) }
  },
  {
    name: "get_manifest",
    description: "Returns one row per guest for a gift: product, variant, unit status, and the values the caller may read. A store's agent reads its batch here.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/gifts/{gift_id}/manifest" }
  },
  {
    name: "get_fulfillment_manifest",
    description: "Returns the fulfillment manifest of a procurement: its revision and approved revision, its status, and one row per attendee with a status (ready, incomplete, invalid, or exception), the values keyed by the store's requirement key, and the issues per requirement. A store's agent sees only the requirements its token may read. The gift is the procurement until a Procurement record exists, so procurement_id and gift_id name the same record.",
    inputSchema: {
      type: "object",
      properties: {
        procurement_id: { type: "string", description: "The procurement's id; the gift's id until a Procurement record exists" },
        gift_id: { type: "string", description: "The gift's id; the same record as procurement_id" }
      },
      additionalProperties: false
    },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/gifts/{gift_id}/fulfillment" }
  },
  {
    name: "get_changes",
    description: "Returns the changes to a procurement after a revision: each with its revision, timestamp, actor, type, the attendee and requirement it concerns, and a one-line summary. Call it with the current_revision of the last manifest or change list you read. The gift is the procurement until a Procurement record exists, so procurement_id and gift_id name the same record. Without a gift the call returns the event's whole change log after since_seq.",
    inputSchema: {
      type: "object",
      properties: {
        procurement_id: { type: "string", description: "The procurement's id; the gift's id until a Procurement record exists" },
        gift_id: { type: "string", description: "The gift's id; the same record as procurement_id" },
        after_revision: { type: "integer", description: "The revision already seen; 0 for every change" },
        since_seq: { type: "integer", description: "For the event-wide log without a gift: the last sequence number already seen; 0 for everything" }
      },
      additionalProperties: false
    },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/changes", query: (a) => ({ since: str(a.since_seq ?? 0), gift: str(a.gift_id ?? a.procurement_id), after: str(a.after_revision) }) }
  },
  {
    name: "search_gifts",
    description: "Searches Shopify's catalog for a gift for the guests: a card (gift_sets, food_drink, apparel, stationery) or a sentence, shipping to the venue, under the cost per person, with delivery to the venue checked for each candidate. Returns the ranked products, the excluded ones with the rule that excluded each, and the funnel per search.",
    inputSchema: { type: "object", properties: { card: { type: "string", description: "A card key", enum: ["gift_sets", "food_drink", "apparel", "stationery"] }, sentence: { type: "string", description: "The gift in the organizer's words, when no card fits" } }, additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "POST", path: "/api/events/:eventId/search", body: (a) => ({ card: a.card, sentence: a.sentence }) }
  },
  {
    name: "set_gift_plan",
    description: "Replaces a gift's plan: the ordered rules that assign a product to guests by filter. The first rule whose filter matches a guest wins.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" }, rules: { type: "array", description: "Rules as {filter, product_id} in order", items: { type: "object" } } }, required: ["gift_id", "rules"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "PATCH", path: "/api/events/:eventId/gifts/{gift_id}", body: (a) => ({ rules: a.rules }) }
  },
  {
    name: "set_personalization_mapping",
    description: "Replaces a personalized gift's field mappings: each row sends an RSVP definition, an event field (title, starts_at, venue), the guest's display_name, or a literal into one vendor field of the selected product, with an optional transform (uppercase, lowercase, date_only, location_query). Use it after choosing a product with personalization fields.",
    inputSchema: {
      type: "object",
      properties: {
        gift_id: { type: "string", description: "The gift's id" },
        mappings: { type: "array", description: "Rows as {vendor_field_key, source, transform?}; source is {type: 'definition', definition_id, subject_scope}, {type: 'event', key}, {type: 'guest', key: 'display_name'} or {type: 'literal', value}", items: { type: "object" } }
      },
      required: ["gift_id", "mappings"],
      additionalProperties: false
    },
    scopes: ["organizer"],
    route: { method: "POST", path: "/api/events/:eventId/gifts/{gift_id}/personalization", body: (a) => ({ mappings: a.mappings }) }
  },
  {
    name: "get_requirements",
    description: "Returns the requirements of a gift's product with the source that fills each: the guest's own row, an event field, a literal, an existing question, or a question a request would create. Call it before request_from_attendees to see what attendees will be asked.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "GET", path: "/api/events/:eventId/gifts/{gift_id}/request-fields" }
  },
  {
    name: "request_from_attendees",
    description: "Creates the questions a gift's product still needs and records a request to every going attendee who lacks an answer and emails each one their own link. Returns the event snapshot with the requests.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "POST", path: "/api/events/:eventId/gifts/{gift_id}/request-fields" }
  },
  {
    name: "follow_up",
    description: "Sends a gift's request again to every attendee whose request still has an unanswered question. Returns the event snapshot with the requests.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "POST", path: "/api/events/:eventId/gifts/{gift_id}/follow-up" }
  },
  {
    name: "send_to_vendor",
    description: "Prices a gift at its store: builds the priced proposal (the cart at the shop) from the current quantities.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "POST", path: "/api/events/:eventId/gifts/{gift_id}/send" }
  },
  {
    name: "approve_specs",
    description: "Approves the collected attendee values for a gift and fills the store's cart with one line per attendee; a later approval fills a fresh cart. Returns the gift with its cart state.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "POST", path: "/api/events/:eventId/gifts/{gift_id}/approve-specs" }
  },
  {
    name: "approve",
    description: "Approves a sent gift: the cart is kept and updated until the cutoff date, then checked out.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer"],
    route: { method: "POST", path: "/api/events/:eventId/gifts/{gift_id}/approve" }
  },
  {
    name: "post_update",
    description: "Posts into a gift's progress log: a confirmation, progress, a shipped notice with a reference, an issue naming a guest, a question, or a proof.",
    inputSchema: {
      type: "object",
      properties: {
        gift_id: { type: "string", description: "The gift's id" },
        kind: { type: "string", description: "What the post is", enum: ["confirmed", "in_production", "shipped", "delivered", "issue", "question", "proof", "reply"] },
        text: { type: "string", description: "The message" },
        expected_date: { type: "string", description: "An ISO date the store expects, if any" },
        reference: { type: "string", description: "A tracking or order reference, if any" },
        guest_id: { type: "string", description: "The guest an issue is about, if any" }
      },
      required: ["gift_id", "kind", "text"],
      additionalProperties: false
    },
    scopes: ["organizer", "vendor"],
    route: { method: "POST", path: "/api/events/:eventId/gifts/{gift_id}/updates", body: (a) => ({ kind: a.kind, text: a.text, expected_date: a.expected_date ?? null, reference: a.reference ?? null, guest_id: a.guest_id ?? null }) }
  },
  {
    name: "get_updates",
    description: "Returns a gift's progress log: every post by the cart job and the store, in order.",
    inputSchema: { type: "object", properties: { gift_id: { type: "string", description: "The gift's id" }, since_seq: { type: "integer", description: "Only posts after this sequence number; 0 for all" } }, required: ["gift_id"], additionalProperties: false },
    scopes: ["organizer", "vendor"],
    route: { method: "GET", path: "/api/events/:eventId/gifts/{gift_id}/updates", query: (a) => ({ since: str(a.since_seq ?? 0) }) }
  }
];

/** A choice question with no options has no answer, so it stays off the schema as it stays off the form. */
function askable(def: AttributeDefinition): boolean {
  return !((def.value_type === "enum" || def.value_type === "multi_enum") && !def.constraints.options?.length);
}

/** One question as a JSON Schema property: the store's length cap, allowed set, date form, or pattern travel with it. */
function questionProperty(def: AttributeDefinition): JsonSchemaProperty {
  const { options, min, max, max_length, pattern } = def.constraints;
  const values = options?.map((o) => o.value);
  const description = def.required_rule === "never" ? def.label : `${def.label}; required when ${def.required_rule === "going" ? "going" : "replying"}`;
  switch (def.value_type) {
    case "number":
      return { type: "number", description, ...(min !== undefined && { minimum: min }), ...(max !== undefined && { maximum: max }) };
    case "boolean":
      return { type: "boolean", description };
    case "enum":
      return { type: "string", description, enum: values };
    case "multi_enum":
      return { type: "array", description, items: { type: "string", enum: values } };
    case "date":
      return { type: "string", description, format: "date" };
    default:
      return { type: "string", description, ...(max_length !== undefined && { maxLength: max_length }), ...(pattern && { pattern }) };
  }
}

/**
 * The submit_rsvp schema for one invite: the name, the event's response options, the email a later
 * request goes to, an optional guest id, and one property per guest-scope question named by its key. A question required when going is
 * required in the schema, since the tool exists to answer the organizer's request.
 */
export function rsvpInputSchema(definitions: AttributeDefinition[], responseOptions: GuestStatus[]): JsonObjectSchema {
  const asked = definitions.filter((d) => d.scope === "guest" && d.required_rule !== "never" && askable(d));
  const properties: Record<string, JsonSchemaProperty> = { display_name: DISPLAY_NAME, status: { ...REPLY, enum: responseOptions }, email: EMAIL, guest_id: GUEST_ID };
  for (const def of asked) properties[def.key] = questionProperty(def);
  const required = ["display_name", "status", "email", ...asked.filter((d) => d.required_rule === "going" || d.required_rule === "always").map((d) => d.key)];
  return { type: "object", properties, required, additionalProperties: false };
}

/** The answers in a submit_rsvp call keyed by definition id, as the RSVP route stores them; an unknown key is skipped. */
export function rsvpAnswers(definitions: AttributeDefinition[], args: ToolArgs): Record<string, unknown> {
  const byKey = new Map(definitions.map((d) => [d.key, d.id]));
  const answers: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    const id = byKey.get(key);
    if (id !== undefined && value !== undefined) answers[id] = value;
  }
  return answers;
}

/** Builds the URL and init for one call: path arguments in braces, then the query or the body. */
export function buildRequest(tool: ToolDefinition, eventId: string, args: ToolArgs): { url: string; init: RequestInit } {
  let path = tool.route.path.replace(":eventId", encodeURIComponent(eventId));
  // The gift is the procurement until a Procurement record exists, so procurement_id fills a gift_id path segment.
  path = path.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(String(args[key] ?? (key === "gift_id" ? args.procurement_id : undefined) ?? "")));
  const init: RequestInit = { method: tool.route.method, headers: { Accept: "application/json" } };
  if (tool.route.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(tool.route.query(args))) if (v !== undefined && v !== "") params.set(k, v);
    const qs = params.toString();
    if (qs) path += `?${qs}`;
  }
  if (tool.route.body) {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(tool.route.body(args));
  }
  return { url: path, init };
}

/** The static tool list in the shape `webmcp-evals local -t schema.json` reads. */
export function toolsSchemaJson(): { name: string; description: string; inputSchema: object }[] {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}
