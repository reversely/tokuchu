import { NextResponse } from "next/server";
import { acknowledgeRevision } from "../../../../../../../server/acknowledge";
import { errorResponse } from "../../../../../../../server/api";
import { withOwnedEvent } from "../../../../../../../server/ownership";

type Params = { params: Promise<{ id: string; grantId: string }> };

/** Records the last revision a grant's holder acknowledged (#52). Body: { revision }. A token holder posts it through acknowledge_changes on the MCP endpoint. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id, grantId } = await params;
    return await withOwnedEvent(id, async () => NextResponse.json(acknowledgeRevision(id, grantId, await request.json().catch(() => ({})))));
  } catch (e) {
    return errorResponse(e);
  }
}
