import { beforeEach, describe, expect, it } from "vitest";
import { createGift, removeGift, updateGift, type GiftInput } from "./gifts";
import { moveProcurement, syncReadiness } from "./procurement";
import { canMove, derivedStatus, isCollecting } from "./procurement-status";
import { changesSince, createEvent, createGuest, createParty, deserializeState, procurementFor, resetState, serializeState, state, upsertDefinition, writeValue, type EventInput } from "./store";
import type { Batch, ProcurementStatus } from "./types";

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

const GOING = [{ field: "status", op: "eq", value: "going" }] as const;

const GIFT: GiftInput = {
  product_id: "prod_1",
  shop_domain: "shop.myshopify.com",
  product_title: "Crewneck",
  recipients: [...GOING],
  rules: [{ filter: [...GOING], product_id: "prod_1" }],
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

const STATUSES: ProcurementStatus[] = ["draft", "collecting", "ready", "approved", "ordered", "in_production", "fulfilled", "cancelled"];

describe("the procurement status machine", () => {
  it("allows the forward moves and the return of an approval to collecting or ready", () => {
    expect(canMove("draft", "collecting")).toBe(true);
    expect(canMove("collecting", "ready")).toBe(true);
    expect(canMove("ready", "collecting")).toBe(true);
    expect(canMove("ready", "approved")).toBe(true);
    expect(canMove("approved", "ordered")).toBe(true);
    expect(canMove("approved", "collecting")).toBe(true);
    expect(canMove("approved", "ready")).toBe(true);
    expect(canMove("ordered", "approved")).toBe(true);
    expect(canMove("ordered", "in_production")).toBe(true);
    expect(canMove("in_production", "fulfilled")).toBe(true);
  });

  it("never moves out of fulfilled or cancelled, never back from production, and never to the same status", () => {
    for (const to of STATUSES) {
      expect(canMove("fulfilled", to)).toBe(false);
      expect(canMove("cancelled", to)).toBe(false);
      expect(canMove(to, to)).toBe(false);
    }
    expect(canMove("in_production", "ordered")).toBe(false);
    expect(canMove("in_production", "approved")).toBe(false);
    expect(canMove("ordered", "collecting")).toBe(false);
    expect(isCollecting("collecting")).toBe(true);
    expect(isCollecting("ready")).toBe(true);
    expect(isCollecting("approved")).toBe(false);
  });

  it("derives a stored gift's status from the fields each step wrote", () => {
    const base = { ...GIFT, id: "gift_1", event_id: "evt_1", overrides: {}, locked_at: null } as Batch;
    expect(derivedStatus(base)).toBe("draft");
    expect(derivedStatus({ ...base, requested_at: "2030-01-01T00:00:00Z" })).toBe("collecting");
    expect(derivedStatus({ ...base, requested_at: "2030-01-01T00:00:00Z", approved_at: "2030-01-02T00:00:00Z" })).toBe("approved");
    expect(derivedStatus({ ...base, approved_at: "2030-01-02T00:00:00Z", checkout_url: "https://shop/checkout" })).toBe("ordered");
    expect(derivedStatus({ ...base, order_id: "ord_1" })).toBe("ordered");
    expect(derivedStatus({ ...base, procurement_status: "accepted" })).toBe("ordered");
    expect(derivedStatus({ ...base, procurement_status: "in_production" })).toBe("in_production");
    expect(derivedStatus({ ...base, procurement_status: "fulfilled" })).toBe("fulfilled");
  });
});

describe("the procurement record", () => {
  beforeEach(resetState);

  it("is created as a draft with the gift and moves with each recorded step", () => {
    const event = createEvent(EVENT);
    const gift = createGift(event.id, { ...GIFT, product_url: "https://shop.myshopify.com/products/crewneck", personalization: { fields: [{ key: "caption", label: "Caption", kind: "name", required: true }] } });
    const row = procurementFor(gift.id);
    expect(row).toMatchObject({ event_id: event.id, gift_id: gift.id, vendor_id: "shop.myshopify.com", product_id: "prod_1", product_url: "https://shop.myshopify.com/products/crewneck", requirement_schema_id: "shop.myshopify.com/prod_1", status: "draft", current_revision: 0 });
    expect(row.approved_revision).toBeUndefined();
    const collecting = moveProcurement(gift.id, "collecting", "organizer");
    expect(collecting.status).toBe("collecting");
    expect(collecting.current_revision).toBe(state().seq);
    expect(changesSince(event.id, 0).at(-1)).toMatchObject({ kind: "procurement", type: "status_changed", actor_type: "organizer", summary: "The procurement moved from draft to collecting" });
    const seqBefore = state().seq;
    expect(moveProcurement(gift.id, "collecting", "organizer").status).toBe("collecting");
    expect(state().seq).toBe(seqBefore);
    expect(moveProcurement(gift.id, "in_production", "token:tok_1").status).toBe("in_production");
    expect(moveProcurement(gift.id, "approved", "organizer", { patch: { approved_revision: 3 } }).status).toBe("in_production");
    expect(procurementFor(gift.id).approved_revision).toBe(3);
  });

  it("moves between collecting and ready as the rows resolve", () => {
    const event = createEvent(EVENT);
    const caption = upsertDefinition(event.id, { namespace: "organizer", key: "caption", label: "Caption", scope: "guest", value_type: "text", constraints: {}, default_visibility: [], required_rule: "going", creator: "organizer" });
    const party = createParty(event.id, {});
    const guest = createGuest(event.id, party.id, { display_name: "Guest One", status: "going" });
    const gift = createGift(event.id, { ...GIFT, personalization: { fields: [{ key: "caption", label: "Caption", kind: "name", required: true }] }, personalization_mappings: [{ vendor_field_key: "caption", source: { type: "definition", definition_id: caption.id, subject_scope: "guest" } }] });
    expect(syncReadiness(gift.id, "organizer").status).toBe("draft");
    moveProcurement(gift.id, "collecting", "organizer");
    expect(syncReadiness(gift.id, "organizer").status).toBe("collecting");
    writeValue("guest", guest.id, caption.id, "Ada", "guest");
    expect(syncReadiness(gift.id, "guest").status).toBe("ready");
    writeValue("guest", guest.id, caption.id, "", "guest");
    expect(syncReadiness(gift.id, "guest").status).toBe("collecting");
    moveProcurement(gift.id, "approved", "organizer");
    writeValue("guest", guest.id, caption.id, "Ada", "guest");
    expect(syncReadiness(gift.id, "guest").status).toBe("approved");
  });

  it("is backfilled for a stored document's gifts and serializes with the state", () => {
    const event = createEvent(EVENT);
    const gift = createGift(event.id, GIFT);
    updateGift(gift.id, { requested_at: "2030-01-01T00:00:00Z", approved_at: "2030-01-02T00:00:00Z", approved_seq: 4, checkout_url: "https://shop/checkout", cart_id: "cart_9" } as Partial<GiftInput>);
    const doc = serializeState(state());
    expect(doc.procurements).toHaveLength(1);
    const { procurements: _dropped, ...older } = doc;
    const restored = deserializeState(older);
    expect(restored.procurements.get(gift.id)).toMatchObject({ gift_id: gift.id, status: "ordered", approved_revision: 4, checkout_url: "https://shop/checkout", external_cart_id: "cart_9" });
    expect(deserializeState(doc).procurements.get(gift.id)?.status).toBe("draft");
    removeGift(gift.id);
    expect(procurementsCount(event.id)).toBe(1);
  });
});

function procurementsCount(eventId: string): number {
  return [...state().procurements.values()].filter((p) => p.event_id === eventId).length;
}
