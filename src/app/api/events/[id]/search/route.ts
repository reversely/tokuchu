import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../server/api";
import { withPersistedEvent } from "../../../../../server/persistence";
import { giftSearch, type GiftSearchBody } from "../../../../../server/search";

type Params = { params: Promise<{ id: string }> };

/** Body: { card?: string, sentence?: string, probe?: number }; the search itself lives in server/search.ts so the curation agent runs the same code path (#120). */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withPersistedEvent(id, async () => {
      return NextResponse.json(await giftSearch(id, (await request.json()) as GiftSearchBody));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
