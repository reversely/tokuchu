/**
 * The reconciliation service (#38): each method of the decision order over a fixed schema, the model
 * step over a scripted matcher and a scripted SDK model, the threshold, the confirmations, and the
 * request step asking only for what the decisions left to create.
 */
import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openaiMatcher } from "../agent/reconcile-llm";
import { publishEvent, resetState, upsertDefinition } from "../domain/store";
import type { AttributeDefinition, PersonalizationMapping } from "../domain/types";
import { createEventFromBody, createGiftFromBody, giftRequirements, giftView, requestFromAttendees, snapshot, submitRsvp } from "./api";
import { setMailer } from "./mail";
import { completeness, confirmRequirement, incompatibility, llmInput, proposedDefinition, reconcileDeterministically, reconcileGift, reconcileVendorRequirements, resetReconcileState, vendorSchemaFor, type LlmMatcher, type ReconcileInput, type VendorRequirement, type VendorSchema } from "./reconcile";

const BODY = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" }, cost_per_person_cents: 5000 };

let counter = 0;
function def(key: string, value_type: AttributeDefinition["value_type"], extra: Partial<AttributeDefinition> = {}): AttributeDefinition {
  counter += 1;
  return { id: `def_${counter}`, event_id: "evt", namespace: "organizer", key, label: key.replace(/_/g, " "), scope: "guest", value_type, constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer", ...extra };
}

const SIZE: VendorRequirement = { key: "variant_size", label: "Size", kind: "variant", required: true, allowed: [{ value: "m", label: "M" }, { value: "l", label: "L" }] };
const schema = (...requirements: VendorRequirement[]): VendorSchema => ({ id: "store/product", version: "1", requirements });
const input = (vendorSchema: VendorSchema, tokuchuAttributes: AttributeDefinition[] = [], savedMappings: PersonalizationMapping[] = []): ReconcileInput => ({ vendorSchema, tokuchuAttributes, savedMappings });

describe("the decision order", () => {
  it("maps a definition carrying the requirement's key as exact", () => {
    const size = def("variant_size", "enum", { constraints: { options: [{ value: "m", label: "M" }] } });
    const [decision] = reconcileDeterministically(input(schema(SIZE), [size]));
    expect(decision).toEqual({ requirement_id: "variant_size", decision: "map_existing", attribute_id: size.id, confidence: 1, method: "exact" });
  });

  it("maps the definition a vendor field created ahead of one sharing the key", () => {
    const byKey = def("caption", "text");
    const byField = def("caption_2", "text", { vendor_field: { key: "caption", label: "Text 2", kind: "text" } });
    const [decision] = reconcileDeterministically(input(schema({ key: "caption", label: "Text 2", kind: "text", required: true }), [byKey, byField]));
    expect(decision).toMatchObject({ decision: "map_existing", attribute_id: byField.id, method: "exact" });
  });

  it("asks for confirmation when the exact key's definition cannot hold the value", () => {
    const size = def("variant_size", "text");
    const [decision] = reconcileDeterministically(input(schema(SIZE), [size]));
    expect(decision).toMatchObject({ decision: "needs_confirmation", candidates: [{ attribute_id: size.id, method: "exact", confidence: 0.5 }], reason: expect.stringContaining("needs enum") });
  });

  it("keeps a saved mapping to a definition and to the event, and drops one to a definition that left the event", () => {
    const city = def("hometown", "text");
    const saved: PersonalizationMapping[] = [
      { vendor_field_key: "star_map_location", source: { type: "definition", definition_id: city.id, subject_scope: "guest" } },
      { vendor_field_key: "star_map_date", source: { type: "event", key: "starts_at" }, transform: "date_only" },
      { vendor_field_key: "motto", source: { type: "definition", definition_id: "def_gone", subject_scope: "guest" } }
    ];
    const requirements: VendorRequirement[] = [
      { key: "star_map_location", label: "Location", kind: "location", required: true },
      { key: "star_map_date", label: "Date", kind: "date", required: true },
      { key: "motto", label: "Motto", kind: "text", required: true }
    ];
    const decisions = reconcileDeterministically(input(schema(...requirements), [city], saved));
    expect(decisions[0]).toEqual({ requirement_id: "star_map_location", decision: "map_existing", attribute_id: city.id, confidence: 1, method: "saved_mapping" });
    expect(decisions[1]).toEqual({ requirement_id: "star_map_date", decision: "derive", source: { type: "event", key: "starts_at" }, transform: "date_only", confidence: 1, method: "saved_mapping" });
    expect(decisions[2]).toMatchObject({ decision: "create_field", proposed_definition: { key: "motto", value_type: "text" } });
  });

  it("maps by alias when one compatible definition shares the concept", () => {
    const shirt = def("shirt_size", "enum", { constraints: { options: [{ value: "l", label: "L" }, { value: "xl", label: "XL" }] } });
    const printed = def("printed_name", "text");
    const city = def("city", "text");
    const decisions = reconcileDeterministically(input(schema(SIZE, { key: "name_to_print", label: "Name", kind: "text", required: true }, { key: "loc", label: "Enter Location for Star Map 1", kind: "text", required: true }), [shirt, printed, city]));
    expect(decisions[0]).toEqual({ requirement_id: "variant_size", decision: "map_existing", attribute_id: shirt.id, confidence: 0.9, method: "alias" });
    expect(decisions[1]).toMatchObject({ decision: "map_existing", attribute_id: printed.id, confidence: 0.9, method: "alias" });
    // The label alone names the concept, at a lower confidence.
    expect(decisions[2]).toMatchObject({ decision: "map_existing", attribute_id: city.id, confidence: 0.85, method: "alias" });
  });

  it("skips an alias whose definition fails the type or the allowed set", () => {
    const wrongType = def("shirt_size", "text");
    const noOverlap = def("size", "enum", { constraints: { options: [{ value: "xs", label: "XS" }] } });
    const [decision] = reconcileDeterministically(input(schema(SIZE), [wrongType, noOverlap]));
    expect(decision).toMatchObject({ decision: "create_field", proposed_definition: { key: "variant_size", value_type: "enum", constraints: { options: SIZE.allowed } } });
    expect(incompatibility(SIZE, noOverlap)).toMatch(/offers none of the values/);
  });

  it("asks for confirmation between two aliased definitions", () => {
    const one = def("printed_name", "text");
    const two = def("full_name", "text");
    const [decision] = reconcileDeterministically(input(schema({ key: "caption", label: "Text 2", kind: "name", required: true }), [one, two]));
    expect(decision).toMatchObject({ decision: "needs_confirmation", reason: "2 fields could fill Text 2" });
    expect((decision as { candidates: { attribute_id: string }[] }).candidates.map((c) => c.attribute_id)).toEqual([one.id, two.id]);
  });

  it("derives deterministically: a name from the guest row and an event date from the start", () => {
    const decisions = reconcileDeterministically(input(schema({ key: "caption", label: "Text 2", kind: "name", required: true }, { key: "star_map_date", label: "Date", kind: "date", required: true })));
    expect(decisions[0]).toEqual({ requirement_id: "caption", decision: "derive", source: { type: "guest", key: "display_name" }, confidence: 0.9, method: "deterministic" });
    expect(decisions[1]).toEqual({ requirement_id: "star_map_date", decision: "derive", source: { type: "event", key: "starts_at" }, transform: "date_only", confidence: 0.9, method: "deterministic" });
  });

  it("proposes the question a requirement becomes: a date, a file, a choice, a clock time, and capped text", () => {
    expect(proposedDefinition({ key: "d", label: "D", kind: "date", required: true })).toMatchObject({ value_type: "date", scope: "guest", required_rule: "going", vendor_field: { key: "d", kind: "date" } });
    expect(proposedDefinition({ key: "p", label: "P", kind: "image", required: true })).toMatchObject({ value_type: "file" });
    expect(proposedDefinition({ key: "c", label: "C", kind: "color", required: true, allowed: [{ value: "red", label: "Red" }] })).toMatchObject({ value_type: "enum", constraints: { options: [{ value: "red", label: "Red" }] } });
    expect(proposedDefinition({ key: "t", label: "T", kind: "time", required: true }).constraints.pattern).toBe("^([01]\\d|2[0-3]):[0-5]\\d$");
    expect(proposedDefinition({ key: "m", label: "M", kind: "text", required: true, max_length: 20 })).toMatchObject({ value_type: "text", constraints: { max_length: 20 } });
    expect(proposedDefinition(SIZE).vendor_field).toBeUndefined();
  });

  it("counts completeness over the decisions", () => {
    const decisions = reconcileDeterministically(input(schema(SIZE, { key: "motto", label: "Motto", kind: "text", required: true }), [def("variant_size", "enum", { constraints: { options: [{ value: "m", label: "M" }] } })]));
    expect(completeness(decisions)).toEqual({ total: 2, resolved: 1, to_create: 1, pending_confirmation: 0, complete: true });
  });
});

describe("the model step", () => {
  const motto: VendorRequirement = { key: "motto", label: "A line to print", kind: "text", required: true };

  it("runs only for requirements the deterministic steps left to create, over metadata only, and maps a compatible proposal over the threshold", async () => {
    const line = def("favourite_line", "text", { label: "Favourite line" });
    const photo = def("photo", "file");
    const size = def("variant_size", "enum", { constraints: { options: [{ value: "m", label: "M" }] } });
    const llm = vi.fn<LlmMatcher>(async () => ({ attribute_id: line.id, confidence: 0.92, reason: "Both hold a line the guest wrote" }));
    const decisions = await reconcileVendorRequirements(input(schema(SIZE, motto), [line, photo, size]), { llm });
    expect(llm).toHaveBeenCalledTimes(1);
    // The size resolved by key, so the model saw only the motto, and only the fields a text kind can take: the line and the choice, never the file.
    expect(llm.mock.calls[0][0]).toEqual({ requirement: { key: "motto", label: "A line to print", type: "text" }, fields: [{ id: line.id, label: "Favourite line", type: "text" }, { id: size.id, label: "variant size", type: "enum" }] });
    expect(JSON.stringify(llm.mock.calls[0][0])).not.toMatch(/Avery|value/);
    expect(decisions[1]).toEqual({ requirement_id: "motto", decision: "map_existing", attribute_id: line.id, confidence: 0.92, method: "llm" });
  });

  it("asks for confirmation under the threshold and takes the threshold from the options", async () => {
    const line = def("favourite_line", "text");
    const llm: LlmMatcher = async () => ({ attribute_id: line.id, confidence: 0.6, reason: "A guess" });
    const [low] = await reconcileVendorRequirements(input(schema(motto), [line]), { llm });
    expect(low).toEqual({ requirement_id: "motto", decision: "needs_confirmation", candidates: [{ attribute_id: line.id, label: line.label, confidence: 0.6, method: "llm" }], reason: "A guess" });
    const [lenient] = await reconcileVendorRequirements(input(schema(motto), [line]), { llm, threshold: 0.5 });
    expect(lenient).toMatchObject({ decision: "map_existing", method: "llm" });
  });

  it("drops a proposal naming an unknown or incompatible attribute and creates the field", async () => {
    const photo = def("photo", "file");
    const line = def("favourite_line", "text");
    const invented: LlmMatcher = async () => ({ attribute_id: "def_invented", confidence: 0.99, reason: "Made up" });
    expect((await reconcileVendorRequirements(input(schema(motto), [line]), { llm: invented }))[0].decision).toBe("create_field");
    const wrongType: LlmMatcher = async () => ({ attribute_id: photo.id, confidence: 0.99, reason: "A picture" });
    expect((await reconcileVendorRequirements(input(schema(motto), [photo, line]), { llm: wrongType }))[0].decision).toBe("create_field");
  });

  it("skips the model without a matcher and without compatible fields, and records each verdict once", async () => {
    const llm = vi.fn<LlmMatcher>(async () => ({ attribute_id: null, confidence: 0, reason: "None" }));
    expect((await reconcileVendorRequirements(input(schema(motto), [def("favourite_line", "text")]), { llm: null }))[0].decision).toBe("create_field");
    await reconcileVendorRequirements(input(schema(motto), [def("photo", "file")]), { llm });
    expect(llm).not.toHaveBeenCalled();
    const proposals = new Map();
    const line = def("favourite_line", "text");
    await reconcileVendorRequirements(input(schema(motto), [line]), { llm, proposals });
    await reconcileVendorRequirements(input(schema(motto), [line]), { llm, proposals });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(proposals.get("motto")).toEqual({ attribute_id: null, confidence: 0, reason: "None" });
  });

  it("answers through a scripted SDK model with the structured verdict", async () => {
    const line = def("favourite_line", "text");
    const requests: ModelRequest[] = [];
    const model: Model = {
      async getResponse(request): Promise<ModelResponse> {
        requests.push(request);
        return { usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify({ attribute_id: line.id, confidence: 0.9, reason: "Same meaning" }) }] }] };
      },
      // eslint-disable-next-line require-yield
      async *getStreamedResponse() {
        throw new Error("streaming is not scripted");
      }
    };
    const verdict = await openaiMatcher({ model })(llmInput(motto, [line]));
    expect(verdict).toEqual({ attribute_id: line.id, confidence: 0.9, reason: "Same meaning" });
    expect(requests[0].systemInstructions).toMatch(/Never invent an id/);
    expect(JSON.stringify(requests[0].input)).toContain(line.id);
  });
});

/** The crewneck with the fields the store's get_customization returns. */
function seedGift(eventId: string, extra: { key: string; label: string; kind: "text" | "name"; required: boolean }[] = []) {
  return createGiftFromBody(eventId, {
    product_id: "gid://shopify/Product/1",
    shop_domain: "springbuilt.myshopify.com",
    product_title: "Customized Crewneck",
    variants: [
      { id: "v-m", title: "M", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "M" }] },
      { id: "v-l", title: "L", price_cents: 5000, currency: "CAD", available: true, options: [{ name: "Size", label: "L" }] }
    ],
    personalization: { fields: [{ key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} }, { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }, ...extra] },
    default_variant_id: "v-m"
  });
}

describe("a gift's schema and the request step", () => {
  beforeEach(() => {
    resetState();
    resetReconcileState();
    setMailer({ async send() { return "sent"; } });
  });
  afterEach(() => setMailer(null));

  it("reads the variant axis and each field as the store's schema", () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const gift = seedGift(event.id);
    const read = vendorSchemaFor(giftView(event.id, gift.id));
    expect(read.id).toBe("springbuilt.myshopify.com/gid://shopify/Product/1");
    expect(read.requirements.map((r) => [r.key, r.kind])).toEqual([["variant_size", "variant"], ["star_map_location", "location"], ["caption", "name"]]);
    expect(read.requirements[0].allowed).toEqual([{ value: "m", label: "M" }, { value: "l", label: "L" }]);
    expect(read.requirements[2].max_length).toBe(20);
  });

  it("maps the caption to the printed name by alias, asks for the location, and records the model's verdict for a later read", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const printed = upsertDefinition(event.id, { namespace: "organizer", key: "printed_name", label: "Name for printing", scope: "guest", value_type: "text", constraints: { max_length: 40 }, default_visibility: [], required_rule: "going", creator: "organizer" });
    const home = upsertDefinition(event.id, { namespace: "organizer", key: "birthplace", label: "Where you were born", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "never", creator: "organizer" });
    const gift = giftView(event.id, seedGift(event.id).id);
    const llm = vi.fn<LlmMatcher>(async ({ requirement }) => (requirement.key === "star_map_location" ? { attribute_id: home.id, confidence: 0.9, reason: "A birthplace is a location" } : { attribute_id: null, confidence: 0, reason: "None" }));
    const { decisions, completeness: done } = await reconcileGift(gift, snapshot(event.id).definitions, { llm });
    expect(decisions.map((d) => d.decision)).toEqual(["create_field", "map_existing", "map_existing"]);
    expect(decisions[1]).toMatchObject({ attribute_id: home.id, method: "llm" });
    expect(decisions[2]).toMatchObject({ attribute_id: printed.id, method: "alias" });
    expect(done).toEqual({ total: 3, resolved: 2, to_create: 1, pending_confirmation: 0, complete: true });
    // The deterministic read agrees with the recorded verdict, and the request step asks for the size and the two mapped questions the attendee has not answered.
    const byKey = Object.fromEntries(giftRequirements(event.id, gift.id).map((r) => [r.key, r]));
    expect(byKey.star_map_location).toMatchObject({ source: "definition", definition_id: home.id, already: true });
    expect(byKey.variant_size).toMatchObject({ source: "question", already: false });
    submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going" }] });
    const snap = await requestFromAttendees(event.id, gift.id);
    const size = snap.definitions.find((d) => d.key === "variant_size")!;
    expect([...snap.requests[0].definition_ids].sort()).toEqual([size.id, home.id, printed.id].sort());
    expect(giftView(event.id, gift.id).personalization_mappings).toEqual(expect.arrayContaining([
      { vendor_field_key: "star_map_location", source: { type: "definition", definition_id: home.id, subject_scope: "guest" } },
      { vendor_field_key: "caption", source: { type: "definition", definition_id: printed.id, subject_scope: "guest" } }
    ]));
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("leaves the model out with the flag off", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    upsertDefinition(event.id, { namespace: "organizer", key: "birthplace", label: "Where you were born", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "never", creator: "organizer" });
    const gift = giftView(event.id, seedGift(event.id).id);
    const { decisions } = await reconcileGift(gift, snapshot(event.id).definitions);
    expect(decisions[1]).toMatchObject({ requirement_id: "star_map_location", decision: "create_field" });
  });

  it("holds a requirement that needs confirmation out of the request until the organizer confirms it", async () => {
    const event = publishEvent(createEventFromBody(BODY).id);
    const one = upsertDefinition(event.id, { namespace: "organizer", key: "printed_name", label: "Name for printing", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer" });
    upsertDefinition(event.id, { namespace: "organizer", key: "full_name", label: "Full name", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer" });
    const gift = giftView(event.id, seedGift(event.id).id);
    submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going" }] });
    const pending = giftRequirements(event.id, gift.id).find((r) => r.key === "caption")!;
    expect(pending).toMatchObject({ source: "question", already: false, confirmation: { reason: "2 fields could fill Text 2" } });
    expect(pending.question).toBeUndefined();

    await requestFromAttendees(event.id, gift.id);
    expect(giftView(event.id, gift.id).personalization_mappings?.some((m) => m.vendor_field_key === "caption")).toBe(false);
    expect(snapshot(event.id).definitions.some((d) => d.key === "caption")).toBe(false);

    confirmRequirement(gift, "caption", { attribute_id: one.id });
    expect(giftRequirements(event.id, gift.id).find((r) => r.key === "caption")).toMatchObject({ source: "definition", definition_id: one.id, already: true });
    await requestFromAttendees(event.id, gift.id);
    expect(giftView(event.id, gift.id).personalization_mappings).toContainEqual({ vendor_field_key: "caption", source: { type: "definition", definition_id: one.id, subject_scope: "guest" } });

    // A confirmation to create instead makes the field a question the next request creates and asks.
    confirmRequirement(gift, "caption", { create: true });
    const created = giftRequirements(event.id, gift.id).find((r) => r.key === "caption")!;
    expect(created).toMatchObject({ source: "question", already: false, question: { value_type: "text", constraints: { max_length: 20 } } });
  });
});
