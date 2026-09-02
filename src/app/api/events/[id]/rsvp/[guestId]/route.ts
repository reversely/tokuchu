import { NextResponse } from "next/server";
import { errorResponse, guestView, patchRsvp } from "../../../../../../server/api";
import { withPersistedEvent } from "../../../../../../server/persistence";

type Params = { params: Promise<{ id: string; guestId: string }> };

/** The guest's own record for the invite link that carries the guest id: name, status, and answers. */
export async function GET(_: Request, { params }: Params) {
  try {
    const { id, guestId } = await params;
    return await withPersistedEvent(id, async () => {
      return NextResponse.json(guestView(id, guestId));
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** A guest edits or cancels; an edit after approval is accepted and marks the row changed. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, guestId } = await params;
    return await withPersistedEvent(id, async () => {
      return NextResponse.json(patchRsvp(id, guestId, await request.json()));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
