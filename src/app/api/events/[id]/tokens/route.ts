import { NextResponse } from "next/server";
import { errorResponse } from "../../../../../server/api";
import { withOwnedEvent } from "../../../../../server/ownership";
import { createToken, tokensFor } from "../../../../../server/mcp";

type Params = { params: Promise<{ id: string }> };

/** The organizer issues a token: holder, gifts, readable definitions, callable tools, expiry. The id is the secret. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(createToken(id, await request.json()), { status: 201 });
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withOwnedEvent(id, async () => {
      return NextResponse.json({ tokens: tokensFor(id).map(({ id, ...rest }) => ({ ...rest, id: `${id.slice(0, 6)}...` })) });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
