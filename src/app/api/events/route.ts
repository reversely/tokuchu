import { NextResponse } from "next/server";
import { createEventFromBody, errorResponse } from "../../../server/api";
import { createPersistedEvent } from "../../../server/persistence";

/** Creates a draft event with no questions; the organizer's list arrives through PUT /definitions (PRD Section 8, Draft). */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    return await createPersistedEvent(() => NextResponse.json(createEventFromBody(body), { status: 201 }));
  } catch (e) {
    return errorResponse(e);
  }
}
