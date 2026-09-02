import { NextResponse } from "next/server";
import { errorResponse, submitRsvp } from "../../../../../server/api";
import { withPersistedEvent } from "../../../../../server/persistence";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withPersistedEvent(id, async () => {
      return NextResponse.json(submitRsvp(id, await request.json()), { status: 201 });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
