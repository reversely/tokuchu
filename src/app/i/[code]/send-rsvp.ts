/**
 * The one client path an attendee's reply takes: the form's button and the submit_rsvp tool both
 * call sendRsvp. A first reply posts to /rsvp and reads the guest back; a later one patches the guest.
 * Answers are keyed by definition id, as the routes store them.
 */
import type { GuestStatus } from "../../../domain/types";

export type RecordedGuest = { id: string; display_name: string; status: GuestStatus; values: Record<string, unknown> };
export type LockDetail = { definition_id: string; label: string; batch_id: string; date: string };
export type RsvpOutcome = { ok: true; guest: RecordedGuest } | { ok: false; status: number; error: string; locked?: LockDetail };
export type RsvpSend = { eventId: string; guestId: string | null; displayName: string; status: GuestStatus; answers: Record<string, unknown> };

const JSON_HEADERS = { "Content-Type": "application/json" };

async function failure(response: Response): Promise<RsvpOutcome> {
  const body = (await response.json().catch(() => ({}))) as { error?: string; locked?: LockDetail };
  return { ok: false, status: response.status, error: body.error ?? response.statusText, locked: body.locked };
}

/** Sends one reply; a network failure comes back as a status 0 outcome so both callers read one shape. */
export async function sendRsvp(send: RsvpSend, fetchImpl: typeof fetch = fetch): Promise<RsvpOutcome> {
  try {
    return await request(send, fetchImpl);
  } catch (cause) {
    return { ok: false, status: 0, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

async function request({ eventId, guestId, displayName, status, answers }: RsvpSend, fetchImpl: typeof fetch): Promise<RsvpOutcome> {
  const events = `/api/events/${encodeURIComponent(eventId)}`;
  if (guestId) {
    const response = await fetchImpl(`${events}/rsvp/${encodeURIComponent(guestId)}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ status, answers }) });
    if (!response.ok) return failure(response);
    return { ok: true, guest: (await response.json()) as RecordedGuest };
  }
  const created = await fetchImpl(`${events}/rsvp`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ guests: [{ display_name: displayName.trim(), status, answers }] }) });
  if (!created.ok) return failure(created);
  const { guest_ids } = (await created.json()) as { guest_ids: string[] };
  const guest = await fetchImpl(`${events}/rsvp/${encodeURIComponent(guest_ids[0])}`);
  if (!guest.ok) return failure(guest);
  return { ok: true, guest: (await guest.json()) as RecordedGuest };
}
