import { NextResponse } from "next/server";
import { errorResponse, replaceDefinitions } from "../../../../../server/api";
import { withPersistedEvent } from "../../../../../server/persistence";

type Params = { params: Promise<{ id: string }> };

/** Replaces the event's question list with the organizer's: rows keyed by `key`, options in the organizer's words. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withPersistedEvent(id, async () => {
      return NextResponse.json({ definitions: replaceDefinitions(id, await request.json()) });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
