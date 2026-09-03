/**
 * The signed guest token on the client: `/demo` puts the signed value in the event URL as `t`, and
 * every request a guest's page makes repeats it in a header derived from that token, so a browser
 * that drops the cookie keeps its guest session. The server verifies the header the way it verifies
 * the token.
 */

export const DEMO_HEADER = "x-tokuchu-demo";
export const DEMO_TOKEN_PARAM = "t";

/** The demo token the page's URL carries, or null on a page without one or outside a browser. */
export function demoToken(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(DEMO_TOKEN_PARAM);
}

/** The request init with the demo header added when the page carries a token. */
export function withDemoHeaders(init: RequestInit = {}): RequestInit {
  const token = demoToken();
  if (!token) return init;
  const headers = new Headers(init.headers);
  headers.set(DEMO_HEADER, token);
  return { ...init, headers };
}
