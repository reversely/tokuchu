import { NextResponse } from "next/server";
import { errorResponse, manifestView } from "../../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../../server/ownership";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** One row per guest: product, variant, unit status, and values (get_manifest). */
export async function GET(_: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(manifestView(id, giftId));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
