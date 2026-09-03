import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../server/api";
import { createGrant, grantView, grantsFor } from "../../../../../server/grants";
import { withOwnedEvent } from "../../../../../server/ownership";

type Params = { params: Promise<{ id: string }> };

/** The organizer grants an outside party access to one procurement: grantee, permissions, allowed attributes, expiry. The answer carries the signed link the store opens. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withOwnedEvent(id, async () => {
      const grant = createGrant(id, await request.json());
      return NextResponse.json(grantView(grant), { status: 201 });
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const procurementId = new URL(request.url).searchParams.get("procurement") ?? undefined;
    return await withOwnedEvent(id, async () => NextResponse.json({ grants: grantsFor(id, procurementId).map(grantView) }));
  } catch (e) {
    return errorResponse(e);
  }
}
