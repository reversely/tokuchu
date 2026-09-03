"use client";
import { useEffect, useState } from "react";
import type { ReconciliationView } from "../../../server/reconcile-api";
import { withDemoHeaders } from "../../../demo/token";

const CHANGE_LABEL = { added: "added", removed: "removed", changed: "changed" } as const;

/**
 * The schema version change the organizer sees before the request step runs again (#51): the
 * requirements the store added, removed, or changed, the attendees each touches, and a Continue
 * that marks the change seen and reruns the request step. Nothing renders while the gift's schema
 * has no pending change.
 */
export function SchemaChange({ eventId, giftId, seq, onChanged }: { eventId: string; giftId: string; seq: number; onChanged: () => void }) {
  const [view, setView] = useState<ReconciliationView["change"]>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/gifts/${giftId}/reconcile`, withDemoHeaders({ cache: "no-store" }));
        const body = res.ok ? ((await res.json()) as ReconciliationView) : null;
        if (!cancelled) setView(body?.change ?? null);
      } catch {
        if (!cancelled) setView(null);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, giftId, seq]);

  if (!view || view.continued_at) return null;

  async function proceed() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/gifts/${giftId}/reconcile`, withDemoHeaders({ method: "POST" }));
      if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? "The request step did not run");
      else onChanged();
    } catch {
      setError("The request step did not run");
    }
    setBusy(false);
  }

  const shortVersion = (v: string) => (v.length > 12 ? v.slice(0, 12) : v);
  return (
    <div className="panel" style={{ marginTop: 16, padding: 18, border: "1px solid var(--line)", borderRadius: "var(--r)" }} data-testid="schema-change" data-gift={giftId} data-from={view.from_version} data-to={view.to_version}>
      <div className="labelrow"><h3 style={{ fontSize: 18 }}>The store changed its requirements</h3><span className="eyebrow">version {shortVersion(view.to_version)}</span></div>
      <p className="hint" style={{ marginBottom: 12 }}>The requirement schema moved from version {shortVersion(view.from_version)} to version {shortVersion(view.to_version)}</p>
      <div className="list">
        {view.requirements.map((r) => (
          <div className="row" style={{ gridTemplateColumns: "1fr auto auto" }} key={r.key} data-testid="schema-change-requirement" data-key={r.key} data-change={r.change}>
            <span>{r.label}</span>
            <code>{r.key}</code>
            <span className={`tag${r.change === "removed" ? " quiet" : ""}`}>{CHANGE_LABEL[r.change]}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        {view.attendees.length === 0 ? (
          <p className="hint" data-testid="schema-change-nobody">No attendee is affected yet</p>
        ) : (
          <>
            <p className="hint" style={{ marginBottom: 8 }}>{view.attendees.length === 1 ? "One attendee is affected" : `${view.attendees.length} attendees are affected`}</p>
            <div className="list">
              {view.attendees.map((a) => (
                <div className="row" style={{ gridTemplateColumns: "1fr auto" }} key={a.attendee_ref} data-testid="schema-change-attendee" data-attendee={a.attendee_ref}>
                  <span>{a.display_name}</span>
                  <span className="type">{a.keys.join(" ")}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="sendrow" style={{ marginTop: 16 }}>
        <div className="lead">Continue reruns the request step with the new requirements</div>
        <button type="button" className="btn primary" onClick={proceed} disabled={busy} data-testid="schema-change-continue">{busy ? "Sending" : "Continue"}</button>
      </div>
      {error && <p className="error" role="alert" data-testid="schema-change-error">{error}</p>}
    </div>
  );
}
