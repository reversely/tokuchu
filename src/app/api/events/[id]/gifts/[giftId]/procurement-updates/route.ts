import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../../server/ownership";
import { postProcurementUpdate } from "../../../../../../../server/procurement";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** A structured update from this page (post_procurement_update); the MCP endpoint posts for a token holder with the token as caller. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => {
      const body = (await request.json()) as { caller?: string };
      return NextResponse.json(await postProcurementUpdate(id, giftId, body.caller ?? "organizer", body), { status: 201 });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
