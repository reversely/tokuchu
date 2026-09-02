"use client";
import { useEffect, useState } from "react";
import type { Snapshot } from "./dashboard";
import type { Requestable } from "../../../server/api";

const STATUS_LABEL: Record<string, string> = { going: "Going", maybe: "Maybe", cant_go: "Can't go", no_reply: "No reply" };

/** A guest question in plain words: the control it renders and, for a choice, the options it offers. */
function questionKind(def: Snapshot["definitions"][number]): string {
  const opts = (def.constraints.options ?? []).map((o) => o.label);
  if (def.value_type === "enum") return opts.length ? `choose one of ${opts.join(", ")}` : "choose one";
  if (def.value_type === "multi_enum") return opts.length ? `choose any of ${opts.join(", ")}` : "choose any";
  if (def.value_type === "date") return "a date";
  if (def.value_type === "number") return "a number";
  return "short text";
}

/** The Attendees records grid, the organizer's request panel, the WebMCP routing that carries it, and the approve gate. */
export function Attendees({ snap, onChanged }: { snap: Snapshot; onChanged: () => void }) {
  // A choice question with no options cannot be answered, so it is neither a column nor a request.
  const answerable = (d: Snapshot["definitions"][number]) => !((d.value_type === "enum" || d.value_type === "multi_enum") && (d.constraints.options?.length ?? 0) === 0);
  const guestDefs = snap.definitions.filter((d) => d.scope === "guest" && answerable(d));
  const questions = snap.definitions.filter((d) => d.scope === "guest" && d.required_rule !== "never" && answerable(d));
  const attendees = snap.guests.filter((g) => g.status === "going");
  const gift = snap.gifts[0] as (Snapshot["gifts"][number] & { checkout_url?: string | null; locked_at?: string | null }) | undefined;
  const approved = Boolean(gift?.locked_at);
  const vendor = gift?.shop_domain?.replace(/^https?:\/\//, "") || "the vendor";

  const [requestables, setRequestables] = useState<Requestable[]>([]);
  const [busy, setBusy] = useState<null | "request" | "approve">(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gift) { setRequestables([]); return; }
    let stop = false;
    fetch(`/api/events/${snap.event.id}/gifts/${gift.id}/request-fields`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { requestables: [] }))
      .then((d: { requestables: Requestable[] }) => { if (!stop) setRequestables(d.requestables); })
      .catch(() => { if (!stop) setRequestables([]); });
    return () => { stop = true; };
  }, [snap.event.id, gift?.id, snap.definitions.length]);

  const pending = requestables.filter((r) => !r.already);

  async function post(action: "request-fields" | "approve-specs", which: "request" | "approve") {
    if (!gift) return;
    setBusy(which);
    setError(null);
    try {
      const res = await fetch(`/api/events/${snap.event.id}/gifts/${gift.id}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error(((await res.json()) as { error: string }).error);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function cell(value: unknown, def: (typeof guestDefs)[number], going: boolean) {
    const label = Array.isArray(value)
      ? (value as string[]).map((x) => def.constraints.options?.find((o) => o.value === x)?.label ?? x).join(" ")
      : value === undefined || value === "" ? "" : def.constraints.options?.find((o) => o.value === value)?.label ?? String(value);
    const required = def.required_rule === "always" || (def.required_rule === "going" && going);
    return label || (required ? <span className="missing">missing</span> : <span className="quiet">not given</span>);
  }

  return (
    <div className="wrap solo">
      <section className="block" aria-labelledby="requested" data-testid="requested-info">
        <div className="labelrow"><h2 id="requested">Information requested from attendees</h2>{gift && <span className="eyebrow">{gift.product_title}</span>}</div>
        {questions.length > 0 ? (
          <div className="chips">
            {questions.map((q) => (
              <span className="chip" key={q.id} data-testid="requested-field"><strong>{q.label}</strong> <span className="quiet">{questionKind(q)}</span></span>
            ))}
          </div>
        ) : (
          <p className="hint" style={{ color: "var(--muted)" }}>No questions requested yet</p>
        )}
        {gift && pending.length > 0 && (
          <div className="sendrow" style={{ marginTop: 16 }}>
            <div className="lead">{gift.product_title} needs {pending.map((r) => r.label.toLowerCase()).join(" and ")} from each attendee</div>
            <button type="button" className="btn primary" onClick={() => post("request-fields", "request")} disabled={busy !== null} data-testid="request-fields">
              {busy === "request" ? "Adding" : `Request ${pending.map((r) => r.label).join(" and ")} from attendees`}
            </button>
          </div>
        )}
      </section>

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
        <section className="block" aria-labelledby="routing" data-testid="webmcp-routing">
          <div className="labelrow"><h2 id="routing">How this reaches the vendor</h2><span className="eyebrow">WebMCP</span></div>
          <div className="list">
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Store agent surface</span><span className="type"><code>https://{vendor}/api/ucp/mcp</code></span></div>
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Reads the product's fields</span><span className="type"><code>get_personalization_schema</code></span></div>
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Checks the batch before sending</span><span className="type"><code>validate_personalized_batch</code></span></div>
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Fills the cart on approval</span><span className="type"><code>create_personalized_batch</code></span></div>
          </div>
        </section>
      )}

      {gift && (
        <section className="block" aria-labelledby="approve" data-testid="approve-block">
          <div className="labelrow"><h2 id="approve">Send to vendor</h2></div>
          <div className="sendrow">
            <div className="lead">{gift.product_title} for {attendees.length} attendees at {vendor}</div>
            {approved ? (
              <span className="pill live" data-testid="specs-approved">Approved and sent to vendor</span>
            ) : (
              <button type="button" className="btn primary" onClick={() => post("approve-specs", "approve")} disabled={busy !== null || attendees.length === 0} data-testid="approve-send">{busy === "approve" ? "Sending" : "Approve and send to vendor"}</button>
            )}
          </div>
          {approved && gift.checkout_url && (
            <p className="hint" style={{ marginTop: 12 }}><a href={gift.checkout_url} target="_blank" rel="noreferrer" data-testid="review-cart">Review the cart at {vendor}</a></p>
          )}
          {error && <p className="error" role="alert" data-testid="approve-error">{error}</p>}
        </section>
      )}
    </div>
  );
}
