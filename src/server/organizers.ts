/** The organizer allowlist: `ORGANIZER_EMAILS` names the addresses that may sign in; unset or empty lets any address create an account. */

/** The addresses `ORGANIZER_EMAILS` lists, lowercased. */
export function organizerEmails(list = process.env.ORGANIZER_EMAILS ?? ""): Set<string> {
  return new Set(list.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

/** The `signIn` callback: an address may sign in when the allowlist is empty or names it. */
export function allowOrganizer({ user }: { user: { email?: string | null } }, allowed = organizerEmails()): boolean {
  if (!user.email) return false;
  return allowed.size === 0 || allowed.has(user.email.toLowerCase());
}
