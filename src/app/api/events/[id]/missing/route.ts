import { NextResponse } from "next/server";
import { BadRequestError, errorResponse, missing, readFilter } from "../../../../../server/api";
import { withOwnedEvent } from "../../../../../server/ownership";

type Params = { params: Promise<{ id: string }> };

/** `?definition=def_1&filter=status:eq:going` (list_missing). */
export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withOwnedEvent(id, async () => {
      const url = new URL(request.url);
      const definition = url.searchParams.get("definition");
      if (!definition) throw new BadRequestError("definition is required.");
      return NextResponse.json(missing(id, definition, readFilter(url.searchParams.get("filter"))));
    });
  } catch (e) {
    return errorResponse(e);
  }
}
