import { NextResponse } from "next/server";
import { giftRequestables, requestFromAttendees, errorResponse } from "../../../../../../../server/api";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The per-attendee questions this gift implies, derived from the product the search read. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return NextResponse.json({ requestables: giftRequestables(id, giftId) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** The organizer requests those questions from attendees; they persist on the event. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return NextResponse.json(requestFromAttendees(id, giftId));
  } catch (e) {
    return errorResponse(e);
  }
}
