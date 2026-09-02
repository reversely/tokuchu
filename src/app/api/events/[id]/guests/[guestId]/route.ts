import { NextResponse } from "next/server";
import { errorResponse, guestView } from "../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../server/ownership";

type Params = { params: Promise<{ id: string; guestId: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id, guestId } = await params;
    return await withOwnedEvent(id, async () => {
      const fields = new URL(request.url).searchParams.get("fields")?.split(",").filter(Boolean);
      return NextResponse.json(guestView(id, guestId, fields));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
