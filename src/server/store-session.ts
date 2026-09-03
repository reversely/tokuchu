/**
 * The store's session behind `/s/{token}` (#47): the grant a link names, signed with the auth secret
 * the way the demo guest's id is (demo-session.ts). The signed value carries the event, the grant,
 * and the link's expiry, so the page loads the right document and a forged or outdated link opens
 * nothing. The value travels in the link and then in a cookie; the grant itself decides on every
 * render whether the holder still sees anything. No store account stands behind it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AccessGrant } from "../domain/types";
import { authSecret } from "./auth-secret";

export const STORE_COOKIE = "tokuchu_store";
/** A link without a grant expiry lives this long. */
export const STORE_LINK_TTL_HOURS = 24 * 30;

export type StoreSession = { event_id: string; grant_id: string; expires_at: number };

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** The signed value: the session as base64url JSON and its hex HMAC joined with a dot. */
export function storeLinkToken(session: StoreSession, secret = authSecret() ?? ""): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** The session a signed value names, or null when the value is absent, altered, or past its expiry. */
export function storeSessionFrom(value: string | null | undefined, secret = authSecret() ?? "", now = Date.now()): StoreSession | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "hex");
  const expected = Buffer.from(sign(payload, secret), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let session: StoreSession;
  try {
    session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as StoreSession;
  } catch {
    return null;
  }
  if (typeof session?.event_id !== "string" || typeof session.grant_id !== "string" || typeof session.expires_at !== "number") return null;
  if (session.expires_at <= now) return null;
  return session;
}

/** The link's expiry: the grant's own when it comes sooner than the link's fixed life. */
function linkExpiry(grant: AccessGrant, now: number): number {
  const fixed = now + STORE_LINK_TTL_HOURS * 60 * 60 * 1000;
  return grant.expires_at ? Math.min(fixed, Date.parse(grant.expires_at)) : fixed;
}

/** The path a store opens for the grant: `/s/{token}`. */
export function storeLinkPath(grant: AccessGrant, now = Date.now()): string {
  return `/s/${storeLinkToken({ event_id: grant.event_id, grant_id: grant.id, expires_at: linkExpiry(grant, now) })}`;
}

/** The Set-Cookie options: unreadable from scripts, sent on same-site navigations, over HTTPS in production, and gone with the link. */
export function storeCookieOptions(session: StoreSession, now = Date.now()) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: Math.max(0, Math.floor((session.expires_at - now) / 1000)) };
}
