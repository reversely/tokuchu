import { appUrl as appOrigin } from "../../server/request-mail";
import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "../../server/api";
import { hasDatabase } from "../../server/db";
import { demoEventFor, sweepDemoState } from "../../server/demo";
import { DEMO_COOKIE, demoCookieOptions, demoCookieValue, newDemoId } from "../../server/demo-session";
import { currentCaller } from "../../server/ownership";
import { DEMO_TOKEN_PARAM } from "../../demo/token";

/** Only the in-memory store sweeps here; the database sweeps from `npm run sweep-demo`. */
function usesMemory(): boolean {
  return !hasDatabase() && process.env.NODE_ENV !== "production";
}

/**
 * Opens the caller's demo event. A signed-in organizer gets the demo event under the account. A
 * visitor without a session runs as the guest the `t` token, the cookie, or the demo header names,
 * or as a fresh guest id, and gets the seeded event and the cookie; the redirect repeats the signed
 * value as `t` so a browser that drops the cookie still reaches its event. `?autoplay=1` carries
 * through so the tour runs on its own.
 */
export async function GET(request: NextRequest) {
  // A browser prefetching the typed address would mint a second guest id and overwrite the cookie the
  // real navigation sets, so a prefetch gets an empty answer and no cookie.
  if (isPrefetch(request)) return new NextResponse(null, { status: 204 });
  try {
    if (usesMemory()) sweepDemoState();
    // The caller already reads the token, the cookie, and the header; a consumed or forged token names no guest, so the visit mints a fresh one.
    const caller = await currentCaller(request.nextUrl.searchParams.get(DEMO_TOKEN_PARAM));
    const isAccount = !!caller && !caller.is_demo && !caller.is_local;
    const ownerId = caller?.is_demo || isAccount ? caller.id : newDemoId();
    const eventId = await demoEventFor(ownerId);
    const target = new URL(`/events/${eventId}`, publicOrigin(request));
    if (request.nextUrl.searchParams.get("autoplay") === "1") target.searchParams.set("autoplay", "1");
    if (isAccount) return NextResponse.redirect(target);
    const token = demoCookieValue(ownerId);
    target.searchParams.set(DEMO_TOKEN_PARAM, token);
    const response = NextResponse.redirect(target);
    response.cookies.set(DEMO_COOKIE, token, demoCookieOptions());
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
