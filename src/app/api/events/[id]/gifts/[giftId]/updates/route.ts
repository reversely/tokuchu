import { NextResponse } from "next/server";
import { errorResponse, postUpdate, updatesFor } from "../../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../../server/ownership";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The progress log for one gift (get_updates). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => {
      const since = Number(new URL(request.url).searchParams.get("since") ?? "0");
      return NextResponse.json({ updates: updatesFor(id, giftId, Number.isNaN(since) ? 0 : since) });
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** A post into the gift's progress log from this page; the MCP endpoint posts for a token holder with the token as caller. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => {
      const body = (await request.json()) as { caller?: string };
      return NextResponse.json(postUpdate(id, giftId, body.caller ?? "organizer", body), { status: 201 });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
