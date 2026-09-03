/**
 * The organizer's side of the stored reconciliation (#51): a confirmation on one requirement, the
 * view of a schema version change with the attendees it affects, and the continuation that reruns
 * the request step once the organizer has seen the change.
 */
import { z } from "zod";
import { continuePastSchemaChange } from "../domain/reconciliation";
import { recordProcurementChange, requirementKeys } from "../domain/procurement";
import type { Filter } from "../domain/filter";
import { definitionsFor, listGuests, requestsFor, valuesFor } from "../domain/store";
import type { AttributeDefinition, Batch, Confirmation, Guest, StoredDecision } from "../domain/types";
import { BadRequestError, giftRequirements, NotFoundError, requestFromAttendees, requireGift, type Requirement } from "./api";
import { confirmRequirement, incompatibility, reconciliationOf, vendorSchemaFor } from "./reconcile";

const GOING: Filter = [{ field: "status", op: "eq", value: "going" }];

const ConfirmationBody = z.union([z.object({ attribute_id: z.string().min(1) }), z.object({ create: z.literal(true) })]);

/**
 * Records the organizer's confirmation of one requirement and returns the requirements as they now read.
 *
 * Raises:
 *   NotFoundError: when the requirement is not in the gift's schema, or the attribute is not a definition of the event.
 *   BadRequestError: when the body is neither an attribute nor a request to create, or the attribute cannot hold the requirement's value.
 */
export function confirmRequirementFromBody(eventId: string, giftId: string, requirementKey: string, body: unknown): { requirements: Requirement[] } {
  const gift = requireGift(eventId, giftId);
  const requirement = vendorSchemaFor(gift).requirements.find((r) => r.key === requirementKey);
  if (!requirement) throw new NotFoundError(`No requirement ${requirementKey} on gift ${giftId}.`);
  const parsed = ConfirmationBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError("The confirmation names an attribute_id or asks to create.");
  const choice: Confirmation = parsed.data;
  let summary = `${requirement.label} will be asked of attendees as a new question`;
  if ("attribute_id" in choice) {
    const def = definitionsFor(eventId).find((d) => d.id === choice.attribute_id);
    if (!def) throw new NotFoundError(`No definition ${choice.attribute_id} on event ${eventId}.`);
    const why = incompatibility(requirement, def);
    if (why) throw new BadRequestError(why);
    summary = `${requirement.label} fills from ${def.label}`;
  }
  confirmRequirement(gift, requirementKey, choice);
  recordProcurementChange(giftId, "mapping_changed", "organizer", `The organizer confirmed ${summary}`, { requirement_id: requirementKey });
  return { requirements: giftRequirements(eventId, giftId) };
}

/* ---- The schema change ---- */

export type ChangeKind = "added" | "removed" | "changed";
export type ChangedRequirement = { key: string; label: string; change: ChangeKind };
export type AffectedAttendee = { attendee_ref: string; display_name: string; keys: string[] };

/** A schema version change as the organizer sees it: what moved, the attendees it touches, and whether the organizer has continued past it. */
export type SchemaChangeView = { schema_id: string; from_version: string; to_version: string; changed_at: string; continued_at: string | null; requirements: ChangedRequirement[]; attendees: AffectedAttendee[] };

/** The stored reconciliation as the organizer's page reads it. */
export type ReconciliationView = { schema_id: string; schema_version: string; decisions: StoredDecision[]; change: SchemaChangeView | null };

/** The definition a requirement key reads: the gift's mapping, or the definition the store's field created. */
function definitionForKey(gift: Batch, key: string, defs: AttributeDefinition[]): AttributeDefinition | undefined {
  const mapped = requirementKeys(gift).byKey.get(key);
  return (mapped ? defs.find((d) => d.id === mapped) : undefined) ?? defs.find((d) => d.vendor_field?.key === key || d.key === key);
}

/** A requirement's label: the store's current field, or the definition its earlier field created, or the key itself. */
function labelForKey(gift: Batch, key: string, defs: AttributeDefinition[]): string {
  return gift.personalization?.fields.find((f) => f.key === key)?.label ?? definitionForKey(gift, key, defs)?.label ?? key;
}

/**
 * The attendees a change touches: every going attendee for an added requirement, and for a removed
 * or changed one every going attendee who answered its question or was asked it.
 */
function affectedAttendees(gift: Batch, requirements: ChangedRequirement[], defs: AttributeDefinition[]): AffectedAttendee[] {
  const going: Guest[] = listGuests(gift.event_id, GOING);
  const asked = new Map(requestsFor(gift.event_id, gift.id).map((r) => [r.guest_id, new Set(r.definition_ids)]));
  const out: AffectedAttendee[] = [];
  for (const guest of going) {
    const values = valuesFor(guest);
    const keys = requirements.filter((r) => {
      if (r.change === "added") return true;
      const def = definitionForKey(gift, r.key, defs);
      if (!def) return false;
      const value = values[def.id];
      return (value !== undefined && value !== null && value !== "") || asked.get(guest.id)?.has(def.id) === true;
    }).map((r) => r.key);
    if (keys.length) out.push({ attendee_ref: guest.id, display_name: guest.display_name, keys });
  }
  return out;
}

/** The change the gift's current schema version carries from the version before, or null when there is none. */
export function schemaChangeFor(eventId: string, giftId: string): SchemaChangeView | null {
  const gift = requireGift(eventId, giftId);
  const row = reconciliationOf(gift);
  if (!row.previous) return null;
  const defs = definitionsFor(eventId);
  const { diff } = row.previous;
  const requirements: ChangedRequirement[] = [
    ...diff.added.map((key) => ({ key, label: labelForKey(gift, key, defs), change: "added" as const })),
    ...diff.removed.map((key) => ({ key, label: labelForKey(gift, key, defs), change: "removed" as const })),
    ...diff.changed.map((key) => ({ key, label: labelForKey(gift, key, defs), change: "changed" as const }))
  ];
  return { schema_id: row.schema_id, from_version: row.previous.schema_version, to_version: row.schema_version, changed_at: row.previous.changed_at, continued_at: row.previous.continued_at, requirements, attendees: affectedAttendees(gift, requirements, defs) };
}

export function reconciliationView(eventId: string, giftId: string): ReconciliationView {
  const gift = requireGift(eventId, giftId);
  // The decisions are read first so the row holds the ones the current definitions give.
  giftRequirements(eventId, giftId);
  const row = reconciliationOf(gift);
  return { schema_id: row.schema_id, schema_version: row.schema_version, decisions: row.decisions, change: schemaChangeFor(eventId, giftId) };
}

/** The organizer continues past the schema change: the change is marked seen and the request step runs again. */
export async function continueAfterSchemaChange(eventId: string, giftId: string) {
  const gift = requireGift(eventId, giftId);
  const row = reconciliationOf(gift);
  continuePastSchemaChange(giftId, row.schema_id, row.schema_version);
  if (row.previous) recordProcurementChange(giftId, "mapping_changed", "organizer", `The organizer continued past the schema change to version ${row.schema_version}`);
  return requestFromAttendees(eventId, giftId);
}
