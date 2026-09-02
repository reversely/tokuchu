import { NextResponse } from "next/server";
import { publishEvent } from "../../../../../domain/store";
import { errorResponse, requireEvent } from "../../../../../server/api";
import { withPersistedEvent } from "../../../../../server/persistence";

type Params = { params: Promise<{ id: string }> };

/** Publishes the event and mints the invite code. */
export async function POST(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withPersistedEvent(id, async () => {
      const event = publishEvent(requireEvent(id).id);
      return NextResponse.json({ event, invite_path: `/i/${event.invite_code}` });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
