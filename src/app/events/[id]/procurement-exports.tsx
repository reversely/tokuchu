"use client";
import { useEffect, useState } from "react";
import type { AccessGrant } from "../../../domain/types";
import { withDemoHeaders } from "../../../demo/token";
import { GrantSeen } from "./grant-seen";

type GrantRow = Pick<AccessGrant, "id" | "grantee_id" | "acknowledged_revision" | "revoked_at" | "expires_at">;

/**
 * The organizer's exports for one gift (#52): the fulfilment manifest as a CSV download through the
 * same projection a store's agent reads, and the revision each active grant's holder has acknowledged.
 */
export function ProcurementExports({ eventId, giftId, seq, current }: { eventId: string; giftId: string; seq: number; current: number }) {
  const [grants, setGrants] = useState<GrantRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/grants?procurement=${encodeURIComponent(giftId)}`, withDemoHeaders({ cache: "no-store" }));
        const body = res.ok ? ((await res.json()) as { grants: GrantRow[] }) : { grants: [] };
        if (!cancelled) setGrants(body.grants.filter((g) => !g.revoked_at && (!g.expires_at || Date.parse(g.expires_at) > Date.now())));
      } catch {
        if (!cancelled) setGrants([]);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, giftId, seq]);

  return (
    <section className="block" aria-labelledby="exports" data-testid="procurement-exports" data-gift={giftId}>
      <div className="labelrow"><h2 id="exports">Manifest export</h2><span className="eyebrow">revision {current}</span></div>
      <div className="sendrow">
        <div className="lead">One row per attendee with every requirement the store fills</div>
        <a className="btn ghost" href={`/api/events/${eventId}/gifts/${giftId}/fulfillment.csv`} download data-testid="fulfillment-csv">Download CSV</a>
      </div>
      {grants.length > 0 && (
        <ul className="hint" style={{ marginTop: 12 }} data-testid="grant-seen-list">
          {grants.map((g) => <li key={g.id}><GrantSeen grant={{ id: g.id, grantee_id: g.grantee_id, acknowledged_revision: g.acknowledged_revision ?? null }} current={current} /></li>)}
        </ul>
      )}
    </section>
  );
}
