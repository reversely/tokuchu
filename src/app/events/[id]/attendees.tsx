"use client";
import { useState } from "react";
import type { Snapshot } from "./dashboard";

const STATUS_LABEL: Record<string, string> = { going: "Going", maybe: "Maybe", cant_go: "Can't go", no_reply: "No reply" };

/** The Attendees records grid: one row per attendee, one column per answer, in a spreadsheet layout.
 * Above it, the information the configured product requests from attendees, and the gate that approves
 * the collected specs and sends them to the vendor. */
export function Attendees({ snap, onChanged }: { snap: Snapshot; onChanged: () => void }) {
  const guestDefs = snap.definitions.filter((d) => d.scope === "guest");
  const attendees = snap.guests.filter((g) => g.status === "going");
  const gift = snap.gifts[0] as (Snapshot["gifts"][number] & { personalization?: { fields: { key: string; label: string; kind: string; required: boolean }[] }; locked_at?: string | null }) | undefined;
  const requested = gift?.personalization?.fields ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approved = Boolean(gift?.locked_at);

  async function approveAndSend() {
    if (!gift) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${snap.event.id}/gifts/${gift.id}/approve-specs`, { method: "POST" });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function cell(value: unknown, def: (typeof guestDefs)[number], going: boolean) {
    const label = Array.isArray(value)
      ? (value as string[]).map((x) => def.constraints.options?.find((o) => o.value === x)?.label ?? x).join(" ")
      : value === undefined || value === "" ? "" : String(value);
    const required = def.required_rule === "always" || (def.required_rule === "going" && going);
    return label || (required ? <span className="missing">missing</span> : <span className="quiet">not given</span>);
  }

  return (
    <div className="wrap">
      {requested.length > 0 && (
        <section className="block" aria-labelledby="requested" data-testid="requested-info">
          <div className="labelrow"><h2 id="requested">Information requested from attendees</h2><span className="eyebrow">{gift?.product_title}</span></div>
          <div className="chips">
            {requested.map((f) => (
              <span className="chip" key={f.key} data-testid="requested-field"><strong>{f.label}</strong> <span className="quiet">{f.kind}{f.required ? " required" : ""}</span></span>
            ))}
          </div>
        </section>
      )}

      <section className="block" aria-labelledby="records" data-testid="attendees">
        <div className="labelrow"><h2 id="records">Attendees</h2><span className="eyebrow">{attendees.length} responses</span></div>
        {attendees.length === 0 ? (
          <p className="hint" style={{ color: "var(--muted)" }} data-testid="attendees-empty">No attendees yet</p>
        ) : (
          <div className="list" style={{ overflowX: "auto" }}>
            <table className="records" data-testid="attendees-grid">
              <thead>
                <tr>
                  <th>Attendee</th>
                  <th>Status</th>
                  {guestDefs.map((d) => <th key={d.id}>{d.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {attendees.map((g) => (
                  <tr key={g.id} data-testid="attendee-row">
                    <td>{g.display_name}</td>
                    <td>{STATUS_LABEL[g.status]}</td>
                    {guestDefs.map((d) => <td key={d.id}>{cell(g.values[d.id], d, g.status === "going")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {gift && (
        <section className="block" aria-labelledby="approve" data-testid="approve-block">
          <div className="labelrow"><h2 id="approve">Send to vendor</h2></div>
          <div className="sendrow">
            <div className="lead">{gift.product_title} for {attendees.length} attendees at {gift.shop_domain || "the vendor"}</div>
            {approved ? (
              <span className="pill live" data-testid="specs-approved">Approved and sent to vendor</span>
            ) : (
              <button type="button" className="btn primary" onClick={approveAndSend} disabled={busy || attendees.length === 0} data-testid="approve-send">{busy ? "Sending" : "Approve and send to vendor"}</button>
            )}
          </div>
          {error && <p className="error" role="alert" data-testid="approve-error">{error}</p>}
        </section>
      )}
    </div>
  );
}
