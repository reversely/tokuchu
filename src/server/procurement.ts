/**
 * The procurement projection a store's agent reads (get_fulfillment_manifest): one row per
 * attendee the gift serves, with the values keyed by the store's requirement key and the issues
 * per requirement, cut to what the caller's token may read. The gift is the procurement until a
 * Procurement record exists.
 */
import { manifest, type ManifestRow } from "../domain/gifts";
import type { PersonalizationIssue } from "../domain/personalization";
import { requirementKeys } from "../domain/procurement";
import type { Batch } from "../domain/types";
import { requireGift } from "./api";
import { currentRevision } from "../domain/procurement";

export type ProcurementStatus = "draft" | "collecting" | "approved" | "filling_cart" | "cart_ready" | "locked" | "ordered";
export type AttendeeStatus = "ready" | "incomplete" | "invalid" | "exception";
export type IssueStatus = "incomplete" | "invalid" | "vendor_rejected" | "exception";
export type FulfillmentIssue = { requirement_id: string; status: IssueStatus; message: string };
export type FulfillmentAttendee = { attendee_ref: string; status: AttendeeStatus; variant_id: string | null; values: Record<string, unknown>; issues: FulfillmentIssue[] };
export type FulfillmentManifest = {
  procurement_id: string;
  gift_id: string;
  revision: number;
  approved_revision: number | null;
  requirement_schema_id?: string;
  requirement_schema_version?: string;
  status: ProcurementStatus;
  attendees: FulfillmentAttendee[];
};

/** Where the gift stands, read from the fields each step writes. */
export function procurementStatus(gift: Batch): ProcurementStatus {
  if (gift.order_id) return "ordered";
  if (gift.locked_at) return "locked";
  if (gift.cart_fill?.status === "running") return "filling_cart";
  if (gift.cart_fill?.status === "done" || gift.checkout_url) return "cart_ready";
  if (gift.approved_at) return "approved";
  if (gift.requested_at) return "collecting";
  return "draft";
}

const ISSUE_STATUS: Record<PersonalizationIssue["code"], IssueStatus> = { missing_source: "incomplete", missing_value: "incomplete", invalid_type: "invalid", too_long: "invalid", unsupported_value: "invalid" };

const worst = (issues: FulfillmentIssue[]): AttendeeStatus => (issues.some((i) => i.status === "exception" || i.status === "vendor_rejected") ? "exception" : issues.some((i) => i.status === "invalid") ? "invalid" : issues.length ? "incomplete" : "ready");

/**
 * One attendee row cut to the caller: a personalization value whose source definition the caller
 * may not read leaves with its issues, and the variant question's value follows the same rule.
 */
function attendeeRow(gift: Batch, row: ManifestRow, variantDefinitionId: string | undefined, variantKey: string | undefined, readable?: string[]): FulfillmentAttendee {
  const canRead = (definitionId: string) => !readable || readable.includes(definitionId);
  const hidden = new Set<string>();
  const values: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(row.personalization ?? {})) {
    if (field.source.type === "definition" && !canRead(field.source.definition_id)) hidden.add(key);
    else values[key] = field.value;
  }
  if (variantKey && variantDefinitionId && canRead(variantDefinitionId) && row.values[variantDefinitionId] !== undefined) values[variantKey] = row.values[variantDefinitionId];
  const issues: FulfillmentIssue[] = (row.personalization_issues ?? []).filter((i) => !hidden.has(i.vendor_field_key)).map((i) => ({ requirement_id: i.vendor_field_key, status: ISSUE_STATUS[i.code], message: i.message }));
  if (row.unit_status === "unservable") issues.push({ requirement_id: variantKey ?? "variant", status: "invalid", message: row.reason ?? "No variant resolves for the row" });
  else if (row.unit_status === "held") issues.push({ requirement_id: variantKey ?? "variant", status: "incomplete", message: row.reason ?? "The unit waits for a value" });
  return { attendee_ref: row.guest_id, status: worst(issues), variant_id: row.variant_id, values, issues };
}

/** The manifest for a gift as the caller may see it; `readable` absent is the organizer's view. */
export function fulfillmentManifest(eventId: string, giftId: string, readable?: string[]): FulfillmentManifest {
  const gift = requireGift(eventId, giftId);
  const keys = requirementKeys(gift);
  const variantDefinitionId = gift.mapping[0]?.definition_id;
  const variantKey = variantDefinitionId ? keys.byDefinition.get(variantDefinitionId) : undefined;
  const attendees = manifest(gift)
    .filter((row) => row.unit_status !== "excluded")
    .map((row) => attendeeRow(gift, row, variantDefinitionId, variantKey, readable));
  return {
    procurement_id: giftId,
    gift_id: giftId,
    revision: currentRevision(giftId, readable),
    approved_revision: typeof gift.approved_seq === "number" ? gift.approved_seq : null,
    ...(gift.personalization?.fields.length ? { requirement_schema_id: `${gift.shop_domain}/${gift.product_id}` } : {}),
    status: procurementStatus(gift),
    attendees
  };
}
