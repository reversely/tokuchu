import { notFound, redirect } from "next/navigation";
import { snapshot } from "../../../server/api";
import { UnauthorizedError, ForbiddenError } from "../../../server/errors";
import { currentCaller, withEventOwnedBy } from "../../../server/ownership";
import { DEMO_TOKEN_PARAM } from "../../../demo/token";
import { Dashboard } from "./dashboard";
import { SessionPill } from "../../session-pill";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The single `t` search param, or null when the URL carries none or repeats it. */
function tokenFrom(query: Record<string, string | string[] | undefined>): string | null {
  const value = query[DEMO_TOKEN_PARAM];
  return typeof value === "string" ? value : null;
}

/**
 * The published event's dashboard (PRD Section 5) for the organizer who owns it; anyone else sees
 * the not-found page or the sign-in page. A demo URL's `t` token stands in for the demo cookie on
 * this render, so the first load after `/demo` succeeds in a browser that dropped the cookie.
 */
export default async function Page({ params, searchParams }: Props) {
  const { id } = await params;
  const token = tokenFrom(await searchParams);
  const caller = await currentCaller(token);
  let initial;
  let needsSignIn = !caller;
  let ownDemo = false;
  try {
    initial = await withEventOwnedBy(caller, id, () => snapshot(id));
  } catch (e) {
    if (e instanceof UnauthorizedError) needsSignIn = true;
    else if (e instanceof ForbiddenError && caller?.is_demo) ownDemo = true;
    else notFound();
  }
  // A guest whose cookie names another demo id lands on that id's own event instead of a dead end; the token goes along so a browser without the cookie resumes the same session.
  if (ownDemo) redirect(token ? `/demo?${DEMO_TOKEN_PARAM}=${encodeURIComponent(token)}` : "/demo");
  // `redirect` throws, so it runs outside the try that maps every other failure to not-found.
  if (needsSignIn || !initial) redirect(`/sign-in?next=${encodeURIComponent(`/events/${id}`)}`);
  return <Dashboard initial={initial} account={<SessionPill />} />;
}
