/**
 * The procurement status machine: the moves a Procurement may make and the status a gift's own
 * fields derive for a gift stored before procurements existed. Both are pure; procurement.ts applies
 * a move to the store and records it in the change log.
 */
import type { Batch, ProcurementStatus } from "./types";

/** The statuses a procurement may move to from each status; a terminal status has none. */
const MOVES: Record<ProcurementStatus, readonly ProcurementStatus[]> = {
  draft: ["collecting", "ready", "approved", "checkout_ready", "ordered", "in_production", "fulfilled", "cancelled"],
  collecting: ["ready", "approved", "checkout_ready", "ordered", "in_production", "fulfilled", "cancelled"],
  ready: ["collecting", "approved", "checkout_ready", "ordered", "in_production", "fulfilled", "cancelled"],
  approved: ["collecting", "ready", "checkout_ready", "ordered", "in_production", "fulfilled", "cancelled"],
  checkout_ready: ["approved", "ordered", "in_production", "fulfilled", "cancelled"],
  ordered: ["approved", "in_production", "fulfilled", "cancelled"],
  in_production: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: []
};

/** True when a procurement at `from` may move to `to`; the same status is never a move. */
export function canMove(from: ProcurementStatus, to: ProcurementStatus): boolean {
  return MOVES[from].includes(to);
}

/** True while the procurement still gathers or awaits attendee values. */
export function isCollecting(status: ProcurementStatus): boolean {
  return status === "collecting" || status === "ready";
}

/** What a store's structured update moves the procurement to: accepted is the order placed with the store. */
export const VENDOR_MOVES: Record<"accepted" | "in_production" | "fulfilled", ProcurementStatus> = { accepted: "ordered", in_production: "in_production", fulfilled: "fulfilled" };

/** Where a gift stands by the fields each step wrote: the store's own status once it posted one, then the checkout, the approval, and the request. */
export function derivedStatus(gift: Batch): ProcurementStatus {
  if (gift.procurement_status) return VENDOR_MOVES[gift.procurement_status];
  if (gift.order_id || gift.locked_at) return "ordered";
  if (gift.checkout_url || gift.cart_fill?.status === "done") return "checkout_ready";
  if (gift.approved_at) return "approved";
  if (gift.requested_at) return "collecting";
  return "draft";
}
