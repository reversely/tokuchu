import { AuthError } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { signIn } from "../../server/auth";

type Props = { searchParams: Promise<{ sent?: string; error?: string; next?: string }> };

const production = process.env.NODE_ENV === "production";
const sendsEmail = production && !!process.env.RESEND_API_KEY;
/** A dev server delivers the link to its own log; a production server without a mail key delivers it nowhere. */
const delivers = sendsEmail || !production;

/** The page the link returns to: a path on this site, or the root for anything else. */
function returnPath(next: FormDataEntryValue | string | null | undefined): string {
  const path = typeof next === "string" ? next : "";
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

/** Sends the link and lands on the confirmation; a denied address lands on the not-found page. */
async function sendLink(formData: FormData): Promise<void> {
  "use server";
  try {
    await signIn("resend", { email: String(formData.get("email") ?? ""), redirectTo: returnPath(formData.get("next")) });
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    // A denied address is a 404 with the demo link; a link the mail provider refused to send is a message here, since the address may be fine.
    redirect(`/sign-in?error=${error.type === "AccessDenied" ? "AccessDenied" : "send"}`);
  }
}

/** One field and one button: the address gets a magic link and the confirmation says where it went; a first sign-in creates the account. A denied address, or a production server with no mail key, shows the not-found page and its demo link instead of a message. */
export default async function Page({ searchParams }: Props) {
  const { sent, error, next } = await searchParams;
  if (error === "AccessDenied" || (sent && !delivers)) notFound();
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
                {error === "send" && <p className="error" role="alert" data-testid="sign-in-send-error">The sign-in email could not be sent to that address. The demo needs no account.</p>}
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input id="email" name="email" type="email" autoComplete="email" required data-testid="sign-in-email" />
                </div>
                <button className="btn primary" type="submit" data-testid="sign-in-submit">Send the link</button>
              </form>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
