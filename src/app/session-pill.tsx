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
