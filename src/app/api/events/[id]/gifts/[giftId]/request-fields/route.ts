import { NextResponse } from "next/server";
import { definitionsFor } from "../../../../../../../domain/store";
import { giftRequirements, requestFromAttendees, requireGift, errorResponse } from "../../../../../../../server/api";
import { reconcileGift } from "../../../../../../../server/reconcile";
import { withOwnedEvent } from "../../../../../../../server/ownership";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The product's requirements with the source that fills each: the guest row, the event, a literal, a definition, or a question to ask. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => {
      // The model step, when the flag allows it, records its proposals once so the read below carries them.
      await reconcileGift(requireGift(id, giftId), definitionsFor(id));
      return NextResponse.json({ requirements: giftRequirements(id, giftId) });
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** The organizer requests the missing values from attendees: the questions persist on the event and each attendee gets a request row. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(await requestFromAttendees(id, giftId));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
