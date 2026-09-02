/**
 * Who may read and change an event: the organizer whose user id the event's `owner_id` names. A
 * request with no session but a signed demo cookie, or the same signed value in the demo header,
 * runs as the demo organizer that value names, in every mode. A request with none of those runs as
 * the local organizer when `DATABASE_URL` is unset
 * outside production, so the dev server and the browser suites need no sign-in. An event a signed-in
 * account owns answers such a request the way it answers a stranger, so the browser goes to sign in.
 */
import { state } from "../domain/store";
import type { Event } from "../domain/types";
import { hasDatabase } from "./db";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "./errors";
import { DEMO_HEADER } from "../demo/token";
import { DEMO_COOKIE, demoIdFromCookie } from "./demo-session";
import { withPersistedEvent } from "./persistence";

/** The user id every request without a session runs as in development. */
export const LOCAL_ORGANIZER_ID = "local-organizer";

/** The organizer a request runs as: a signed-in user, the demo organizer a cookie names, or the local organizer in development. */
export type Caller = { id: string; is_local: boolean; is_demo: boolean };

type Mode = { has_database: boolean; is_production: boolean };

type Handler<T> = () => T | Promise<T>;

declare global {
  // eslint-disable-next-line no-var
  var __tokuchuWarnedLocalOrganizer: boolean | undefined;
}

function currentMode(): Mode {
  return { has_database: hasDatabase(), is_production: process.env.NODE_ENV === "production" };
}

/** The warning fires once per process; the flag sits on `globalThis` because each route bundle loads its own copy of this module. */
function warnLocalOrganizer(): void {
  if (globalThis.__tokuchuWarnedLocalOrganizer) return;
  globalThis.__tokuchuWarnedLocalOrganizer = true;
  console.warn("No session and no DATABASE_URL; requests without a session run as the local organizer.");
}

/** The caller for a session's user id, else for a demo cookie's id, else null when the mode allows no local organizer. */
export function callerFor(userId: string | null | undefined, demoId: string | null | undefined, mode: Mode = currentMode()): Caller | null {
  if (userId) return { id: userId, is_local: false, is_demo: false };
  if (demoId) return { id: demoId, is_local: false, is_demo: true };
  if (mode.has_database || mode.is_production) return null;
  warnLocalOrganizer();
  return { id: LOCAL_ORGANIZER_ID, is_local: true, is_demo: false };
}

/**
 * Checks that the caller owns the event.
 *
 * Raises:
 *   UnauthorizedError: with no caller, or when the local organizer reaches an event an account owns.
 *   ForbiddenError: when a signed-in or demo caller does not own the event.
 */
export function assertOwner(event: Event, caller: Caller | null): void {
  if (!caller) throw new UnauthorizedError("Sign in to open this event.");
  if (event.owner_id === caller.id) return;
  if (caller.is_local) throw new UnauthorizedError("Sign in to open this event.");
  throw new ForbiddenError("This event belongs to another organizer.");
}

type Reader = () => Promise<string | null | undefined>;

let sessionReader: Reader | undefined;
let demoIdReader: Reader | undefined;

/** Test hook: the session user id reader used instead of Auth.js; null restores the default. */
export function setSessionReader(reader: Reader | null): void {
  sessionReader = reader ?? undefined;
}

/** Test hook: the demo id reader used instead of the request's cookie and header; null restores the default. */
export function setDemoIdReader(reader: Reader | null): void {
  demoIdReader = reader ?? undefined;
}

/** Auth.js loads on first use so a module that only checks ownership never pays for it. */
async function sessionUserId(): Promise<string | undefined> {
  const { currentSession } = await import("./auth");
  return (await currentSession())?.user?.id;
}

/** `next/headers` loads on first use for the same reason; the demo id comes from the cookie, else the header, and is null outside a request. */
async function requestDemoId(): Promise<string | null> {
  const { cookies, headers } = await import("next/headers");
  return demoIdFromCookie((await cookies()).get(DEMO_COOKIE)?.value) ?? demoIdFromCookie((await headers()).get(DEMO_HEADER));
}

/**
 * The caller behind the current request.
 *
 * Args:
 *   demoToken: a signed demo token the request carried outside the cookie and the header, such as
 *     the event page's `t` search param; it counts after those and before the local organizer.
 */
export async function currentCaller(demoToken?: string | null): Promise<Caller | null> {
  const userId = await (sessionReader ?? sessionUserId)();
  const demoId = userId ? null : ((await (demoIdReader ?? requestDemoId)()) ?? demoIdFromCookie(demoToken));
  return callerFor(userId, demoId);
}

/**
 * Runs the handler with `state()` bound to the stored event once the caller's ownership is checked.
 *
 * Raises:
 *   UnauthorizedError: before the event loads, when there is no caller.
 *   NotFoundError: when no event has the id.
 */
export function withEventOwnedBy<T>(caller: Caller | null, eventId: string, handler: Handler<T>): Promise<T> {
  if (!caller) return Promise.reject(new UnauthorizedError("Sign in to open this event."));
  return withPersistedEvent(eventId, () => {
    const event = state().events.get(eventId);
    if (!event) throw new NotFoundError(`No event ${eventId}.`);
    assertOwner(event, caller);
    return handler();
  });
}

/** The organizer route wrapper: the request's caller must own the event. */
export async function withOwnedEvent<T>(eventId: string, handler: Handler<T>): Promise<T> {
  return withEventOwnedBy(await currentCaller(), eventId, handler);
}
