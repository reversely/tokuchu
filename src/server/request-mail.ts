/**
 * The email behind a request: the questions asked and the attendee's own link. Each send records how
 * it left on the request row, so the organizer's grid shows an attendee with no address or a
 * rejected message and the request stays on record either way. A correction carries the store's
 * words as quoted lines the attendee reads as the store's and not as the organizer's.
 */
import { getDefinition, getEvent, setRequestDelivery, state } from "../domain/store";
import type { Event, Guest } from "../domain/types";
import { mailer } from "./mail";
import { afterCommit, withPersistedEvent } from "./persistence";

/** One email to make: the attendee, the gift's request, the questions it still asks, and for a correction the store's message. */
export type Outgoing = { guest: Guest; gift_id: string; definition_ids: string[]; kind: "request" | "follow_up" | "correction"; message?: string | null };

/** The public origin the links point at. */
export function appUrl(): string {
  return (process.env.APP_URL || process.env.AUTH_URL || "http://localhost:3113").replace(/\/$/, "");
}

/** The attendee's own link, or a placeholder when the event has no invite code yet. */
export function attendeeLink(event: Event, guest: Guest): string {
  return event.invite_code ? `${appUrl()}/i/${event.invite_code}?guest=${guest.id}` : `(unpublished event) guest ${guest.id}`;
}

/** The store's message as quoted lines, cut to a length an email can carry; it is the store's text and arrives untrusted. */
function quoted(message: string): string[] {
  return message.slice(0, 500).split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => `> ${line}`);
}

/** The subject and text of a request, a reminder, or a correction. */
export function requestEmail(event: Event, guest: Guest, labels: string[], link: string, kind: Outgoing["kind"], message: string | null = null): { subject: string; text: string } {
  if (kind === "correction") {
    const lines = [`Hello ${guest.display_name}`, "", `The store making your gift for ${event.title} could not use one of your answers.`, ...(message ? ["The store wrote:", ...quoted(message)] : []), "", "Please give these details again:", ...labels.map((label) => `- ${label}`), "", "Reply through your own link:", link];
    return { subject: `A correction for your details for ${event.title}`, text: lines.join("\n") };
  }
  const reminder = kind === "follow_up";
  const opening = reminder ? `This is a reminder. The organizer of ${event.title} still needs these details from you:` : `The organizer of ${event.title} needs these details from you:`;
  const lines = [`Hello ${guest.display_name}`, "", opening, ...labels.map((label) => `- ${label}`), "", "Reply through your own link:", link];
  return { subject: reminder ? `Reminder: your details for ${event.title}` : `Your details for ${event.title}`, text: lines.join("\n") };
}

/** Sends one email and records the outcome on its request row. Never throws: a rejected message records `failed`. */
async function deliver(event: Event, outgoing: Outgoing): Promise<void> {
  const { guest, gift_id } = outgoing;
  const to = state().parties.get(guest.party_id)?.contact.email;
  if (!to) {
    setRequestDelivery(guest.id, gift_id, "no_address");
    return;
  }
  const labels = outgoing.definition_ids.map((id) => getDefinition(id).label);
  try {
    const delivery = await mailer().send({ to, ...requestEmail(event, guest, labels, attendeeLink(event, guest), outgoing.kind, outgoing.message ?? null) });
    setRequestDelivery(guest.id, gift_id, delivery);
  } catch (e) {
    setRequestDelivery(guest.id, gift_id, "failed", (e as Error).message);
  }
}

/** Sends every email and waits for each outcome to reach its row. */
export function deliverAll(event: Event, outgoing: Outgoing[]): Promise<void> {
  return Promise.all(outgoing.map((o) => deliver(event, o))).then(() => undefined);
}

/** One chain per event, so two RSVP writes in quick succession record their deliveries in order and the second's row keeps the first's outcome. */
const pending = new Map<string, Promise<unknown>>();

/**
 * Sends after the enclosing request has written its row, in a persisted scope of its own, so a send
 * queued inside a synchronous transaction still records its outcome on the stored event.
 */
export function deliverAfterCommit(eventId: string, outgoing: Outgoing[]): void {
  if (!outgoing.length) return;
  const committed = afterCommit();
  const previous = pending.get(eventId) ?? Promise.resolve();
  const next = Promise.all([previous, committed])
    .then(() => withPersistedEvent(eventId, () => deliverAll(getEvent(eventId), outgoing)))
    .catch((e: unknown) => console.error(`Request emails for event ${eventId} failed: ${(e as Error).message}`));
  pending.set(eventId, next);
}
