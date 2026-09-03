import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../../server/ownership";
import { fulfillmentManifest } from "../../../../../../../server/procurement";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The organizer's view of the fulfillment manifest (get_fulfillment_manifest); a token holder reads it over the MCP endpoint under the token's scope. */
export async function GET(_: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => NextResponse.json(fulfillmentManifest(id, giftId)));
  } catch (e) {
    return errorResponse(e);
  }
}
