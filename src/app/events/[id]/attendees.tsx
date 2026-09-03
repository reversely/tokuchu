"use client";
import { useCallback, useEffect, useState } from "react";
import type { Snapshot } from "./dashboard";
import type { Requirement } from "../../../server/api";
import { withDemoHeaders } from "../../../demo/token";
import { executeThroughApi } from "../../../webmcp/register";
import { TOOLS } from "../../../webmcp/tools";
import { DEMO_STORE } from "../../../demo/seed";
import type { GrantView } from "../../../server/grants";
import type { GrantPermission, VendorUpdate } from "../../../domain/types";
import { slugValue } from "../../../domain/values";
import { dateTime } from "../../../lib/format";
import { cellState, ExceptionsList, GridCell, GridLegend, ProcurementState, requirementKey, useFulfillmentManifest } from "./readiness";
import { ReconcilePanels } from "./reconcile-panels";
import { ProcurementExports } from "./procurement-exports";

const STATUS_LABEL: Record<string, string> = { going: "Going", maybe: "Maybe", cant_go: "Can't go", no_reply: "No reply" };
type Definition = Snapshot["definitions"][number];
type Gift = Snapshot["gifts"][number];

const bareHost = (shop: string) => shop.replace(/^https?:\/\//, "");

/** A guest question in plain words: the control it renders and, for a choice, the options it offers. */
function questionKind(def: Definition): string {
  const opts = (def.constraints.options ?? []).map((o) => o.label);
  if (def.value_type === "enum") return opts.length ? `choose one of ${opts.join(", ")}` : "choose one";
  if (def.value_type === "multi_enum") return opts.length ? `choose any of ${opts.join(", ")}` : "choose any";
  if (def.value_type === "date") return "a date";
  if (def.value_type === "number") return "a number";
  if (def.value_type === "file") return "the address of a picture";
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
 * The grid's columns for one gift: the questions its store fields created and the variant choice its
 * option axes ask for. With no gift chosen every guest question is a column.
 */
function giftColumns(gift: Gift | undefined, guestDefs: Definition[]): Definition[] {
  if (!gift) return guestDefs;
  const fieldKeys = new Set((gift.personalization?.fields ?? []).map((f) => f.key));
  const variantKeys = new Set(gift.variants.flatMap((v) => (v.options ?? []).map((o) => `variant_${slugValue(o.name)}`)));
  return guestDefs.filter((d) => (d.vendor_field?.key !== undefined && fieldKeys.has(d.vendor_field.key)) || variantKeys.has(d.key));
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

/** The four kinds of access the Share block offers and the permissions each carries. */
type AccessKey = "personalization" | "manifest" | "changes" | "updates";
const ACCESS: { key: AccessKey; label: string; permissions: GrantPermission[] }[] = [
  { key: "personalization", label: "Required attendee personalization", permissions: ["requirements:read"] },
  { key: "manifest", label: "Fulfilment manifest", permissions: ["manifest:read"] },
  { key: "changes", label: "Manifest changes", permissions: ["changes:read"] },
  { key: "updates", label: "Submit fulfilment updates", permissions: ["updates:read", "updates:write"] }
];
const EXPIRY: { value: string; label: string }[] = [
  { value: "fulfilment", label: "After fulfilment" },
  { value: "7", label: "In 7 days" },
  { value: "30", label: "In 30 days" }
];
const GRANT_STATUS: Record<GrantView["status"], string> = { active: "Active", revoked: "Revoked", expired: "Expired" };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Share fulfilment data: the organizer names the store, picks the access the grant carries and when
 * it ends, and creates the store access. Each grant shows its status and what it reaches with a copy
 * of the signed link and a revoke action. The token behind a grant never reaches the page.
 */
function ShareBlock({ eventId, gift, requirements }: { eventId: string; gift: Gift; requirements: Requirement[] }) {
  const [store, setStore] = useState(bareHost(gift.shop_domain));
  const [access, setAccess] = useState<Record<AccessKey, boolean>>({ personalization: true, manifest: true, changes: true, updates: true });
  const [expiry, setExpiry] = useState("fulfilment");
  const [grants, setGrants] = useState<GrantView[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setStore(bareHost(gift.shop_domain)), [gift.shop_domain]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/grants?procurement=${encodeURIComponent(gift.id)}`, withDemoHeaders({ cache: "no-store" }));
      setGrants(res.ok ? ((await res.json()) as { grants: GrantView[] }).grants : []);
    } catch {
      setGrants([]);
    }
  }, [eventId, gift.id]);
  useEffect(() => { void load(); }, [load]);

  const chosen = ACCESS.filter((a) => access[a.key]);

  async function create() {
    setBusy(true);
    setError(null);
    // The personalization access names the definitions the gift's requirements map; without it the holder reads no attendee field.
    const mapped = requirements.flatMap((r) => (r.definition_id ? [r.definition_id] : []));
    const body = {
      procurement_id: gift.id,
      grantee_type: "vendor",
      grantee_id: store.trim(),
      permissions: chosen.flatMap((a) => a.permissions),
      allowed_attribute_ids: access.personalization ? mapped : [],
      expires_at: expiry === "fulfilment" ? null : new Date(Date.now() + Number(expiry) * 24 * 60 * 60 * 1000).toISOString()
    };
    const res = await fetch(`/api/events/${eventId}/grants`, withDemoHeaders({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? "The access was not created");
    else await load();
    setBusy(false);
  }

  async function revoke(grantId: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/grants/${grantId}`, withDemoHeaders({ method: "DELETE" }));
    if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? "The access was not revoked");
    else await load();
    setBusy(false);
  }

  function copy(grant: GrantView) {
    if (!grant.link) return;
    void navigator.clipboard?.writeText(`${window.location.origin}${grant.link}`);
    setCopied(grant.id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="block" aria-labelledby="share" data-testid="share-block" data-gift={gift.id}>
      <div className="labelrow"><h2 id="share">Share fulfilment data</h2><span className="eyebrow">{gift.product_title}</span></div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="share-store">Store</label>
          <input id="share-store" data-testid="share-store" value={store} onChange={(e) => setStore(e.target.value)} placeholder="The store that fills the order" />
        </div>
        <div className="field">
          <label htmlFor="share-expiry">Access ends</label>
          <select id="share-expiry" data-testid="share-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
            {EXPIRY.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
      <div className="chips" data-testid="share-access" aria-label="The access the store gets">
        {ACCESS.map((a) => (
          <label className={`chip${access[a.key] ? " on" : ""}`} key={a.key} style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" style={{ width: "auto", margin: 0 }} checked={access[a.key]} onChange={(e) => setAccess({ ...access, [a.key]: e.target.checked })} data-testid={`share-access-${a.key}`} />
            {a.label}
          </label>
        ))}
      </div>
      <div className="acts" style={{ marginTop: 16 }}>
        <button type="button" className="btn primary" onClick={create} disabled={busy || !store.trim() || chosen.length === 0} data-testid="share-create">{busy ? "Working" : "Create store access"}</button>
        {error && <p className="error" role="alert" style={{ margin: 0 }} data-testid="share-error">{error}</p>}
      </div>
      {grants.length > 0 && (
        <div className="list" style={{ marginTop: 16 }} data-testid="share-grants">
          {grants.map((g) => (
            <div className="row" key={g.id} style={{ gridTemplateColumns: "1fr auto auto" }} data-testid="share-grant" data-grant={g.id} data-status={g.status}>
              <div>
                <div><strong data-testid="share-grant-store">{g.grantee_id}</strong> <span className={`pill${g.status === "active" ? " live" : ""}`} data-testid="share-grant-status">{GRANT_STATUS[g.status]}</span></div>
                <div className="chips" style={{ marginTop: 8 }} data-testid="share-grant-access">
                  <span className="tag quiet">{plural(g.access.fields, "field", "fields")}</span>
                  <span className="tag quiet">{plural(g.access.records, "fulfilment record", "fulfilment records")}</span>
                  <span className="tag quiet">the gift</span>
                </div>
              </div>
              {g.status === "active" && g.link && (
                <button type="button" className="btn ghost small" onClick={() => copy(g)} data-testid="share-copy" data-link={g.link}>{copied === g.id ? "Copied" : "Copy access link"}</button>
              )}
              {g.status === "active" && (
                <button type="button" className="btn ghost small" onClick={() => revoke(g.id)} disabled={busy} data-testid="share-revoke">Revoke</button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The Attendees tab, one gift at a time: the gift switcher, the organizer's request panel, the records
 * grid with that gift's columns, the WebMCP routing that carries it, the approve gate, the share block,
 * and the cart job's progress log.
 */
export function Attendees({ snap, onChanged }: { snap: Snapshot; onChanged: () => void }) {
  // A choice question with no options cannot be answered, so it is neither a column nor a request.
  const answerable = (d: Definition) => !((d.value_type === "enum" || d.value_type === "multi_enum") && (d.constraints.options?.length ?? 0) === 0);
  const guestDefs = snap.definitions.filter((d) => d.scope === "guest" && answerable(d));
  const defsById = new Map(snap.definitions.map((d) => [d.id, d]));
  const attendees = snap.guests.filter((g) => g.status === "going");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const gift = snap.gifts.find((g) => g.id === selectedId) ?? snap.gifts[0];
  const columns = giftColumns(gift, guestDefs);
  const personalized = (gift?.personalization?.fields.length ?? 0) > 0;
  const approved = Boolean(gift?.approved_at);
  const fill = gift?.cart_fill ?? null;
  const filling = fill?.status === "running";
  const changed = attendees.filter((g) => g.changed_since_approval).length;
  // The approval is stale once a fulfilment-affecting change follows the approved revision (#44); a changed answer on any question also offers the action.
  const approval = gift?.approval ?? null;
  const stale = approved && (approval?.stale === true || changed > 0);
  const store = gift ? bareHost(gift.shop_domain) || "the store" : "the store";
  const requests = new Map(snap.requests.filter((r) => r.gift_id === gift?.id).map((r) => [r.guest_id, r]));
  const incomplete = [...requests.values()].filter((r) => !r.complete).length;

  // The grid's cell states come from the organizer's fulfilment manifest (#49), read from its route on every snapshot sequence.
  const manifest = useFulfillmentManifest(snap.event.id, gift?.id, snap.seq);
  const rows = new Map((manifest?.attendees ?? []).map((a) => [a.attendee_ref, a]));
  const procurement = snap.procurements.find((p) => p.gift_id === gift?.id);
  const exceptions = snap.exceptions.filter((e) => e.procurement_id === gift?.id);

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

  function select(id: string) {
    setSelectedId(id);
    setError(null);
    setApproveError(null);
  }

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

  return (
    <div className="wrap solo">
      {snap.gifts.length > 1 && (
        <div className="chips" style={{ marginBottom: 20 }} data-testid="gift-tabs" aria-label="The gift the tab shows">
          {snap.gifts.map((g) => (
            <button type="button" key={g.id} className={`chip${g.id === gift?.id ? " on" : ""}`} aria-current={g.id === gift?.id ? "true" : undefined} onClick={() => select(g.id)} data-testid="gift-tab" data-gift={g.id}>
              {g.product_title} <span className="quiet">{bareHost(g.shop_domain)}</span>
            </button>
          ))}
        </div>
      )}

      <section className="block" aria-labelledby="requested" data-testid="requested-info" data-gift={gift?.id}>
        <div className="labelrow"><h2 id="requested">Information requested from attendees</h2>{gift && <span className="eyebrow">{gift.product_title}</span>}</div>
        {requirements.length > 0 ? (
          <div className="chips">
            {requirements.map((r) => (
              <span className="chip" key={r.key} data-testid="requested-field" data-source={r.source}><strong>{r.label}</strong> <span className="quiet">{sourceLabel(r, defsById)}</span></span>
            ))}
          </div>
        ) : (
          <p className="hint" style={{ color: "var(--muted)" }}>{gift && !personalized ? "This product has no customization fields" : "No requirements yet"}</p>
        )}
        {gift && <ReconcilePanels eventId={snap.event.id} giftId={gift.id} requirements={requirements} seq={snap.seq} onChanged={onChanged} />}
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

      <section className="block" aria-labelledby="records" data-testid="attendees" data-gift={gift?.id}>
        <div className="labelrow"><h2 id="records">Attendees</h2><span className="eyebrow">{attendees.length} responses</span></div>
        {gift && <ProcurementState procurement={procurement} current={approval?.current_revision ?? 0} approved={approval?.approved_revision ?? null} />}
        {attendees.length === 0 ? (
          <p className="hint" style={{ color: "var(--muted)" }} data-testid="attendees-empty">No attendees yet</p>
        ) : (
          <div className="list" style={{ overflowX: "auto" }}>
            <table className="records" data-testid="attendees-grid" data-manifest={manifest ? manifest.revision : ""}>
              <thead>
                <tr>
                  <th>Attendee</th>
                  <th>Status</th>
                  {columns.map((d) => <th key={d.id}>{d.label}</th>)}
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
                      {columns.map((d) => <td key={d.id} data-requirement={requirementKey(d)}><GridCell def={d} cell={cellState(d, g.values[d.id], rows.get(g.id), g.status === "going")} /></td>)}
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
        {attendees.length > 0 && <GridLegend />}
        <ExceptionsList exceptions={exceptions} guests={snap.guests} definitions={snap.definitions} requests={requests} />
      </section>

      {gift && (
        <section className="block" aria-labelledby="routing" data-testid="webmcp-routing" data-gift={gift.id}>
          <div className="labelrow"><h2 id="routing">How this reaches the store</h2><span className="eyebrow">WebMCP</span></div>
          <div className="list">
            {store === DEMO_STORE.shop_domain && <div className="row" style={{ gridTemplateColumns: "1fr auto" }} data-testid="routing-demo-store"><span>The demo store built for this project</span><span className="type"><code>{store}</code> trading as {DEMO_STORE.shop_name}</span></div>}
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Store UCP endpoint</span><span className="type"><code>https://{store}/api/ucp/mcp</code></span></div>
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Shopify page tools on the store's pages</span><span className="type"><code>search_catalog</code> <code>get_product</code> <code>get_cart</code> <code>update_cart</code> and the rest</span></div>
            {personalized ? (
              <>
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Store page tool that reads the product's fields</span><span className="type"><code>get_customization</code></span></div>
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Tokuchu page tool that requests the missing values</span><span className="type"><code>request_from_attendees</code></span></div>
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Store page tool that fills the cart on approval</span><span className="type"><code>add_customized_to_cart</code></span></div>
              </>
            ) : (
              <>
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }}><span>Tokuchu page tool that records the approval</span><span className="type"><code>approve_specs</code></span></div>
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }} data-testid="routing-ucp-cart"><span>Store UCP tools that fill the cart on approval</span><span className="type"><code>create_cart</code> <code>update_cart</code> <code>create_checkout</code></span></div>
              </>
            )}
          </div>
        </section>
      )}

      {gift && (
        <section className="block" aria-labelledby="approve" data-testid="approve-block" data-gift={gift.id}>
          <div className="labelrow"><h2 id="approve">Fill the cart</h2></div>
          <div className="sendrow">
            <div className="lead">{gift.product_title} for {attendees.length} attendees at {store}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {approved ? (
                <span className="pill live" data-testid="specs-approved">Approved</span>
              ) : (
                <button type="button" className="btn primary" onClick={approve} disabled={busy !== null || attendees.length === 0} data-testid="approve-send">{busy === "approve" ? "Approving" : "Approve and fill the cart"}</button>
              )}
              {stale && (
                <button type="button" className="btn primary" onClick={approve} disabled={busy !== null || filling} data-testid="re-approve">{busy === "approve" ? "Approving" : "Re-approve"}</button>
              )}
            </div>
          </div>
          {approved && approval && (
            approval.stale ? (
              <p className="hint" style={{ marginTop: 12 }} data-testid="approval-stale" data-approved={approval.approved_revision ?? ""} data-current={approval.current_revision}>
                Approved at revision {approval.approved_revision}; revision {approval.current_revision} has changes since
              </p>
            ) : (
              <p className="hint" style={{ marginTop: 12 }} data-testid="approval-revision" data-approved={approval.approved_revision ?? ""}>Approved at revision {approval.approved_revision}</p>
            )
          )}
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
      {gift && <ProcurementExports eventId={snap.event.id} giftId={gift.id} seq={snap.seq} current={approval?.current_revision ?? 0} />}

      {gift && <ShareBlock eventId={snap.event.id} gift={gift} requirements={requirements} />}

      {gift && approved && (
        <section className="block" aria-labelledby="progress" data-testid="cart-progress" data-gift={gift.id}>
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
