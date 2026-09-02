import { NextResponse } from "next/server";
import { errorResponse, importGuests } from "../../../../../../server/api";
import { withPersistedEvent } from "../../../../../../server/persistence";

type Params = { params: Promise<{ id: string }> };

/** The guest list: { text } with one guest per line, or { lines }. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withPersistedEvent(id, async () => {
      return NextResponse.json(importGuests(id, await request.json()), { status: 201 });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
