/** The organizer allowlist: `ORGANIZER_EMAILS` decides which addresses may sign in. */

/** The addresses `ORGANIZER_EMAILS` lists, lowercased. */
export function organizerEmails(list = process.env.ORGANIZER_EMAILS ?? ""): Set<string> {
  return new Set(list.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

/** The `signIn` callback: an address on the allowlist may sign in and any other address is denied. */
export function allowOrganizer({ user }: { user: { email?: string | null } }, allowed = organizerEmails()): boolean {
  return !!user.email && allowed.has(user.email.toLowerCase());
}
