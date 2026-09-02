/**
 * The signed demo token on the client: `/demo` puts the demo cookie's value in the event URL as `t`,
 * and every request a demo page makes repeats it in a header, so a browser that drops the cookie
 * keeps its guest session. The server verifies the header the way it verifies the cookie.
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

/** The same-origin path with the page's demo token kept, so a navigation from a demo page stays in the guest session. */
export function withDemoToken(path: string): string {
  const token = demoToken();
  if (!token) return path;
  const url = new URL(path, window.location.origin);
  url.searchParams.set(DEMO_TOKEN_PARAM, token);
  return `${url.pathname}${url.search}${url.hash}`;
}
