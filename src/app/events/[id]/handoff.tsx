"use client";
import { useState } from "react";
import type { Snapshot } from "./dashboard";
import { replyError } from "../../../lib/reply-error";
import { withDemoHeaders } from "../../../demo/token";
import { AgentNotes } from "../../agent-notes";
import { useFulfillmentManifest } from "./readiness";

type Gift = Snapshot["gifts"][number];

const bareHost = (shop: string) => shop.replace(/^https?:\/\//, "");

/** The product's page at the store: the gift's own URL, else the store's root. */
function storeUrl(gift: Gift | null, fallback: string | null): string | null {
  if (gift?.product_url) return gift.product_url;
  if (gift?.shop_domain) return `https://${bareHost(gift.shop_domain)}/`;
  return fallback;
}

/** The product handle from a Shopify product URL, the segment after /products/. */
export function productHandle(url: string | null | undefined): string | null {
  const match = url?.match(/\/products\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** What the agent calls next on each side, from where the gift stands. */
function nextTools(gift: Gift | null): { here: string; store: string } {
  if (!gift) return { here: "set_gift_plan", store: "get_customization" };
  if (!gift.personalization?.fields.length) return { here: "set_gift_customization", store: "get_customization" };
  if (!gift.approved_at) return { here: "get_requirements", store: "add_customized_to_cart after approve_specs" };
  return { here: "post_update with the checkout_url", store: "add_customized_to_cart" };
}

/**
 * The handoff card (#56): what an agent needs to switch to the store's tab. One card per gift and
 * one for the store alone while the event has no gift.
 */
function Handoff({ gift, fallbackStoreUrl, eventId, seq }: { gift: Gift | null; fallbackStoreUrl: string | null; eventId: string; seq: number }) {
  const url = storeUrl(gift, fallbackStoreUrl);
  const handle = productHandle(url);
  const next = nextTools(gift);
  // The count the agent will carry over: the manifest's cart_items as the organizer reads them.
  const manifest = useFulfillmentManifest(eventId, gift?.id, seq);
  const ready = manifest?.cart_items.length ?? 0;
  return (
    <section className="block" aria-labelledby={`handoff-${gift?.id ?? "store"}`} data-testid="handoff" data-gift={gift?.id ?? ""} data-next={next.store}>
      <div className="labelrow"><h2 id={`handoff-${gift?.id ?? "store"}`}>Handoff to the store</h2><span className="eyebrow">{gift ? gift.product_title || gift.product_id : "No gift yet"}</span></div>
      <div className="list">
        <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Store page</span><span className="type">{url ? <a href={url} target="_blank" rel="noreferrer" data-testid="handoff-url">{url}</a> : <span data-testid="handoff-url">none</span>}</span></div>
        <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Product handle</span><code data-testid="handoff-handle">{handle ?? "none"}</code></div>
        <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Product id</span><code data-testid="handoff-product">{gift?.product_id ?? "none"}</code></div>
        <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Gift id</span><code data-testid="handoff-gift">{gift?.id ?? "none"}</code></div>
        <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Next tool on this page</span><code data-testid="handoff-next-here">{next.here}</code></div>
        <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Next tool on the store's page</span><code data-testid="handoff-next-store">{next.store}</code></div>
        {gift?.approved_at && <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Cart items ready in get_fulfillment_manifest</span><span className="type" data-testid="handoff-cart-items">{ready}</span></div>}
      </div>
    </section>
  );
}

/**
 * The Guest Experience tab in static mode (#56): no search and no cards. The gifts the agent
 * created through set_gift_plan list here with a handoff card each, and the Agent notes name the
 * order of operations.
 */
export function StaticExperience({ snap, onChanged }: { snap: Snapshot; onChanged: () => void }) {
  const gifts = snap.gifts;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(gift: Gift) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${snap.event.id}/gifts/${gift.id}`, withDemoHeaders({ method: "DELETE" }));
      if (!res.ok) throw new Error(await replyError(res));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap solo">
      <section aria-labelledby="gx-static">
        <h1 className="title" id="gx-static">Gifts</h1>
        <p className="lead">The agent adds a gift through set_gift_plan and its fields through set_gift_customization</p>
        <div data-testid="gifts">
          {gifts.map((g) => {
            const units = g.quantities.reduce((s, q) => s + q.quantity, 0);
            return (
              <div className="item" key={g.id} data-testid="gift">
                <div>
                  <div style={{ fontWeight: 600 }}>{g.product_title || g.product_id}</div>
                  <div className="m">{[bareHost(g.shop_domain), `${units} ${units === 1 ? "unit" : "units"}`, g.personalization?.fields.length ? `${g.personalization.fields.length} store fields` : "no store fields yet", g.approved_at ? "approved" : "not approved"].filter(Boolean).join(" / ")}</div>
                </div>
                <div />
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn ghost small" onClick={() => remove(g)} disabled={busy} data-testid="remove-gift">Remove</button>
                </div>
              </div>
            );
          })}
          {gifts.length === 0 && <p className="hint" style={{ color: "var(--muted)" }} data-testid="gifts-empty">No gift yet</p>}
        </div>
        {error && <p className="error" role="alert" data-testid="gx-error">{error}</p>}
      </section>
      {gifts.length === 0 ? <Handoff gift={null} fallbackStoreUrl={snap.store_url} eventId={snap.event.id} seq={snap.seq} /> : gifts.map((g) => <Handoff key={g.id} gift={g} fallbackStoreUrl={snap.store_url} eventId={snap.event.id} seq={snap.seq} />)}
      <AgentNotes page="event" />
    </div>
  );
}
