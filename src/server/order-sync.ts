/**
 * The tick's order check (#59): for each gift whose cart returned a checkout and whose Procurement
 * has not reached fulfilled, the store's order route answers where the order stands, and a change
 * lands as the structured update the store's own agent would post. An order that exists moves the
 * Procurement to in_production; a fulfilled order moves it to fulfilled. Each gift is asked at most
 * once per interval, so the four-second dashboard poll reads the Admin API once a minute.
 */
import { giftsFor } from "../domain/gifts";
import { procurementFor, updateProcurement } from "../domain/store";
import type { Batch } from "../domain/types";
import { postProcurementUpdate } from "./procurement";
import { adminConfigured } from "./shopify-admin";
import { cartTokenIn, lookupOrder, type OrderQuery, type OrderState } from "./store-orders";

export type OrderLookup = (query: OrderQuery) => Promise<OrderState>;

const SYNC_INTERVAL_MS = 60_000;
/** When each gift's order was last asked for, by gift id; in-process, so a restart asks again. */
const lastAsked = new Map<string, number>();

/** Test hook: forgets when each gift was last asked, so the next tick asks again. */
export function resetOrderSync(): void {
  lastAsked.clear();
}

/** The checkout the gift's cart returned, from the gift or its Procurement. */
function checkoutOf(gift: Batch): string | null {
  return gift.checkout_url ?? procurementFor(gift.id).checkout_url ?? null;
}

/** True for a gift whose checkout names a cart token the order route can look up and whose Procurement still has a move to make; a UCP checkout's URL names none. */
function syncable(gift: Batch): boolean {
  const checkout = checkoutOf(gift);
  const status = procurementFor(gift.id).status;
  return Boolean(checkout && cartTokenIn(checkout)) && (status === "approved" || status === "checkout_ready" || status === "ordered" || status === "in_production");
}

/** The event's gifts whose order is due a check: syncable, and not asked within the interval. Empty with no Admin credentials. */
export function ordersDue(eventId: string, now: Date = new Date()): Batch[] {
  if (!adminConfigured()) return [];
  return giftsFor(eventId).filter((gift) => syncable(gift) && (lastAsked.get(gift.id) ?? 0) + SYNC_INTERVAL_MS <= now.getTime());
}

/** The moves one order state calls for from the Procurement's status, in the order they post. */
export function movesFor(state: OrderState, status: string): ("production_started" | "fulfilled")[] {
  if (state.status !== "ordered") return [];
  const moves: ("production_started" | "fulfilled")[] = [];
  if (status === "approved" || status === "checkout_ready" || status === "ordered") moves.push("production_started");
  if (state.fulfillment_status === "fulfilled" && status !== "fulfilled") moves.push("fulfilled");
  return moves;
}

/**
 * Asks the store about each due gift's order and posts the moves the answer calls for as the store,
 * with the order name as the reference. Returns the gift ids that moved. A failed lookup is logged
 * and the next interval asks again.
 */
export async function syncOrders(eventId: string, now: Date = new Date(), lookup: OrderLookup = lookupOrder): Promise<string[]> {
  const moved: string[] = [];
  for (const gift of ordersDue(eventId, now)) {
    lastAsked.set(gift.id, now.getTime());
    let state: OrderState;
    try {
      state = await lookup({ checkout_url: checkoutOf(gift) });
    } catch (e) {
      console.error(`The order check for gift ${gift.id} failed: ${(e as Error).message}`);
      continue;
    }
    if (state.status !== "ordered") continue;
    const row = procurementFor(gift.id);
    if (!row.external_order_id) updateProcurement(gift.id, { external_order_id: state.order_name });
    const caller = gift.shop_domain.replace(/^https?:\/\//, "");
    const moves = movesFor(state, row.status);
    for (const type of moves) {
      const text = type === "fulfilled" ? `${caller} fulfilled order ${state.order_name}` : `${caller} has order ${state.order_name} in production`;
      await postProcurementUpdate(eventId, gift.id, caller, { type, reference: state.order_name, message: text });
    }
    if (moves.length) moved.push(gift.id);
  }
  return moved;
}
