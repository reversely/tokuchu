import { beforeEach, describe, expect, it } from "vitest";
import { createGift, getGift, type GiftInput } from "./gifts";
import { applyRequirementSchema, changesAfter, moveProcurement } from "./procurement";
import { deriveSchemaId, deriveSchemaVersion, diffRequirements } from "./requirement-schema";
import { createEvent, createGuest, createParty, procurementFor, resetState, upsertDefinition, writeValue, type EventInput } from "./store";
import type { PersonalizationField } from "./types";

const EVENT: EventInput = {
  type: "event",
  title: "Test event",
  host: "Host",
  starts_at: "2030-01-10T19:00:00Z",
  venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" },
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
  { key: "printed_name", label: "Name", kind: "name", required: true, constraints: { max_length: 20 } },
  { key: "star_map_location", label: "Location", kind: "location", required: true, constraints: {} }
];

const GOING = [{ field: "status", op: "eq", value: "going" }] as const;

const GIFT: GiftInput = {
  product_id: "gid://shopify/Product/1",
  shop_domain: "springbuilt.myshopify.com",
  product_title: "Crewneck",
  recipients: [...GOING],
  rules: [{ filter: [...GOING], product_id: "gid://shopify/Product/1" }],
  mapping: [],
  default_variant_id: "var_1",
  variants: [],
  missing_value_fallback: "default",
  post_lock_cancellation: "keep",
  cutoff: null,
  cart_id: null,
  checkout_id: null,
  order_id: null
};

describe("the derived schema identity", () => {
  it("names the schema by the store's domain and the product id", () => {
    expect(deriveSchemaId("springbuilt.myshopify.com", "gid://shopify/Product/1")).toBe("springbuilt.myshopify.com/gid://shopify/Product/1");
    expect(deriveSchemaId("https://springbuilt.myshopify.com/", "7")).toBe("springbuilt.myshopify.com/7");
  });

  it("gives one version for the same keys, kinds, and constraints in any order and another when a constraint changes", () => {
    const version = deriveSchemaVersion(FIELDS);
    expect(version).toMatch(/^[0-9a-f]{16}$/);
    expect(deriveSchemaVersion([...FIELDS].reverse())).toBe(version);
    expect(deriveSchemaVersion(FIELDS.map((f) => ({ ...f, label: `${f.label} renamed` })))).toBe(version);
    expect(deriveSchemaVersion([{ ...FIELDS[0], constraints: { max_length: 12 } }, FIELDS[1]])).not.toBe(version);
    expect(deriveSchemaVersion([{ ...FIELDS[0], kind: "text" }, FIELDS[1]])).not.toBe(version);
    expect(deriveSchemaVersion([FIELDS[0]])).not.toBe(version);
  });

  it("diffs two versions into added, removed, and changed keys", () => {
    const next: PersonalizationField[] = [{ ...FIELDS[0], constraints: { max_length: 12 } }, { key: "engraving_text", label: "Engraving", kind: "text", required: false, constraints: {} }];
    expect(diffRequirements(FIELDS, next)).toEqual({ added: ["engraving_text"], removed: ["star_map_location"], changed: ["printed_name"] });
    expect(diffRequirements(FIELDS, FIELDS)).toEqual({ added: [], removed: [], changed: [] });
  });
});

describe("applying a re-read schema to a procurement", () => {
  beforeEach(resetState);

  function seed() {
    const event = createEvent(EVENT);
    const name = upsertDefinition(event.id, { namespace: "vendor", key: "printed_name", label: "Name", scope: "guest", value_type: "text", constraints: { max_length: 20 }, default_visibility: [], required_rule: "going", creator: "organizer", vendor_field: { key: "printed_name", label: "Name", kind: "name" } });
    const location = upsertDefinition(event.id, { namespace: "vendor", key: "star_map_location", label: "Location", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer", vendor_field: { key: "star_map_location", label: "Location", kind: "location" } });
    const party = createParty(event.id, {});
    const guest = createGuest(event.id, party.id, { display_name: "Guest One", status: "going" });
    writeValue("guest", guest.id, name.id, "Ada", "guest");
    writeValue("guest", guest.id, location.id, "Vancouver", "guest");
    const version = deriveSchemaVersion(FIELDS);
    const gift = createGift(event.id, {
      ...GIFT,
      personalization: { fields: FIELDS, schema_id: deriveSchemaId(GIFT.shop_domain, GIFT.product_id), schema_version: version },
      personalization_mappings: [
        { vendor_field_key: "printed_name", source: { type: "definition", definition_id: name.id, subject_scope: "guest" } },
        { vendor_field_key: "star_map_location", source: { type: "definition", definition_id: location.id, subject_scope: "guest" } }
      ]
    });
    return { event, gift, name, location, version, schema_id: deriveSchemaId(GIFT.shop_domain, GIFT.product_id) };
  }

  it("stores the id and the version on the procurement and reuses the persisted mappings on the same version", () => {
    const { gift, version, schema_id } = seed();
    expect(procurementFor(gift.id)).toMatchObject({ requirement_schema_id: schema_id, requirement_schema_version: version });
    const seq = changesAfter(gift.id, 0).current_revision;
    const again = applyRequirementSchema(gift.id, { schema_id, version, requirements: FIELDS }, "organizer");
    expect(again).toMatchObject({ reused: true, diff: null });
    expect(getGift(gift.id).personalization_mappings).toHaveLength(2);
    expect(changesAfter(gift.id, 0).current_revision).toBe(seq);
  });

  it("diffs a new version, drops the removed mapping, flags the changed one unresolved, and returns an approved procurement to collecting", () => {
    const { gift, version, schema_id } = seed();
    moveProcurement(gift.id, "collecting", "organizer");
    moveProcurement(gift.id, "approved", "organizer", { patch: { approved_revision: changesAfter(gift.id, 0).current_revision } });
    const approved = procurementFor(gift.id);
    const next: PersonalizationField[] = [{ ...FIELDS[0], constraints: { max_length: 12 } }];
    const nextVersion = deriveSchemaVersion(next);
    expect(nextVersion).not.toBe(version);
    const applied = applyRequirementSchema(gift.id, { schema_id, version: nextVersion, requirements: next }, "organizer");
    expect(applied.diff).toEqual({ added: [], removed: ["star_map_location"], changed: ["printed_name"] });
    expect(applied.procurement).toMatchObject({ status: "collecting", requirement_schema_id: schema_id, requirement_schema_version: nextVersion, approved_revision: approved.approved_revision });
    expect(applied.procurement.current_revision).toBeGreaterThan(approved.approved_revision!);
    const stored = getGift(gift.id);
    expect(stored.personalization).toEqual({ fields: next, schema_id, schema_version: nextVersion });
    expect(stored.personalization_mappings).toEqual([{ vendor_field_key: "printed_name", source: { type: "definition", definition_id: expect.any(String), subject_scope: "guest" }, resolution: "unresolved" }]);
    const types = changesAfter(gift.id, approved.current_revision).changes.map((c) => [c.type, c.summary]);
    expect(types).toEqual([
      ["mapping_changed", `The store's requirement schema moved to version ${nextVersion}: removed star_map_location; changed printed_name`],
      ["status_changed", "The requirement schema changed after the approval"]
    ]);
  });

  it("moves an approved procurement to ready when the new version leaves every row resolved", () => {
    const { gift, version, schema_id } = seed();
    moveProcurement(gift.id, "approved", "organizer", { patch: { approved_revision: changesAfter(gift.id, 0).current_revision } });
    const next: PersonalizationField[] = [FIELDS[0]];
    const applied = applyRequirementSchema(gift.id, { schema_id, version: deriveSchemaVersion(next), requirements: next }, "organizer");
    expect(applied.diff).toEqual({ added: [], removed: ["star_map_location"], changed: [] });
    expect(applied.procurement.status).toBe("ready");
    expect(getGift(gift.id).personalization_mappings?.map((m) => m.vendor_field_key)).toEqual(["printed_name"]);
  });

  it("adopts a schema without a diff on a gift that had no version yet", () => {
    const event = createEvent(EVENT);
    const gift = createGift(event.id, { ...GIFT, personalization: { fields: FIELDS } });
    expect(procurementFor(gift.id).requirement_schema_version).toBeUndefined();
    const applied = applyRequirementSchema(gift.id, { schema_id: "springbuilt.myshopify.com/gid://shopify/Product/1", version: deriveSchemaVersion(FIELDS), requirements: FIELDS }, "organizer");
    expect(applied).toMatchObject({ reused: false, diff: null });
    expect(procurementFor(gift.id).requirement_schema_version).toBe(deriveSchemaVersion(FIELDS));
    expect(changesAfter(gift.id, 0).changes).toEqual([]);
  });
});
