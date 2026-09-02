import { notFound, redirect } from "next/navigation";
import { snapshot } from "../../../server/api";
import { UnauthorizedError } from "../../../server/errors";
import { currentCaller, withEventOwnedBy } from "../../../server/ownership";
import { Dashboard } from "./dashboard";
import { SessionPill } from "../../session-pill";

type Params = { params: Promise<{ id: string }> };

/** The published event's dashboard (PRD Section 5) for the organizer who owns it; anyone else sees the not-found page or the sign-in page. */
export default async function Page({ params }: Params) {
  const { id } = await params;
  const caller = await currentCaller();
  let initial;
  let needsSignIn = !caller;
  try {
    initial = await withEventOwnedBy(caller, id, () => snapshot(id));
  } catch (e) {
    if (e instanceof UnauthorizedError) needsSignIn = true;
    else notFound();
  }
  // `redirect` throws, so it runs outside the try that maps every other failure to not-found.
  if (needsSignIn || !initial) redirect(`/sign-in?next=${encodeURIComponent(`/events/${id}`)}`);
  return <Dashboard initial={initial} account={<SessionPill />} />;
}
