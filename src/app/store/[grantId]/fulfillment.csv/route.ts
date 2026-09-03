import { cookies } from "next/headers";
import { NotFoundError } from "../../../../server/errors";
import { csvResponse, fulfillmentCsv } from "../../../../server/fulfillment-csv";
import { getGrant, grantStatus, readableDefinitionIds } from "../../../../server/grants";
import { withPersistedEvent } from "../../../../server/persistence";
import { STORE_COOKIE, storeSessionFrom } from "../../../../server/store-session";

type Params = { params: Promise<{ grantId: string }> };

/**
 * The grant holder's fulfilment manifest as a CSV download (#52), under the store session the signed
 * link set: the same projection and the same grant filter as get_fulfillment_manifest, so the file
 * carries only the requirements the grant lets the holder read. A missing session, another grant's
 * session, a grant without manifest:read, and a revoked or expired grant each answer not found.
 */
export async function GET(_: Request, { params }: Params) {
  const { grantId } = await params;
  const session = storeSessionFrom((await cookies()).get(STORE_COOKIE)?.value);
  if (!session || session.grant_id !== grantId) return new Response("Not found", { status: 404 });
  try {
    return await withPersistedEvent(session.event_id, () => {
      const grant = getGrant(session.event_id, grantId);
      if (grantStatus(grant) !== "active" || !grant.permissions.includes("manifest:read")) throw new NotFoundError(`Grant ${grantId} has no manifest to export.`);
      return csvResponse(fulfillmentCsv(session.event_id, grant.procurement_id, readableDefinitionIds(grant)));
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
