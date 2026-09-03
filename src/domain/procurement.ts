/**
 * The procurement view of the change log. Until a Procurement row exists the gift is the
 * procurement: its revision is the seq of the last change a store's agent may see for it, and the
 * reader lists the changes after a revision in the shape get_changes returns. The store's
 * requirement key (a vendor field key or the variant question's key) names each requirement.
 */
import type { ActorType, Batch, ChangeEntry, Procurement, ProcurementChangeType, ProcurementException, ProcurementStatus } from "./types";
import { getGift, manifest } from "./gifts";
import { canMove, isCollecting } from "./procurement-status";
import { actorOf, appendChange, definitionsFor, getGuest, newId, procurementFor, state, updateProcurement } from "./store";

/** One change as get_changes returns it. */
export type ChangeView = { revision: number; timestamp: string; actor_type: NonNullable<ChangeEntry["actor_type"]>; actor_id?: string; type: string; attendee_ref?: string; requirement_id?: string; summary: string };

/** The definition each requirement key of a gift reads, and the key each definition fills. */
export type RequirementKeys = { byDefinition: Map<string, string>; byKey: Map<string, string> };

/** The store's requirement keys a gift's mappings name: a vendor field key per mapped definition and the variant question's own key. */
export function requirementKeys(gift: Batch): RequirementKeys {
  const byDefinition = new Map<string, string>();
  const defs = new Map(definitionsFor(gift.event_id).map((d) => [d.id, d]));
  for (const m of gift.personalization_mappings ?? []) if (m.source.type === "definition") byDefinition.set(m.source.definition_id, m.vendor_field_key);
  for (const row of gift.mapping) {
    const def = defs.get(row.definition_id);
    if (def && !byDefinition.has(def.id)) byDefinition.set(def.id, def.key);
  }
  return { byDefinition, byKey: new Map([...byDefinition].map(([id, key]) => [key, id])) };
}

/** Records a procurement-level change on a gift: a mapping or plan edit, an approval, an exception, or a status move. */
export function recordProcurementChange(giftId: string, type: ProcurementChangeType, source: string, summary: string, context: { attendee_ref?: string; requirement_id?: string } = {}): ChangeEntry {
  const gift = getGift(giftId);
  return appendChange({ kind: "procurement", event_id: gift.event_id, gift_id: giftId, type, ...actorOf(source), ...context, summary });
}

/**
 * True when a store's agent holding `readable` may see the entry for the gift: a value write to a
 * definition the gift maps and the holder may read, a reply status change, a post on the gift, or a
 * procurement change whose requirement the holder may read. `readable` absent means the organizer.
 */
function visible(entry: ChangeEntry, giftId: string, keys: RequirementKeys, readable?: string[]): boolean {
  const canRead = (definitionId: string) => !readable || readable.includes(definitionId);
  switch (entry.kind) {
    case "value":
      return keys.byDefinition.has(entry.definition_id) && canRead(entry.definition_id);
    case "status":
      return true;
    case "update":
      return entry.gift_id === giftId;
    case "procurement": {
      if (entry.gift_id !== giftId) return false;
      const definitionId = entry.requirement_id ? keys.byKey.get(entry.requirement_id) : undefined;
      return definitionId ? canRead(definitionId) : true;
    }
  }
}

/** The change-log entries after `after` a holder may see for the gift, in sequence order. */
export function procurementChanges(giftId: string, after: number, readable?: string[]): ChangeEntry[] {
  const gift = getGift(giftId);
  const keys = requirementKeys(gift);
  return state().changes.filter((c) => c.event_id === gift.event_id && c.seq > after && visible(c, giftId, keys, readable));
}

/** The seq of the last change a holder may see for the gift, or 0 before any. */
export function currentRevision(giftId: string, readable?: string[]): number {
  return procurementChanges(giftId, 0, readable).at(-1)?.seq ?? 0;
}

function guestName(guestId: string): string {
  try {
    return getGuest(guestId).display_name;
  } catch {
    return guestId;
  }
}

/** One entry in the reader's shape; an entry stored before revisions existed derives its actor and summary from its own fields. */
export function changeView(entry: ChangeEntry, keys: RequirementKeys): ChangeView {
  const actor = entry.actor_type ? { actor_type: entry.actor_type, ...(entry.actor_id ? { actor_id: entry.actor_id } : {}) } : actorOf("source" in entry ? entry.source : "caller" in entry ? entry.caller : "system");
  const base = { revision: entry.seq, timestamp: entry.at, ...actor };
  const ref = (attendee?: string, requirement?: string) => ({ ...(attendee ? { attendee_ref: attendee } : {}), ...(requirement ? { requirement_id: requirement } : {}) });
  switch (entry.kind) {
    case "value":
      return { ...base, type: "answer_changed", ...ref(entry.attendee_ref ?? (entry.subject_type === "guest" ? entry.subject_id : undefined), entry.requirement_id ?? keys.byDefinition.get(entry.definition_id)), summary: entry.summary ?? `${guestName(entry.subject_id)} answered ${keys.byDefinition.get(entry.definition_id) ?? entry.definition_id}` };
    case "status":
      return { ...base, type: "reply_changed", ...ref(entry.guest_id), summary: entry.summary ?? `${guestName(entry.guest_id)} changed the reply from ${entry.from} to ${entry.to}` };
    case "update":
      return { ...base, type: "update_posted", ...ref(entry.attendee_ref, entry.requirement_id), summary: entry.summary ?? `${entry.update_kind} posted` };
    case "procurement":
      return { ...base, type: entry.type, ...ref(entry.attendee_ref, entry.requirement_id), summary: entry.summary ?? entry.type };
  }
}

/** The get_changes result for a gift: the changes after `after` the holder may see and the revision the reader stands at. */
export function changesAfter(giftId: string, after: number, readable?: string[]) {
  const keys = requirementKeys(getGift(giftId));
  const entries = procurementChanges(giftId, 0, readable);
  return { procurement_id: giftId, gift_id: giftId, from_revision: after, current_revision: entries.at(-1)?.seq ?? 0, changes: entries.filter((c) => c.seq > after).map((c) => changeView(c, keys)) };
}

/* ---- Status moves ---- */

/**
 * Moves a gift's procurement to a status, records the move in the change log, and stores the entry's
 * seq as the current revision. A move the machine does not allow, or to the status already held,
 * changes nothing and returns the row as it stands. `patch` carries the fields the step also writes,
 * such as the approved revision or the checkout link.
 */
export type MoveOptions = {
  patch?: Partial<Pick<Procurement, "approved_revision" | "external_cart_id" | "checkout_url" | "external_order_id">>;
  summary?: string;
  /** An entry already recorded for the move, such as the approval's own, so the move stands at that revision. */
  entry?: ChangeEntry;
};

export function moveProcurement(giftId: string, to: ProcurementStatus, source: string, { patch = {}, summary, entry }: MoveOptions = {}): Procurement {
  const row = procurementFor(giftId);
  if (!canMove(row.status, to)) return Object.keys(patch).length ? updateProcurement(giftId, patch) : row;
  const recorded = entry ?? recordProcurementChange(giftId, "status_changed", source, summary ?? `The procurement moved from ${row.status.replace(/_/g, " ")} to ${to.replace(/_/g, " ")}`);
  return updateProcurement(giftId, { ...patch, status: to, current_revision: recorded.seq });
}

/** True when every counted manifest row has a variant, every personalization value resolves, and no exception is open on the gift. */
export function rowsResolved(gift: Batch): boolean {
  if (openExceptionsFor(gift.id).length) return false;
  return manifest(gift).every((row) => row.unit_status === "excluded" || (row.unit_status !== "held" && row.unit_status !== "unservable" && (row.personalization_status ?? "ready") === "ready"));
}

/**
 * Moves a collecting procurement to ready once every row resolves, and back to collecting when a
 * row stops resolving. A procurement at any other status keeps it, so an approval or an order is
 * never undone by a value write; a schema change undoes an approval on its own path.
 */
export function syncReadiness(giftId: string, source: string): Procurement {
  const row = procurementFor(giftId);
  if (!isCollecting(row.status)) return row;
  const target: ProcurementStatus = rowsResolved(getGift(giftId)) ? "ready" : "collecting";
  return target === row.status ? row : moveProcurement(giftId, target, source, { summary: target === "ready" ? "Every attendee row resolves" : "An attendee row no longer resolves" });
}

/* ---- Exceptions ---- */

export type ExceptionInput = { attendee_ref?: string | null; requirement_id?: string | null; type: ProcurementException["type"]; message?: string | null; unavailable_value?: string | null; allowed_values?: string[] | null };

const EXCEPTION_SOURCE: Record<ActorType, ProcurementException["source"]> = { attendee: "system", organizer: "organizer", vendor: "vendor", agent: "vendor", system: "system" };

/** Opens an exception on a gift and records the change; the exception's created_revision is that entry's seq. */
export function openException(giftId: string, input: ExceptionInput, source: string): ProcurementException {
  const gift = getGift(giftId);
  const id = newId("exc");
  const context = { ...(input.attendee_ref ? { attendee_ref: input.attendee_ref } : {}), ...(input.requirement_id ? { requirement_id: input.requirement_id } : {}) };
  const entry = recordProcurementChange(giftId, "exception_opened", source, `${input.type.replace(/_/g, " ")}${input.requirement_id ? ` on ${input.requirement_id}` : ""}${input.message ? `: ${input.message}` : ""}`, context);
  const row: ProcurementException = {
    id,
    event_id: gift.event_id,
    procurement_id: giftId,
    attendee_ref: input.attendee_ref ?? null,
    requirement_id: input.requirement_id ?? null,
    source: EXCEPTION_SOURCE[actorOf(source).actor_type],
    type: input.type,
    message: input.message ?? null,
    unavailable_value: input.unavailable_value ?? null,
    allowed_values: input.allowed_values ?? null,
    status: "open",
    created_at: entry.at,
    resolved_at: null,
    created_revision: entry.seq,
    resolved_revision: null
  };
  state().exceptions.set(id, row);
  return row;
}

export function exceptionsFor(eventId: string, giftId?: string): ProcurementException[] {
  return [...state().exceptions.values()].filter((e) => e.event_id === eventId && (giftId === undefined || e.procurement_id === giftId)).sort((a, b) => a.created_revision - b.created_revision);
}

export function openExceptionsFor(giftId: string): ProcurementException[] {
  return exceptionsFor(getGift(giftId).event_id, giftId).filter((e) => e.status === "open");
}

function closeException(row: ProcurementException, status: "resolved" | "dismissed", source: string, summary: string): ProcurementException {
  const context = { ...(row.attendee_ref ? { attendee_ref: row.attendee_ref } : {}), ...(row.requirement_id ? { requirement_id: row.requirement_id } : {}) };
  const entry = recordProcurementChange(row.procurement_id, status === "resolved" ? "exception_resolved" : "exception_dismissed", source, summary, context);
  const closed: ProcurementException = { ...row, status, resolved_at: entry.at, resolved_revision: entry.seq };
  state().exceptions.set(row.id, closed);
  return closed;
}

/** An attendee's answer on a definition resolves every open exception on that attendee's requirement the definition fills, on every gift. */
export function resolveExceptionsByAnswer(guestId: string, definitionId: string, source: string): ProcurementException[] {
  const resolved: ProcurementException[] = [];
  for (const row of state().exceptions.values()) {
    if (row.status !== "open" || row.attendee_ref !== guestId || !row.requirement_id) continue;
    if (requirementKeys(getGift(row.procurement_id)).byKey.get(row.requirement_id) !== definitionId) continue;
    resolved.push(closeException(row, "resolved", source, `${row.requirement_id} answered again`));
  }
  return resolved;
}

/** The organizer closes an exception without an answer. */
export function dismissException(id: string, source: string): ProcurementException {
  const row = state().exceptions.get(id);
  if (!row) throw new Error(`No exception ${id}.`);
  if (row.status !== "open") return row;
  return closeException(row, "dismissed", source, `${row.type.replace(/_/g, " ")} dismissed`);
}
