import { notFound, redirect } from "next/navigation";
import { snapshot } from "../../../server/api";
import { guestKeepPath, signInPath } from "../../../server/demo";
import { currentCaller, openEvent } from "../../../server/ownership";
import { DEMO_TOKEN_PARAM } from "../../../demo/token";
import { Dashboard } from "./dashboard";
import { GuestPill, SessionPill } from "../../session-pill";

type Query = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ id: string }>; searchParams: Promise<Query> };

/** The single `t` search param, or null when the URL carries none or repeats it. */
function tokenFrom(query: Query): string | null {
  const value = query[DEMO_TOKEN_PARAM];
  return typeof value === "string" ? value : null;
}

/** The page's own path with every search param but the token, so a consumed token leaves the address bar. */
function pathWithoutToken(id: string, query: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (key !== DEMO_TOKEN_PARAM && typeof value === "string") params.set(key, value);
  const search = params.toString();
  return `/events/${id}${search ? `?${search}` : ""}`;
}

/** The page for an event another account owns. */
function Forbidden() {
  return (
    <>
      <header className="band">
        <a className="brand" href="/">Tokuchu</a>
      </header>
      <main className="sheet">
        <div className="wrap solo">
          <h1 className="title" data-testid="forbidden-title">This event belongs to another organizer</h1>
          <p className="lead"><a href="/events" data-testid="forbidden-events-link">Open your events</a></p>
        </div>
      </main>
    </>
  );
}

/**
 * The published event's dashboard (PRD Section 5) for the caller who owns it. A guest URL's `t`
 * token stands in for the cookie on this render, so the first load after `/demo` succeeds in a
 * browser that dropped the cookie; beside a session the token hands the event to the account and
 * the page reloads without it. A refusal renders as sign-in, the not-found page, or the page that
 * names another organizer.
 */
export default async function Page({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const token = tokenFrom(query);
  const caller = await currentCaller(token);
  if (token && caller && !caller.is_demo) redirect(pathWithoutToken(id, query));
  const opened = await openEvent(caller, id, () => snapshot(id));
  // `redirect` and `notFound` throw, so they run outside any try.
  if (opened.kind === "sign_in") redirect(signInPath(`/events/${id}`));
  if (opened.kind === "not_found") notFound();
  if (opened.kind === "forbidden") return <Forbidden />;
  const account = caller?.is_demo ? <GuestPill signIn={signInPath(await guestKeepPath(caller.id))} /> : <SessionPill />;
  return <Dashboard initial={opened.value} account={account} />;
}
