/**
 * What the store-facing page shows for one grant (#47): the Procurement, and then each block the
 * grant's permissions allow, cut to the definitions the grant lets the holder read. The page's
 * tools and its update form call the MCP endpoint with the grant's token, so the token id travels
 * with the view.
 */
import type { AccessGrant, GrantPermission, ProcurementException, VendorUpdate } from "../domain/types";
import { giftRequirements, requireEvent, updatesFor, type Requirement } from "./api";
import { getGrant, grantStatus, tokenForGrant, tokenScope } from "./grants";
import { NotFoundError } from "./errors";
import { fulfillmentManifest, procurementSummary, visibleExceptions, type FulfillmentManifest, type ProcurementSummary } from "./procurement";

export type StoreView = {
  grant: Pick<AccessGrant, "id" | "grantee_type" | "grantee_id" | "permissions" | "expires_at">;
  token_id: string;
  /** The tools the grant's token may call, for the page's registration. */
  tools: string[];
  event: { id: string; title: string; starts_at: string };
  procurement: ProcurementSummary;
  manifest: FulfillmentManifest | null;
  requirements: Requirement[] | null;
  exceptions: ProcurementException[] | null;
  updates: VendorUpdate[] | null;
};

/**
 * The view for an active grant.
 *
 * Raises:
 *   NotFoundError: when the grant is not on the event, or is revoked or expired.
 */
export function storeView(eventId: string, grantId: string): StoreView {
  const event = requireEvent(eventId);
  const grant = getGrant(eventId, grantId);
  if (grantStatus(grant) !== "active") throw new NotFoundError(`Grant ${grantId} is ${grantStatus(grant)}.`);
  const token = tokenForGrant(eventId, grantId);
  const scope = tokenScope(grant);
  const may = (permission: GrantPermission) => grant.permissions.includes(permission);
  const readable = scope.readable_definition_ids;
  const giftId = grant.procurement_id;
  return {
    grant: { id: grant.id, grantee_type: grant.grantee_type, grantee_id: grant.grantee_id, permissions: grant.permissions, expires_at: grant.expires_at },
    token_id: token.id,
    tools: scope.callable_tools,
    event: { id: event.id, title: event.title, starts_at: event.starts_at },
    procurement: procurementSummary(eventId, giftId, readable),
    manifest: may("manifest:read") ? fulfillmentManifest(eventId, giftId, readable) : null,
    requirements: may("requirements:read") ? giftRequirements(eventId, giftId).filter((r) => !r.definition_id || readable.includes(r.definition_id)) : null,
    exceptions: may("manifest:read") ? visibleExceptions(eventId, giftId, readable) : null,
    updates: may("updates:read") ? updatesFor(eventId, giftId) : null
  };
}
