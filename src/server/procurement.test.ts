import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishEvent, resetState } from "../domain/store";
import type { PersonalizationField } from "../domain/types";
import { approveSpecs, createEventFromBody, createGiftFromBody, patchRsvp, requestFromAttendees, snapshot, submitRsvp } from "./api";
import { setMailer, type MailMessage } from "./mail";
import { fulfillmentManifest, postProcurementUpdate } from "./procurement";
import { changesAfter, exceptionsFor } from "../domain/procurement";
import { deserializeState, serializeState, state } from "../domain/store";

const BODY = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };

const FIELDS: PersonalizationField[] = [
  { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
  { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
];

let sent: MailMessage[] = [];

function fakeMailer() {
  sent = [];
  setMailer({
    async send(message) {
      sent.push(message);
      return "sent";
    }
  });
  return sent;
}

/** An event with the crewneck gift, its questions requested, and two going attendees: one answered and one who has not. */
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
  const reply = submitRsvp(event.id, {
    party: { contact: { email: "a@b.co" } },
    guests: [
      { display_name: "Avery Chen", status: "going", answers: { [size.id]: "l", [location.id]: "Vancouver" } },
      { display_name: "Blake Rivera", status: "going", answers: { [size.id]: "m" } }
    ]
  });
  return { event, gift, size, location, avery: reply.guest_ids[0], blake: reply.guest_ids[1] };
}

describe("the fulfillment manifest", () => {
  beforeEach(() => {
    resetState();
    fakeMailer();
  });
  afterEach(() => setMailer(null));

  it("keys each attendee's values by the store's requirement and grades the row", async () => {
    const { event, gift, avery, blake } = await seed();
    const view = fulfillmentManifest(event.id, gift.id);
    expect(view).toMatchObject({ procurement_id: gift.id, status: "collecting", approved_revision: null, requirement_schema_id: "springbuilt.myshopify.com/gid://shopify/Product/1" });
    expect(view.revision).toBe(snapshot(event.id).seq);
    const rows = Object.fromEntries(view.attendees.map((a) => [a.attendee_ref, a]));
    expect(rows[avery]).toMatchObject({ status: "ready", variant_id: "v-l", values: { star_map_location: "Vancouver", caption: "Avery Chen", variant_size: "l" }, issues: [] });
    expect(rows[blake]).toMatchObject({ status: "incomplete", variant_id: "v-m", values: { star_map_location: null, caption: "Blake Rivera", variant_size: "m" } });
    expect(rows[blake].issues).toEqual([{ requirement_id: "star_map_location", status: "incomplete", message: "Enter Location for Star Map 1 is not confirmed by the attendee yet" }]);
  });

  it("never shows a token holder a requirement whose definition it may not read", async () => {
    const { event, gift, size, location, avery, blake } = await seed();
    const view = fulfillmentManifest(event.id, gift.id, [size.id]);
    for (const row of view.attendees) {
      expect(Object.keys(row.values).sort()).toEqual(["caption", "variant_size"]);
      expect(row.issues).toEqual([]);
      expect(row.status).toBe("ready");
    }
    expect(view.attendees.map((a) => a.attendee_ref).sort()).toEqual([avery, blake].sort());
    const wide = fulfillmentManifest(event.id, gift.id, [size.id, location.id]);
    expect(wide.attendees.find((a) => a.attendee_ref === blake)!.issues.map((i) => i.requirement_id)).toEqual(["star_map_location"]);
    expect(view.revision).toBeLessThanOrEqual(wide.revision);
  });

  it("carries the approved revision and moves the status with the approval", async () => {
    const { event, gift, location, blake } = await seed();
    const approved = approveSpecs(event.id, gift.id);
    const view = fulfillmentManifest(event.id, gift.id);
    expect(view.status).toBe("approved");
    expect(view.approved_revision).toBe(approved.approved_seq);
    expect(view.revision).toBe(approved.approved_seq);
    patchRsvp(event.id, blake, { answers: { [location.id]: "Calgary" } });
    const later = fulfillmentManifest(event.id, gift.id);
    expect(later.revision).toBeGreaterThan(later.approved_revision!);
    expect(later.attendees.find((a) => a.attendee_ref === blake)).toMatchObject({ status: "ready", values: { star_map_location: "Calgary" } });
  });
});

describe("a store's structured update", () => {
  beforeEach(() => {
    resetState();
    fakeMailer();
  });
  afterEach(() => setMailer(null));

  it("moves the order's status on accepted, production_started, and fulfilled and records each move", async () => {
    const { event, gift } = await seed();
    const before = changesAfter(gift.id, 0).current_revision;
    const accepted = await postProcurementUpdate(event.id, gift.id, "token:tok_1", { type: "accepted", reference: "PO-7" });
    expect(accepted).toMatchObject({ procurement_status: "accepted", update: { kind: "confirmed", reference: "PO-7", caller: "token:tok_1" }, exception: null });
    expect(accepted.current_revision).toBeGreaterThan(before);
    expect(fulfillmentManifest(event.id, gift.id).status).toBe("accepted");
    await postProcurementUpdate(event.id, gift.id, "token:tok_1", { type: "production_started" });
    expect(fulfillmentManifest(event.id, gift.id).status).toBe("in_production");
    await postProcurementUpdate(event.id, gift.id, "token:tok_1", { type: "fulfilled", message: "Shipped by courier." });
    expect(fulfillmentManifest(event.id, gift.id).status).toBe("fulfilled");
    const types = changesAfter(gift.id, before).changes.map((c) => [c.type, c.actor_type]);
    expect(types).toEqual([["update_posted", "vendor"], ["status_changed", "vendor"], ["update_posted", "vendor"], ["status_changed", "vendor"], ["update_posted", "vendor"], ["status_changed", "vendor"]]);
    expect(snapshot(event.id).exceptions).toEqual([]);
    expect(sent.filter((m) => m.subject.startsWith("A correction"))).toHaveLength(0);
  });

  it("needs_information opens an exception, marks the requirement incomplete, and emails the attendee a correction with the store's words quoted", async () => {
    const { event, gift, location, avery } = await seed();
    sent.length = 0;
    const posted = await postProcurementUpdate(event.id, gift.id, "token:tok_1", { type: "needs_information", attendee_ref: avery, requirement_id: "star_map_location", message: "Which Vancouver?\nThere are two." });
    expect(posted.exception).toMatchObject({ procurement_id: gift.id, attendee_ref: avery, requirement_id: "star_map_location", source: "vendor", type: "missing_information", status: "open", resolved_revision: null });
    expect(posted.exception!.created_revision).toBeLessThanOrEqual(posted.current_revision);
    const row = fulfillmentManifest(event.id, gift.id).attendees.find((a) => a.attendee_ref === avery)!;
    expect(row.status).toBe("exception");
    expect(row.issues).toEqual([{ requirement_id: "star_map_location", status: "incomplete", message: "Which Vancouver?\nThere are two." }]);
    const corrections = sent.filter((m) => m.subject.startsWith("A correction"));
    expect(corrections).toHaveLength(1);
    expect(corrections[0].subject).toBe("A correction for your details for Astronomy Symposium");
    expect(corrections[0].text).toContain("> Which Vancouver?\n> There are two.");
    expect(corrections[0].text).toContain("- Enter Location for Star Map 1");
    expect(corrections[0].text).toContain(`guest=${avery}`);
    const request = snapshot(event.id).requests.find((r) => r.guest_id === avery)!;
    expect(request.definition_ids).toContain(location.id);
    expect(request.delivery).toBe("sent");
    expect(snapshot(event.id).exceptions.map((e) => e.id)).toEqual([posted.exception!.id]);
    // A token that may not read the location never sees the exception on it.
    const hidden = fulfillmentManifest(event.id, gift.id, []).attendees.find((a) => a.attendee_ref === avery)!;
    expect(hidden.status).toBe("ready");
    expect(hidden.issues).toEqual([]);
  });

  it("invalid_value and option_unavailable mark the requirement vendor_rejected and invalid_value needs the attendee and the requirement", async () => {
    const { event, gift, avery, blake } = await seed();
    await expect(postProcurementUpdate(event.id, gift.id, "token:tok_1", { type: "invalid_value", message: "Too long." })).rejects.toThrow(/names the attendee/);
    await postProcurementUpdate(event.id, gift.id, "token:tok_1", { type: "invalid_value", attendee_ref: avery, requirement_id: "star_map_location", message: "Not a place we can chart." });
    await postProcurementUpdate(event.id, gift.id, "token:tok_1", { type: "option_unavailable", attendee_ref: blake, requirement_id: "variant_size", unavailable_value: "m", allowed_values: ["l"] });
    const rows = Object.fromEntries(fulfillmentManifest(event.id, gift.id).attendees.map((a) => [a.attendee_ref, a]));
    expect(rows[avery].issues).toEqual([{ requirement_id: "star_map_location", status: "vendor_rejected", message: "Not a place we can chart." }]);
    expect(rows[blake].status).toBe("exception");
    expect(rows[blake].issues.find((i) => i.requirement_id === "variant_size")).toEqual({ requirement_id: "variant_size", status: "vendor_rejected", message: "m is unavailable; the store offers l" });
    expect(exceptionsFor(event.id, gift.id).map((e) => e.type)).toEqual(["invalid_value", "option_unavailable"]);
    expect(sent.filter((m) => m.subject.startsWith("A correction"))).toHaveLength(2);
  });

  it("exception without an attendee opens a gift-level exception the organizer sees and sends no email", async () => {
    const { event, gift } = await seed();
    sent.length = 0;
    const posted = await postProcurementUpdate(event.id, gift.id, "organizer", { type: "exception", message: "The blank stock is late." });
    expect(posted.exception).toMatchObject({ attendee_ref: null, requirement_id: null, source: "organizer", type: "other", status: "open" });
    expect(posted.update.kind).toBe("issue");
    expect(sent.filter((m) => m.subject.startsWith("A correction"))).toHaveLength(0);
    expect(fulfillmentManifest(event.id, gift.id).attendees.every((a) => a.status !== "exception")).toBe(true);
    expect(snapshot(event.id).exceptions).toHaveLength(1);
  });

  it("an attendee's later answer on the requirement resolves the exception with the resolving revision", async () => {
    const { event, gift, location, avery, blake } = await seed();
    const posted = await postProcurementUpdate(event.id, gift.id, "token:tok_1", { type: "needs_information", attendee_ref: avery, requirement_id: "star_map_location", message: "Which one?" });
    patchRsvp(event.id, blake, { answers: { [location.id]: "Calgary" } });
    expect(exceptionsFor(event.id, gift.id)[0].status).toBe("open");
    patchRsvp(event.id, avery, { answers: { [location.id]: "Vancouver BC" } });
    const resolved = exceptionsFor(event.id, gift.id)[0];
    expect(resolved).toMatchObject({ id: posted.exception!.id, status: "resolved" });
    expect(resolved.resolved_revision).toBeGreaterThan(resolved.created_revision);
    expect(resolved.resolved_at).not.toBeNull();
    expect(changesAfter(gift.id, posted.current_revision).changes.map((c) => c.type)).toEqual(["answer_changed", "answer_changed", "exception_resolved"]);
    expect(changesAfter(gift.id, 0).current_revision).toBe(resolved.resolved_revision);
    const row = fulfillmentManifest(event.id, gift.id).attendees.find((a) => a.attendee_ref === avery)!;
    expect(row).toMatchObject({ status: "ready", values: { star_map_location: "Vancouver BC" }, issues: [] });
    expect(fulfillmentManifest(event.id, gift.id).status).toBe("collecting");
  });

  it("stores exceptions in the state document and a document without them loads", async () => {
    const { event, gift, avery } = await seed();
    await postProcurementUpdate(event.id, gift.id, "token:tok_1", { type: "needs_information", attendee_ref: avery, requirement_id: "star_map_location", message: "Which one?" });
    const doc = serializeState(state());
    expect(doc.exceptions).toHaveLength(1);
    expect(deserializeState(doc).exceptions.size).toBe(1);
    const { exceptions: _dropped, ...older } = doc;
    expect(deserializeState(older).exceptions.size).toBe(0);
  });
});
