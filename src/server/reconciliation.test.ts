/**
 * The stored reconciliation (#51): a confirmation and a model verdict persist per gift and schema
 * version with who confirmed each decision, they survive a serialize and deserialize round trip, a
 * new schema version opens its own row with the diff and the attendees it affects, and the
 * continuation marks the change seen and reruns the request step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconciliationsFor } from "../domain/reconciliation";
import { deriveSchemaVersion } from "../domain/requirement-schema";
import { deserializeState, publishEvent, resetState, runWithState, serializeState, state, upsertDefinition } from "../domain/store";
import type { PersonalizationField } from "../domain/types";
import { createEventFromBody, createGiftFromBody, giftRequirements, giftView, requestFromAttendees, snapshot, submitRsvp, updateGiftFromBody } from "./api";
import { setMailer } from "./mail";
import { confirmRequirementFromBody, continueAfterSchemaChange, reconciliationView, schemaChangeFor } from "./reconcile-api";
import { reconcileGift, reconciliationOf, type LlmMatcher } from "./reconcile";

const BODY = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };
const FIELDS: PersonalizationField[] = [
  { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
  { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
];

function seedGift(eventId: string, fields: PersonalizationField[] = FIELDS) {
  return createGiftFromBody(eventId, {
    product_id: "gid://shopify/Product/1",
    shop_domain: "springbuilt.myshopify.com",
    product_title: "Customized Crewneck",
    variants: [
      { id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] },
      { id: "v-l", title: "L", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "L" }] }
    ],
    // The customization read gives the gift its schema version; a version the procurement carries is what a later read diffs against.
    personalization: { fields, schema_version: deriveSchemaVersion(fields) },
    default_variant_id: "v-m"
  });
}

const question = (eventId: string, key: string, label: string) => upsertDefinition(eventId, { namespace: "organizer", key, label, scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer" });

describe("the stored reconciliation", () => {
  beforeEach(() => {
    resetState();
    setMailer({ async send() { return "sent"; } });
  });
  afterEach(() => setMailer(null));

  it("persists the organizer's confirmation and the model's verdict with who confirmed each decision across a round trip", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const printed = question(event.id, "printed_name", "Name for printing");
    question(event.id, "full_name", "Full name");
    const home = upsertDefinition(event.id, { namespace: "organizer", key: "birthplace", label: "Where you were born", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "never", creator: "organizer" });
    const gift = seedGift(event.id);
    const llm = vi.fn<LlmMatcher>(async ({ requirement }) => (requirement.key === "star_map_location" ? { attribute_id: home.id, confidence: 0.9, reason: "A birthplace is a location" } : { attribute_id: null, confidence: 0, reason: "None" }));
    await reconcileGift(giftView(event.id, gift.id), snapshot(event.id).definitions, { llm });
    const candidates = giftRequirements(event.id, gift.id).find((r) => r.key === "caption")?.confirmation?.candidates.map((c) => c.attribute_id);
    expect(candidates).toHaveLength(2);
    expect(candidates).toContain(printed.id);

    const { requirements } = confirmRequirementFromBody(event.id, gift.id, "caption", { attribute_id: printed.id });
    expect(requirements.find((r) => r.key === "caption")).toMatchObject({ source: "definition", definition_id: printed.id, already: true });
    const row = reconciliationOf(giftView(event.id, gift.id));
    expect(row).toMatchObject({ gift_id: gift.id, schema_id: "springbuilt.myshopify.com/gid://shopify/Product/1", schema_version: deriveSchemaVersion(FIELDS) });
    expect(row.confirmations.caption).toMatchObject({ choice: { attribute_id: printed.id } });
    expect(row.verdicts.star_map_location).toMatchObject({ attribute_id: home.id, confidence: 0.9 });
    const byKey = Object.fromEntries(row.decisions.map((d) => [d.decision.requirement_id, d]));
    expect(byKey.caption).toMatchObject({ decision: { decision: "map_existing", attribute_id: printed.id }, confirmed_by: "organizer" });
    expect(byKey.star_map_location).toMatchObject({ decision: { decision: "map_existing", attribute_id: home.id, method: "llm" }, confirmed_by: "model" });
    expect(byKey.variant_size).toMatchObject({ decision: { decision: "create_field" }, confirmed_by: null });
    expect(state().changes.at(-1)).toMatchObject({ kind: "procurement", type: "mapping_changed", requirement_id: "caption", summary: "The organizer confirmed Text 2 fills from Name for printing" });

    // The document carries the row, and a store rebuilt from it reads the same decisions without the model.
    const doc = JSON.parse(JSON.stringify(serializeState(state())));
    expect(doc.reconciliations).toHaveLength(1);
    const rebuilt = deserializeState(doc);
    runWithState(rebuilt, () => {
      const again = reconciliationOf(giftView(event.id, gift.id));
      expect(again).toEqual(row);
      const read = giftRequirements(event.id, gift.id);
      expect(read.find((r) => r.key === "caption")).toMatchObject({ source: "definition", definition_id: printed.id });
      expect(read.find((r) => r.key === "star_map_location")).toMatchObject({ source: "definition", definition_id: home.id });
      const view = reconciliationView(event.id, gift.id);
      expect(view.decisions.map((d) => [d.decision.requirement_id, d.confirmed_by])).toEqual([["variant_size", null], ["star_map_location", "model"], ["caption", "organizer"]]);
      expect(view.change).toBeNull();
    });
    expect(llm).toHaveBeenCalledTimes(1);
    // A document stored before the collection existed loads with none.
    const { reconciliations: _gone, ...older } = doc;
    expect(deserializeState(older).reconciliations.size).toBe(0);
  });

  it("rejects a confirmation naming an unknown requirement, an unknown attribute, or an incompatible one", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    const number = upsertDefinition(event.id, { namespace: "organizer", key: "age", label: "Age", scope: "guest", value_type: "number", constraints: {}, default_visibility: [], required_rule: "never", creator: "organizer" });
    expect(() => confirmRequirementFromBody(event.id, gift.id, "nothing", { create: true })).toThrow("No requirement nothing");
    expect(() => confirmRequirementFromBody(event.id, gift.id, "caption", { attribute_id: "def_gone" })).toThrow("No definition def_gone");
    expect(() => confirmRequirementFromBody(event.id, gift.id, "caption", { attribute_id: number.id })).toThrow("needs text");
    expect(() => confirmRequirementFromBody(event.id, gift.id, "caption", {})).toThrow("names an attribute_id");
    expect(confirmRequirementFromBody(event.id, gift.id, "caption", { create: true }).requirements.find((r) => r.key === "caption")).toMatchObject({ source: "question", question: { value_type: "text" } });
  });

  it("opens a row for a new schema version with the diff and the attendees it affects, and the continuation reruns the request step", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    question(event.id, "printed_name", "Name for printing");
    question(event.id, "full_name", "Full name");
    confirmRequirementFromBody(event.id, gift.id, "caption", { create: true });
    await requestFromAttendees(event.id, gift.id);
    const defs = snapshot(event.id).definitions;
    const size = defs.find((d) => d.key === "variant_size")!;
    const location = defs.find((d) => d.key === "star_map_location")!;
    const [avery] = submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "l", [location.id]: "Vancouver" } }] }).guest_ids;
    const [blake] = submitRsvp(event.id, { party: { contact: { email: "b@b.co" } }, guests: [{ display_name: "Blake Ito", status: "going", answers: { [size.id]: "m" } }] }).guest_ids;
    submitRsvp(event.id, { party: { contact: { email: "c@b.co" } }, guests: [{ display_name: "Casey Lund", status: "cant_go" }] });
    expect(schemaChangeFor(event.id, gift.id)).toBeNull();
    const before = reconciliationOf(giftView(event.id, gift.id));

    const next: PersonalizationField[] = [
      { ...FIELDS[1], constraints: { max_length: 12 } },
      { key: "star_map_time", label: "Pick a time for Star Map 1", kind: "time", required: true, constraints: {} }
    ];
    updateGiftFromBody(event.id, gift.id, { personalization: { fields: next } });
    const change = schemaChangeFor(event.id, gift.id)!;
    expect(change).toMatchObject({ schema_id: before.schema_id, from_version: before.schema_version, to_version: deriveSchemaVersion(next), continued_at: null });
    expect(change.requirements).toEqual([
      { key: "star_map_time", label: "Pick a time for Star Map 1", change: "added" },
      { key: "star_map_location", label: "Enter Location for Star Map 1", change: "removed" },
      { key: "caption", label: "Text 2", change: "changed" }
    ]);
    // Every going attendee meets the added requirement; the removed and the changed ones touch the attendees who answered or were asked them; the attendee who cannot go is left out.
    expect(change.attendees).toEqual([
      { attendee_ref: avery, display_name: "Avery Chen", keys: ["star_map_time", "star_map_location", "caption"] },
      { attendee_ref: blake, display_name: "Blake Ito", keys: ["star_map_time", "star_map_location", "caption"] }
    ]);
    const rows = reconciliationsFor(gift.id);
    expect(rows.map((r) => r.schema_version)).toEqual([deriveSchemaVersion(next), before.schema_version]);
    // The confirmation on the changed requirement does not carry over; the new row decides it afresh.
    expect(rows[0].confirmations).toEqual({});
    expect(reconciliationView(event.id, gift.id).change).toEqual(change);

    const snap = await continueAfterSchemaChange(event.id, gift.id);
    expect(schemaChangeFor(event.id, gift.id)?.continued_at).toEqual(expect.any(String));
    const time = snap.definitions.find((d) => d.key === "star_map_time")!;
    expect(snap.requests.filter((r) => r.gift_id === gift.id).map((r) => [r.guest_id, r.definition_ids.includes(time.id)])).toEqual([[avery, true], [blake, true]]);
    expect(state().changes.filter((c) => c.kind === "procurement" && c.type === "mapping_changed").at(-2)?.summary).toContain("continued past the schema change");
  });
});
