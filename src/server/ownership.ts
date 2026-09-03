/**
 * Who may read and change an event: the organizer whose user id the event's `owner_id` names. A
 * request resolves to a session user first, then to the guest a signed demo token names (in the URL,
 * the cookie, or the demo header), then, when `DATABASE_URL` is unset outside production, to the
 * local organizer, so the dev server and the browser suites need no sign-in. A request that carries
 * a session and a guest token hands the guest's events to the account and consumes the guest id.
 */
import { state } from "../domain/store";
import { hasDatabase } from "./db";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "./errors";
import { DEMO_HEADER } from "../demo/token";
import { DEMO_COOKIE, demoIdFromCookie } from "./demo-session";
import { handOffGuest, isConsumedGuest } from "./handoff";
import { withPersistedEvent } from "./persistence";

/** The user id every request without a session runs as in development. */
export const LOCAL_ORGANIZER_ID = "local-organizer";

/** The organizer a request runs as: a signed-in user, the guest a token names, or the local organizer in development. */
export type Caller = { id: string; is_local: boolean; is_demo: boolean };

/** What a caller may do with an event: open it, or the refusal the page or route answers with. */
export type Access = { kind: "allowed" } | { kind: "sign_in" } | { kind: "forbidden" } | { kind: "not_found" };

type Refusal = Exclude<Access, { kind: "allowed" }>;

type Opened<T> = { kind: "allowed"; value: T } | Refusal;

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

/** The caller for a session's user id, else for a guest id, else null when the mode allows no local organizer. */
export function callerFor(userId: string | null | undefined, guestId: string | null | undefined, mode: Mode = currentMode()): Caller | null {
  if (userId) return { id: userId, is_local: false, is_demo: false };
  if (guestId) return { id: guestId, is_local: false, is_demo: true };
  if (mode.has_database || mode.is_production) return null;
  warnLocalOrganizer();
  return { id: LOCAL_ORGANIZER_ID, is_local: true, is_demo: false };
}

/**
 * The access the caller has to the event in the current State. The local organizer meets an
 * account's event the way a stranger does, so the browser goes to sign in.
 */
export function resolveAccess(eventId: string, caller: Caller | null): Access {
  if (!caller) return { kind: "sign_in" };
  const event = state().events.get(eventId);
  if (!event) return { kind: "not_found" };
  if (event.owner_id === caller.id) return { kind: "allowed" };
  return caller.is_local ? { kind: "sign_in" } : { kind: "forbidden" };
}

type Reader = () => Promise<string | null | undefined>;

let sessionReader: Reader | undefined;
let demoIdReader: Reader | undefined;

/** Test hook: the session user id reader used instead of Auth.js; null restores the default. */
export function setSessionReader(reader: Reader | null): void {
  sessionReader = reader ?? undefined;
}

/** Test hook: the guest id reader used instead of the request's cookie and header; null restores the default. */
export function setDemoIdReader(reader: Reader | null): void {
  demoIdReader = reader ?? undefined;
}

/** Auth.js loads on first use so a module that only checks ownership never pays for it. */
async function sessionUserId(): Promise<string | undefined> {
  const { currentSession } = await import("./auth");
  return (await currentSession())?.user?.id;
}

/** `next/headers` loads on first use for the same reason; the guest id comes from the cookie, else the header, and is null outside a request. */
async function requestDemoId(): Promise<string | null> {
  const { cookies, headers } = await import("next/headers");
  return demoIdFromCookie((await cookies()).get(DEMO_COOKIE)?.value) ?? demoIdFromCookie((await headers()).get(DEMO_HEADER));
}

/**
 * The caller behind the current request. A session beside a guest token hands the guest's events to
 * the account once; a consumed guest id names no caller.
 *
 * Args:
 *   demoToken: a signed guest token the request carried outside the cookie and the header, such as
 *     the event page's `t` search param.
 */
export async function currentCaller(demoToken?: string | null): Promise<Caller | null> {
  const userId = await (sessionReader ?? sessionUserId)();
  const guestId = demoIdFromCookie(demoToken) ?? (await (demoIdReader ?? requestDemoId)()) ?? null;
  if (userId && guestId) await handOffGuest(guestId, userId);
  if (userId) return callerFor(userId, null);
  return callerFor(null, guestId && !(await isConsumedGuest(guestId)) ? guestId : null);
}

/**
 * Loads the event and runs the handler under it when the caller may open it; otherwise the refusal.
 * A caller-less request is refused before the row loads.
 */
export async function openEvent<T>(caller: Caller | null, eventId: string, handler: Handler<T>): Promise<Opened<T>> {
  if (!caller) return { kind: "sign_in" };
  let loaded = false;
  try {
    return await withPersistedEvent(eventId, async () => {
      loaded = true;
      const access = resolveAccess(eventId, caller);
      return access.kind === "allowed" ? { kind: "allowed", value: await handler() } : access;
    });
  } catch (e) {
    // The persisted loader reports a missing row; a NotFoundError from inside the handler passes through.
    if (!loaded && e instanceof NotFoundError) return { kind: "not_found" };
    throw e;
  }
}

function errorFor(refusal: Refusal, eventId: string): Error {
  if (refusal.kind === "sign_in") return new UnauthorizedError("Sign in to open this event.");
  if (refusal.kind === "forbidden") return new ForbiddenError("This event belongs to another organizer.");
  return new NotFoundError(`No event ${eventId}.`);
}

/**
 * Runs the handler with `state()` bound to the stored event once the caller's access is resolved.
 *
 * Raises:
 *   UnauthorizedError: with no caller, or when the local organizer reaches an event an account owns.
 *   ForbiddenError: when a signed-in or guest caller does not own the event.
 *   NotFoundError: when no event has the id.
 */
export async function withEventOwnedBy<T>(caller: Caller | null, eventId: string, handler: Handler<T>): Promise<T> {
  const opened = await openEvent(caller, eventId, handler);
  if (opened.kind === "allowed") return opened.value;
  throw errorFor(opened, eventId);
}

/** The organizer route wrapper: the request's caller must own the event. */
export async function withOwnedEvent<T>(eventId: string, handler: Handler<T>): Promise<T> {
  return withEventOwnedBy(await currentCaller(), eventId, handler);
}
