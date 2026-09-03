/**
 * The acknowledgement cursor and the CSV export (#52): the CSV has one row per attendee and only the
 * columns the grant lets its holder read, through the same projection as get_fulfillment_manifest;
 * a grant's holder acknowledges a revision through the tool and the cursor survives a serialize and
 * deserialize round trip.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deserializeState, publishEvent, resetState, runWithState, serializeState, state } from "../domain/store";
import type { PersonalizationField } from "../domain/types";
import { acknowledgeRevision } from "./acknowledge";
import { createEventFromBody, createGiftFromBody, requestFromAttendees, snapshot, submitRsvp } from "./api";
import { csvField, fulfillmentCsv } from "./fulfillment-csv";
import { callableTools, createGrant, tokenForGrant } from "./grants";
import { setMailer } from "./mail";
import { handleRpc } from "./mcp";
import { fulfillmentManifest } from "./procurement";

const BODY = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const FIELDS: PersonalizationField[] = [
  { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
  { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
];

/** The crewneck with its questions requested and two going attendees, one with a location that carries a comma. */
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
  await requestFromAttendees(event.id, gift.id);
  const defs = snapshot(event.id).definitions;
  const size = defs.find((d) => d.key === "variant_size")!;
  const location = defs.find((d) => d.key === "star_map_location")!;
  const [avery] = submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "l", [location.id]: "Vancouver, BC" } }] }).guest_ids;
  const [blake] = submitRsvp(event.id, { party: { contact: { email: "b@b.co" } }, guests: [{ display_name: "Blake Ito", status: "going", answers: { [size.id]: "m" } }] }).guest_ids;
  submitRsvp(event.id, { party: { contact: { email: "c@b.co" } }, guests: [{ display_name: "Casey Lund", status: "cant_go" }] });
  return { event, gift, size, location, avery, blake };
}

const rpc = (eventId: string, tokenId: string, name: string, args: Record<string, unknown> = {}) => handleRpc(eventId, state().tokens.get(tokenId) ?? null, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
const payload = (r: Record<string, unknown>) => JSON.parse((r.result as { content: { text: string }[] }).content[0].text);

describe("the fulfilment CSV", () => {
  beforeEach(() => {
    resetState();
    setMailer({ send: async () => "sent" });
  });
  afterEach(() => setMailer(null));

  it("quotes a field with a comma or a quote and leaves the rest bare", () => {
    expect(csvField("Vancouver")).toBe("Vancouver");
    expect(csvField("Vancouver, BC")).toBe('"Vancouver, BC"');
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvField(null)).toBe("");
    expect(csvField(["a", "b"])).toBe("a; b");
  });

  it("writes one row per attendee with every requirement for the organizer and only the granted columns for a grant", async () => {
    const { event, gift, size, avery, blake } = await seed();
    const organizer = fulfillmentCsv(event.id, gift.id);
    expect(organizer.columns).toEqual(["attendee_ref", "status", "variant_id", "variant_size", "star_map_location", "caption", "issues"]);
    expect(organizer.rows.map((r) => r[0])).toEqual([avery, blake]);
    expect(organizer.rows[0]).toEqual([avery, "ready", "v-l", "l", "Vancouver, BC", "Avery Chen", ""]);
    expect(organizer.rows[1]).toEqual([blake, "incomplete", "v-m", "m", "", "Blake Ito", "star_map_location: Enter Location for Star Map 1 is not confirmed by the attendee yet"]);
    const lines = organizer.text.split("\r\n");
    expect(lines[0]).toBe("attendee_ref,status,variant_id,variant_size,star_map_location,caption,issues");
    expect(lines[1]).toBe(`${avery},ready,v-l,l,"Vancouver, BC",Avery Chen,`);
    expect(lines).toHaveLength(4);
    expect(organizer.filename).toBe(`fulfillment-${gift.id}-r${fulfillmentManifest(event.id, gift.id).revision}.csv`);

    // The grant may read the size only: the location column leaves with its issue, and the caption stays because it derives from the guest's name.
    const grant = createGrant(event.id, { procurement_id: gift.id, grantee_type: "vendor", grantee_id: "springbuilt.myshopify.com", permissions: ["manifest:read"], allowed_attribute_ids: [size.id] });
    const granted = fulfillmentCsv(event.id, gift.id, [size.id]);
    expect(granted.columns).toEqual(["attendee_ref", "status", "variant_id", "variant_size", "caption", "issues"]);
    expect(granted.rows).toHaveLength(2);
    expect(granted.rows[1]).toEqual([blake, "ready", "v-m", "m", "Blake Ito", ""]);
    // The same rows the manifest projection gives the grant.
    const manifest = fulfillmentManifest(event.id, gift.id, [size.id]);
    expect(granted.rows.map((r) => r[1])).toEqual(manifest.attendees.map((a) => a.status));
    expect(granted.text).not.toContain("Vancouver");
    expect(grant.acknowledged_revision).toBeUndefined();
  });
});

describe("the acknowledgement cursor", () => {
  beforeEach(() => {
    resetState();
    setMailer({ send: async () => "sent" });
  });
  afterEach(() => setMailer(null));

  it("records the revision a grant's holder acknowledged through the tool, refuses one past the current revision, and persists across a round trip", async () => {
    const { event, gift, size } = await seed();
    const grant = createGrant(event.id, { procurement_id: gift.id, grantee_type: "vendor", grantee_id: "springbuilt.myshopify.com", permissions: ["manifest:read", "changes:read"], allowed_attribute_ids: [size.id] });
    expect(callableTools(grant)).toEqual(["get_manifest", "get_procurement", "get_fulfillment_manifest", "get_changes", "acknowledge_changes"]);
    const token = tokenForGrant(event.id, grant.id);
    const current = fulfillmentManifest(event.id, gift.id, [size.id]).revision;
    expect(current).toBeGreaterThan(0);

    const past = await rpc(event.id, token.id, "acknowledge_changes", { revision: current + 5 });
    expect(payload(past)).toEqual({ error: `Revision ${current + 5} is past the current revision ${current}.` });
    const other = await rpc(event.id, token.id, "acknowledge_changes", { grant_id: "grant_other", revision: 1 });
    expect(payload(other)).toEqual({ error: "No grant grant_other for this token." });
    const acked = await rpc(event.id, token.id, "acknowledge_changes", { revision: current });
    expect(payload(acked)).toEqual({ grant_id: grant.id, acknowledged_revision: current, current_revision: current });
    expect(state().grants.get(grant.id)?.acknowledged_revision).toBe(current);

    expect(() => acknowledgeRevision(event.id, grant.id, { revision: -1 })).toThrow("whole number");
    expect(() => acknowledgeRevision(event.id, "grant_none", { revision: 1 })).toThrow("No grant grant_none");
    expect(acknowledgeRevision(event.id, grant.id, { revision: 1 })).toEqual({ grant_id: grant.id, acknowledged_revision: 1, current_revision: current });

    const doc = JSON.parse(JSON.stringify(serializeState(state())));
    const rebuilt = deserializeState(doc);
    runWithState(rebuilt, () => expect(state().grants.get(grant.id)?.acknowledged_revision).toBe(1));
    // A grant stored before the cursor existed reads as never acknowledged.
    const older = { ...doc, grants: doc.grants.map(([id, g]: [string, Record<string, unknown>]) => { const { acknowledged_revision: _gone, ...rest } = g; return [id, rest]; }) };
    expect(deserializeState(older).grants.get(grant.id)?.acknowledged_revision).toBeUndefined();
  });
});
