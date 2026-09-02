import { NextResponse } from "next/server";
import { deleteGift, errorResponse, giftView, updateGiftFromBody } from "../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../server/ownership";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The gift with its quantities and manifest, resolved on this read. */
export async function GET(_: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(giftView(id, giftId));
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(updateGiftFromBody(id, giftId, await request.json()));
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(deleteGift(id, giftId));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
