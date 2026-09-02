import { NextResponse } from "next/server";
import { errorResponse, followUp } from "../../../../../../../server/api";
import { withPersistedEvent } from "../../../../../../../server/persistence";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** Sends the request again to every attendee whose request still has an unanswered question. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withPersistedEvent(id, async () => {
      return NextResponse.json(followUp(id, giftId));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
