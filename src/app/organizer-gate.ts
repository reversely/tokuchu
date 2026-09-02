import { redirect } from "next/navigation";
import { currentCaller, type Caller } from "../server/ownership";

/** The caller behind an organizer page; a request with no caller goes to sign in and comes back to `next`. */
export async function callerOrSignIn(next: string): Promise<Caller> {
  const caller = await currentCaller();
  if (!caller) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return caller;
}
