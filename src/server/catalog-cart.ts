/**
 * The cart fill for a plain product: a gift whose product carries no customization fields has no
 * merchant tool to call, so approval fills the store's own UCP cart. The job creates the cart from
 * the plan's quantities when the gift has none, records the approval and the cutoff, creates the
 * checkout, and stores its link on the gift, posting each step into the progress log the way the
 * store-tool job does.
 */
import { CatalogError } from "@webmcp/shopify-ucp";
import { approveGift, lockAndCheckout, sendGift, syncGift, type CartDeps } from "../agent/cart";
import { getGift, updateGift, type GiftInput } from "../domain/gifts";
import { getEvent } from "../domain/store";
import type { CartBuyer } from "../domain/types";
import { postUpdate, requireGift } from "./api";
import { withPersistedEvent } from "./persistence";

const bareHost = (shop: string) => shop.replace(/^https?:\/\//, "");

/** The buyer the cart names: the event's contact when the organizer gave one, so the store's checkout has an address to write to. */
function buyerFor(eventId: string): CartBuyer | null {
  const contact = getEvent(eventId).contact;
  const buyer: CartBuyer = { ...(contact?.email ? { email: contact.email } : {}), ...(contact?.phone ? { phone_number: contact.phone } : {}) };
  return Object.keys(buyer).length ? buyer : null;
}

type IncompleteCheckout = { id: string; continue_url: string; messages: string[] };

/**
 * A store may mark `create_checkout` as an error while still returning the checkout, with recoverable
 * messages such as a missing contact method or phone number. That checkout is usable: the organizer
 * completes those details at the store's own page, so the fill keeps its link.
 */
function incompleteCheckout(e: unknown): IncompleteCheckout | null {
  if (!(e instanceof CatalogError) || e.kind !== "tool") return null;
  let data = e.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const payload = data as { id?: unknown; continue_url?: unknown; messages?: { content?: unknown }[] } | null;
  if (!payload || typeof payload.id !== "string" || typeof payload.continue_url !== "string") return null;
  return { id: payload.id, continue_url: payload.continue_url, messages: (payload.messages ?? []).map((m) => m.content).filter((m): m is string => typeof m === "string") };
}

/** One progress post and the matching state on the gift, in one persisted scope. */
function report(eventId: string, giftId: string, kind: "in_production" | "issue", text: string, patch: Partial<GiftInput> = {}, reference: string | null = null): Promise<void> {
  return withPersistedEvent(eventId, () => {
    postUpdate(eventId, giftId, "tokuchu", { kind, text, reference });
    updateGift(giftId, patch);
  });
}

/**
 * Fills the store's UCP cart for an approved plain gift and creates its checkout. A gift whose
 * checkout already exists cannot take a fresh one, so the fill reports that with the link the
 * progress log already holds.
 */
export async function runCatalogCartFill(eventId: string, giftId: string, deps: CartDeps): Promise<void> {
  const started = new Date().toISOString();
  const first = requireGift(eventId, giftId);
  const shop = bareHost(first.shop_domain);
  if (first.locked_at) {
    const reason = `The checkout at ${shop} already exists; its link is in the progress log`;
    await report(eventId, giftId, "issue", reason, { cart_fill: { status: "failed", started_at: started, reason } } as Partial<GiftInput>);
    return;
  }
  const running = { status: "running", started_at: started, reason: null } as const;
  try {
    const cart = await withPersistedEvent(eventId, async () => {
      const gift = requireGift(eventId, giftId);
      updateGift(giftId, { cart_fill: running, cart_blocked: [] } as Partial<GiftInput>);
      if (!gift.cart_id) {
        const proposal = await sendGift(eventId, giftId, deps, buyerFor(eventId));
        postUpdate(eventId, giftId, "tokuchu", { kind: "in_production", text: `Cart created at ${shop} with ${proposal.lines.length} ${proposal.lines.length === 1 ? "line" : "lines"} through create_cart` });
        return proposal;
      }
      const { proposal } = await syncGift(eventId, giftId, deps);
      postUpdate(eventId, giftId, "tokuchu", { kind: "in_production", text: `Cart at ${shop} updated through update_cart` });
      return proposal;
    });
    const checkout = await withPersistedEvent(eventId, async () => {
      approveGift(eventId, giftId, deps);
      try {
        const locked = await lockAndCheckout(eventId, giftId, deps);
        return { url: locked.checkout_url ?? null, lines: cart?.lines.length ?? 0 };
      } catch (e) {
        const incomplete = incompleteCheckout(e);
        if (!incomplete) throw e;
        const date = deps.now().toISOString().slice(0, 10);
        const gift = getGift(giftId);
        postUpdate(eventId, giftId, "tokuchu", { kind: "in_production", text: `The checkout at ${shop} waits for details the organizer gives at the store: ${incomplete.messages.join("; ") || "the buyer's contact"}` });
        updateGift(giftId, { checkout_id: incomplete.id, checkout_url: incomplete.continue_url, cutoff: gift.cutoff ?? date, locked_at: date } as Partial<GiftInput>);
        return { url: incomplete.continue_url, lines: cart?.lines.length ?? 0 };
      }
    });
    if (!checkout.url) {
      const reason = `The checkout at ${shop} returned no link`;
      await report(eventId, giftId, "issue", reason, { cart_fill: { status: "failed", started_at: started, reason } } as Partial<GiftInput>);
      return;
    }
    await report(eventId, giftId, "in_production", `The checkout at ${shop} is ready to review through create_checkout`, { cart_fill: { status: "done", started_at: started, reason: null }, checkout_url: checkout.url } as Partial<GiftInput>, checkout.url);
  } catch (e) {
    const reason = `The store did not fill the cart: ${(e as Error).message}`;
    await report(eventId, giftId, "issue", reason, { cart_fill: { status: "failed", started_at: started, reason } } as Partial<GiftInput>);
  }
}
