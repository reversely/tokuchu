import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../../../server/ownership";
import { confirmRequirementFromBody } from "../../../../../../../../server/reconcile-api";

type Params = { params: Promise<{ id: string; giftId: string; requirementKey: string }> };

/** The organizer confirms one requirement's mapping (#51). Body: { attribute_id } to map an existing question, or { create: true } to ask attendees a new one. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, giftId, requirementKey } = await params;
    return await withOwnedEvent(id, async () => NextResponse.json(confirmRequirementFromBody(id, giftId, decodeURIComponent(requirementKey), await request.json().catch(() => ({})))));
  } catch (e) {
    return errorResponse(e);
  }
}
