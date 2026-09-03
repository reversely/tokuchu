"use client";
import { useCallback, useEffect, useState } from "react";
import type { Snapshot } from "./dashboard";
import type { Requirement } from "../../../server/api";
import { withDemoHeaders } from "../../../demo/token";
import { executeThroughApi } from "../../../webmcp/register";
import { TOOLS } from "../../../webmcp/tools";
import { DEMO_STORE } from "../../../demo/seed";
import type { VendorUpdate } from "../../../domain/types";
import { dateTime } from "../../../lib/format";

const STATUS_LABEL: Record<string, string> = { going: "Going", maybe: "Maybe", cant_go: "Can't go", no_reply: "No reply" };
type Definition = Snapshot["definitions"][number];

/** A guest question in plain words: the control it renders and, for a choice, the options it offers. */
function questionKind(def: Definition): string {
  const opts = (def.constraints.options ?? []).map((o) => o.label);
  if (def.value_type === "enum") return opts.length ? `choose one of ${opts.join(", ")}` : "choose one";
  if (def.value_type === "multi_enum") return opts.length ? `choose any of ${opts.join(", ")}` : "choose any";
  if (def.value_type === "date") return "a date";
  if (def.value_type === "number") return "a number";
  if (def.constraints.max_length) return `text up to ${def.constraints.max_length} characters`;
  return "short text";
}

/** An incomplete request's state: how its email left when that stopped it and otherwise how long it has waited. */
function requestState(request: Snapshot["requests"][number]): string {
  if (request.delivery === "no_address") return "no email address";
  if (request.delivery === "failed") return "email failed";
  return request.follow_ups > 0 ? `waiting after ${request.follow_ups} follow-up${request.follow_ups === 1 ? "" : "s"}` : "waiting";
}

/** Where a requirement's value comes from, in the organizer's words. */
function sourceLabel(r: Requirement, defs: Map<string, Definition>): string {
  if (r.source === "guest") return "from the RSVP name";
  if (r.source === "event") return "from the event";
  if (r.source === "literal") return "a fixed value";
  if (r.source === "definition") {
    const def = r.definition_id ? defs.get(r.definition_id) : undefined;
    return def?.scope === "guest" ? `asked of attendees as ${questionKind(def)}` : "from the event's records";
  }
  return "to be asked of attendees";
}

/**
 * Runs one organizer tool through the same path a browser agent takes on this page, so a click and a
 * tool call share one request. Returns the error text when the call failed.
 */
async function runTool(name: string, eventId: string, giftId: string): Promise<string | null> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return `No tool ${name}`;
  const result = await executeThroughApi(tool, eventId, { gift_id: giftId }, fetch);
  if (!result.isError) return null;
  try {
    return (JSON.parse(result.content[0].text) as { error?: string }).error ?? "The request failed";
  } catch {
    return "The request failed";
  }
}

/** The Attendees records grid, the organizer's request panel, the WebMCP routing that carries it, the approve gate, and the cart job's progress log. */
export function Attendees({ snap, onChanged }: { snap: Snapshot; onChanged: () => void }) {
  // A choice question with no options cannot be answered, so it is neither a column nor a request.
  const answerable = (d: Definition) => !((d.value_type === "enum" || d.value_type === "multi_enum") && (d.constraints.options?.length ?? 0) === 0);
  const guestDefs = snap.definitions.filter((d) => d.scope === "guest" && answerable(d));
  const defsById = new Map(snap.definitions.map((d) => [d.id, d]));
  const attendees = snap.guests.filter((g) => g.status === "going");
  const gift = snap.gifts[0];
  const approved = Boolean(gift?.approved_at);
  const fill = gift?.cart_fill ?? null;
  const filling = fill?.status === "running";
  const changed = attendees.filter((g) => g.changed_since_approval).length;
  const store = gift?.shop_domain?.replace(/^https?:\/\//, "") || "the store";
  const requests = new Map(snap.requests.filter((r) => r.gift_id === gift?.id).map((r) => [r.guest_id, r]));
  const incomplete = [...requests.values()].filter((r) => !r.complete).length;

  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [updates, setUpdates] = useState<VendorUpdate[]>([]);
  const [busy, setBusy] = useState<null | "request" | "follow_up" | "approve">(null);
  const [error, setError] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);

  const loadRequirements = useCallback(async () => {
    if (!gift) return setRequirements([]);
    try {
      const res = await fetch(`/api/events/${snap.event.id}/gifts/${gift.id}/request-fields`, withDemoHeaders({ cache: "no-store" }));
      setRequirements(res.ok ? ((await res.json()) as { requirements: Requirement[] }).requirements : []);
    } catch {
      setRequirements([]);
    }
  }, [snap.event.id, gift]);

  const loadUpdates = useCallback(async () => {
    if (!gift || !approved) return setUpdates([]);
    try {
      const res = await fetch(`/api/events/${snap.event.id}/gifts/${gift.id}/updates`, withDemoHeaders({ cache: "no-store" }));
      setUpdates(res.ok ? ((await res.json()) as { updates: VendorUpdate[] }).updates : []);
    } catch {
      setUpdates([]);
    }
  }, [snap.event.id, gift, approved]);

  // The requirement list changes with the definitions and the gift's mappings, and the progress log with the job's posts; the snapshot sequence tracks all three.
  useEffect(() => { void loadRequirements(); void loadUpdates(); }, [loadRequirements, loadUpdates, snap.seq]);

  const pending = requirements.filter((r) => !r.already);

  /** The two states a blocked row can be in that an email resolves: a specification asked and unanswered, or one never asked. */
  const blockedIssues = (gift?.cart_blocked ?? []).flatMap((b) => b.issues);
  const blockedUnconfirmed = blockedIssues.some((i) => i.includes("not confirmed by the attendee"));
  const blockedUnrequested = blockedIssues.some((i) => i.includes("not been requested from attendees"));

  async function run(name: "request_from_attendees" | "follow_up", which: "request" | "follow_up") {
    if (!gift) return;
    setBusy(which);
    setError(null);
    const failure = await runTool(name, snap.event.id, gift.id);
    if (failure) setError(failure);
    else onChanged();
    setBusy(null);
  }

  async function approve() {
    if (!gift) return;
    setBusy("approve");
    setApproveError(null);
    const failure = await runTool("approve_specs", snap.event.id, gift.id);
    if (failure) setApproveError(failure);
    else onChanged();
    setBusy(null);
  }

  function cell(guestId: string, value: unknown, def: Definition, going: boolean) {
    const label = Array.isArray(value)
      ? (value as string[]).map((x) => def.constraints.options?.find((o) => o.value === x)?.label ?? x).join(" ")
      : value === undefined || value === "" ? "" : def.constraints.options?.find((o) => o.value === value)?.label ?? String(value);
    if (label) return requests.get(guestId)?.definition_ids.includes(def.id) ? <span className="answered" data-state="answered">{label}</span> : label;
    const requested = requests.get(guestId)?.definition_ids.includes(def.id);
    const required = def.required_rule === "always" || (def.required_rule === "going" && going);
    return requested || required ? <span className="missing" data-state="missing">missing</span> : <span className="quiet">not given</span>;
  }

  return (
    <div className="wrap solo">
      <section className="block" aria-labelledby="requested" data-testid="requested-info">
        <div className="labelrow"><h2 id="requested">Information requested from attendees</h2>{gift && <span className="eyebrow">{gift.product_title}</span>}</div>
        {requirements.length > 0 ? (
          <div className="chips">
            {requirements.map((r) => (
              <span className="chip" key={r.key} data-testid="requested-field" data-source={r.source}><strong>{r.label}</strong> <span className="quiet">{sourceLabel(r, defsById)}</span></span>
            ))}
          </div>
        ) : (
          <p className="hint" style={{ color: "var(--muted)" }}>No requirements yet</p>
        )}
        {gift && (
          <div className="sendrow" style={{ marginTop: 16 }}>
            <div className="lead">
              {pending.length > 0
                ? `${gift.product_title} needs ${pending.map((r) => r.label.toLowerCase()).join(" and ")} from each attendee`
                : incomplete > 0
                  ? `${incomplete} ${incomplete === 1 ? "attendee is" : "attendees are"} still missing values`
                  : requests.size > 0
                    ? "Every request is complete"
                    : "Nothing to ask attendees yet"}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="btn primary" onClick={() => run("request_from_attendees", "request")} disabled={busy !== null || approved} data-testid="request-fields">
                {busy === "request" ? "Sending" : "Request from attendees"}
              </button>
              <button type="button" className="btn ghost" onClick={() => run("follow_up", "follow_up")} disabled={busy !== null || incomplete === 0} data-testid="follow-up">
                {busy === "follow_up" ? "Sending" : `Send follow-up to ${incomplete}`}
              </button>
            </div>
          </div>
        )}
        {error && <p className="error" role="alert" data-testid="request-error">{error}</p>}
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
                  {(requests.size > 0 || approved) && <th>Request</th>}
                </tr>
              </thead>
              <tbody>
                {attendees.map((g) => {
                  const request = requests.get(g.id);
                  return (
                    <tr key={g.id} data-testid="attendee-row" data-request={request ? (request.complete ? "complete" : "incomplete") : "none"} data-changed={g.changed_since_approval ? "true" : "false"}>
                      <td>{g.display_name}</td>
                      <td>{STATUS_LABEL[g.status]}</td>
                      {guestDefs.map((d) => <td key={d.id}>{cell(g.id, g.values[d.id], d, g.status === "going")}</td>)}
                      {(requests.size > 0 || approved) && (
                        <td>
                          {g.changed_since_approval ? (
                            <span className="missing" data-state="changed">changed after approval</span>
                          ) : request ? (
                            request.complete ? <span className="answered">complete</span> : <span className="missing">{requestState(request)}</span>
                          ) : (
                            <span className="quiet">nothing to ask</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {gift && (
        <section className="block" aria-labelledby="routing" data-testid="webmcp-routing">
          <div className="labelrow"><h2 id="routing">How this reaches the store</h2><span className="eyebrow">WebMCP</span></div>
          <div className="list">
            {store === DEMO_STORE.shop_domain && <div className="row" style={{ gridTemplateColumns: "1fr auto" }} data-testid="routing-demo-store"><span>The demo store built for this project</span><span className="type"><code>{store}</code> trading as {DEMO_STORE.shop_name}</span></div>}
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Store UCP endpoint</span><span className="type"><code>https://{store}/api/ucp/mcp</code></span></div>
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Shopify page tools on the store's pages</span><span className="type"><code>search_catalog</code> <code>get_product</code> <code>get_cart</code> <code>update_cart</code> and the rest</span></div>
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Store page tool that reads the product's fields</span><span className="type"><code>get_customization</code></span></div>
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Tokuchu page tool that requests the missing values</span><span className="type"><code>request_from_attendees</code></span></div>
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Store page tool that fills the cart on approval</span><span className="type"><code>add_customized_to_cart</code></span></div>
          </div>
        </section>
      )}

      {gift && (
        <section className="block" aria-labelledby="approve" data-testid="approve-block">
          <div className="labelrow"><h2 id="approve">Fill the cart</h2></div>
          <div className="sendrow">
            <div className="lead">{gift.product_title} for {attendees.length} attendees at {store}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {approved ? (
                <span className="pill live" data-testid="specs-approved">Approved</span>
              ) : (
                <button type="button" className="btn primary" onClick={approve} disabled={busy !== null || attendees.length === 0} data-testid="approve-send">{busy === "approve" ? "Approving" : "Approve and fill the cart"}</button>
              )}
              {approved && changed > 0 && (
                <button type="button" className="btn primary" onClick={approve} disabled={busy !== null || filling} data-testid="approve-again">{busy === "approve" ? "Approving" : "Approve again"}</button>
              )}
            </div>
          </div>
          {approved && changed > 0 && <p className="hint" style={{ marginTop: 12 }} data-testid="changed-count">{changed} {changed === 1 ? "attendee" : "attendees"} changed an answer after approval</p>}
          {approved && filling && <p className="hint" style={{ marginTop: 12 }} data-testid="cart-filling">Filling the cart</p>}
          {approved && fill?.status === "done" && <p className="hint" style={{ marginTop: 12 }} data-testid="cart-filled">Cart filled</p>}
          {approved && gift.checkout_url && (
            <p className="hint" style={{ marginTop: 12 }}><a href={gift.checkout_url} target="_blank" rel="noreferrer" data-testid="review-cart">Review the cart at {store}</a></p>
          )}
          {approved && fill?.status === "failed" && <p className="error" role="alert" data-testid="cart-failed">{fill.reason ?? "The cart did not fill"}</p>}
          {approved && (gift.cart_blocked?.length ?? 0) > 0 && (
            <div data-testid="cart-blocked">
              {blockedUnconfirmed && (
                <div className="labelrow" style={{ marginTop: 12, gap: 12 }}>
                  <p className="hint" style={{ margin: 0 }} data-testid="cart-blocked-unconfirmed">Attendees haven't confirmed their specifications yet</p>
                  <button type="button" className="btn ghost small" onClick={() => run("follow_up", "follow_up")} disabled={busy !== null} data-testid="cart-blocked-remind">{busy === "follow_up" ? "Sending" : "Send email reminders"}</button>
                </div>
              )}
              {blockedUnrequested && (
                <div className="labelrow" style={{ marginTop: 12, gap: 12 }}>
                  <p className="hint" style={{ margin: 0 }} data-testid="cart-blocked-unrequested">Some specifications have not been requested from attendees</p>
                  <button type="button" className="btn ghost small" onClick={() => run("request_from_attendees", "request")} disabled={busy !== null} data-testid="cart-blocked-request">{busy === "request" ? "Sending" : "Request from attendees"}</button>
                </div>
              )}
              <ul className="hint" style={{ marginTop: 8 }}>
                {gift.cart_blocked!.map((b) => <li key={b.guest_id}>{snap.guests.find((g) => g.id === b.guest_id)?.display_name ?? b.guest_id}: {b.issues.join("; ")}</li>)}
              </ul>
            </div>
          )}
          {approveError && <p className="error" role="alert" data-testid="approve-error">{approveError}</p>}
        </section>
      )}

      {gift && approved && (
        <section className="block" aria-labelledby="progress" data-testid="cart-progress">
          <div className="labelrow"><h2 id="progress">Cart job progress</h2><span className="eyebrow">{updates.length} {updates.length === 1 ? "post" : "posts"}</span></div>
          {updates.length === 0 ? (
            <p className="hint" style={{ color: "var(--muted)" }}>No posts yet</p>
          ) : (
            <div className="list">
              {updates.map((u) => (
                <div className="row" key={u.id} style={{ gridTemplateColumns: "1fr auto" }} data-testid="cart-progress-post">
                  <span>{u.reference ? <a href={u.reference} target="_blank" rel="noreferrer">{u.text}</a> : u.text}</span>
                  <span className="type">{dateTime(u.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
