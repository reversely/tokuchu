import { NextResponse } from "next/server";
import { errorResponse, setPersonalizationMappings } from "../../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../../server/ownership";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** Stores the gift's personalization mappings (set_personalization_mapping). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(setPersonalizationMappings(id, giftId, await request.json()));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
