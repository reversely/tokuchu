/**
 * The cart job that follows approval: one item per ready manifest row goes to the store's
 * `add_customized_to_cart` tool in one call, and the cart's checkout URL, the line keys, and any
 * refused item come back onto the gift. The job starts once the approving request's row is written,
 * runs each of its own writes in its own persisted scope so the dashboard poll sees the progress,
 * and posts each step into the gift's thread.
 */
import { manifest, updateGift, type GiftInput, type ManifestRow } from "../domain/gifts";
import type { CartBlocked, CartLine } from "../domain/types";
import { postUpdate, requireGift } from "./api";
import { afterCommit, withPersistedEvent } from "./persistence";
import { withStorePage, type StorePage } from "./store-page";

export type CartItem = { recipient_ref: string; variant_id: string; values: Record<string, string> };
export type CartItems = { items: CartItem[]; skipped: { guest_id: string; reason: string }[] };

type ToolReply = {
  ready?: { recipient_ref: string; cart_line_key: string; variant_id?: string }[];
  blocked?: { recipient_ref: string; issues?: { field_key?: string; message: string }[] }[];
  checkout_url?: string | null;
  error?: string;
};

export type CartJobDeps = {
  /** Opens the store page and runs the tool calls; the live driver launches a browser. */
  withPage: <T>(pageUrl: string, fn: (page: StorePage) => Promise<T>) => Promise<T>;
};

const liveDeps: CartJobDeps = { withPage: withStorePage };

/** The tool's items from the manifest: every ready row with a variant, each value as the string the store takes. */
export function buildCartItems(rows: ManifestRow[]): CartItems {
  const items: CartItem[] = [];
  const skipped: CartItems["skipped"] = [];
  for (const row of rows) {
    if (row.unit_status === "excluded") continue;
    if (row.personalization_status !== "ready") {
      skipped.push({ guest_id: row.guest_id, reason: row.personalization_issues?.map((i) => i.message).join("; ") || `the row is ${row.personalization_status ?? "not personalized"}` });
      continue;
    }
    if (!row.variant_id) {
      skipped.push({ guest_id: row.guest_id, reason: row.reason ?? "no variant resolves for the row" });
      continue;
    }
    const values = Object.fromEntries(Object.entries(row.personalization ?? {}).filter(([, field]) => field.value !== null && field.value !== undefined).map(([key, field]) => [key, String(field.value)]));
    items.push({ recipient_ref: row.guest_id, variant_id: row.variant_id, values });
  }
  return { items, skipped };
}

/** The gift's record of the tool's answer: the lines per guest and the refused items with the store's words. */
export function recordFromReply(reply: ToolReply): { cart_lines: CartLine[]; cart_blocked: CartBlocked[]; checkout_url: string | null } {
  const cart_lines = (reply.ready ?? []).map((r) => ({ guest_id: r.recipient_ref, cart_line_key: r.cart_line_key, variant_id: r.variant_id ?? "" }));
  const cart_blocked = (reply.blocked ?? []).map((b) => ({ guest_id: b.recipient_ref, issues: (b.issues ?? []).map((i) => (i.field_key ? `${i.field_key}: ${i.message}` : i.message)) }));
  return { cart_lines, cart_blocked, checkout_url: reply.checkout_url ?? null };
}

function pageUrlOf(gift: { product_url?: string | null; shop_domain: string }): string {
  return gift.product_url || `https://${gift.shop_domain.replace(/^https?:\/\//, "")}/`;
}

/** One progress post in the gift's thread and the matching state on the gift, in one persisted scope. */
function report(eventId: string, giftId: string, kind: "in_production" | "issue", text: string, patch: Partial<GiftInput> = {}, reference: string | null = null): Promise<void> {
  return withPersistedEvent(eventId, () => {
    postUpdate(eventId, giftId, "tokuchu", { kind, text, reference });
    updateGift(giftId, patch);
  });
}

/**
 * Fills the store's cart for an approved gift. Every step reports into the thread and onto the
 * gift, so a failure reads as a `failed` cart_fill with the reason.
 */
export async function runCartFill(eventId: string, giftId: string, deps: CartJobDeps = liveDeps): Promise<void> {
  const started = new Date().toISOString();
  const plan = await withPersistedEvent(eventId, () => {
    const gift = requireGift(eventId, giftId);
    const built = buildCartItems(manifest(gift));
    postUpdate(eventId, giftId, "tokuchu", { kind: "in_production", text: `Filling the cart at ${gift.shop_domain} with ${built.items.length} ${built.items.length === 1 ? "item" : "items"}` });
    updateGift(giftId, { cart_fill: { status: "running", started_at: started, reason: null }, cart_blocked: built.skipped.map((s) => ({ guest_id: s.guest_id, issues: [s.reason] })) } as Partial<GiftInput>);
    return { pageUrl: pageUrlOf(gift), idempotencyKey: `${gift.id}:${gift.approved_at ?? started}`, shop: gift.shop_domain, ...built };
  });
  if (plan.items.length === 0) {
    await report(eventId, giftId, "issue", "No attendee row is ready for the cart", { cart_fill: { status: "failed", started_at: started, reason: "No attendee row is ready for the cart" } } as Partial<GiftInput>);
    return;
  }
  let reply: ToolReply;
  try {
    const call = await deps.withPage(plan.pageUrl, (page) => page.call("add_customized_to_cart", { items: plan.items, idempotency_key: plan.idempotencyKey }));
    reply = call.payload as ToolReply;
    if (call.isError && !Array.isArray(reply.ready)) throw new Error(String(reply.error ?? JSON.stringify(reply)));
  } catch (e) {
    const reason = `The store did not fill the cart: ${(e as Error).message}`;
    await report(eventId, giftId, "issue", reason, { cart_fill: { status: "failed", started_at: started, reason } } as Partial<GiftInput>);
    return;
  }
  const record = recordFromReply(reply);
  await withPersistedEvent(eventId, () => {
    const gift = requireGift(eventId, giftId);
    const blocked = [...(gift.cart_blocked ?? []), ...record.cart_blocked];
    postUpdate(eventId, giftId, "tokuchu", { kind: "in_production", text: `${record.cart_lines.length} ${record.cart_lines.length === 1 ? "item" : "items"} sent to ${plan.shop}` });
    if (record.checkout_url) {
      postUpdate(eventId, giftId, "tokuchu", { kind: "in_production", text: `The cart at ${plan.shop} is ready to review`, reference: record.checkout_url });
      updateGift(giftId, { cart_fill: { status: "done", started_at: started, reason: null }, cart_lines: record.cart_lines, cart_blocked: blocked, checkout_url: record.checkout_url } as Partial<GiftInput>);
    } else {
      const reason = record.cart_lines.length ? "The store returned no checkout link" : blocked.length ? `The store refused every item: ${blocked.map((b) => b.issues.join("; ")).join("; ")}` : "The store added no line";
      postUpdate(eventId, giftId, "tokuchu", { kind: "issue", text: reason });
      updateGift(giftId, { cart_fill: { status: "failed", started_at: started, reason }, cart_lines: record.cart_lines, cart_blocked: blocked } as Partial<GiftInput>);
    }
  });
}

/** One job per gift at a time; a second approval while one runs joins it. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Schedules the cart job for a gift once the calling request's row is written. The approve response
 * returns before the job completes; the dashboard poll shows its progress.
 */
export function startCartFill(eventId: string, giftId: string, deps: CartJobDeps = liveDeps): Promise<void> {
  const running = inFlight.get(giftId);
  if (running) return running;
  const job = afterCommit()
    .then(() => runCartFill(eventId, giftId, deps))
    .catch((e: unknown) => console.error(`Cart fill for gift ${giftId} failed: ${(e as Error).message}`))
    .finally(() => inFlight.delete(giftId));
  inFlight.set(giftId, job);
  return job;
}
