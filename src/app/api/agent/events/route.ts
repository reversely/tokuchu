import { NextResponse, type NextRequest } from "next/server";
import { createEventForAgent } from "../../../../server/agent-events";
import { errorResponse } from "../../../../server/api";
import { DEMO_COOKIE, demoCookieOptions, demoCookieValue, newDemoId } from "../../../../server/demo-session";
import { currentCaller } from "../../../../server/ownership";
import { createPersistedEvent } from "../../../../server/persistence";
import { publicOrigin } from "../../../../server/request-mail";

/**
 * The landing page's create_event tool: creates and publishes an event with its guest list for the
 * caller, or for a new demo guest when the browser has no session, and sets that guest's cookie so
 * the page's later calls own the event.
 */
export async function POST(request: NextRequest) {
  try {
    const caller = await currentCaller();
    const isAccount = !!caller && !caller.is_demo && !caller.is_local;
    const ownerId = caller?.id ?? newDemoId();
    const body = await request.json();
    const created = await createPersistedEvent(() => createEventForAgent(body, ownerId, isAccount || !!caller?.is_local, publicOrigin(request)));
    const response = NextResponse.json(created, { status: 201 });
    if (!isAccount && !caller?.is_local) response.cookies.set(DEMO_COOKIE, demoCookieValue(ownerId), demoCookieOptions());
    return response;
  } catch (e) {
    return errorResponse(e);
  }
}
