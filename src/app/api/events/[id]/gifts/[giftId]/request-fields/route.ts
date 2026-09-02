import { NextResponse } from "next/server";
import { giftRequirements, requestFromAttendees, errorResponse } from "../../../../../../../server/api";
import { withPersistedEvent } from "../../../../../../../server/persistence";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The product's requirements with the source that fills each: the guest row, the event, a literal, a definition, or a question to ask. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withPersistedEvent(id, async () => {
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
    return await withPersistedEvent(id, async () => {
      return NextResponse.json(await requestFromAttendees(id, giftId));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
