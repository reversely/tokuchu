import { NextResponse } from "next/server";
import { errorResponse, readFilter, summary } from "../../../../../server/api";
import { withPersistedEvent } from "../../../../../server/persistence";

type Params = { params: Promise<{ id: string }> };

/** `?definitions=def_1,def_2&filter=...` (get_summary): status counts plus count_by per definition. */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withPersistedEvent(id, async () => {
      const url = new URL(request.url);
      const definitions = url.searchParams.get("definitions")?.split(",").filter(Boolean) ?? [];
      return NextResponse.json(summary(id, definitions, readFilter(url.searchParams.get("filter"))));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
