/**
 * The procurement surface a store's agent works with: the projection it reads
 * (get_fulfillment_manifest), cut to what its token may see, and the structured update it posts
 * (post_procurement_update), which becomes state. The gift is the procurement until a Procurement
 * record exists.
 */
import { z } from "zod";
import { manifest, updateGift, type GiftInput, type ManifestRow } from "../domain/gifts";
import type { RequirementResolutionStatus } from "../domain/personalization";
import { currentRevision, moveProcurement, openException, openExceptionsFor, requirementKeys } from "../domain/procurement";
import { VENDOR_MOVES } from "../domain/procurement-status";
import { definitionsFor, getGuest, procurementFor, state, transactionally, upsertRequest } from "../domain/store";
import type { AttributeDefinition, Batch, ExceptionType, ProcurementException, ProcurementStatus, VendorProcurementStatus, VendorUpdate } from "../domain/types";
import { BadRequestError, postUpdate, requireEvent, requireGift, requireGuest } from "./api";
import { expireGrantsFor } from "./grants";
import { deliverAll, type Outgoing } from "./request-mail";

export type { ProcurementStatus };
export type AttendeeStatus = "ready" | "incomplete" | "invalid" | "exception";
/** The status an issue carries: a requirement's resolution status short of resolved, or exception for a problem raised on the attendee as a whole. */
export type IssueStatus = Exclude<RequirementResolutionStatus, "resolved"> | "exception";
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

/** Where the gift stands: the status its Procurement holds. */
export function procurementStatus(gift: Batch): ProcurementStatus {
  return procurementFor(gift.id).status;
}

/** The schema fields the Procurement carries, when the product has requirements. */
function schemaFields(gift: Batch): Pick<FulfillmentManifest, "requirement_schema_id" | "requirement_schema_version"> {
  const row = procurementFor(gift.id);
  if (!gift.personalization?.fields.length) return {};
  return { requirement_schema_id: row.requirement_schema_id ?? `${gift.shop_domain}/${gift.product_id}`, ...(row.requirement_schema_version ? { requirement_schema_version: row.requirement_schema_version } : {}) };
}

/** The revision the organizer approved, from the Procurement or the gift's own field. */
function approvedRevision(gift: Batch): number | null {
  const row = procurementFor(gift.id);
  return row.approved_revision ?? (typeof gift.approved_seq === "number" ? gift.approved_seq : null);
}

const EXCEPTION_ISSUE: Record<ExceptionType, IssueStatus> = { missing_information: "missing", invalid_value: "vendor_rejected", option_unavailable: "vendor_rejected", mapping_problem: "exception", other: "exception" };

/** The attendee grade each issue status carries; a value changed after the approval stays usable. */
const ISSUE_GRADE: Record<IssueStatus, AttendeeStatus> = { missing: "incomplete", mapping_unresolved: "incomplete", needs_confirmation: "incomplete", invalid: "invalid", vendor_rejected: "invalid", changed_after_approval: "ready", exception: "exception" };

function worst(issues: FulfillmentIssue[], open: boolean): AttendeeStatus {
  if (open) return "exception";
  const grades = issues.map((i) => ISSUE_GRADE[i.status]);
  return grades.includes("invalid") ? "invalid" : grades.includes("incomplete") ? "incomplete" : "ready";
}

function exceptionMessage(row: ProcurementException): string {
  if (row.message) return row.message;
  if (row.type === "option_unavailable") return `${row.unavailable_value ?? "the value"} is unavailable${row.allowed_values?.length ? `; the store offers ${row.allowed_values.join(", ")}` : ""}`;
  return row.type.replace(/_/g, " ");
}

/**
 * One attendee row cut to the caller: a personalization value whose source definition the caller
 * may not read leaves with its issues and its exceptions, and the variant question's value follows
 * the same rule. An open exception on the attendee grades the row `exception`.
 */
function attendeeRow(row: ManifestRow, exceptions: ProcurementException[], variantDefinitionId: string | undefined, variantKey: string | undefined, byKey: Map<string, string>, readable?: string[]): FulfillmentAttendee {
  const canRead = (definitionId: string) => !readable || readable.includes(definitionId);
  const hidden = new Set<string>();
  const values: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(row.personalization ?? {})) {
    if (field.source.type === "definition" && !canRead(field.source.definition_id)) hidden.add(key);
    else values[key] = field.value;
  }
  if (variantKey && variantDefinitionId) {
    if (canRead(variantDefinitionId)) values[variantKey] = row.values[variantDefinitionId];
    else hidden.add(variantKey);
  }
  const issues: FulfillmentIssue[] = (row.personalization_issues ?? []).filter((i) => !hidden.has(i.vendor_field_key)).map((i) => ({ requirement_id: i.vendor_field_key, status: i.status, message: i.message }));
  if (row.unit_status === "unservable") issues.push({ requirement_id: variantKey ?? "variant", status: "invalid", message: row.reason ?? "No variant resolves for the row" });
  else if (row.unit_status === "held") issues.push({ requirement_id: variantKey ?? "variant", status: "missing", message: row.reason ?? "The unit waits for a value" });
  const open = exceptions.filter((e) => e.attendee_ref === row.guest_id && !(e.requirement_id && (hidden.has(e.requirement_id) || (byKey.has(e.requirement_id) && !canRead(byKey.get(e.requirement_id)!)))));
  // A rejection the row already grades vendor_rejected keeps the store's own words in place of the row's generic message.
  for (const e of open) {
    const status = EXCEPTION_ISSUE[e.type];
    const graded = status === "vendor_rejected" ? issues.findIndex((i) => i.requirement_id === e.requirement_id && i.status === "vendor_rejected") : -1;
    const issue = { requirement_id: e.requirement_id ?? "procurement", status, message: exceptionMessage(e) };
    if (graded >= 0) issues[graded] = issue;
    else issues.push(issue);
  }
  return { attendee_ref: row.guest_id, status: worst(issues, open.length > 0), variant_id: row.variant_id, values, issues };
}

/** The manifest for a gift as the caller may see it; `readable` absent is the organizer's view. */
export function fulfillmentManifest(eventId: string, giftId: string, readable?: string[]): FulfillmentManifest {
  const gift = requireGift(eventId, giftId);
  const keys = requirementKeys(gift);
  const variantDefinitionId = gift.mapping[0]?.definition_id;
  const variantKey = variantDefinitionId ? keys.byDefinition.get(variantDefinitionId) : undefined;
  const exceptions = openExceptionsFor(giftId);
  const attendees = manifest(gift)
    .filter((row) => row.unit_status !== "excluded")
    .map((row) => attendeeRow(row, exceptions, variantDefinitionId, variantKey, keys.byKey, readable));
  return {
    procurement_id: giftId,
    gift_id: giftId,
    revision: currentRevision(giftId, readable),
    approved_revision: approvedRevision(gift),
    ...schemaFields(gift),
    status: procurementStatus(gift),
    attendees
  };
}

/** The open exceptions a caller may see on a gift: every one without a requirement, and those whose requirement's definition the caller may read. */
export function visibleExceptions(eventId: string, giftId: string, readable?: string[]): ProcurementException[] {
  const gift = requireGift(eventId, giftId);
  const byKey = requirementKeys(gift).byKey;
  return openExceptionsFor(giftId).filter((e) => {
    if (!readable || !e.requirement_id) return true;
    const definitionId = byKey.get(e.requirement_id);
    return !definitionId || readable.includes(definitionId);
  });
}

/** The Procurement as get_procurement returns it: the product, the store, where the order stands, and the revisions. */
export type ProcurementSummary = {
  procurement_id: string;
  gift_id: string;
  product: { id: string; title: string; url: string | null };
  store: string;
  status: ProcurementStatus;
  current_revision: number;
  approved_revision: number | null;
  requirement_schema_id?: string;
  requirement_schema_version?: string;
  attendees: number;
  open_exceptions: number;
};

export function procurementSummary(eventId: string, giftId: string, readable?: string[]): ProcurementSummary {
  const gift = requireGift(eventId, giftId);
  return {
    procurement_id: giftId,
    gift_id: giftId,
    product: { id: gift.product_id, title: gift.product_title, url: gift.product_url ?? null },
    store: gift.shop_domain,
    status: procurementStatus(gift),
    current_revision: currentRevision(giftId, readable),
    approved_revision: approvedRevision(gift),
    ...schemaFields(gift),
    attendees: manifest(gift).filter((row) => row.unit_status !== "excluded").length,
    open_exceptions: visibleExceptions(eventId, giftId, readable).length
  };
}

/* ---- Structured updates (post_procurement_update) ---- */

const UpdateType = z.enum(["accepted", "production_started", "fulfilled", "needs_information", "invalid_value", "option_unavailable", "exception"]);
export type ProcurementUpdateType = z.infer<typeof UpdateType>;

export const ProcurementUpdateBody = z.object({
  type: UpdateType,
  attendee_ref: z.string().nullable().default(null),
  requirement_id: z.string().nullable().default(null),
  message: z.string().nullable().default(null),
  unavailable_value: z.string().nullable().default(null),
  allowed_values: z.array(z.string()).nullable().default(null),
  expected_date: z.string().nullable().default(null),
  reference: z.string().nullable().default(null)
});

/** The progress-log kind each structured update also posts, so get_updates keeps showing every post. */
const UPDATE_KIND: Record<ProcurementUpdateType, VendorUpdate["kind"]> = { accepted: "confirmed", production_started: "in_production", fulfilled: "delivered", needs_information: "question", invalid_value: "issue", option_unavailable: "issue", exception: "issue" };
const STATUS_MOVE: Partial<Record<ProcurementUpdateType, VendorProcurementStatus>> = { accepted: "accepted", production_started: "in_production", fulfilled: "fulfilled" };
const EXCEPTION_TYPE: Partial<Record<ProcurementUpdateType, ExceptionType>> = { needs_information: "missing_information", invalid_value: "invalid_value", option_unavailable: "option_unavailable", exception: "other" };

/** The definition an attendee is asked again for a requirement: a guest-scope definition the gift's mappings name under that key. */
function correctionDefinition(gift: Batch, requirementId: string): AttributeDefinition | undefined {
  const definitionId = requirementKeys(gift).byKey.get(requirementId);
  const def = definitionId ? definitionsFor(gift.event_id).find((d) => d.id === definitionId) : undefined;
  return def?.scope === "guest" ? def : undefined;
}

type Posted = { update: VendorUpdate; exception: ProcurementException | null; outgoing: Outgoing[] };

/**
 * Records a store's structured update: the post in the progress log, the change-log entry, and
 * what the type means for state. accepted, production_started, and fulfilled move the gift's
 * procurement_status. needs_information, invalid_value, option_unavailable, and exception open a
 * ProcurementException; one on an attendee's requirement the event asks that attendee for records
 * a request and emails the attendee a correction with the store's message quoted. fulfilled also
 * expires every grant on the procurement.
 *
 * Raises:
 *   BadRequestError: when the body is not a typed update, or invalid_value names no attendee or requirement.
 *   NotFoundError: when the attendee is not on the event.
 */
export async function postProcurementUpdate(eventId: string, giftId: string, caller: string, body: unknown) {
  const event = requireEvent(eventId);
  const gift = requireGift(eventId, giftId);
  const parsed = ProcurementUpdateBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const data = parsed.data;
  if (data.type === "invalid_value" && (!data.attendee_ref || !data.requirement_id)) throw new BadRequestError("invalid_value names the attendee and the requirement.");
  if (data.attendee_ref) requireGuest(eventId, data.attendee_ref);
  const text = data.message ?? (data.unavailable_value ? `${data.requirement_id ?? "a value"} ${data.unavailable_value} is unavailable${data.allowed_values?.length ? `; the store offers ${data.allowed_values.join(", ")}` : ""}` : data.type.replace(/_/g, " "));
  const posted = transactionally((): Posted => {
    const update = postUpdate(eventId, giftId, caller, { kind: UPDATE_KIND[data.type], text, expected_date: data.expected_date, reference: data.reference, guest_id: data.attendee_ref });
    const move = STATUS_MOVE[data.type];
    if (move) {
      updateGift(giftId, { procurement_status: move } as Partial<GiftInput>);
      moveProcurement(giftId, VENDOR_MOVES[move], caller, { patch: data.reference && move === "accepted" ? { external_order_id: data.reference } : {}, summary: `The store moved the order to ${move.replace(/_/g, " ")}` });
      // A fulfilled order needs no further access: every grant on the procurement expires with it (#41).
      if (move === "fulfilled") expireGrantsFor(eventId, giftId);
      return { update, exception: null, outgoing: [] };
    }
    const exception = openException(giftId, { attendee_ref: data.attendee_ref, requirement_id: data.requirement_id, type: EXCEPTION_TYPE[data.type]!, message: data.message, unavailable_value: data.unavailable_value, allowed_values: data.allowed_values }, caller);
    const def = data.attendee_ref && data.requirement_id ? correctionDefinition(gift, data.requirement_id) : undefined;
    if (!def || !data.attendee_ref) return { update, exception, outgoing: [] };
    const guest = getGuest(data.attendee_ref);
    const asked = state().requests.get(`${guest.id}|${giftId}`)?.definition_ids ?? [];
    upsertRequest(eventId, guest.id, giftId, [...new Set([...asked, def.id])]);
    return { update, exception, outgoing: [{ guest, gift_id: giftId, definition_ids: [def.id], kind: "correction", message: data.message }] };
  });
  await deliverAll(event, posted.outgoing);
  return { update: posted.update, exception: posted.exception, procurement_status: procurementFor(giftId).status, current_revision: currentRevision(giftId) };
}
