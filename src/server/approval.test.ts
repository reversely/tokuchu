/** Approval tied to a revision (#44): approve, change, see the stale state on the snapshot and both revisions on the manifest, re-approve, see it clear. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishEvent, resetState } from "../domain/store";
import { approvalState } from "./approval";
import { approveSpecs, createEventFromBody, createGiftFromBody, patchRsvp, postUpdate, requestFromAttendees, snapshot, submitRsvp, updateGiftFromBody } from "./api";
import { setMailer } from "./mail";
import { fulfillmentManifest, postProcurementUpdate } from "./procurement";

const BODY = { title: "Astronomy Symposium", host: "Host", starts_at: "2030-01-10T19:00:00Z", venue: { name: "Venue", line1: "1 Street", city: "City", region: "RG", postal_code: "00000", country: "CA" }, cost_per_person_cents: 5000 };

/** A published event with the crewneck requested from one going attendee who answered the size and the location. */
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
    personalization: { fields: [{ key: "star_map_location", label: "Enter Location for Star Map 1", kind: "location", required: true, constraints: {} }, { key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 20 } }] },
    default_variant_id: "v-m"
  });
  await requestFromAttendees(event.id, gift.id);
  const defs = snapshot(event.id).definitions;
  const size = defs.find((d) => d.key === "variant_size")!;
  const location = defs.find((d) => d.key === "star_map_location")!;
  const { guest_ids } = submitRsvp(event.id, { party: { contact: { email: "a@b.co" } }, guests: [{ display_name: "Avery Chen", status: "going", answers: { [size.id]: "m", [location.id]: "Toronto" } }] });
  return { event, gift, size, location, avery: guest_ids[0] };
}

const gift = (eventId: string, giftId: string) => snapshot(eventId).gifts.find((g) => g.id === giftId)!;

describe("approval tied to a revision", () => {
  beforeEach(() => {
    resetState();
    setMailer({ async send() { return "sent"; } });
  });
  afterEach(() => setMailer(null));

  it("approves at the current revision, goes stale on a later answer, and clears on re-approval at the new revision", async () => {
    const { event, gift: g, location, avery } = await seed();
    expect(gift(event.id, g.id).approval).toEqual({ approved_revision: null, current_revision: expect.any(Number), stale: false, changes_since: 0 });

    const first = approveSpecs(event.id, g.id, new Date("2030-01-01T10:00:00Z"));
    let state = gift(event.id, g.id).approval;
    expect(state).toEqual({ approved_revision: first.approved_seq, current_revision: first.approved_seq, stale: false, changes_since: 0 });
    let manifest = fulfillmentManifest(event.id, g.id);
    expect(manifest).toMatchObject({ revision: first.approved_seq, approved_revision: first.approved_seq, status: "approved" });

    patchRsvp(event.id, avery, { answers: { [location.id]: "Calgary" } });
    state = gift(event.id, g.id).approval;
    expect(state.stale).toBe(true);
    expect(state.changes_since).toBe(1);
    expect(state.current_revision).toBeGreaterThan(state.approved_revision!);
    manifest = fulfillmentManifest(event.id, g.id);
    expect(manifest.approved_revision).toBe(first.approved_seq);
    expect(manifest.revision).toBe(state.current_revision);

    const second = approveSpecs(event.id, g.id, new Date("2030-01-02T10:00:00Z"));
    expect(second.approved_seq).toBeGreaterThan(first.approved_seq!);
    state = gift(event.id, g.id).approval;
    expect(state).toEqual({ approved_revision: second.approved_seq, current_revision: second.approved_seq, stale: false, changes_since: 0 });
    expect(fulfillmentManifest(event.id, g.id)).toMatchObject({ revision: second.approved_seq, approved_revision: second.approved_seq });
  });

  it("goes stale on a reply change, a mapping change, a schema change, and an opened exception, and stays fresh on a progress post", async () => {
    const { event, gift: g, avery } = await seed();
    const state = () => approvalState(gift(event.id, g.id));
    approveSpecs(event.id, g.id);
    postUpdate(event.id, g.id, "tokuchu", { kind: "in_production", text: "Filling the cart" });
    const fresh = state();
    expect(fresh.stale).toBe(false);
    expect(fresh.current_revision).toBeGreaterThan(fresh.approved_revision!);

    patchRsvp(event.id, avery, { status: "cant_go" });
    expect(state()).toMatchObject({ stale: true, changes_since: 1 });

    approveSpecs(event.id, g.id);
    updateGiftFromBody(event.id, g.id, { default_variant_id: "v-l" });
    expect(state()).toMatchObject({ stale: true, changes_since: 1 });

    approveSpecs(event.id, g.id);
    updateGiftFromBody(event.id, g.id, { personalization: { fields: [{ key: "caption", label: "Text 2", kind: "name", required: true, constraints: { max_length: 10 } }] } });
    expect(state()).toMatchObject({ stale: true, changes_since: 1 });

    approveSpecs(event.id, g.id);
    await postProcurementUpdate(event.id, g.id, "token:store", { type: "exception", message: "The print area is too small" });
    expect(state()).toMatchObject({ stale: true, changes_since: 1 });
  });
});
