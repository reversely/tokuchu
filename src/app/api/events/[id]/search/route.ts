import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../server/api";
import { staticMode } from "../../../../../server/flags";
import { withOwnedEvent } from "../../../../../server/ownership";
import { giftSearch, type GiftSearchBody } from "../../../../../server/search";

type Params = { params: Promise<{ id: string }> };

/** Body: { card?: string, sentence?: string, probe?: number }; the search itself lives in server/search.ts so the curation agent runs the same code path (#120). Static mode answers 501 before reading the body (#56). */
export async function POST(request: Request, { params }: Params) {
  if (staticMode()) return NextResponse.json({ error: "search_gifts is off in static mode; the agent picks the product on the store's page and names it in set_gift_plan." }, { status: 501 });
  try {
    const { id } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(await giftSearch(id, (await request.json()) as GiftSearchBody));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
