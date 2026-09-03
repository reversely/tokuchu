import { currentSession, signOut } from "../server/auth";

/** The band's sign-in state: the signed-in address with a sign-out control, or a link to sign in. */
export async function SessionPill() {
  const session = await currentSession();
  const email = session?.user?.email;
  if (!email) return <a className="btn ghost small" href="/sign-in" data-testid="sign-in-link">Sign in</a>;
  return (
    <form
      className="session"
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <span className="pill" data-testid="session-email">{email}</span>
      <button className="btn ghost small" type="submit" data-testid="sign-out">Sign out</button>
    </form>
  );
}

/** The band for a guest: the demo label and the one action that keeps the event under a new account. */
export function GuestPill({ signIn }: { signIn: string }) {
  return (
    <span className="session">
      <span className="pill" data-testid="guest-pill">Guest demo</span>
      <a className="btn ghost small" href={signIn} data-testid="keep-event-link">Create an account to keep this event</a>
    </span>
  );
}
