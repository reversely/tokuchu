/**
 * The order behind a checkout the store's cart tool returned (#59). A theme cannot read orders on
 * its own, so Tokuchu's server looks the order up through the store's Admin API and answers one
 * shape for every reader: the store page's `get_order_updates` tool through `/api/store/orders`,
 * the store-facing page, the Attendees tab, and the tick that moves the Procurement on.
 */
import { BadRequestError } from "./errors";
import { adminGraphql } from "./shopify-admin";

/** The store origins the order route answers with CORS headers: the demo store and the shop `CUSTOMILY_SHOP_URL` names. */
const STORE_ORIGIN = "https://springbuilt.myshopify.com";

/** The line item property the adapter writes with the caller's recipient reference (integrations/customily/webmcp-customily.js). */
const RECIPIENT_PROPERTY = "_tokuchu_recipient";

/** How many line items and fulfilments one order read carries; an event's order stays well under both. */
const LINE_ITEMS_FIRST = 50;
const FULFILLMENTS_FIRST = 10;

export type OrderQuery = { checkout_url?: string | null; cart_token?: string | null; order_name?: string | null };
export type OrderTracking = { company: string | null; number: string | null; url: string | null };
export type OrderFulfillment = { id: string; status: string; updated_at: string; tracking: OrderTracking[] };
/** One line of the order: `recipient_ref` from the adapter's hidden property and `values` keyed by the property labels Customily reads. */
export type OrderLineItem = { title: string; variant_id: string | null; quantity: number; recipient_ref: string | null; values: Record<string, string> };
export type PlacedOrder = {
  status: "ordered";
  order_id: string;
  order_name: string;
  created_at: string;
  updated_at: string;
  financial_status: string | null;
  fulfillment_status: string;
  line_items: OrderLineItem[];
  fulfillments: OrderFulfillment[];
};
export type OrderState = { status: "not_ordered" } | PlacedOrder;

type OrderNode = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  lineItems: { nodes: { title: string; quantity: number; variant: { id: string } | null; customAttributes: { key: string; value: string | null }[] }[] };
  fulfillments: { id: string; status: string; updatedAt: string; trackingInfo: { company: string | null; number: string | null; url: string | null }[] }[];
};

const ORDER_QUERY = `query($q: String!) { orders(first: 1, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { id name createdAt updatedAt displayFinancialStatus displayFulfillmentStatus lineItems(first: ${LINE_ITEMS_FIRST}) { nodes { title quantity variant { id } customAttributes { key value } } } fulfillments(first: ${FULFILLMENTS_FIRST}) { id status updatedAt trackingInfo { company number url } } } } }`;

/** The origins the route answers: the demo store and the host of `CUSTOMILY_SHOP_URL` when it is set. */
export function allowedStoreOrigins(): string[] {
  const origins = new Set([STORE_ORIGIN]);
  const shop = process.env.CUSTOMILY_SHOP_URL;
  if (shop) {
    try {
      origins.add(new URL(shop.startsWith("http") ? shop : `https://${shop}`).origin);
    } catch {
      // A malformed shop URL leaves only the demo store's origin allowed.
    }
  }
  return [...origins];
}

/** The CORS headers for one request origin: the allow headers for a store origin and none for any other, so the browser refuses the read. */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !allowedStoreOrigins().includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Accept, Content-Type", "Access-Control-Max-Age": "600", Vary: "Origin" };
}

/** The cart token a checkout URL names, `/cart/c/{token}?key=...` as the cart tool returns it, or null for any other URL such as a UCP checkout's `/checkouts/cn/{token}`. */
export function cartTokenIn(checkoutUrl: string): string | null {
  try {
    return new URL(checkoutUrl).pathname.match(/\/cart\/c\/([^/?#]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The cart token a checkout URL names.
 *
 * Raises:
 *   BadRequestError: when the URL carries no cart token.
 */
export function cartTokenFrom(checkoutUrl: string): string {
  const token = cartTokenIn(checkoutUrl);
  if (!token) throw new BadRequestError("checkout_url names no cart token; the cart tool returns /cart/c/{token}.");
  return token;
}

/** Shopify's search syntax takes the value quoted; a quote inside the value is escaped. */
const quoted = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;

/**
 * The Admin search filter for the query: the cart token from the argument or the checkout URL, else
 * the order name without its leading `#`.
 *
 * Raises:
 *   BadRequestError: when the query names none of the three.
 */
export function orderFilter(query: OrderQuery): string {
  const token = query.cart_token?.trim() || (query.checkout_url?.trim() ? cartTokenFrom(query.checkout_url.trim()) : "");
  if (token) return `cart_token:${quoted(token.split("?")[0])}`;
  const name = query.order_name?.trim().replace(/^#/, "");
  if (name) return `name:${quoted(name)}`;
  throw new BadRequestError("Pass checkout_url or cart_token or order_name.");
}

const lower = (s: string | null) => (s ? s.toLowerCase() : null);
const bareId = (gid: string) => gid.replace(/^gid:\/\/shopify\/\w+\//, "");

function lineItem(node: OrderNode["lineItems"]["nodes"][number]): OrderLineItem {
  const values: Record<string, string> = {};
  let recipient: string | null = null;
  for (const { key, value } of node.customAttributes) {
    if (key === RECIPIENT_PROPERTY) recipient = value;
    // A property with a leading underscore is hidden at checkout and carries the adapter's own bookkeeping.
    else if (!key.startsWith("_") && value !== null) values[key] = value;
  }
  return { title: node.title, variant_id: node.variant ? bareId(node.variant.id) : null, quantity: node.quantity, recipient_ref: recipient, values };
}

function placedOrder(node: OrderNode): PlacedOrder {
  return {
    status: "ordered",
    order_id: bareId(node.id),
    order_name: node.name,
    created_at: node.createdAt,
    updated_at: node.updatedAt,
    financial_status: lower(node.displayFinancialStatus),
    fulfillment_status: lower(node.displayFulfillmentStatus) ?? "unfulfilled",
    line_items: node.lineItems.nodes.map(lineItem),
    fulfillments: node.fulfillments.map((f) => ({ id: bareId(f.id), status: f.status.toLowerCase(), updated_at: f.updatedAt, tracking: f.trackingInfo.map((t) => ({ company: t.company, number: t.number, url: t.url })) }))
  };
}

/**
 * The order a checkout produced, or `{ status: "not_ordered" }` while the checkout has no order.
 *
 * Raises:
 *   BadRequestError: when the query names no checkout, cart token, or order name.
 *   ShopifyAdminError: when the Admin API is unconfigured or answers with errors.
 */
export async function lookupOrder(query: OrderQuery, opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<OrderState> {
  const filter = orderFilter(query);
  const data = await adminGraphql<{ orders: { nodes: OrderNode[] } }>(ORDER_QUERY, { q: filter }, opts);
  const node = data.orders.nodes[0];
  return node ? placedOrder(node) : { status: "not_ordered" };
}
