"use client";
import { useEffect, useState } from "react";
import { dateTime } from "../lib/format";
import type { OrderState } from "../server/store-orders";

const words = (s: string) => s.replace(/_/g, " ");

/**
 * The order behind a checkout in one line (#59): the store's order name with its payment and
 * fulfilment statuses and the tracking the store recorded, or the word that no order exists yet.
 * The store-facing page and the Attendees tab both render it under the checkout link.
 */
export function OrderStateBlock({ state }: { state: OrderState }) {
  if (state.status === "not_ordered") return <p className="hint" style={{ marginTop: 8 }} data-testid="order-state" data-status="not_ordered">Not ordered yet</p>;
  const tracking = state.fulfillments.flatMap((f) => f.tracking);
  return (
    <div className="hint" style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }} data-testid="order-state" data-status="ordered" data-order={state.order_name}>
      <span>Order {state.order_name} placed {dateTime(state.created_at)}</span>
      <span className="tag quiet" data-testid="order-financial">{words(state.financial_status ?? "payment unknown")}</span>
      <span className="tag quiet" data-testid="order-fulfillment">{words(state.fulfillment_status)}</span>
      {tracking.map((t, i) =>
        t.url ? (
          <a key={`${t.number ?? "t"}-${i}`} href={t.url} target="_blank" rel="noreferrer" data-testid="order-tracking">{t.company ?? "Tracking"} {t.number ?? ""}</a>
        ) : (
          <span key={`${t.number ?? "t"}-${i}`} data-testid="order-tracking">{t.company ?? "Tracking"} {t.number ?? ""}</span>
        )
      )}
      <span className="quiet">updated {dateTime(state.updated_at)}</span>
    </div>
  );
}

/** Reads the order route for one checkout and renders its state; `seq` re-reads when the event's records change. Nothing renders while the route has not answered. */
export function OrderStatus({ checkoutUrl, seq }: { checkoutUrl: string; seq: number }) {
  const [state, setState] = useState<OrderState | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/store/orders?checkout_url=${encodeURIComponent(checkoutUrl)}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as OrderState) : null))
      .catch(() => null)
      .then((next) => live && setState(next));
    return () => {
      live = false;
    };
  }, [checkoutUrl, seq]);
  return state ? <OrderStateBlock state={state} /> : null;
}
