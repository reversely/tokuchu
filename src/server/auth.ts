/**
 * Sign-in for organizers: Auth.js with one magic-link provider. Resend sends the link in production;
 * in development or without `RESEND_API_KEY` the link goes to the server log instead. The session
 * lives in the database when there is one and in a signed cookie otherwise.
 */
import NextAuth, { type NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";
import PostgresAdapter from "@auth/pg-adapter";
import { adapterPool, authDatabase, logMagicLink } from "./auth-store";
import { hasDatabase } from "./db";
import { allowOrganizer } from "./organizers";

const isProduction = process.env.NODE_ENV === "production";
const sendsEmail = isProduction && !!process.env.RESEND_API_KEY;

function secret(): string | undefined {
  if (process.env.AUTH_SECRET || isProduction) return process.env.AUTH_SECRET;
  console.warn("AUTH_SECRET is not set; sessions sign with a development secret.");
  return "tokuchu-development-secret";
}

export const authConfig: NextAuthConfig = {
  secret: secret(),
  adapter: PostgresAdapter(adapterPool(authDatabase)),
  // A signed cookie outlives the in-process database, so a dev session survives a restart.
  session: { strategy: hasDatabase() || isProduction ? "database" : "jwt" },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.AUTH_EMAIL_FROM ?? "Tokuchu <no-reply@tokuchu.app>",
      ...(sendsEmail ? {} : { sendVerificationRequest: logMagicLink })
    })
  ],
  pages: { signIn: "/sign-in", verifyRequest: "/sign-in?sent=1", error: "/sign-in" },
  callbacks: {
    signIn: (params) => allowOrganizer(params),
    // The database strategy carries the user row; the jwt strategy carries only the token's subject.
    session: ({ session, user, token }) => ({ ...session, user: { ...session.user, id: user?.id ?? token?.sub } })
  }
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** The signed-in session for a server component, or null. */
export const currentSession = auth;
