import { NextResponse } from "next/server";
import { createEventFromBody, errorResponse } from "../../../server/api";
import { guestKeepPath, signInPath } from "../../../server/demo";
import { UnauthorizedError } from "../../../server/errors";
import { currentCaller } from "../../../server/ownership";
import { createPersistedEvent, listOwnedEvents } from "../../../server/persistence";

/** The caller's events: id, title, status, invite code, the last write, and whether each is the demo. */
export async function GET() {
  try {
    const caller = await currentCaller();
    if (!caller) throw new UnauthorizedError("Sign in to list your events.");
    return NextResponse.json({ events: await listOwnedEvents(caller.id) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * Creates a draft event the caller owns with no questions; the organizer's list arrives through
 * PUT /definitions (PRD Section 8, Draft). A guest holds the demo event only: the answer names the
 * sign-in page that keeps it.
 */
export async function POST(request: Request) {
  try {
    const caller = await currentCaller();
    if (!caller) throw new UnauthorizedError("Sign in to create an event.");
    if (caller.is_demo) return NextResponse.json({ error: "Create an account to keep this event.", sign_in: signInPath(await guestKeepPath(caller.id)) }, { status: 401 });
    const body = await request.json();
    return await createPersistedEvent(() => NextResponse.json(createEventFromBody(body, caller.id), { status: 201 }));
  } catch (e) {
    return errorResponse(e);
  }
}
