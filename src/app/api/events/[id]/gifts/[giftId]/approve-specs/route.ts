import { NextResponse } from "next/server";
import { approveSpecs, errorResponse } from "../../../../../../../server/api";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The admin approves the collected attendee specs for the vendor; locks the values so they are final. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return NextResponse.json(approveSpecs(id, giftId));
  } catch (e) {
    return errorResponse(e);
  }
}
