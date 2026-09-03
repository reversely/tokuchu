/**
 * The error audit (#56): every write tool refuses a bad call with a message that names its
 * subject, the field, the limit, the record, or the revisions involved, so an agent reading the
 * error knows what to change. Each row of the table is one bad call through the MCP dispatch under
 * the organizer's token, or through the RSVP operation the invite's submit_rsvp maps to.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGift, updateGift, type GiftInput } from "../domain/gifts";
import { publishEvent, resetState, upsertDefinition } from "../domain/store";
import { createEventFromBody, submitRsvp } from "./api";
import { createGrant } from "./grants";
import { createToken, handleRpc } from "./mcp";
import { TOOLS } from "../webmcp/tools";
// The cart operations register on the dispatch registry when the module loads.
import "./cart-api";

const BODY = { title: "Test event", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const GOING = [{ field: "status", op: "eq", value: "going" }] as const;
const FIELD = { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } } as const;

function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const name = upsertDefinition(event.id, { namespace: "organizer", key: "printed_name", label: "Name for printing", scope: "guest", value_type: "text", constraints: { max_length: 40 }, default_visibility: [], required_rule: "going", creator: "organizer" });
  const reply = submitRsvp(event.id, { guests: [{ display_name: "Guest One", status: "going", answers: { [name.id]: "One" } }] });
  const base = { shop_domain: "shop.myshopify.com", recipients: [...GOING], mapping: [], default_variant_id: "var_a", variants: [{ id: "var_a", title: "A", price_cents: 1000, currency: "CAD" }], missing_value_fallback: "default", post_lock_cancellation: "keep", cutoff: null, cart_id: null, checkout_id: null, order_id: null };
  const plain = createGift(event.id, { ...base, product_id: "prod_1", product_title: "Plain", rules: [{ filter: [...GOING], product_id: "prod_1" }] } as never);
  const personalized = createGift(event.id, { ...base, product_id: "prod_2", product_title: "Personalized", rules: [{ filter: [...GOING], product_id: "prod_2" }], personalization: { fields: [FIELD] } } as never);
  const grant = createGrant(event.id, { procurement_id: personalized.id, grantee_type: "vendor", grantee_id: "shop.myshopify.com", permissions: ["manifest:read", "changes:read"] });
  const organizer = createToken(event.id, { holder: "organizer", callable_tools: TOOLS.map((t) => t.name) });
  return { event, name, plain, personalized, grant, organizer, guestId: reply.guest_ids[0] };
}

type Seed = ReturnType<typeof seed>;
type Row = { tool: string; args: (s: Seed) => Record<string, unknown>; names: (RegExp | ((s: Seed) => RegExp))[]; env?: Record<string, string> };

/** Each bad call and the subject its error must name. */
const ROWS: Row[] = [
  { tool: "set_gift_plan", args: () => ({ gift_id: "gift_none", rules: [] }), names: [/gift_none/] },
  { tool: "set_gift_plan", args: () => ({ rules: [] }), names: [/product_id/] },
  { tool: "set_gift_plan", args: (s) => ({ gift_id: s.plain.id, rules: [{ filter: "going" }] }), names: [/rules/] },
  { tool: "set_gift_customization", args: () => ({ gift_id: "gift_none", fields: [] }), names: [/gift_none/] },
  { tool: "set_gift_customization", args: (s) => ({ gift_id: s.plain.id, fields: "caption" }), names: [/fields/] },
  { tool: "set_gift_customization", args: (s) => ({ gift_id: s.plain.id, product_id: "prod_other", fields: [] }), names: [/product_id prod_other/, (s) => new RegExp(s.plain.id)] },
  { tool: "set_gift_customization", args: (s) => ({ gift_id: s.plain.id, fields: [{ key: "x", label: "X", kind: "hologram", required: true }] }), names: [/fields: none of the 1 fields/, /text, name/] },
  { tool: "set_personalization_mapping", args: (s) => ({ gift_id: s.plain.id, mappings: [] }), names: [/set_gift_customization/, (s) => new RegExp(s.plain.id)] },
  { tool: "set_personalization_mapping", args: (s) => ({ gift_id: s.personalized.id, mappings: [{ vendor_field_key: "nope", source: { type: "literal", value: "x" } }] }), names: [/nope/] },
  { tool: "set_personalization_mapping", args: (s) => ({ gift_id: s.personalized.id, mappings: [{ vendor_field_key: "caption", source: { type: "definition", definition_id: "def_none", subject_scope: "guest" } }] }), names: [/def_none/] },
  { tool: "request_from_attendees", args: () => ({ gift_id: "gift_none" }), names: [/gift_none/] },
  { tool: "follow_up", args: () => ({ gift_id: "gift_none" }), names: [/gift_none/] },
  { tool: "approve_specs", args: () => ({ gift_id: "gift_none" }), names: [/gift_none/] },
  { tool: "approve_specs", args: (s) => { updateGift(s.plain.id, { cart_fill: { status: "running", started_at: "2030-01-01T00:00:00Z", reason: null } } as Partial<GiftInput>); return { gift_id: s.plain.id }; }, names: [/still running/, (s) => new RegExp(s.plain.id)] },
  { tool: "post_update", args: (s) => ({ gift_id: s.plain.id, kind: "bogus", text: "x" }), names: [/kind/] },
  { tool: "post_update", args: (s) => ({ gift_id: s.plain.id, kind: "issue", text: "x", guest_id: "guest_none" }), names: [/guest_none/] },
  { tool: "post_procurement_update", args: (s) => ({ gift_id: s.plain.id, type: "bogus" }), names: [/type/] },
  { tool: "post_procurement_update", args: (s) => ({ gift_id: s.plain.id, type: "invalid_value" }), names: [/attendee/, /requirement/] },
  { tool: "post_procurement_update", args: (s) => ({ gift_id: s.plain.id, type: "exception", attendee_ref: "guest_none" }), names: [/guest_none/] },
  { tool: "acknowledge_changes", args: () => ({ revision: 0 }), names: [/grant_id/] },
  { tool: "acknowledge_changes", args: () => ({ grant_id: "grant_none", revision: 0 }), names: [/grant_none/] },
  { tool: "acknowledge_changes", args: (s) => ({ grant_id: s.grant.id, revision: -1 }), names: [/revision/, /0 or more/] },
  { tool: "acknowledge_changes", args: (s) => ({ grant_id: s.grant.id, revision: 999 }), names: [/Revision 999/, /current revision \d+/] },
  { tool: "send_to_vendor", args: (s) => ({ gift_id: s.plain.id }), names: [/send_to_vendor is off in static mode/, /cart_items/], env: { TOKUCHU_STATIC: "1" } },
  { tool: "approve", args: (s) => ({ gift_id: s.plain.id }), names: [/approve is off in static mode/, /get_fulfillment_manifest/], env: { TOKUCHU_STATIC: "1" } },
  { tool: "search_gifts", args: () => ({ sentence: "mugs" }), names: [/search_gifts is off in static mode/, /set_gift_plan/], env: { TOKUCHU_STATIC: "1" } }
];

/** A row's pattern may depend on the seed: a function stands in for a RegExp and the test resolves it. */
function patterns(row: Row, s: Seed): RegExp[] {
  return row.names.map((n) => (typeof n === "function" ? n(s) : n));
}

const call = (eventId: string, token: ReturnType<typeof createToken>, name: string, args: Record<string, unknown>) => handleRpc(eventId, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

describe("every write tool's error names its subject", () => {
  const saved = { ...process.env };
  beforeEach(resetState);
  afterEach(() => {
    process.env = { ...saved };
  });

  for (const row of ROWS) {
    it(`${row.tool} with ${JSON.stringify(row.args(seed()))}`, async () => {
      resetState();
      const s = seed();
      const args = row.args(s);
      for (const [k, v] of Object.entries(row.env ?? {})) process.env[k] = v;
      const reply = await call(s.event.id, s.organizer, row.tool, args);
      const result = reply.result as { isError?: boolean; content: { text: string }[] };
      expect(result.isError, JSON.stringify(reply)).toBe(true);
      const { error } = JSON.parse(result.content[0].text) as { error: string };
      for (const pattern of patterns(row, s)) expect(error).toMatch(pattern);
    });
  }

  it("a token without a tool is told which tool it may not call", async () => {
    const s = seed();
    const vendor = createToken(s.event.id, { holder: "shop", gift_ids: [s.plain.id], callable_tools: ["get_manifest"] });
    const reply = await call(s.event.id, vendor, "approve_specs", { gift_id: s.plain.id });
    expect(JSON.parse((reply.result as { content: { text: string }[] }).content[0].text).error).toBe("The token may not call approve_specs.");
  });

  it("submit_rsvp names the question and its limit", () => {
    const s = seed();
    expect(() => submitRsvp(s.event.id, { guests: [{ display_name: "Guest Two", status: "going", answers: { [s.name.id]: "x".repeat(41) } }] })).toThrow(/Name for printing allows 40 characters; this has 41/);
    expect(() => submitRsvp(s.event.id, { guests: [{ display_name: "Guest Two", status: "going", answers: { def_none: "x" } }] })).toThrow(/No question def_none/);
    expect(() => submitRsvp(s.event.id, { guests: [{ status: "going" }] })).toThrow(/guests\.0\.display_name/);
  });
});
