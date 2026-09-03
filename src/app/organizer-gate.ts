import { redirect } from "next/navigation";
import { guestKeepPath, signInPath } from "../server/demo";
import { currentCaller, type Caller } from "../server/ownership";

/**
 * The account behind an organizer page. A request with no caller goes to sign in and comes back to
 * `next`; a guest goes to sign in and comes back to its demo event with its token, so the first
 * signed-in request hands the event to the new account.
 */
export async function accountOrSignIn(next: string): Promise<Caller> {
  const caller = await currentCaller();
  if (!caller) redirect(signInPath(next));
  if (caller.is_demo) redirect(signInPath(await guestKeepPath(caller.id)));
  return caller;
}
