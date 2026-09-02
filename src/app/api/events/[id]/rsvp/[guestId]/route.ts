import { NextResponse } from "next/server";
import { errorResponse, patchRsvp } from "../../../../../../server/api";
import { withPersistedEvent } from "../../../../../../server/persistence";

type Params = { params: Promise<{ id: string; guestId: string }> };

/** A guest edits or cancels; a locked value answers 409 with the lock. */
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
