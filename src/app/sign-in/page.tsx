import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn } from "../../server/auth";

type Props = { searchParams: Promise<{ sent?: string; error?: string; next?: string }> };

const sendsEmail = process.env.NODE_ENV === "production" && !!process.env.RESEND_API_KEY;

/** The page the link returns to: a path on this site, or the root for anything else. */
function returnPath(next: FormDataEntryValue | string | null | undefined): string {
  const path = typeof next === "string" ? next : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

/** Sends the link and lands on the confirmation; a denied address lands back here with the reason. */
async function sendLink(formData: FormData): Promise<void> {
  "use server";
  try {
    await signIn("resend", { email: String(formData.get("email") ?? ""), redirectTo: returnPath(formData.get("next")) });
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    redirect(`/sign-in?error=${error.type}`);
  }
}

/** One field and one button: the address gets a magic link and the confirmation says where it went; a first sign-in creates the account. */
export default async function Page({ searchParams }: Props) {
  const { sent, error, next } = await searchParams;
  return (
    <>
      <header className="band">
        <a className="brand" href="/">Tokuchu</a>
      </header>
      <main className="sheet">
        <div className="wrap" style={{ gridTemplateColumns: "minmax(0, 480px)", justifyContent: "center" }}>
          <div>
            <h1 className="title">Sign in</h1>
            {sent ? (
              <p className="lead" data-testid="sign-in-sent">{sendsEmail ? "Check your email for the sign-in link" : "The sign-in link is in the server log"}</p>
            ) : (
              <form action={sendLink}>
                <p className="lead" data-testid="sign-in-lead">Enter your email to get a sign-in link. A first sign-in creates your account.</p>
                <p className="lead"><a href="/demo" data-testid="sign-in-demo">Try the demo</a> without an account</p>
                <input type="hidden" name="next" value={returnPath(next)} />
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input id="email" name="email" type="email" autoComplete="email" required data-testid="sign-in-email" />
                </div>
                {error && <p className="error" role="alert" data-testid="sign-in-error">{error === "AccessDenied" ? "This address is not on the organizer list" : "The sign-in link did not work"}</p>}
                <button className="btn primary" type="submit" data-testid="sign-in-submit">Send the link</button>
              </form>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
