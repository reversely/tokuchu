/**
 * The secret every signed cookie shares: the Auth.js session and the demo session. Production reads
 * `AUTH_SECRET` as it is; development falls back to a fixed string and says so once.
 */
declare global {
  // eslint-disable-next-line no-var
  var __tokuchuWarnedAuthSecret: boolean | undefined;
}

const DEVELOPMENT_SECRET = "tokuchu-development-secret"; // pragma: allowlist secret

/** The warning fires once per process; the flag sits on `globalThis` because each route bundle loads its own copy of this module. */
function warnDevelopmentSecret(): void {
  if (globalThis.__tokuchuWarnedAuthSecret) return;
  globalThis.__tokuchuWarnedAuthSecret = true;
  console.warn("AUTH_SECRET is not set; sessions sign with a development secret.");
}

/** `AUTH_SECRET`, or the development secret outside production; undefined in production without one so Auth.js refuses to start. */
export function authSecret(): string | undefined {
  if (process.env.AUTH_SECRET || process.env.NODE_ENV === "production") return process.env.AUTH_SECRET;
  warnDevelopmentSecret();
  return DEVELOPMENT_SECRET;
}
