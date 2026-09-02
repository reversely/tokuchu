import { NextResponse } from "next/server";
import { createGiftFromBody, errorResponse, requireEvent } from "../../../../../server/api";
import { withStoreCustomization } from "../../../../../server/customization";
import { withOwnedEvent } from "../../../../../server/ownership";
import { giftsFor, quantities } from "../../../../../domain/gifts";

type Params = { params: Promise<{ id: string }> };

/** Every gift on the event with its derived quantities. */
export async function GET(_: Request, { params }: Params) {
  try {
    const { id } = await params;
    return await withOwnedEvent(id, async () => {
      requireEvent(id);
      return NextResponse.json({ gifts: giftsFor(id).map((g) => ({ ...g, quantities: quantities(g) })) });
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Stores a gift plan (set_gift_plan) and returns it with the quantities per variant. A product of a shop that answers the merchant tools takes the store's fields and variants first; that read runs before the event loads so the row is not held open for a browser. */
export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await withStoreCustomization(await request.json());
    return await withOwnedEvent(id, async () => {
      return NextResponse.json(createGiftFromBody(id, body), { status: 201 });
    });
  } catch (e) {
    return errorResponse(e);
  }
}
