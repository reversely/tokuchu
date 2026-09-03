import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../server/api";
import { getGrant, revokeGrant } from "../../../../../../server/grants";
import { withOwnedEvent } from "../../../../../../server/ownership";

type Params = { params: Promise<{ id: string; grantId: string }> };

export async function GET(_: Request, { params }: Params) {
  try {
    const { id, grantId } = await params;
    return await withOwnedEvent(id, async () => NextResponse.json(getGrant(id, grantId)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** Revokes the grant: the next call on any token it authorizes answers with an error (#41). */
export async function DELETE(_: Request, { params }: Params) {
  try {
    const { id, grantId } = await params;
    return await withOwnedEvent(id, async () => NextResponse.json(revokeGrant(id, grantId)));
  } catch (e) {
    return errorResponse(e);
  }
}
