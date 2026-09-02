import { NextResponse } from "next/server";
import { errorResponse, inviteView } from "../../../../server/api";
import { withPersistedEventByInviteCode } from "../../../../server/persistence";

type Params = { params: Promise<{ code: string }> };

/** What the invite page shows: the event and the questions guests answer. */
export async function GET(_: Request, { params }: Params) {
  try {
    const { code } = await params;
    return await withPersistedEventByInviteCode(code, () => NextResponse.json(inviteView(code)));
  } catch (e) {
    return errorResponse(e);
  }
}
