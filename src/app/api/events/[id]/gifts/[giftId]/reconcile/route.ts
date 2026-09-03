import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../../server/ownership";
import { continueAfterSchemaChange, reconciliationView } from "../../../../../../../server/reconcile-api";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The stored reconciliation for the gift's current schema version: the decision per requirement with who confirmed it, and the change from the version before (#51). */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => NextResponse.json(reconciliationView(id, giftId)));
  } catch (e) {
    return errorResponse(e);
  }
}

/** The organizer continues past a schema change: the change is marked seen and the request step runs again. */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => NextResponse.json(await continueAfterSchemaChange(id, giftId)));
  } catch (e) {
    return errorResponse(e);
  }
}
