import { errorResponse } from "../../../../../../../server/api";
import { csvResponse, fulfillmentCsv } from "../../../../../../../server/fulfillment-csv";
import { withOwnedEvent } from "../../../../../../../server/ownership";

type Params = { params: Promise<{ id: string; giftId: string }> };

/** The organizer's fulfilment manifest as a CSV download (#52): the same projection as get_fulfillment_manifest with every requirement. */
export async function GET(_: Request, { params }: Params) {
  try {
    const { id, giftId } = await params;
    return await withOwnedEvent(id, async () => csvResponse(fulfillmentCsv(id, giftId)));
  } catch (e) {
    return errorResponse(e);
  }
}
