import { NextResponse } from "next/server";
import { errorResponse, snapshot, updateEventFromBody } from "../../../../server/api";
import { withOwnedEvent } from "../../../../server/ownership";

type Params = { params: Promise<{ id: string }> };

/** The snapshot the dashboard polls: event, definitions, guests with values, counts, follow-ups, seq. */
export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(snapshot(id));
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(updateEventFromBody(id, await request.json()));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
