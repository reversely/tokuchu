/**
 * The landing page's create_event tool (the first prompt of the demo): a browser agent with no
 * session opens Tokuchu, creates a published event with its guest list, and gets the event's URL
 * back. An account owns the event when a session exists; otherwise the event belongs to a demo
 * guest, as `/demo` does, and the reply carries the guest's signed token so the event page opens
 * as that guest. Demo events sweep after DEMO_TTL_HOURS.
 */
import { z } from "zod";
import { DEMO_TOKEN_PARAM } from "../demo/token";
import { publishEvent } from "../domain/store";
import { createEventFromBody, importGuests } from "./api";
import { demoCookieValue } from "./demo-session";
import { BadRequestError } from "./errors";

export const AgentEventBody = z.object({
  title: z.string().min(1),
  starts_at: z.string().min(1),
  host: z.string().optional(),
  description: z.string().optional(),
  venue: z.object({ name: z.string().min(1), line1: z.string().default(""), city: z.string().default(""), region: z.string().default(""), postal_code: z.string().default(""), country: z.string().default("CA") }),
  spots: z.number().int().positive().nullable().optional(),
  rsvp_deadline: z.string().nullable().optional(),
  needed_by: z.string().nullable().optional(),
  guests: z.array(z.string()).default([])
});
export type AgentEventBody = z.infer<typeof AgentEventBody>;

export type AgentEventCreated = { event_id: string; url: string; invite_url: string; guests_added: number; owner: "account" | "guest" };

/** Creates and publishes the event for `ownerId`, imports the guest lines, and names the pages. Runs inside a persisted create scope. */
export function createEventForAgent(body: unknown, ownerId: string, isAccount: boolean, origin: string): AgentEventCreated {
  const parsed = AgentEventBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const input = parsed.data;
  const draft = createEventFromBody(
    {
      title: input.title,
      host: input.host ?? "",
      description: input.description ?? "",
      starts_at: new Date(input.starts_at).toISOString(),
      venue: input.venue,
      spots: input.spots ?? null,
      rsvp_deadline: input.rsvp_deadline ?? null,
      delivery: { destination: "venue", address: null, needed_by: input.needed_by ?? null }
    },
    ownerId,
    !isAccount
  );
  const event = publishEvent(draft.id);
  const added = input.guests.length ? importGuests(event.id, { lines: input.guests }).added : 0;
  const token = isAccount ? null : demoCookieValue(ownerId);
  const url = new URL(`/events/${event.id}`, origin);
  if (token) url.searchParams.set(DEMO_TOKEN_PARAM, token);
  return { event_id: event.id, url: url.toString(), invite_url: new URL(`/i/${event.invite_code}`, origin).toString(), guests_added: added, owner: isAccount ? "account" : "guest" };
}
