import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishEvent, resetState } from "../domain/store";
import type { PersonalizationField } from "../domain/types";
import { approveSpecs, createEventFromBody, createGiftFromBody, patchRsvp, requestFromAttendees, snapshot, submitRsvp } from "./api";
import { setMailer, type MailMessage } from "./mail";
import { fulfillmentManifest } from "./procurement";

const BODY = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" } };

const FIELDS: PersonalizationField[] = [
  { key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} },
  { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }
];

function fakeMailer() {
  const sent: MailMessage[] = [];
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
