import { NextResponse } from "next/server";
import { approveSpecs, errorResponse } from "../../../../../../../server/api";
import { startCartFill } from "../../../../../../../server/cart-job";
import { withPersistedEvent } from "../../../../../../../server/persistence";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The organizer approves the collected attendee values: the lock makes them final and the cart job starts once this request's row is written. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withPersistedEvent(id, async () => {
      const view = approveSpecs(id, giftId);
      void startCartFill(id, giftId);
      return NextResponse.json(view);
    });
  } catch (e) {
    return errorResponse(e);
  }
}
