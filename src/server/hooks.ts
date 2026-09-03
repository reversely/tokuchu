/**
 * What runs after a write. An RSVP write can change a gift's quantities, so each gift with a cart
 * and no checkout yet gets a cart sync; the sync runs after the response so the guest's reply never waits
 * on the shop.
 */
import { syncGift } from "../agent/cart";
import { giftsFor } from "../domain/gifts";
import { cartDeps } from "./cart-api";
import { afterCommit, withPersistedEvent } from "./persistence";
import { noteRsvpWrite } from "./proactive";

/** One chain per gift, so two writes in quick succession run their syncs in order and the second sees the first's cart. */
const pending = new Map<string, Promise<unknown>>();

/**
 * Each sync starts once the request that queued it has written its row and runs in its own
 * persisted scope, so it reads the reply it follows and its cart write lands in the row as well.
 */
export function afterRsvpWrite(eventId: string): void {
  noteRsvpWrite(eventId);
  const committed = afterCommit();
  for (const gift of giftsFor(eventId)) {
    if (!gift.cart_id || gift.locked_at) continue;
    const previous = pending.get(gift.id) ?? Promise.resolve();
    const next = Promise.all([previous, committed])
      .then(() => withPersistedEvent(eventId, () => syncGift(eventId, gift.id, cartDeps())))
      .catch((e: unknown) => console.error(`Cart sync for gift ${gift.id} failed: ${(e as Error).message}`));
    pending.set(gift.id, next);
  }
}
