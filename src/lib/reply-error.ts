/**
 * The error a failed fetch reply carries. A route answers `{ error }` as JSON; a proxy answering
 * for a restarting instance sends an empty or HTML body, which used to surface as a JSON parse
 * error. That case reads as the status and a hint to try again.
 */
export async function replyError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: string };
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `The server answered ${res.status} without a reply. It may be restarting; try again in a minute.`;
}
