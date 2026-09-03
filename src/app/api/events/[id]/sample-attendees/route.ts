import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../server/api";
import { withOwnedEvent } from "../../../../../server/ownership";
import { loadSampleAttendees } from "../../../../../server/sample-attendees";

type Params = { params: Promise<{ id: string }> };

/** Adds the ten sample attendees to the event as going (the load_sample_attendees page tool). */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withOwnedEvent(id, async () => NextResponse.json(loadSampleAttendees(id)));
  } catch (e) {
    return errorResponse(e);
  }
}
