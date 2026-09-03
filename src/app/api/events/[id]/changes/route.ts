import { NextResponse } from "next/server";
import { changeReader, changes, errorResponse } from "../../../../../server/api";
import { withOwnedEvent } from "../../../../../server/ownership";

type Params = { params: Promise<{ id: string }> };

/** `?gift=<id>&after=<revision>` (get_changes): a gift's changes after a revision; `?since=<seq>` alone: the event's whole change log after a sequence number. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withOwnedEvent(id, async () => {
      const query = new URL(request.url).searchParams;
      const gift = query.get("gift");
      if (gift) return NextResponse.json(changeReader(id, gift, Number(query.get("after") ?? "0") || 0));
      const since = Number(query.get("since") ?? "0");
      return NextResponse.json(changes(id, Number.isNaN(since) ? 0 : since));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
