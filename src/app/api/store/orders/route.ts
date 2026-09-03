import { NextResponse } from "next/server";
import { errorResponse } from "../../../../server/api";
import { ShopifyAdminError } from "../../../../server/shopify-admin";
import { corsHeaders, lookupOrder } from "../../../../server/store-orders";

/**
 * The order-status route Tokuchu serves for the store (#59): the store page's `get_order_updates`
 * tool calls it with `checkout_url` or `cart_token` and the route answers the order
 * the checkout produced, or `{ status: "not_ordered" }`. CORS admits the store's origins alone; a
 * same-origin reader (the Attendees tab) needs no header.
 */
export async function GET(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"));
  const params = new URL(request.url).searchParams;
  try {
    const state = await lookupOrder({ checkout_url: params.get("checkout_url"), cart_token: params.get("cart_token") });
    return NextResponse.json(state, { headers });
  } catch (e) {
    if (e instanceof ShopifyAdminError) return NextResponse.json({ error: e.message }, { status: 502, headers });
    const response = errorResponse(e);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  }
}

/** The preflight a cross-origin read from the store's page makes. */
export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}
