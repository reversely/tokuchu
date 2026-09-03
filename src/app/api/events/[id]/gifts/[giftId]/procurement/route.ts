import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../../server/ownership";
import { procurementSummary } from "../../../../../../../server/procurement";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The organizer's view of the Procurement summary (get_procurement); a store's holder reads it over the MCP endpoint under its grant. */
export async function GET(_: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => NextResponse.json(procurementSummary(id, giftId)));
  } catch (e) {
    return errorResponse(e);
  }
}
