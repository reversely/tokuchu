import { beforeEach, describe, expect, it } from "vitest";
import { createGift, manifest, type GiftInput } from "./gifts";
import { applyTransform, locationQuery, validateMappings, type PersonalizationIssue } from "./personalization";
import { moveProcurement, openException, resolveExceptionsByAnswer } from "./procurement";
import { createEvent, createGuest, createParty, getEvent, getValue, resetState, state, upsertDefinition, writeValue, type EventInput } from "./store";
import type { AttributeDefinition, PersonalizationField, PersonalizationMapping } from "./types";

const EVENT: EventInput = {
  type: "event",
  title: "Winter Gala",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Grand Hall", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" },
  spots: 10,
  cost_per_person_cents: 1000,
  rsvp_deadline: "2030-01-03",
  description: "",
  invite_extras: [],
  response_options: ["going", "maybe", "cant_go"],
  settings: { guest_approval: false, reminders: true, reask_on_change: true, order_approval: true },
  segments: [],
  delivery: { destination: "venue", address: null, needed_by: "2030-01-08" }
};

const FIELDS: PersonalizationField[] = [
  { key: "caption", label: "Caption", kind: "name", max_length: 12, required: true },
  { key: "star_date", label: "Star date", kind: "date", required: true },
  { key: "star_place", label: "Star place", kind: "location", required: true },
  { key: "accent", label: "Accent", kind: "color", required: false, allowed_values: ["gold", "silver"] }
];

const GOING = [{ field: "status", op: "eq", value: "going" }] as const;

function gift(eventId: string, patch: Partial<GiftInput> = {}) {
  return createGift(eventId, {
    product_id: "prod_p",
    shop_domain: "shop.example",
    product_title: "Star map print",
    recipients: [...GOING],
    mapping: [],
    default_variant_id: "var_1",
    variants: [{ id: "var_1", title: "Print", price_cents: 900, currency: "CAD" }],
    missing_value_fallback: "default",
    post_lock_cancellation: "keep",
    cutoff: null,
    cart_id: null,
    checkout_id: null,
    order_id: null,
    rules: [{ filter: [...GOING], product_id: "prod_p" }],
    personalization: { fields: FIELDS },
    ...patch
  });
}

function seed() {
  const event = createEvent(EVENT);
  const def = (key: string, scope: AttributeDefinition["scope"], value_type: AttributeDefinition["value_type"], constraints: AttributeDefinition["constraints"] = {}) =>
    upsertDefinition(event.id, { namespace: "organizer", key, label: key, scope, value_type, constraints, default_visibility: [], required_rule: "never", creator: "organizer" });
  const nameDef = def("preferred_name", "guest", "text");
  const colourDef = def("table_colour", "party", "enum", { options: [{ value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }] });
  const themeDef = def("theme", "event", "text");
  const party = createParty(event.id, {});
  const one = createGuest(event.id, party.id, { display_name: "Guest One", status: "going" });
  const two = createGuest(event.id, party.id, { display_name: "Guest Two", status: "going" });
  writeValue("guest", one.id, nameDef.id, "Ada", "guest");
  return { event, nameDef, colourDef, themeDef, party, one, two };
}

function mappings(nameDef: AttributeDefinition): PersonalizationMapping[] {
  return [
    { vendor_field_key: "caption", source: { type: "definition", definition_id: nameDef.id, subject_scope: "guest" } },
    { vendor_field_key: "star_date", source: { type: "event", key: "starts_at" }, transform: "date_only" },
    { vendor_field_key: "star_place", source: { type: "event", key: "venue" }, transform: "location_query" },
    { vendor_field_key: "accent", source: { type: "literal", value: "gold" } }
  ];
}

const row = (g: ReturnType<typeof gift>, guestId: string) => manifest(g).find((r) => r.guest_id === guestId)!;
const codes = (issues: PersonalizationIssue[] | undefined) => (issues ?? []).map((i) => i.code);

describe("validateMappings", () => {
  beforeEach(resetState);

  it("accepts a complete compatible mapping list", () => {
    const { event, nameDef } = seed();
    const g = gift(event.id);
    expect(validateMappings(g, getEvent(event.id), mappings(nameDef), [nameDef])).toEqual([]);
  });

  it("names each failure with its code", () => {
    const { event, nameDef, colourDef } = seed();
    const g = gift(event.id);
    const at = (rows: PersonalizationMapping[], defs = [nameDef, colourDef]) => validateMappings(g, getEvent(event.id), rows, defs).map((e) => e.code);
    expect(at([...mappings(nameDef), { vendor_field_key: "nope", source: { type: "literal", value: "x" } }])).toEqual(["unknown_field"]);
    expect(at(mappings(nameDef).slice(1))).toEqual(["unmapped_required"]);
    expect(at([...mappings(nameDef).slice(1), { vendor_field_key: "caption", source: { type: "definition", definition_id: "def_none", subject_scope: "guest" } }])).toEqual(["unknown_definition"]);
    expect(at([...mappings(nameDef).slice(1), { vendor_field_key: "caption", source: { type: "definition", definition_id: nameDef.id, subject_scope: "party" } }])).toEqual(["scope_mismatch"]);
    expect(at([...mappings(nameDef).slice(0, 3), { vendor_field_key: "star_date", source: { type: "definition", definition_id: nameDef.id, subject_scope: "guest" } }])).toEqual(["incompatible_type"]);
    expect(at([mappings(nameDef)[0], ...mappings(nameDef).slice(2), { vendor_field_key: "star_date", source: { type: "event", key: "title" } }])).toEqual(["incompatible_type"]);
    expect(at([...mappings(nameDef).slice(1), { vendor_field_key: "caption", source: { type: "definition", definition_id: nameDef.id, subject_scope: "guest" }, transform: "date_only" }])).toEqual(["incompatible_transform"]);
    expect(at([...mappings(nameDef).slice(0, 3), { vendor_field_key: "accent", source: { type: "event", key: "title" }, transform: "location_query" }])).toEqual(["incompatible_transform"]);
    expect(at([...mappings(nameDef).slice(0, 3), { vendor_field_key: "accent", source: { type: "literal", value: 5 }, transform: "uppercase" }])).toEqual(["incompatible_transform"]);
  });

  it("refuses a literal a transform cannot consume and accepts one it can", () => {
    const { event, nameDef } = seed();
    const g = gift(event.id);
    const withStarDate = (value: unknown): PersonalizationMapping[] => [mappings(nameDef)[0], { vendor_field_key: "star_date", source: { type: "literal", value }, transform: "date_only" }, ...mappings(nameDef).slice(2)];
    const bad = validateMappings(g, getEvent(event.id), withStarDate("hello"), [nameDef]);
    expect(bad.map((e) => e.code)).toEqual(["incompatible_transform"]);
    expect(bad[0].message).toMatch(/date_only/);
    expect(validateMappings(g, getEvent(event.id), withStarDate("2030-01-10"), [nameDef])).toEqual([]);
  });
});

describe("transforms", () => {
  it("uppercases and lowercases text and rejects the rest", () => {
    expect(applyTransform("uppercase", "Ada")).toEqual({ ok: true, value: "ADA" });
    expect(applyTransform("lowercase", "Ada")).toEqual({ ok: true, value: "ada" });
    expect(applyTransform("uppercase", 5)).toMatchObject({ ok: false });
  });

  it("takes an ISO datetime to its date", () => {
    expect(applyTransform("date_only", "2030-01-10T19:00:00Z")).toEqual({ ok: true, value: "2030-01-10" });
    expect(applyTransform("date_only", "next friday")).toMatchObject({ ok: false });
  });

  it("renders a venue into one search string", () => {
    expect(locationQuery(EVENT.venue)).toBe("Grand Hall, City, RG, CA");
    expect(applyTransform("location_query", EVENT.venue)).toEqual({ ok: true, value: "Grand Hall, City, RG, CA" });
    expect(applyTransform("location_query", "text")).toMatchObject({ ok: false });
  });
});

describe("the personalized manifest", () => {
  beforeEach(resetState);

  it("resolves guest, event, and literal sources into ready rows", () => {
    const { event, nameDef, one } = seed();
    const g = gift(event.id, { personalization_mappings: mappings(nameDef) });
    const r = row(g, one.id);
    expect(r.personalization_status).toBe("ready");
    expect(r.personalization_issues).toEqual([]);
    expect(r.personalization).toMatchObject({
      caption: { value: "Ada", source: { type: "definition", definition_id: nameDef.id } },
      star_date: { value: "2030-01-10", source: { type: "event", key: "starts_at" } },
      star_place: { value: "Grand Hall, City, RG, CA", source: { type: "event", key: "venue" } },
      accent: { value: "gold", source: { type: "literal" } }
    });
  });

  it("resolves party and event scoped definitions for every guest in the party", () => {
    const { event, nameDef, colourDef, themeDef, party, one, two } = seed();
    writeValue("guest", two.id, nameDef.id, "Grace", "guest");
    writeValue("party", party.id, colourDef.id, "silver", "organizer");
    writeValue("event", event.id, themeDef.id, "Aurora", "organizer");
    const rows = [
      ...mappings(nameDef).slice(0, 3),
      { vendor_field_key: "accent", source: { type: "definition", definition_id: colourDef.id, subject_scope: "party" } } as PersonalizationMapping
    ];
    const g = gift(event.id, { personalization_mappings: rows });
    expect(row(g, one.id).personalization?.accent.value).toBe("silver");
    expect(row(g, two.id).personalization?.accent.value).toBe("silver");
    const themed = gift(event.id, { personalization_mappings: [...mappings(nameDef).slice(1), { vendor_field_key: "caption", source: { type: "definition", definition_id: themeDef.id, subject_scope: "event" } }] });
    expect(row(themed, one.id).personalization?.caption.value).toBe("Aurora");
  });

  it("applies uppercase to a guest value", () => {
    const { event, nameDef, one } = seed();
    const rows = mappings(nameDef);
    rows[0] = { ...rows[0], transform: "uppercase" };
    const g = gift(event.id, { personalization_mappings: rows });
    expect(row(g, one.id).personalization?.caption.value).toBe("ADA");
  });

  it("marks a guest without a required value incomplete with a missing_value issue", () => {
    const { event, nameDef, two } = seed();
    const g = gift(event.id, { personalization_mappings: mappings(nameDef) });
    const r = row(g, two.id);
    expect(r.personalization_status).toBe("incomplete");
    expect(r.personalization_issues).toEqual([{ guest_id: two.id, vendor_field_key: "caption", code: "missing_value", status: "missing", message: expect.any(String) }]);
    expect(r.personalization?.caption.value).toBeNull();
  });

  it("marks an unmapped required field missing_source", () => {
    const { event, nameDef, one } = seed();
    const g = gift(event.id, { personalization_mappings: mappings(nameDef).slice(1) });
    const r = row(g, one.id);
    expect(r.personalization_status).toBe("incomplete");
    expect(codes(r.personalization_issues)).toEqual(["missing_source"]);
    expect(r.personalization?.caption).toBeUndefined();
  });

  it("marks a failing value invalid: wrong type, too long, or outside the allowed values", () => {
    const { event, nameDef, one } = seed();
    const typed = gift(event.id, { personalization_mappings: [...mappings(nameDef).slice(1), { vendor_field_key: "caption", source: { type: "literal", value: 5 } }] });
    expect(row(typed, one.id)).toMatchObject({ personalization_status: "invalid" });
    expect(codes(row(typed, one.id).personalization_issues)).toEqual(["invalid_type"]);
    const long = gift(event.id, { personalization_mappings: [...mappings(nameDef).slice(1), { vendor_field_key: "caption", source: { type: "literal", value: "a name far past twelve characters" } }] });
    expect(codes(row(long, one.id).personalization_issues)).toEqual(["too_long"]);
    const outside = gift(event.id, { personalization_mappings: [...mappings(nameDef).slice(0, 3), { vendor_field_key: "accent", source: { type: "literal", value: "pink" } }] });
    expect(row(outside, one.id)).toMatchObject({ personalization_status: "invalid" });
    expect(codes(row(outside, one.id).personalization_issues)).toEqual(["unsupported_value"]);
  });

  it("grades each requirement resolved with the provenance of its value", () => {
    const { event, nameDef, one } = seed();
    const g = gift(event.id, { personalization_mappings: mappings(nameDef) });
    const r = row(g, one.id);
    const written = getValue("guest", one.id, nameDef.id)!;
    expect(r.personalization?.caption).toMatchObject({ status: "resolved", provenance: { requirement_id: "caption", attribute_id: nameDef.id, value: "Ada", source: "existing_field", updated_at: written.updated_at, revision: written.seq } });
    expect(r.personalization?.star_date).toMatchObject({ status: "resolved", provenance: { source: "derived", source_attribute_ids: [], transform: "date_only", revision: 0 } });
    expect(r.personalization?.accent).toMatchObject({ status: "resolved", provenance: { source: "literal", value: "gold" } });
    expect(Object.values(r.personalization ?? {}).every((f) => f.status === "resolved")).toBe(true);
  });

  it("names an answer to a store's own question vendor_requested_answer and a transformed answer derived", () => {
    const { event, nameDef, one } = seed();
    const asked = upsertDefinition(event.id, { namespace: "vendor", key: "caption", label: "Caption", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer", vendor_field: { key: "caption", label: "Caption", kind: "name", vendor_id: "shop.example", requirement_id: "caption" } });
    writeValue("guest", one.id, asked.id, "Ada L", "guest");
    const direct = gift(event.id, { personalization_mappings: [...mappings(nameDef).slice(1), { vendor_field_key: "caption", source: { type: "definition", definition_id: asked.id, subject_scope: "guest" } }] });
    expect(row(direct, one.id).personalization?.caption.provenance).toMatchObject({ attribute_id: asked.id, source: "vendor_requested_answer", value: "Ada L" });
    const upper = gift(event.id, { personalization_mappings: [...mappings(nameDef).slice(1), { vendor_field_key: "caption", source: { type: "definition", definition_id: asked.id, subject_scope: "guest" }, transform: "uppercase" }] });
    expect(row(upper, one.id).personalization?.caption.provenance).toMatchObject({ source: "derived", source_attribute_ids: [asked.id], transform: "uppercase", value: "ADA L" });
  });

  it("grades a value that fails the field invalid even though the field exists: Alexandria-Catherine against a 12 character cap", () => {
    const { event, nameDef, one } = seed();
    writeValue("guest", one.id, nameDef.id, "Alexandria-Catherine", "guest");
    const r = row(gift(event.id, { personalization_mappings: mappings(nameDef) }), one.id);
    expect(r.personalization?.caption).toMatchObject({ value: "Alexandria-Catherine", status: "invalid" });
    expect(r.personalization_issues).toEqual([{ guest_id: one.id, vendor_field_key: "caption", code: "too_long", status: "invalid", message: "Caption allows 12 characters" }]);
    expect(r.personalization_status).toBe("invalid");
  });

  it("grades a missing answer missing and an unmapped or unsettled requirement mapping_unresolved", () => {
    const { event, nameDef, two } = seed();
    expect(row(gift(event.id, { personalization_mappings: mappings(nameDef) }), two.id).personalization?.caption).toMatchObject({ value: null, status: "missing" });
    const unmapped = row(gift(event.id, { personalization_mappings: mappings(nameDef).slice(1) }), two.id);
    expect(unmapped.personalization_issues?.map((i) => [i.code, i.status])).toEqual([["missing_source", "mapping_unresolved"]]);
    const unsettled = row(gift(event.id, { personalization_mappings: [{ ...mappings(nameDef)[0], resolution: "unresolved" }, ...mappings(nameDef).slice(1)] }), two.id);
    expect(unsettled.personalization?.caption).toMatchObject({ value: null, status: "mapping_unresolved" });
    expect(unsettled.personalization_status).toBe("incomplete");
  });

  it("grades a mapping flagged for confirmation needs_confirmation with the value in place", () => {
    const { event, nameDef, one } = seed();
    const r = row(gift(event.id, { personalization_mappings: [{ ...mappings(nameDef)[0], resolution: "needs_confirmation" }, ...mappings(nameDef).slice(1)] }), one.id);
    expect(r.personalization?.caption).toMatchObject({ value: "Ada", status: "needs_confirmation" });
    expect(r.personalization_issues?.map((i) => i.status)).toEqual(["needs_confirmation"]);
    expect(r.personalization_status).toBe("incomplete");
  });

  it("grades a requirement the store rejected through an open exception vendor_rejected until the exception closes", () => {
    const { event, nameDef, one, two } = seed();
    const g = gift(event.id, { personalization_mappings: mappings(nameDef) });
    openException(g.id, { attendee_ref: one.id, requirement_id: "caption", type: "invalid_value", message: "No hyphens." }, "token:tok_1");
    expect(row(g, one.id).personalization?.caption).toMatchObject({ value: "Ada", status: "vendor_rejected" });
    expect(row(g, one.id)).toMatchObject({ personalization_status: "invalid", personalization_issues: [{ vendor_field_key: "caption", code: "vendor_rejected", status: "vendor_rejected" }] });
    expect(row(g, two.id).personalization?.caption.status).toBe("missing");
    writeValue("guest", one.id, nameDef.id, "Ada B", "guest");
    resolveExceptionsByAnswer(one.id, nameDef.id, "guest");
    expect(row(g, one.id).personalization?.caption.status).toBe("resolved");
  });

  it("grades an answer written after the approved revision changed_after_approval and keeps the row ready", () => {
    const { event, nameDef, one } = seed();
    const g = gift(event.id, { personalization_mappings: mappings(nameDef) });
    moveProcurement(g.id, "approved", "organizer", { patch: { approved_revision: state().seq } });
    expect(row(g, one.id).personalization?.caption.status).toBe("resolved");
    const later = writeValue("guest", one.id, nameDef.id, "Ada C", "guest");
    const r = row(g, one.id);
    expect(r.personalization?.caption).toMatchObject({ value: "Ada C", status: "changed_after_approval", provenance: { revision: later.seq } });
    expect(r.personalization_issues?.map((i) => i.status)).toEqual(["changed_after_approval"]);
    expect(r.personalization_status).toBe("ready");
  });

  it("leaves an ordinary product's manifest rows without personalization fields", () => {
    const { event, one } = seed();
    const g = gift(event.id, { personalization: null });
    const r = row(g, one.id);
    expect(r.personalization).toBeUndefined();
    expect(r.personalization_status).toBeUndefined();
    expect(r.personalization_issues).toBeUndefined();
  });
});
