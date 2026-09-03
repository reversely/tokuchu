import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { inviteView } from "../../../server/api";
import { staticMode } from "../../../server/flags";
import { withPersistedEventByInviteCode } from "../../../server/persistence";
import { AGENT_TASK_META, agentTaskText } from "../../../webmcp/agent-task";
import { InviteForm } from "./invite-form";

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ guest?: string }> };

/** In static mode the head carries the agent's task for this page (#56). */
export function generateMetadata(): Metadata {
  return staticMode() ? { other: { [AGENT_TASK_META]: agentTaskText("invite") } } : {};
}

/** The invite (PRD Section 6): the event, the response options, and the questions; the same link edits or cancels. */
export default async function Page({ params, searchParams }: Props) {
  const { code } = await params;
  const { guest } = await searchParams;
  let invite;
  try {
    invite = await withPersistedEventByInviteCode(code, () => inviteView(code));
  } catch {
    notFound();
  }
  return <InviteForm invite={invite} guestId={guest ?? null} agentNotes={staticMode()} />;
}
