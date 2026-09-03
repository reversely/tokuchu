"use client";
import { useState } from "react";
import type { Requirement } from "../../../server/api";
import { withDemoHeaders } from "../../../demo/token";

const METHOD_LABEL: Record<string, string> = { exact: "same key", saved_mapping: "saved mapping", alias: "same concept", llm: "model match" };

/**
 * The confirmations the reconciliation left to the organizer (#51): each requirement with more than
 * one candidate or an uncertain one lists its candidates with a Use this action and an Ask attendees
 * action. A choice posts to the reconcile route and the parent reloads the requirements.
 */
export function Confirmations({ eventId, giftId, requirements, onChanged }: { eventId: string; giftId: string; requirements: Requirement[]; onChanged: () => void }) {
  const pending = requirements.filter((r) => r.confirmation);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (pending.length === 0) return null;

  async function choose(key: string, body: { attribute_id: string } | { create: true }) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/gifts/${giftId}/reconcile/${encodeURIComponent(key)}`, withDemoHeaders({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
      if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? "The confirmation was not saved");
      else onChanged();
    } catch {
      setError("The confirmation was not saved");
    }
    setBusy(null);
  }

  return (
    <div style={{ marginTop: 16 }} data-testid="confirmations">
      <p className="hint" style={{ marginBottom: 10 }}>{pending.length === 1 ? "One requirement needs your confirmation" : `${pending.length} requirements need your confirmation`}</p>
      <div className="list">
        {pending.map((r) => (
          <div key={r.key} data-testid="confirm-requirement" data-key={r.key}>
            <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
              <span><strong>{r.label}</strong> <span className="quiet">{r.confirmation!.reason}</span></span>
              <button type="button" className="btn ghost small" onClick={() => choose(r.key, { create: true })} disabled={busy !== null} data-testid="confirm-create">Ask attendees</button>
            </div>
            {r.confirmation!.candidates.map((c) => (
              <div className="row" style={{ gridTemplateColumns: "1fr auto auto" }} key={c.attribute_id} data-testid="confirm-candidate" data-attribute={c.attribute_id}>
                <span>{c.label}</span>
                <span className="type">{METHOD_LABEL[c.method] ?? c.method} at {Math.round(c.confidence * 100)}%</span>
                <button type="button" className="btn primary small" onClick={() => choose(r.key, { attribute_id: c.attribute_id })} disabled={busy !== null} data-testid="confirm-use">{busy === r.key ? "Saving" : "Use this"}</button>
              </div>
            ))}
          </div>
        ))}
      </div>
      {error && <p className="error" role="alert" data-testid="confirm-error">{error}</p>}
    </div>
  );
}
