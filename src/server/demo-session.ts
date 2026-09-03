/**
 * The guest session behind `/demo`: a guest id signed with the auth secret. The signed value is
 * the guest's identity: it travels in the event URL as `t`, in a cookie set for convenience, and in
 * the demo header the page derives from the token (`src/demo/token.ts`). The id carries a fixed
 * prefix so the sweep tells a guest's rows from an account's, and the signature keeps a visitor from
 * naming another visitor's id.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { authSecret } from "./auth-secret";

export const DEMO_COOKIE = "tokuchu_demo";
export const DEMO_ID_PREFIX = "demo_";
/** A demo event and its cookie both live this long. */
export const DEMO_TTL_HOURS = 24;

/** 12 random bytes read as base64url are 16 url-safe characters. */
export function newDemoId(): string {
  return DEMO_ID_PREFIX + randomBytes(12).toString("base64url");
}

export function isDemoId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(DEMO_ID_PREFIX);
}

function sign(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("hex");
}

/** The signed value the cookie, the URL token, and the header carry: the id and its hex HMAC joined with a dot. */
export function demoCookieValue(id: string, secret = authSecret() ?? ""): string {
  return `${id}.${sign(id, secret)}`;
}

/** The demo id a signed value names, or null when the value is absent or the signature does not match. */
export function demoIdFromCookie(value: string | null | undefined, secret = authSecret() ?? ""): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const id = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "hex");
  const expected = Buffer.from(sign(id, secret), "hex");
  if (!isDemoId(id) || given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return id;
}

/** The Set-Cookie options: unreadable from scripts, sent on same-site navigations, and over HTTPS in production. */
export function demoCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: DEMO_TTL_HOURS * 60 * 60 };
}
