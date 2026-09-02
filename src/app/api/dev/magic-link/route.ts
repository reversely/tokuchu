import { magicLinks } from "../../../../server/auth-store";

/** Dev only: the last magic link logged for an address, so a browser test can follow it. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const email = new URL(request.url).searchParams.get("email")?.toLowerCase() ?? "";
  const url = magicLinks().get(email);
  return url ? Response.json({ url }) : new Response(null, { status: 404 });
}
