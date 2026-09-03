/**
 * The load_sample_attendees page tool: ten attendees added to an event as going, each with an
 * email, so an agent running the demo populates the list itself instead of a launcher seeding it
 * through the API. The reply carries each attendee's offline details (size, star map location and
 * time) as the organizer would hold them, so the agent can answer the store's questions for them
 * later through submit_rsvp. An attendee already on the list by name is not added again.
 */
import data from "../demo/sample-attendees.json";
import { createGuest, createParty, guestsFor } from "../domain/store";
import { afterRsvpWrite } from "./hooks";
import { requireEvent } from "./api";

export type SampleAttendee = { display_name: string; email: string; size: string; location: string | null; time: string };
export type SampleLoad = { added: number; skipped: number; attendees: (SampleAttendee & { guest_id: string })[] };

export const SAMPLE_ATTENDEES: SampleAttendee[] = (data as { attendees: SampleAttendee[] }).attendees;

export function loadSampleAttendees(eventId: string): SampleLoad {
  requireEvent(eventId);
  const existing = new Map(guestsFor(eventId).map((g) => [g.display_name.toLowerCase(), g]));
  const out: SampleLoad = { added: 0, skipped: 0, attendees: [] };
  for (const a of SAMPLE_ATTENDEES) {
    const known = existing.get(a.display_name.toLowerCase());
    if (known) {
      out.skipped += 1;
      out.attendees.push({ ...a, guest_id: known.id });
      continue;
    }
    const party = createParty(eventId, { contact: { email: a.email } });
    const guest = createGuest(eventId, party.id, { display_name: a.display_name, status: "going" });
    out.added += 1;
    out.attendees.push({ ...a, guest_id: guest.id });
  }
  if (out.added) afterRsvpWrite(eventId);
  return out;
}
