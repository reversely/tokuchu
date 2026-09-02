import { appUrl as appOrigin } from "../../server/request-mail";
import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "../../server/api";
import { hasDatabase } from "../../server/db";
import { demoEventFor, sweepDemoState } from "../../server/demo";
import { DEMO_COOKIE, demoCookieOptions, demoCookieValue, demoIdFromCookie, newDemoId } from "../../server/demo-session";
import { currentCaller } from "../../server/ownership";

/** Only the in-memory store sweeps here; the database sweeps from `npm run sweep-demo`. */
function usesMemory(): boolean {
  return !hasDatabase() && process.env.NODE_ENV !== "production";
}

/**
 * Starts or resumes a guest session: the cookie's demo organizer keeps its event, and a visitor
 * without one gets a fresh id, a published event from the seed, and the cookie. `?autoplay=1`
 * carries through to the dashboard so the tour runs on its own. A signed-in
 * organizer already runs the real flow, so that request goes to the event list instead.
 */
export async function GET(request: NextRequest) {
  // A browser prefetching the typed address would mint a second demo id and overwrite the cookie the
  // real navigation sets, so a prefetch gets an empty answer and no cookie.
  if (isPrefetch(request)) return new NextResponse(null, { status: 204 });
  try {
    const caller = await currentCaller();
    if (caller && !caller.is_demo && !caller.is_local) return NextResponse.redirect(new URL("/events", publicOrigin(request)));
    if (usesMemory()) sweepDemoState();
    const demoId = demoIdFromCookie(request.cookies.get(DEMO_COOKIE)?.value) ?? newDemoId();
    const eventId = await demoEventFor(demoId);
    const target = new URL(`/events/${eventId}?demo=1`, publicOrigin(request));
    if (request.nextUrl.searchParams.get("autoplay") === "1") target.searchParams.set("autoplay", "1");
    const response = NextResponse.redirect(target);
    response.cookies.set(DEMO_COOKIE, demoCookieValue(demoId), demoCookieOptions());
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}

/** The origin a redirect should carry: the configured public URL, since the standalone server reports its bind address in request.url. */
function publicOrigin(request: Request): string {
  return process.env.APP_URL || process.env.AUTH_URL ? appOrigin() : new URL(request.url).origin;
}

/** Chrome and Safari mark a speculative fetch with Sec-Purpose or Purpose. */
function isPrefetch(request: NextRequest): boolean {
  const purpose = `${request.headers.get("sec-purpose") ?? ""} ${request.headers.get("purpose") ?? ""}`.toLowerCase();
  return purpose.includes("prefetch") || purpose.includes("prerender");
}
