"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { StoreView } from "../../../server/store-view";
import type { ProcurementUpdateType } from "../../../server/procurement";
import { executeThroughMcp, registerStoreTools } from "../../../webmcp/register";
import { useWebMcp, WebMcpPill } from "../../webmcp-provider";
import { TraceList } from "../../events/[id]/trace";

const UPDATE_TYPES: { value: ProcurementUpdateType; label: string }[] = [
  { value: "accepted", label: "Accepted" },
  { value: "production_started", label: "Production started" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "needs_information", label: "Needs information" },
  { value: "invalid_value", label: "Invalid value" },
  { value: "option_unavailable", label: "Option unavailable" },
  { value: "exception", label: "Exception" }
];

const words = (s: string) => s.replace(/_/g, " ");
const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

/**
 * Registers the grant's tools while the store page is open (#48): a write through a tool changes
 * the page's data, so the page re-reads its view afterwards.
 */
function StoreWebMcp({ eventId, tokenId, tools }: { eventId: string; tokenId: string; tools: string[] }) {
  const router = useRouter();
  const status = useWebMcp((signal) => registerStoreTools({ eventId, tokenId, toolNames: tools, signal, onToolCall: (call) => call.ok && call.name.startsWith("post_") && router.refresh() }), [eventId, tokenId, tools]);
  return <WebMcpPill status={status} />;
}

/** The store's page for one grant (#47): the Procurement, then each block the grant allows, and the update form when it may write. */
export function StorePage({ view }: { view: StoreView }) {
  const { procurement, manifest, requirements, exceptions, updates, grant, event } = view;
  const keys = manifest ? [...new Set(manifest.attendees.flatMap((a) => Object.keys(a.values)))] : [];
  return (
    <div className="store">
      <header className="band">
        <a className="brand" href="/">Tokuchu</a>
        <div className="right">
          <StoreWebMcp eventId={event.id} tokenId={view.token_id} tools={view.tools} />
          <span className="pill" data-testid="store-grantee">{grant.grantee_id}</span>
        </div>
      </header>
      <main className="sheet">
        <div className="wrap solo">
          <h1 className="title" data-testid="store-product">{procurement.product.title}</h1>
          <p className="lead" data-testid="store-lead">{procurement.store} fills this order for {event.title}</p>

          <section className="block" data-testid="store-procurement">
            <div className="labelrow"><h2>Procurement</h2></div>
            <div className="stats store-stats">
              <div className="stat"><div className="n" data-testid="store-status">{words(procurement.status)}</div><div className="l">Status</div></div>
              <div className="stat"><div className="n" data-testid="store-revision">{procurement.current_revision}</div><div className="l">Current revision</div></div>
              <div className="stat"><div className="n" data-testid="store-approved">{procurement.approved_revision ?? "none"}</div><div className="l">Approved revision</div></div>
              <div className="stat"><div className="n" data-testid="store-attendees">{procurement.attendees}</div><div className="l">Attendees</div></div>
            </div>
            <div className="list" style={{ marginTop: 16 }}>
              <div className="row store-row"><span>Procurement id</span><code data-testid="store-procurement-id">{procurement.procurement_id}</code></div>
              <div className="row store-row"><span>Requirement schema</span><code data-testid="store-schema">{procurement.requirement_schema_id ?? "none"}</code></div>
              <div className="row store-row"><span>Access</span><span data-testid="store-permissions">{grant.permissions.join(" ")}</span></div>
              <div className="row store-row"><span>Access ends</span><span data-testid="store-expires">{grant.expires_at ? when(grant.expires_at) : "when the order is fulfilled"}</span></div>
              <div className="row store-row">
                <span>Seen up to revision</span>
                <span data-testid="store-seen">{grant.acknowledged_revision ?? "none"}</span>
                {view.tools.includes("acknowledge_changes") && <AcknowledgeButton eventId={event.id} tokenId={view.token_id} revision={procurement.current_revision} seen={grant.acknowledged_revision ?? null} />}
              </div>
            </div>
          </section>

          {requirements && (
            <section className="block" data-testid="store-requirements">
              <div className="labelrow"><h2>Requirements</h2></div>
              <div className="list">
                {requirements.map((r) => (
                  <div className="row store-row" key={r.key} data-testid="store-requirement" data-key={r.key}>
                    <span>{r.label}</span>
                    <code>{r.key}</code>
                    <span className="tag quiet">{r.kind}</span>
                  </div>
                ))}
                {requirements.length === 0 && <div className="row store-row"><span className="quiet">No requirements on this product</span></div>}
              </div>
            </section>
          )}

          {manifest && (
            <section className="block" data-testid="store-manifest">
              <div className="labelrow">
                <h2>Fulfilment manifest</h2>
                <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span className="tag quiet">revision {manifest.revision}</span>
                  <a className="btn ghost small" href={`/store/${grant.id}/fulfillment.csv`} download data-testid="store-csv">Download CSV</a>
                </span>
              </div>
              <div className="store-table">
                <table className="records">
                  <thead>
                    <tr>
                      <th>Attendee</th>
                      <th>Status</th>
                      <th>Variant</th>
                      {keys.map((k) => <th key={k} data-testid="store-manifest-key">{k}</th>)}
                      <th>Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manifest.attendees.map((a) => (
                      <tr key={a.attendee_ref} data-testid="store-manifest-row" data-attendee={a.attendee_ref} data-status={a.status}>
                        <td><code>{a.attendee_ref}</code></td>
                        <td className={a.status === "ready" ? "answered" : "missing"}>{a.status}</td>
                        <td>{a.variant_id ?? <span className="quiet">none</span>}</td>
                        {keys.map((k) => <td key={k}>{a.values[k] === null || a.values[k] === undefined || a.values[k] === "" ? <span className="quiet">missing</span> : String(a.values[k])}</td>)}
                        <td>{a.issues.length ? a.issues.map((i) => <div key={`${i.requirement_id}-${i.status}`}><span className="tag">{words(i.status)}</span> {i.requirement_id}: {i.message}</div>) : <span className="quiet">none</span>}</td>
                      </tr>
                    ))}
                    {manifest.attendees.length === 0 && <tr><td colSpan={4 + keys.length} className="quiet">No attendees on this order yet</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {exceptions && (
            <section className="block" data-testid="store-exceptions">
              <div className="labelrow"><h2>Open exceptions</h2></div>
              <div className="list">
                {exceptions.map((e) => (
                  <div className="row store-row" key={e.id} data-testid="store-exception">
                    <span>{e.message ?? words(e.type)}</span>
                    <code>{e.attendee_ref ?? "order"}</code>
                    <span className="tag">{e.requirement_id ?? words(e.type)}</span>
                  </div>
                ))}
                {exceptions.length === 0 && <div className="row store-row"><span className="quiet">No open exceptions</span></div>}
              </div>
            </section>
          )}

          {updates && (
            <section className="block" data-testid="store-updates">
              <div className="labelrow"><h2>Updates</h2></div>
              <div className="list">
                {updates.map((u) => (
                  <div className="row store-row" key={u.id} data-testid="store-update" data-kind={u.kind}>
                    <span>{u.text || words(u.kind)}</span>
                    <span className="tag quiet">{words(u.kind)}</span>
                    <span className="quiet">{when(u.created_at)}</span>
                  </div>
                ))}
                {updates.length === 0 && <div className="row store-row"><span className="quiet">No updates posted yet</span></div>}
              </div>
            </section>
          )}

          {grant.permissions.includes("updates:write") && <UpdateForm eventId={event.id} tokenId={view.token_id} procurementId={procurement.procurement_id} attendees={manifest?.attendees.map((a) => a.attendee_ref) ?? []} requirements={keys} />}

          <section className="block" data-testid="store-trace">
            <div className="labelrow"><h2>Agent trace</h2><span className="tag quiet">{view.traces.length} {view.traces.length === 1 ? "call" : "calls"} about this order</span></div>
            <TraceList entries={view.traces} empty="No calls about this order yet" />
          </section>
        </div>
      </main>
    </div>
  );
}

/** Records the current revision as seen through acknowledge_changes (#52) and reloads the page's data. */
function AcknowledgeButton({ eventId, tokenId, revision, seen }: { eventId: string; tokenId: string; revision: number; seen: number | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (seen !== null && seen >= revision) return <span className="tag quiet" data-testid="store-ack-current">up to date</span>;

  async function acknowledge() {
    setBusy(true);
    setError(null);
    const result = await executeThroughMcp(eventId, tokenId, "acknowledge_changes", { revision }, fetch);
    setBusy(false);
    if (result.isError) {
      setError((JSON.parse(result.content[0].text) as { error?: string }).error ?? "The revision was not recorded");
      return;
    }
    router.refresh();
  }

  return (
    <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <button type="button" className="btn ghost small" onClick={acknowledge} disabled={busy} data-testid="store-ack">{busy ? "Recording" : `Mark revision ${revision} as seen`}</button>
      {error && <span className="error" data-testid="store-ack-error">{error}</span>}
    </span>
  );
}

/** Posts one structured update through post_procurement_update as the grant's actor and reloads the page's data. */
function UpdateForm({ eventId, tokenId, procurementId, attendees, requirements }: { eventId: string; tokenId: string; procurementId: string; attendees: string[]; requirements: string[] }) {
  const router = useRouter();
  const [type, setType] = useState<ProcurementUpdateType>("accepted");
  const [attendee, setAttendee] = useState("");
  const [requirement, setRequirement] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const args: Record<string, unknown> = { procurement_id: procurementId, type };
    if (attendee) args.attendee_ref = attendee;
    if (requirement) args.requirement_id = requirement;
    if (message.trim()) args.message = message.trim();
    const result = await executeThroughMcp(eventId, tokenId, "post_procurement_update", args, fetch);
    setBusy(false);
    if (result.isError) {
      setError((JSON.parse(result.content[0].text) as { error?: string }).error ?? "The update was not posted");
      return;
    }
    setMessage("");
    window.dispatchEvent(new Event("event:changed"));
    router.refresh();
  }

  return (
    <section className="block" data-testid="store-post">
      <div className="labelrow"><h2>Post an update</h2></div>
      <form onSubmit={submit} className="grid2 store-form">
        <div className="field">
          <label htmlFor="store-type">Type</label>
          <select id="store-type" data-testid="store-type" value={type} onChange={(e) => setType(e.target.value as ProcurementUpdateType)}>
            {UPDATE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="store-attendee">Attendee</label>
          {attendees.length ? (
            <select id="store-attendee" data-testid="store-attendee" value={attendee} onChange={(e) => setAttendee(e.target.value)}>
              <option value="">Whole order</option>
              {attendees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          ) : (
            <input id="store-attendee" data-testid="store-attendee" value={attendee} onChange={(e) => setAttendee(e.target.value)} placeholder="Attendee id from the manifest" />
          )}
        </div>
        <div className="field">
          <label htmlFor="store-requirement">Requirement</label>
          {requirements.length ? (
            <select id="store-requirement" data-testid="store-requirement-field" value={requirement} onChange={(e) => setRequirement(e.target.value)}>
              <option value="">No single requirement</option>
              {requirements.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          ) : (
            <input id="store-requirement" data-testid="store-requirement-field" value={requirement} onChange={(e) => setRequirement(e.target.value)} placeholder="Requirement key" />
          )}
        </div>
        <div className="field">
          <label htmlFor="store-message">Message</label>
          <input id="store-message" data-testid="store-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Words the attendee or the organizer reads" />
        </div>
        <div className="acts" style={{ marginTop: 0, gridColumn: "1 / -1" }}>
          <button className="btn primary" type="submit" disabled={busy} data-testid="store-submit">Post update</button>
          {error && <p className="error" data-testid="store-error">{error}</p>}
        </div>
      </form>
    </section>
  );
}
