/**
 * The cart operations the send, approve, sync, lock, and cart routes call. Each checks the gift
 * belongs to the event, validates the body, runs the agent step, and returns the gift view with
 * what the step produced, so a route stays a few lines.
 */
import { z } from "zod";
import { approveGift, CartStateError, liveDeps, lockAndCheckout, lockIsDue, pollOrder, refreshCart, sendGift, syncGift, type CartDeps, type ShortLine } from "../agent/cart";
import { CartBuyer, DeliveryWindow } from "../domain/types";
import { BadRequestError, giftView, requireGift } from "./api";
import { traceClient } from "./trace";
import { staticMode } from "./flags";

let deps: CartDeps = liveDeps;

/** Test hook: the client factory and clock the routes and the RSVP hook use. */
import { cartOperations } from "./registry";

/** The MCP endpoint dispatches send_to_vendor and approve to these operations (organizer tokens only); static mode refuses both, since each prices a cart at the store from the server (#56). */
const staticRefusal = (name: string) => new BadRequestError(`${name} is off in static mode; the agent fills the cart on the store's page with the cart_items of get_fulfillment_manifest after approve_specs.`);
cartOperations.send = (eventId, giftId) => (staticMode() ? Promise.reject(staticRefusal("send_to_vendor")) : sendGiftOp(eventId, giftId, {}));
cartOperations.approve = (eventId, giftId) => (staticMode() ? Promise.reject(staticRefusal("approve")) : approveGiftOp(eventId, giftId, {}));

export function setCartDeps(next: CartDeps): void {
  deps = next;
}

export function cartDeps(): CartDeps {
  return deps;
}

/** The deps with the shop client traced on the event and the gift (#55), so every cart call records itself. */
export function cartDepsFor(eventId: string, giftId: string): CartDeps {
  return { ...deps, client: () => traceClient(eventId, deps.client(), { gift_id: giftId }) };
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

/** A gift in the wrong state for the step is the caller's error, so it answers 400 with the step that comes first. */
async function step<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof CartStateError) throw new BadRequestError(e.message);
    throw e;
  }
}

const SendBody = z.object({ buyer: CartBuyer.nullable().default(null) });

/** POST .../send: the cart at the shop, priced; the proposal comes back on the gift view. */
export async function sendGiftOp(eventId: string, giftId: string, body: unknown) {
  requireGift(eventId, giftId);
  const { buyer } = parseBody(SendBody, body);
  const proposal = await step(() => sendGift(eventId, giftId, cartDepsFor(eventId, giftId), buyer));
  return { ...giftView(eventId, giftId), proposal };
}

const ApproveBody = z.object({ delivery_window: DeliveryWindow.nullable().default(null) });

/** POST .../approve: the organizer keeps the priced cart and the cutoff follows from the delivery window. */
export async function approveGiftOp(eventId: string, giftId: string, body: unknown) {
  requireGift(eventId, giftId);
  const { delivery_window } = parseBody(ApproveBody, body);
  await step(async () => approveGift(eventId, giftId, cartDepsFor(eventId, giftId), delivery_window));
  return giftView(eventId, giftId);
}

/** POST .../sync: recompute the quantities and rewrite the cart when they changed. */
export async function syncGiftOp(eventId: string, giftId: string) {
  requireGift(eventId, giftId);
  const result = await step(() => syncGift(eventId, giftId, cartDepsFor(eventId, giftId)));
  return { ...giftView(eventId, giftId), ...result };
}

/** POST .../lock: the checkout now, whatever the cutoff says. */
export async function lockGiftOp(eventId: string, giftId: string) {
  requireGift(eventId, giftId);
  await step(() => lockAndCheckout(eventId, giftId, cartDepsFor(eventId, giftId)));
  return giftView(eventId, giftId);
}

/**
 * GET .../cart: the dashboard's poll. Creates the checkout when the cutoff has arrived, reads the
 * order once one exists, and otherwise reads the cart back and names any line the shop cut short.
 */
export async function cartView(eventId: string, giftId: string) {
  let gift = requireGift(eventId, giftId);
  let follow_ups: ShortLine[] = [];
  let update = null;
  if (lockIsDue(gift, deps.now())) gift = await step(() => lockAndCheckout(eventId, giftId, cartDepsFor(eventId, giftId)));
  if (gift.order_id) update = await pollOrder(eventId, giftId, cartDepsFor(eventId, giftId));
  else if (gift.cart_id) follow_ups = (await step(() => refreshCart(eventId, giftId, cartDepsFor(eventId, giftId)))).follow_ups;
  return { ...giftView(eventId, giftId), follow_ups, update };
}
