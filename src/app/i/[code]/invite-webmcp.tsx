"use client";
import { useWebMcp, WebMcpPill } from "../../webmcp-provider";
import { registerRsvpTool } from "../../../webmcp/register";
import type { AttributeDefinition, GuestStatus } from "../../../domain/types";

/** Registers submit_rsvp while the invite is open, defaulting the record to the link's guest, and shows whether an agent can see it. */
export function InviteWebMcp({ eventId, guestId, questions, responseOptions }: { eventId: string; guestId: string | null; questions: AttributeDefinition[]; responseOptions: GuestStatus[] }) {
  const status = useWebMcp((signal) => registerRsvpTool({ eventId, guestId, definitions: questions, responseOptions, signal }), [eventId, guestId, questions, responseOptions]);
  return <WebMcpPill status={status} />;
}
