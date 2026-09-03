import { NextResponse } from "next/server";
import { publicOrigin } from "../../../server/request-mail";
import { STORE_COOKIE, storeCookieOptions, storeSessionFrom } from "../../../server/store-session";

type Params = { params: Promise<{ token: string }> };

/**
 * The store's signed link (#47): a valid token sets the store session cookie and opens the grant's
 * page. An altered or outdated token sets nothing and lands on the same path, where the missing
 * session renders the not-found page.
 */
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const session = storeSessionFrom(token);
  const response = NextResponse.redirect(new URL(`/store/${encodeURIComponent(session?.grant_id ?? "none")}`, publicOrigin(request)));
  if (session) response.cookies.set(STORE_COOKIE, token, storeCookieOptions(session));
  return response;
}
