import { NextResponse } from "next/server";
import { errorResponse } from "../../../server/api";
import { tickAll } from "../../../server/tick";

/**
 * The cron entry for the scheduled actions (#33): one sweep over every event's due schedules.
 * With `TICK_SECRET` set the request carries it as a bearer token; without it any caller may tick,
 * which only runs what is due anyway. Returns the events visited and the runs made.
 */
export async function POST(request: Request) {
  const secret = process.env.TICK_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "The tick secret is missing or wrong" }, { status: 401 });
  try {
    return NextResponse.json(await tickAll());
  } catch (e) {
    return errorResponse(e);
  }
}
