import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../server/api";
import { setGiftCustomization } from "../../../../../../../server/customization";
import { withOwnedEvent } from "../../../../../../../server/ownership";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** Stores the store's get_customization payload on the gift (set_gift_customization, #56) and returns the gift with its quantities and manifest. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    const body = await request.json();
    return await withOwnedEvent(id, async () => NextResponse.json(setGiftCustomization(id, giftId, body)));
  } catch (e) {
    return errorResponse(e);
  }
}
