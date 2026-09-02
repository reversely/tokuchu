/**
 * Outbound email. Resend carries a message when `RESEND_API_KEY` is set and the process runs in
 * production or with `MAIL_LIVE=1`; any other process writes one line per message to the server log,
 * so a dev server sends nothing and still shows the link each message carried.
 */

export type MailMessage = { to: string; subject: string; text: string; html?: string };

/** How a message left the process: through the provider or into the log. */
export type MailDelivery = "sent" | "logged";

export interface Mailer {
  send(message: MailMessage): Promise<MailDelivery>;
}

type MailEnv = { RESEND_API_KEY?: string; AUTH_EMAIL_FROM?: string; NODE_ENV?: string; MAIL_LIVE?: string };

const DEFAULT_FROM = "Tokuchu <no-reply@tokuchu.app>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** The first http(s) URL in a body, so the log line shows the link without reprinting the body. */
function firstLink(text: string): string {
  return text.match(/https?:\/\/\S+/)?.[0] ?? "";
}

/** The dev mailer: one line per message with the recipient, the subject, and the link. */
export function logMailer(): Mailer {
  return {
    async send({ to, subject, text }) {
      console.info(`Mail to ${to}: ${subject} ${firstLink(text)}`.trimEnd());
      return "logged";
    }
  };
}

/**
 * The production mailer over Resend's REST API.
 *
 * Raises:
 *   Error: when Resend rejects the message; the body's message text is carried when it has one.
 */
export function resendMailer(apiKey: string, from: string = DEFAULT_FROM): Mailer {
  return {
    async send(message) {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, ...message })
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Resend answered ${response.status}.`);
      }
      return "sent";
    }
  };
}

/** The mailer the environment calls for: Resend only with a key and a live process. */
export function chooseMailer(env: MailEnv = process.env): Mailer {
  const live = env.NODE_ENV === "production" || env.MAIL_LIVE === "1";
  return env.RESEND_API_KEY && live ? resendMailer(env.RESEND_API_KEY, env.AUTH_EMAIL_FROM || DEFAULT_FROM) : logMailer();
}

let current: Mailer | null = null;

/** The process's mailer, chosen once on first use. */
export function mailer(): Mailer {
  return (current ??= chooseMailer());
}

/** Replaces the process's mailer; `null` returns to the environment's choice on the next call. */
export function setMailer(replacement: Mailer | null): void {
  current = replacement;
}
