/** Access grants (#41): the token derives from the grant, the endpoint reads the grant on every call, and revocation, expiry, and fulfilment cut access. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deserializeState, publishEvent, resetState, serializeState, state } from "../domain/store";
import type { PersonalizationField } from "../domain/types";
import { createEventFromBody, createGiftFromBody, requestFromAttendees, snapshot, submitRsvp } from "./api";
import { callableTools, createGrant, expireGrantsFor, grantStatus, grantsFor, revokeGrant, tokenForGrant } from "./grants";
import { setMailer } from "./mail";
import { handleRpc } from "./mcp";
import { postProcurementUpdate } from "./procurement";

const BODY = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const FIELDS: PersonalizationField[] = [
  { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
  { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
];

/** An event with the crewneck gift, its questions requested, one going attendee, and a second gift the grant must not reach. */
async function seed() {
  const event = publishEvent(createEventFromBody(BODY).id);
  const gift = createGiftFromBody(event.id, {
    product_id: "gid://shopify/Product/1",
    shop_domain: "springbuilt.myshopify.com",
    product_title: "Customized Crewneck",
    variants: [
      { id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] },
      { id: "v-l", title: "L", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "L" }] }
    ],
    personalization: { fields: FIELDS },
    default_variant_id: "v-m"
  });
  const other = createGiftFromBody(event.id, { product_id: "gid://shopify/Product/2", shop_domain: "springbuilt.myshopify.com", product_title: "Mug", variants: [{ id: "v-1", title: "Mug", price_cents: 1500, currency: "CAD", available: true }], default_variant_id: "v-1" });
  await requestFromAttendees(event.id, gift.id);
  const defs = snapshot(event.id).definitions;
  const size = defs.find((d) => d.key === "variant_size")!;
  const location = defs.find((d) => d.key === "star_map_location")!;
  const [avery] = submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "l", [location.id]: "Vancouver" } }] }).guest_ids;
  return { event, gift, other, size, location, avery };
}

const rpc = (eventId: string, tokenId: string, method: string, params?: Record<string, unknown>) => handleRpc(eventId, state().tokens.get(tokenId) ?? null, { jsonrpc: "2.0", id: 1, method, params });
const call = (eventId: string, tokenId: string, name: string, args: Record<string, unknown> = {}) => rpc(eventId, tokenId, "tools/call", { name, arguments: args });
const payload = (r: Record<string, unknown>) => JSON.parse((r.result as { content: { text: string }[] }).content[0].text);
const isError = (r: Record<string, unknown>) => (r.result as { isError?: boolean }).isError === true;
const listed = async (eventId: string, tokenId: string) => {
  const r = await rpc(eventId, tokenId, "tools/list");
  return isError(r) ? payload(r) : (r.result as { tools: { name: string }[] }).tools.map((t) => t.name);
};

describe("an access grant", () => {
  beforeEach(() => {
    resetState();
    setMailer({ send: async () => "sent" });
  });
  afterEach(() => setMailer(null));

  it("derives the token's gifts, tools, and readable definitions from the grant and mints one token per grant", async () => {
    const { event, gift, size, location } = await seed();
    const grant = createGrant(event.id, { procurement_id: gift.id, grantee_type: "vendor", grantee_id: "springbuilt.myshopify.com", permissions: ["manifest:read", "updates:write"] });
    expect(grant).toMatchObject({ event_id: event.id, procurement_id: gift.id, created_by: "organizer", expires_at: null, revoked_at: null });
    expect(grant.allowed_attribute_ids).toBeUndefined();
    expect(callableTools(grant)).toEqual(["get_manifest", "get_procurement", "get_fulfillment_manifest", "post_update", "post_procurement_update"]);
    const token = tokenForGrant(event.id, grant.id);
    expect(token).toMatchObject({ grant_id: grant.id, holder: "springbuilt.myshopify.com", gift_ids: [gift.id], expires_at: null });
    expect(token.readable_definition_ids.sort()).toEqual([size.id, location.id].sort());
    expect(tokenForGrant(event.id, grant.id).id).toBe(token.id);
    expect(grantsFor(event.id, gift.id)).toEqual([grant]);
    expect(() => createGrant(event.id, { procurement_id: "gift_none", grantee_type: "vendor", grantee_id: "x", permissions: ["manifest:read"] })).toThrow(/No gift/);
    expect(() => createGrant(event.id, { procurement_id: gift.id, grantee_type: "vendor", grantee_id: "x", permissions: ["manifest:read"], allowed_attribute_ids: ["def_none"] })).toThrow(/Unknown definitions/);
  });

  it("shows a holder only the requirements the grant allows, over the endpoint", async () => {
    const { event, gift, other, size, avery } = await seed();
    const grant = createGrant(event.id, { procurement_id: gift.id, grantee_type: "agent", grantee_id: "store-agent", permissions: ["manifest:read", "requirements:read", "changes:read"], allowed_attribute_ids: [size.id] });
    const token = tokenForGrant(event.id, grant.id);
    expect(await listed(event.id, token.id)).toEqual(["get_manifest", "get_procurement", "get_fulfillment_manifest", "get_changes", "get_requirements"]);
    const summary = payload(await call(event.id, token.id, "get_procurement", { procurement_id: gift.id }));
    expect(summary).toMatchObject({ procurement_id: gift.id, product: { title: "Customized Crewneck" }, store: "springbuilt.myshopify.com", status: "ready", approved_revision: null, attendees: 1, open_exceptions: 0 });
    const manifest = payload(await call(event.id, token.id, "get_fulfillment_manifest", { procurement_id: gift.id }));
    expect(manifest.attendees).toHaveLength(1);
    expect(manifest.attendees[0]).toMatchObject({ attendee_ref: avery, values: { variant_size: "l", caption: "Avery Chen" } });
    expect(manifest.attendees[0].values.star_map_location).toBeUndefined();
    const requirements = payload(await call(event.id, token.id, "get_requirements", { procurement_id: gift.id })).requirements as { key: string }[];
    expect(requirements.map((r) => r.key)).toEqual(["variant_size", "caption"]);
    const changes = payload(await call(event.id, token.id, "get_changes", { procurement_id: gift.id, after_revision: 0 })).changes as { requirement_id?: string }[];
    expect(changes.some((c) => c.requirement_id === "variant_size")).toBe(true);
    expect(changes.some((c) => c.requirement_id === "star_map_location")).toBe(false);
    expect(isError(await call(event.id, token.id, "get_fulfillment_manifest", { procurement_id: other.id }))).toBe(true);
    expect(isError(await call(event.id, token.id, "post_procurement_update", { procurement_id: gift.id, type: "accepted" }))).toBe(true);
  });

  it("answers every call with an error once the grant is revoked", async () => {
    const { event, gift } = await seed();
    const grant = createGrant(event.id, { procurement_id: gift.id, grantee_type: "vendor", grantee_id: "store", permissions: ["manifest:read", "updates:write"] });
    const token = tokenForGrant(event.id, grant.id);
    expect(isError(await call(event.id, token.id, "get_fulfillment_manifest", { procurement_id: gift.id }))).toBe(false);
    const revoked = revokeGrant(event.id, grant.id);
    expect(revoked.revoked_at).toBeTruthy();
    expect(grantStatus(revoked)).toBe("revoked");
    expect(await listed(event.id, token.id)).toEqual({ error: "The grant behind this token was revoked." });
    const refused = await call(event.id, token.id, "post_procurement_update", { procurement_id: gift.id, type: "accepted" });
    expect(isError(refused)).toBe(true);
    expect(payload(refused)).toEqual({ error: "The grant behind this token was revoked." });
    expect(state().gifts.get(gift.id)!.procurement_status).toBeUndefined();
    expect(() => tokenForGrant(event.id, grant.id)).toThrow(/revoked/);
  });

  it("retrieves nothing after the grant's expiry", async () => {
    const { event, gift } = await seed();
    const grant = createGrant(event.id, { procurement_id: gift.id, grantee_type: "user", grantee_id: "person@store.example", permissions: ["manifest:read"], expires_at: "2030-01-01T00:00:00Z" });
    const token = tokenForGrant(event.id, grant.id);
    expect(token.expires_at).toBe("2030-01-01T00:00:00Z");
    expect(grantStatus(grant, Date.parse("2029-12-31T00:00:00Z"))).toBe("active");
    expect(grantStatus(grant, Date.parse("2030-01-01T00:00:00Z"))).toBe("expired");
    const past = createGrant(event.id, { procurement_id: gift.id, grantee_type: "user", grantee_id: "person@store.example", permissions: ["manifest:read"], expires_at: "2020-01-01T00:00:00Z" });
    expect(() => tokenForGrant(event.id, past.id)).toThrow(/expired/);
    state().tokens.set("tok_past", { ...token, id: "tok_past", grant_id: past.id });
    expect(await listed(event.id, "tok_past")).toEqual({ error: "The grant behind this token has expired." });
  });

  it("expires every grant on the procurement when the store posts fulfilled", async () => {
    const { event, gift, other } = await seed();
    const store = createGrant(event.id, { procurement_id: gift.id, grantee_type: "vendor", grantee_id: "store", permissions: ["manifest:read", "updates:write"] });
    const agent = createGrant(event.id, { procurement_id: gift.id, grantee_type: "agent", grantee_id: "store-agent", permissions: ["changes:read"] });
    const elsewhere = createGrant(event.id, { procurement_id: other.id, grantee_type: "vendor", grantee_id: "store", permissions: ["manifest:read"] });
    const token = tokenForGrant(event.id, store.id);
    const posted = await call(event.id, token.id, "post_procurement_update", { procurement_id: gift.id, type: "fulfilled", reference: "TRACK-1" });
    expect(isError(posted)).toBe(false);
    expect(payload(posted).procurement_status).toBe("fulfilled");
    for (const id of [store.id, agent.id]) expect(grantStatus(grantsFor(event.id).find((g) => g.id === id)!)).toBe("expired");
    expect(grantStatus(grantsFor(event.id).find((g) => g.id === elsewhere.id)!)).toBe("active");
    expect(await listed(event.id, token.id)).toEqual({ error: "The grant behind this token has expired." });
    expect(expireGrantsFor(event.id, gift.id)).toEqual([]);
  });

  it("rides in the state document and a document stored before grants existed loads without them", async () => {
    const { event, gift } = await seed();
    const grant = createGrant(event.id, { procurement_id: gift.id, grantee_type: "vendor", grantee_id: "store", permissions: ["manifest:read"] });
    tokenForGrant(event.id, grant.id);
    const restored = deserializeState(JSON.parse(JSON.stringify(serializeState(state()))));
    expect(restored.grants.get(grant.id)).toEqual(grant);
    expect([...restored.tokens.values()].find((t) => t.grant_id === grant.id)).toBeTruthy();
    const { grants: _grants, ...older } = serializeState(state());
    const legacy = deserializeState(JSON.parse(JSON.stringify({ ...older, tokens: older.tokens.map(([id, t]) => [id, { ...t, grant_id: undefined }]) })));
    expect(legacy.grants.size).toBe(0);
    expect([...legacy.tokens.values()].every((t) => t.grant_id === null)).toBe(true);
  });
});
