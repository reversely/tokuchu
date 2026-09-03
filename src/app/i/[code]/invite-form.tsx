"use client";
import { useEffect, useState } from "react";
import type { inviteView } from "../../../server/api";
import type { AttributeDefinition, GuestStatus } from "../../../domain/types";
import { controlFor } from "../../../domain/values";
import { dateTime } from "../../../lib/format";
import { InviteWebMcp } from "./invite-webmcp";
import { sendRsvp } from "./send-rsvp";

type Invite = ReturnType<typeof inviteView>;
type Answers = Record<string, unknown>;

const STATUS_LABEL: Record<GuestStatus, string> = { going: "Going", maybe: "Maybe", cant_go: "Can't go", no_reply: "No reply" };

/** One question rendered from its definition: the control follows the value type, the choices follow the row. */
function Question({ def, value, onChange, disabled }: { def: AttributeDefinition; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const control = controlFor(def);
  const id = `q-${def.id}`;
  const options = def.constraints.options ?? [];
  // A choice question with no options cannot be answered, so it stays off the form until it has some.
  if ((control === "checkboxes" || control === "radio" || control === "select") && options.length === 0) return null;
  if (control === "checkboxes") {
    const chosen = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="field" disabled={disabled} data-testid={`answer-${def.key}`}>
        <legend>{def.label}</legend>
        <div className="chips">
          {options.map((o) => (
            <button key={o.value} type="button" className={`chip${chosen.includes(o.value) ? " on" : ""}`} aria-pressed={chosen.includes(o.value)} onClick={() => onChange(chosen.includes(o.value) ? chosen.filter((v) => v !== o.value) : [...chosen, o.value])}>{o.label}</button>
          ))}
          {options.length === 0 && <span className="hint">No choices yet</span>}
        </div>
      </fieldset>
    );
  }
  if (control === "radio" || control === "select") {
    return (
      <fieldset className="field" disabled={disabled} data-testid={`answer-${def.key}`}>
        <legend>{def.label}</legend>
        <div className="chips">
          {options.map((o) => (
            <button key={o.value} type="button" className={`chip${value === o.value ? " on" : ""}`} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
          ))}
        </div>
      </fieldset>
    );
  }
  if (control === "checkbox") {
    return (
      <div className="field" data-testid={`answer-${def.key}`}>
        <label><input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} /> {def.label}</label>
      </div>
    );
  }
  return (
    <div className="field" data-testid={`answer-${def.key}`}>
      <label htmlFor={id}>{def.label}</label>
      {control === "textarea" ? (
        <textarea id={id} rows={3} value={(value as string) ?? ""} disabled={disabled} maxLength={def.constraints.max_length} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} type={control === "number" ? "number" : control === "date" ? "date" : control === "file" ? "url" : def.vendor_field?.kind === "time" ? "time" : "text"} value={(value as string | number) ?? ""} disabled={disabled} maxLength={def.constraints.max_length} min={def.constraints.min} max={def.constraints.max} onChange={(e) => onChange(control === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} />
      )}
      {def.value_type === "text" && def.constraints.max_length !== undefined && <span className="hint" data-testid={`limit-${def.key}`}>Up to {def.constraints.max_length} characters</span>}
    </div>
  );
}

export function InviteForm({ invite, guestId }: { invite: Invite; guestId: string | null }) {
  const { event, questions } = invite;
  const [name, setName] = useState("");
  const [status, setStatus] = useState<GuestStatus | null>(null);
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ guest_id: string } | null>(guestId ? { guest_id: guestId } : null);
  /** The status saved by this page, shown after a save; a reload starts without it. */
  const [savedStatus, setSavedStatus] = useState<GuestStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!guestId);
  /** True when the link carries a guest id the event does not know, so the form stays blocked. */
  const [badLink, setBadLink] = useState(false);

  useEffect(() => {
    if (!guestId) return;
    fetch(`/api/events/${event.id}/rsvp/${guestId}`)
      .then(async (r) => {
        if (!r.ok) {
          setBadLink(true);
          return;
        }
        const g = (await r.json()) as { display_name: string; status: GuestStatus; email: string | null; values: Answers };
        setName(g.display_name);
        setEmail(g.email ?? "");
        setStatus(g.status === "no_reply" ? null : g.status);
        setAnswers(g.values);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoaded(true));
  }, [guestId, event.id, questions]);

  const required = (q: AttributeDefinition) => q.required_rule === "always" || (q.required_rule === "going" && status === "going");
  const missing = questions.filter((q) => required(q) && (answers[q.id] === undefined || answers[q.id] === "" || (Array.isArray(answers[q.id]) && (answers[q.id] as unknown[]).length === 0)));
  /** A reply of going or maybe needs an address, since a later request for missing details is emailed. */
  const needsEmail = status === "going" || status === "maybe";
  const emailOk = !needsEmail || /^\S+@\S+\.\S+$/.test(email.trim());
  const canSend = name.trim() && status && emailOk && missing.length === 0;

  async function send(nextStatus?: GuestStatus) {
    setSaving(true);
    setError(null);
    const finalStatus = nextStatus ?? status!;
    // A cancel keeps the saved answers; an edit sends the form's.
    const outcome = await sendRsvp({ eventId: event.id, guestId: done?.guest_id ?? null, displayName: name, status: finalStatus, email: email.trim() || null, answers: nextStatus ? {} : answers });
    if (outcome.ok) {
      if (!done) {
        setDone({ guest_id: outcome.guest.id });
        window.history.replaceState(null, "", `?guest=${outcome.guest.id}`);
      }
      setStatus(finalStatus);
      setSavedStatus(finalStatus);
    } else {
      setError(outcome.error);
    }
    setSaving(false);
  }

  const venue = [event.venue.name, event.venue.line1, event.venue.city].filter(Boolean);

  return (
    <>
      <header className="band">
        <span className="brand">Tokuchu</span>
        <InviteWebMcp eventId={event.id} guestId={done?.guest_id ?? null} questions={questions} responseOptions={event.response_options} />
      </header>
      <main className="sheet">
        <div className="wrap" style={{ gridTemplateColumns: "minmax(0, 640px)", justifyContent: "center" }}>
          <div>
            <div className="dark-card" style={{ marginBottom: 32 }}>
              <div className="hero">{event.host && <span className="badge">Hosted by {event.host}</span>}</div>
              <div className="in">
                <h2 data-testid="invite-title">{event.title}</h2>
                <div className="when">
                  <div>{dateTime(event.starts_at)}</div>
                  {venue.length > 0 && <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{venue.map((part) => <span key={part}>{part}</span>)}</div>}
                  {event.rsvp_deadline && <div>Reply by {event.rsvp_deadline}</div>}
                </div>
                {event.invite_extras.length > 0 && <div className="extras">{event.invite_extras.map((x) => <span key={x}>{x}</span>)}</div>}
                {event.description && <p style={{ color: "var(--night-muted)" }}>{event.description}</p>}
              </div>
            </div>

            {!loaded ? (
              <p className="lead">Loading your reply</p>
            ) : badLink ? (
              <p className="error" role="alert" data-testid="bad-link">Unknown reply link</p>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="name">Your name</label>
                  <input id="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="guest-name" />
                </div>
                <div className="field">
                  <label htmlFor="email">Your email</label>
                  <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="guest-email" />
                  <p className="hint" style={{ color: "var(--muted)" }}>Any request for a detail about your gift comes to this address.</p>
                </div>
                <div className="field">
                  <label>Your reply</label>
                  <div className="chips" data-testid="status">
                    {event.response_options.map((s) => (
                      <button key={s} type="button" className={`chip${status === s ? " on" : ""}`} aria-pressed={status === s} onClick={() => setStatus(s)}>{STATUS_LABEL[s]}</button>
                    ))}
                  </div>
                </div>
                {questions.map((q) => (
                  <Question key={q.id} def={q} value={answers[q.id]} disabled={saving} onChange={(v) => setAnswers({ ...answers, [q.id]: v })} />
                ))}
                {status && (!emailOk || missing.length > 0) && <p className="hint" style={{ color: "var(--muted)" }}>Still needed: {[...(!emailOk ? ["your email"] : []), ...missing.map((q) => q.label)].join(" and ")}</p>}
                <div className="foot">
                  <p className="note">{done ? "Saved for this link" : "This link keeps your reply"}</p>
                  <div style={{ display: "flex", gap: 10 }}>
                    {done && status !== "cant_go" && event.response_options.includes("cant_go") && (
                      <button type="button" className="btn ghost" onClick={() => send("cant_go")} disabled={saving} data-testid="cancel">Can't go</button>
                    )}
                    <button type="button" className="btn primary" onClick={() => send()} disabled={!canSend || saving} data-testid="send">{done ? "Save changes" : "Send reply"}</button>
                  </div>
                </div>
                {error && <p className="error" role="alert" data-testid="error">{error}</p>}
                {savedStatus && <p className="hint" style={{ color: "var(--muted)", marginTop: 12 }} data-testid="saved">Saved as {STATUS_LABEL[savedStatus]}</p>}
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
