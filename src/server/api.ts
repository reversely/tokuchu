/**
 * The operations the API routes and the tools call (PRD Sections 7 and 8). Each returns plain
 * data or throws a typed error that `errorResponse` maps to a status, so a route handler stays a
 * few lines and a tool call and a page request share one code path.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { parseFilter, type Filter } from "../domain/filter";
import {
  changesSince,
  countBy,
  createEvent,
  createGuest,
  createParty,
  currentSeq,
  definitionsFor,
  eventByCode,
  getDefinition,
  getEvent,
  getGuest,
  guestsFor,
  InvalidValueError,
  library,
  listGuests,
  listMissing,
  LockedValueError,
  newEventId,
  newId,
  publishEvent,
  recordFollowUp,
  requestsFor,
  setGuestAttendance,
  setGuestStatus,
  state,
  transactionally,
  subjectFor,
  updateEvent,
  upsertDefinition,
  upsertRequest,
  valuesFor,
  writeValue,
  type EventInput
} from "../domain/store";
import { Constraints, EventSettings, FilterSchema, GiftOverride, GiftRule, Guest, GuestStatus, MissingValueFallback, PersonalizationField, PersonalizationMapping, PostLockCancellation, Segment, UpdateKind, ValueType, Variant, VariantMappingRow, Venue, type AttributeDefinition, type Batch, type Event, type MappingSource, type PersonalizationKind, type VendorUpdate, DeliveryWindow, Delivery } from "../domain/types";
import { matches } from "../domain/filter";
import { createGift, getGift, giftsFor, lockGift, manifest, quantities, removeGift, setGiftOverride, unservable, updateGift, type GiftInput } from "../domain/gifts";
import { CLOCK_TIME, fieldConstraints, validateMappings } from "../domain/personalization";
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from "./errors";
import { llmEnabled } from "./flags";
import { afterRsvpWrite } from "./hooks";
import { deliverAfterCommit, deliverAll, type Outgoing } from "./request-mail";

export { BadRequestError, NotFoundError };

/* ---- Events ---- */

const defaults = library().event_defaults;

// #134: the schedule fields (starts_at, rsvp_deadline, needed_by) must be ISO 8601 dates or
// datetimes, and spots and cost_per_person_cents cannot be negative (cost feeds the catalog price
// ceiling in cents, PRD Section 11). A past deadline and a guest count over spots stay display-only
// per the PRD (Section 5 lists spots and the deadlines among the organizer's shown details, not as
// gates), so the API validates format and sign, not temporal ordering or capacity.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
const isoString = z.string().refine((v) => ISO_DATE.test(v) && !Number.isNaN(Date.parse(v)), "must be an ISO 8601 date");
const nonNegativeInt = z.number().int().min(0);
const DeliveryBody = Delivery.extend({ needed_by: isoString.nullable().default(null) });

export const EventBody = z.object({
  type: z.string().default(defaults.type),
  title: z.string().min(1),
  host: z.string().default(""),
  starts_at: isoString,
  venue: Venue,
  spots: nonNegativeInt.nullable().default(null),
  cost_per_person_cents: nonNegativeInt.nullable().default(null),
  rsvp_deadline: isoString.nullable().default(null),
  description: z.string().default(""),
  invite_extras: z.array(z.string()).default([]),
  response_options: z.array(GuestStatus).default(defaults.response_options),
  settings: EventSettings.default(defaults.settings),
  delivery: DeliveryBody.default({ destination: "venue", address: null, needed_by: null }),
  contact: z.object({ email: z.string().nullable().default(null), phone: z.string().nullable().default(null) }).default({ email: null, phone: null }),
  segments: z.array(Segment).default([])
});

/** Creates the draft for the organizer whose user id `ownerId` names. */
export function createEventFromBody(body: unknown, ownerId: string | null = null) {
  const parsed = EventBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return createEvent(parsed.data as EventInput, newEventId(), ownerId);
}

export function updateEventFromBody(eventId: string, body: unknown) {
  const parsed = EventBody.partial().safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return updateEvent(requireEvent(eventId).id, parsed.data as Partial<EventInput>);
}

export function requireEvent(eventId: string) {
  try {
    return getEvent(eventId);
  } catch {
    throw new NotFoundError(`No event ${eventId}.`);
  }
}

export function requireGuest(eventId: string, guestId: string): Guest {
  let guest: Guest;
  try {
    guest = getGuest(guestId);
  } catch {
    throw new NotFoundError(`No guest ${guestId}.`);
  }
  if (guest.event_id !== eventId) throw new NotFoundError(`No guest ${guestId} on event ${eventId}.`);
  return guest;
}

const DefinitionBody = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  scope: z.enum(["guest", "party", "event"]).default("guest"),
  value_type: ValueType,
  constraints: Constraints.default({}),
  required_rule: z.enum(["always", "going", "never"]).default("never"),
  default_visibility: z.array(z.string()).default([])
});

/** The organizer's question list replaces the event's: matching keys keep their ids, new keys get one, absent keys leave the event. */
export function replaceDefinitions(eventId: string, body: unknown) {
  const event = requireEvent(eventId);
  const parsed = z.object({ definitions: z.array(DefinitionBody) }).safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const existing = definitionsFor(eventId);
  const kept = parsed.data.definitions.map((d) => {
    const prior = existing.find((x) => x.key === d.key);
    return upsertDefinition(eventId, { ...(prior ?? {}), ...d, namespace: prior?.namespace ?? "organizer", creator: prior?.creator ?? "organizer", id: prior?.id });
  });
  const s = state();
  s.events.set(eventId, { ...getEvent(event.id), definition_ids: kept.map((d) => d.id) });
  return kept;
}

/* ---- Snapshot and follow-ups ---- */

/** A follow-up names its kind and the guests it covers; the page composes the sentence and the action from the kind. */
export type FollowUp = { kind: "missing_value" | "unresolved" | "no_reply" | "unservable" | "vendor_question" | "vendor_issue"; definition_id: string | null; status: GuestStatus | null; guest_ids: string[]; deadline: string | null; gift_id?: string; update_id?: string };

/** The Overview's follow-ups (PRD Section 5): a required value missing per definition, unresolved maybes, non-responders, and guests a gift cannot serve. */
export function followUps(eventId: string): FollowUp[] {
  const event = getEvent(eventId);
  const out: FollowUp[] = [];
  for (const def of definitionsFor(eventId)) {
    if (def.required_rule === "never") continue;
    const filter: Filter = def.required_rule === "going" ? [{ field: "status", op: "eq", value: "going" }] : [{ field: "status", op: "neq", value: "no_reply" }];
    const guests = listMissing(eventId, def.id, filter);
    if (guests.length) out.push({ kind: "missing_value", definition_id: def.id, status: def.required_rule === "going" ? "going" : null, guest_ids: guests.map((g) => g.id), deadline: null });
  }
  const maybes = listGuests(eventId, [{ field: "status", op: "eq", value: "maybe" }]);
  if (maybes.length) out.push({ kind: "unresolved", definition_id: null, status: "maybe", guest_ids: maybes.map((g) => g.id), deadline: event.rsvp_deadline });
  const silent = listGuests(eventId, [{ field: "status", op: "eq", value: "no_reply" }]);
  if (silent.length) out.push({ kind: "no_reply", definition_id: null, status: "no_reply", guest_ids: silent.map((g) => g.id), deadline: event.rsvp_deadline });
  for (const entry of unservable(eventId)) out.push({ kind: "unservable", definition_id: null, status: null, guest_ids: entry.guests.map((g) => g.guest_id), deadline: getGift(entry.gift_id).cutoff, gift_id: entry.gift_id });
  // A vendor's question stays a follow-up until the organizer replies after it; an issue naming a guest stays until that guest's unit changes.
  for (const gift of giftsFor(eventId)) {
    const thread = [...state().updates.values()].filter((u) => u.event_id === eventId && u.gift_id === gift.id).sort((a, b) => a.seq - b.seq);
    for (const u of thread) {
      if (u.kind === "question" && !thread.some((r) => r.kind === "reply" && r.seq > u.seq)) out.push({ kind: "vendor_question", definition_id: null, status: null, guest_ids: [], deadline: u.expected_date, gift_id: gift.id, update_id: u.id });
      if (u.kind === "issue" && u.guest_id && !thread.some((r) => r.kind === "reply" && r.seq > u.seq)) out.push({ kind: "vendor_issue", definition_id: null, status: null, guest_ids: [u.guest_id], deadline: u.expected_date, gift_id: gift.id, update_id: u.id });
    }
  }
  return out;
}

export function snapshot(eventId: string) {
  const event = requireEvent(eventId);
  const guests = guestsFor(eventId).map((g) => ({ ...g, values: valuesFor(g) }));
  const counts = { going: 0, maybe: 0, cant_go: 0, no_reply: 0 };
  for (const g of guests) counts[g.status] += 1;
  const gifts = giftsFor(eventId).map((g) => ({ ...g, quantities: quantities(g) }));
  return { event, definitions: definitionsFor(eventId), guests, counts, follow_ups: followUps(eventId), gifts, requests: requestViews(eventId), library: library().questions, seq: currentSeq(), llm_enabled: llmEnabled() };
}

/* ---- Gifts ---- */

const GOING: Filter = [{ field: "status", op: "eq", value: "going" }];

export const GiftBody = z.object({
  product_id: z.string().min(1),
  shop_domain: z.string().default(""),
  product_title: z.string().default(""),
  recipients: FilterSchema.default(GOING),
  mapping: z.array(VariantMappingRow).default([]),
  default_variant_id: z.string().nullable().default(null),
  variants: z.array(Variant).default([]),
  /** The store's customization fields for the product, when it has any. */
  personalization: z.object({ fields: z.array(PersonalizationField) }).nullable().optional(),
  /** The product's own page at the store, where the merchant tools run. */
  product_url: z.string().nullable().default(null),
  missing_value_fallback: MissingValueFallback.default("default"),
  post_lock_cancellation: PostLockCancellation.default("keep"),
  cutoff: z.string().nullable().default(null),
  cart_id: z.string().nullable().default(null),
  checkout_id: z.string().nullable().default(null),
  order_id: z.string().nullable().default(null),
  rules: z.array(GiftRule).optional(),
  /** The delivery window the search read for the product; approve derives the lock date from it. */
  delivery_window: DeliveryWindow.nullable().optional()
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return parsed.data;
}

export function requireGift(eventId: string, giftId: string): Batch {
  let gift: Batch;
  try {
    gift = getGift(giftId);
  } catch {
    throw new NotFoundError(`No gift ${giftId}.`);
  }
  if (gift.event_id !== eventId) throw new NotFoundError(`No gift ${giftId} on event ${eventId}.`);
  return gift;
}

/** Stores a plan (set_gift_plan); the default plan carries one rule that sends the product to every going guest. */
export function createGiftFromBody(eventId: string, body: unknown) {
  requireEvent(eventId);
  const data = parseBody(GiftBody, body);
  const input: GiftInput = { ...data, rules: data.rules ?? [{ filter: GOING, product_id: data.product_id }] };
  return giftView(eventId, createGift(eventId, input).id);
}

export function updateGiftFromBody(eventId: string, giftId: string, body: unknown) {
  requireGift(eventId, giftId);
  const patch = parseBody(GiftBody.partial(), body);
  return giftView(eventId, updateGift(giftId, patch as Partial<GiftInput>).id);
}

export function deleteGift(eventId: string, giftId: string) {
  const gift = requireGift(eventId, giftId);
  // A placed order or a lock is a committed record; removing it would drop the local trace of a real order.
  if (gift.order_id) throw new BadRequestError("An ordered gift cannot be removed.");
  if (gift.locked_at || gift.cutoff) throw new BadRequestError("A locked gift cannot be removed.");
  removeGift(giftId);
  return { id: giftId };
}

/**
 * The organizer approves the collected attendee values. Locking them freezes each attendee's answers
 * so a later edit cannot diverge from what the cart carries; the approval time seeds the cart job's
 * idempotency key, and the first approval keeps it so a repeated approval replays the same cart.
 */
export function approveSpecs(eventId: string, giftId: string, now = new Date()) {
  const gift = requireGift(eventId, giftId);
  lockGift(giftId, now.toISOString().slice(0, 10));
  if (!gift.approved_at) updateGift(giftId, { approved_at: now.toISOString() } as Partial<GiftInput>);
  return giftView(eventId, giftId);
}

/** An option label as a stable value token, matching the invite form's option values. */
function slugValue(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "option";
}

/** Where one requirement's value comes from; `question` means a guest question the request creates. */
export type RequirementSource = MappingSource["type"] | "question";

/**
 * One requirement of the gift's product with the source that fills it. `already` is true when no
 * request is needed for it; `question` carries the definition a request creates; `mapping` carries the
 * row the request stores on the gift when the gift lacks one.
 */
export type Requirement = {
  key: string;
  label: string;
  kind: PersonalizationKind | "variant";
  source: RequirementSource;
  definition_id?: string;
  already: boolean;
  question?: { value_type: ValueType; constraints: Constraints };
  mapping?: PersonalizationMapping;
};

const isBlank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** The question a store field becomes: a date for a date kind, a choice for an allowed set, and text with the store's cap otherwise. */
function questionFor(field: PersonalizationField): Requirement["question"] {
  const { max_length, allowed } = fieldConstraints(field);
  if (field.kind === "date") return { value_type: "date", constraints: {} };
  if (allowed.length) return { value_type: "enum", constraints: { options: field.constraints?.options ?? allowed.map((value) => ({ value, label: value })) } };
  const constraints: Constraints = {};
  if (max_length !== undefined) constraints.max_length = max_length;
  if (field.kind === "time") constraints.pattern = CLOCK_TIME.source;
  return { value_type: "text", constraints };
}

/**
 * Resolves one store field in order: a stored mapping to the event, a literal, or the guest row; a
 * stored mapping to a definition; a name the guest row already holds; a definition an earlier request
 * created for this field; and otherwise a new question.
 */
function resolveField(field: PersonalizationField, mapping: PersonalizationMapping | undefined, defs: AttributeDefinition[]): Requirement {
  const base = { key: field.key, label: field.label, kind: field.kind };
  const byId = new Map(defs.map((d) => [d.id, d]));
  if (mapping && mapping.source.type !== "definition") return { ...base, source: mapping.source.type, already: true };
  if (mapping?.source.type === "definition" && byId.has(mapping.source.definition_id)) return { ...base, source: "definition", definition_id: mapping.source.definition_id, already: true };
  if (field.kind === "name") {
    // A printed_name question the organizer added from the library stands in for the guest's display name.
    const printed = defs.find((d) => d.key === "printed_name");
    if (printed) return { ...base, source: "definition", definition_id: printed.id, already: true, mapping: { vendor_field_key: field.key, source: { type: "definition", definition_id: printed.id, subject_scope: printed.scope } } };
    return { ...base, source: "guest", already: true, mapping: { vendor_field_key: field.key, source: { type: "guest", key: "display_name" } } };
  }
  const earlier = defs.find((d) => d.vendor_field?.key === field.key);
  if (earlier) return { ...base, source: "definition", definition_id: earlier.id, already: true, mapping: { vendor_field_key: field.key, source: { type: "definition", definition_id: earlier.id, subject_scope: earlier.scope } } };
  return { ...base, source: "question", already: false, question: questionFor(field) };
}

/** The variant axis the store sells by (Size, or the first axis with a choice) as a choice requirement, when the product has one. */
function variantRequirement(gift: Batch, defs: AttributeDefinition[]): Requirement | null {
  const byOption = new Map<string, Map<string, string>>();
  for (const v of gift.variants ?? []) for (const o of v.options ?? []) {
    if (!byOption.has(o.name)) byOption.set(o.name, new Map());
    byOption.get(o.name)!.set(slugValue(o.label), o.label);
  }
  const optionName = [...byOption.keys()].find((n) => /size/i.test(n)) ?? [...byOption.entries()].find(([, m]) => m.size > 1)?.[0];
  if (!optionName) return null;
  const options = [...byOption.get(optionName)!].map(([value, label]) => ({ value, label }));
  if (options.length < 2) return null;
  const key = `variant_${slugValue(optionName)}`;
  const existing = defs.find((d) => d.key === key);
  const base = { key, label: optionName, kind: "variant" as const };
  if (existing) return { ...base, source: "definition", definition_id: existing.id, already: true };
  return { ...base, source: "question", already: false, question: { value_type: "enum", constraints: { options } } };
}

/**
 * Compares the product's requirements with what the event already holds: each store field with the
 * source that fills it, plus the variant axis as a choice. A field with nothing to fill it is a question.
 */
export function giftRequirements(eventId: string, giftId: string): Requirement[] {
  const gift = requireGift(eventId, giftId);
  const defs = definitionsFor(eventId);
  const mappings = new Map((gift.personalization_mappings ?? []).map((m) => [m.vendor_field_key, m]));
  const out: Requirement[] = [];
  const variant = variantRequirement(gift, defs);
  if (variant) out.push(variant);
  for (const field of gift.personalization?.fields ?? []) out.push(resolveField(field, mappings.get(field.key), defs));
  return out;
}

/** The definitions a requirement list asks attendees for: every guest-scope definition a requirement names. */
function askedDefinitionIds(requirements: Requirement[], defs: AttributeDefinition[]): string[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  return requirements.flatMap((r) => (r.definition_id && byId.get(r.definition_id)?.scope === "guest" ? [r.definition_id] : []));
}

function missingDefinitionIds(guest: Guest, definitionIds: string[]): string[] {
  const values = valuesFor(guest);
  return definitionIds.filter((id) => isBlank(values[id]));
}

/**
 * Creates the questions the gift's requirements need, stores the mapping and the variant wiring on the
 * gift, records a request to every going attendee who lacks an answer, and emails each one. The rows
 * commit before any email goes out, and the send writes each email's outcome to its row.
 */
export async function requestFromAttendees(eventId: string, giftId: string) {
  const event = requireEvent(eventId);
  const gift = requireGift(eventId, giftId);
  const outgoing = transactionally(() => {
    const variantRows = [...gift.mapping];
    const fieldRows = [...(gift.personalization_mappings ?? [])];
    const resolved = giftRequirements(eventId, giftId).map((r) => {
      if (!r.question) return r;
      const created = upsertDefinition(eventId, { namespace: "organizer", key: r.key, label: r.label, scope: "guest", value_type: r.question.value_type, constraints: r.question.constraints, default_visibility: [], required_rule: "going", creator: "organizer", ...(r.kind === "variant" ? {} : { vendor_field: { key: r.key, label: r.label, kind: r.kind } }) });
      const mapping: PersonalizationMapping | undefined = r.kind === "variant" ? undefined : { vendor_field_key: r.key, source: { type: "definition", definition_id: created.id, subject_scope: "guest" } };
      return { ...r, source: "definition" as const, definition_id: created.id, already: true, mapping };
    });
    for (const r of resolved) {
      if (r.mapping && !fieldRows.some((m) => m.vendor_field_key === r.key)) fieldRows.push(r.mapping);
      if (r.kind === "variant" && r.definition_id) {
        for (const o of getDefinition(r.definition_id).constraints.options ?? []) {
          const variant = gift.variants.find((v) => (v.options ?? []).some((vo) => slugValue(vo.label) === o.value));
          if (variant && !variantRows.some((m) => m.definition_id === r.definition_id && m.value === o.value)) variantRows.push({ definition_id: r.definition_id, value: o.value, variant_id: variant.id });
        }
      }
    }
    updateGift(giftId, { mapping: variantRows, personalization_mappings: fieldRows, requested_at: gift.requested_at ?? new Date().toISOString() } as Partial<GiftInput>);
    const asked = askedDefinitionIds(resolved, definitionsFor(eventId));
    return recordRequests(eventId, giftId, asked, new Set());
  });
  await deliverAll(event, outgoing);
  return snapshot(eventId);
}

/** Records a request row for every going attendee not yet asked who lacks one of the asked answers, and returns the emails to make. */
function recordRequests(eventId: string, giftId: string, asked: string[], requested: Set<string>): Outgoing[] {
  const outgoing: Outgoing[] = [];
  for (const guest of listGuests(eventId, GOING)) {
    if (requested.has(guest.id)) continue;
    const missing = missingDefinitionIds(guest, asked);
    if (!missing.length) continue;
    upsertRequest(eventId, guest.id, giftId, missing);
    outgoing.push({ guest, gift_id: giftId, definition_ids: missing, kind: "request" });
  }
  return outgoing;
}

/** Sends the request again to every attendee whose request still has an unanswered question. */
export async function followUp(eventId: string, giftId: string) {
  const event = requireEvent(eventId);
  requireGift(eventId, giftId);
  const outgoing: Outgoing[] = [];
  for (const request of requestsFor(eventId, giftId)) {
    const guest = getGuest(request.guest_id);
    const missing = missingDefinitionIds(guest, request.definition_ids);
    if (!missing.length) continue;
    recordFollowUp(request);
    outgoing.push({ guest, gift_id: giftId, definition_ids: missing, kind: "follow_up" });
  }
  await deliverAll(event, outgoing);
  return snapshot(eventId);
}

/**
 * Issues a gift's request to every going attendee who has no request row and lacks an answer. It runs
 * inside each RSVP write for every gift whose request has gone out (`requested_at`), so an attendee who
 * replies after the organizer's request still receives one; the emails go out once the write commits.
 */
export function requestFromLateAttendees(eventId: string): void {
  requireEvent(eventId);
  const outgoing: Outgoing[] = [];
  for (const gift of giftsFor(eventId)) {
    if (!gift.requested_at) continue;
    const requested = new Set(requestsFor(eventId, gift.id).map((r) => r.guest_id));
    const asked = askedDefinitionIds(giftRequirements(eventId, gift.id), definitionsFor(eventId));
    outgoing.push(...recordRequests(eventId, gift.id, asked, requested));
  }
  deliverAfterCommit(eventId, outgoing);
}

/** Every request on the event with, per question, whether the attendee has answered it. */
function requestViews(eventId: string) {
  return requestsFor(eventId).map((r) => {
    const values = valuesFor(getGuest(r.guest_id));
    const answered = Object.fromEntries(r.definition_ids.map((id) => [id, !isBlank(values[id])]));
    return { guest_id: r.guest_id, gift_id: r.gift_id, definition_ids: r.definition_ids, sent_at: r.sent_at, follow_ups: r.followed_up_at.length, delivery: r.delivery ?? null, last_error: r.last_error, answered, complete: Object.values(answered).every(Boolean) };
  });
}

export function giftView(eventId: string, giftId: string) {
  const gift = requireGift(eventId, giftId);
  return { ...gift, quantities: quantities(gift), manifest: manifest(gift) };
}

export function manifestView(eventId: string, giftId: string) {
  const gift = requireGift(eventId, giftId);
  const event = requireEvent(eventId);
  return { gift_id: giftId, product_title: gift.product_title, needed_by: event.delivery?.needed_by ?? null, cutoff: gift.cutoff, locked_at: gift.locked_at, rows: manifest(gift) };
}

/** The organizer's decision for one guest; an empty body clears it. */
export function setOverride(eventId: string, giftId: string, guestId: string, body: unknown) {
  requireGift(eventId, giftId);
  requireGuest(eventId, guestId);
  setGiftOverride(giftId, guestId, parseBody(GiftOverride, body ?? {}));
  return giftView(eventId, giftId);
}

const MappingsBody = z.object({ mappings: z.array(PersonalizationMapping) });

/** Stores a gift's personalization mappings (set_personalization_mapping) after validating them against the product schema and the event's definitions (#117). */
export function setPersonalizationMappings(eventId: string, giftId: string, body: unknown) {
  const gift = requireGift(eventId, giftId);
  const event = requireEvent(eventId);
  if (!gift.personalization?.fields.length) throw new BadRequestError("The gift's product has no personalization schema.");
  const data = parseBody(MappingsBody, body);
  const errors = validateMappings(gift, event, data.mappings, definitionsFor(eventId));
  if (errors.length) throw new BadRequestError(errors.map((e) => `${e.code}: ${e.message}`).join("; "));
  updateGift(giftId, { personalization_mappings: data.mappings } as Partial<GiftInput>);
  return giftView(eventId, giftId);
}

/* ---- Invite and RSVP ---- */

/** The event as a guest sees it: every field but the owner's id. */
function publicEvent(event: Event): Omit<Event, "owner_id"> {
  const { owner_id: _owner, ...rest } = event;
  return rest;
}

export function inviteView(code: string) {
  const event = eventByCode(code);
  if (!event || event.status !== "published") throw new NotFoundError(`No published event with code ${code}.`);
  return { event: publicEvent(event), questions: definitionsFor(event.id).filter((d) => d.scope === "guest" && d.required_rule !== "never") };
}

const Answers = z.record(z.string(), z.unknown());
export const RsvpBody = z.object({
  party: z.object({ contact: z.object({ email: z.string().nullable().optional(), phone: z.string().nullable().optional() }).optional(), plus_one_allowance: z.number().int().optional() }).default({}),
  guests: z.array(z.object({ display_name: z.string().min(1), role: z.string().optional(), status: GuestStatus.optional(), attendance: z.record(z.string(), z.boolean()).optional(), answers: Answers.optional() })).min(1)
});

/** One party replies: guests, statuses, and answers, each answer validated by its definition. */
/**
 * The guest list (PRD Section 5): one guest per line as "Name", "Name <email>", "Name, email",
 * or a bare email. A bare-email line captures the address and derives the name from its local part.
 * A line whose second field is not an email (e.g. "Comma Person, notanemail") stays a name with no
 * email, so no data is dropped. Each line becomes a party with that contact and a guest with no
 * reply, so "everyone invited" counts the list and a reply from a listed guest updates their row.
 */
export function importGuests(eventId: string, body: unknown) {
  requireEvent(eventId);
  const parsed = z.object({ lines: z.array(z.string()).optional(), text: z.string().optional() }).safeParse(body);
  if (!parsed.success) throw new BadRequestError("Send lines or text.");
  const lines = (parsed.data.lines ?? parsed.data.text?.split(/\r?\n/) ?? []).map((l) => l.trim()).filter(Boolean);
  const existing = guestsFor(eventId);
  const added: Guest[] = [];
  for (const line of lines) {
    const m = line.match(/^(.*?)\s*(?:<([^>]+)>|,\s*(\S+@\S+))?\s*$/);
    let display_name = (m?.[1] ?? line).trim();
    let email = (m?.[2] ?? m?.[3] ?? "").trim() || null;
    // A bare-email line has no name field: capture the address, name from the local part.
    if (!email && /^\S+@\S+$/.test(display_name)) {
      email = display_name;
      display_name = display_name.slice(0, display_name.indexOf("@"));
    }
    if (!display_name) continue;
    if (existing.some((g) => g.display_name.toLowerCase() === display_name.toLowerCase()) || added.some((g) => g.display_name.toLowerCase() === display_name.toLowerCase())) continue;
    const party = createParty(eventId, { contact: { email } });
    added.push(createGuest(eventId, party.id, { display_name }));
  }
  return { added: added.length, guest_ids: added.map((g) => g.id) };
}

/**
 * An already-invited guest whose name or party email matches the reply, across any status, since
 * the invite form is the re-RSVP path (a re-reply or a cancel updates the row, not adds one). Guests
 * already taken in this submission are skipped so several guests sharing one party email each land on
 * a distinct row.
 */
function invitedMatch(eventId: string, displayName: string, email: string | null | undefined, used: Set<string>): Guest | undefined {
  const s = state();
  return guestsFor(eventId).find((g) => {
    if (used.has(g.id)) return false;
    if (g.display_name.toLowerCase() === displayName.trim().toLowerCase()) return true;
    const party = s.parties.get(g.party_id);
    return !!email && !!party?.contact.email && party.contact.email.toLowerCase() === email.toLowerCase();
  });
}

export function submitRsvp(eventId: string, body: unknown) {
  const event = requireEvent(eventId);
  if (event.status !== "published") throw new BadRequestError("The event is not published yet.");
  const parsed = RsvpBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  // One transaction over the whole party: a later guest's invalid answer rolls back every earlier write.
  return transactionally(() => {
  const email = parsed.data.party.contact?.email ?? null;
  const created: { party: ReturnType<typeof createParty> | null } = { party: null };
  const used = new Set<string>();
  const guests = parsed.data.guests.map((g) => {
    const invited = invitedMatch(eventId, g.display_name, email, used);
    let guest: Guest;
    if (invited) {
      // A listed guest replies: their row takes the status and the answers; the party keeps its contact.
      guest = g.status ? setGuestStatus(invited.id, g.status, "guest") : invited;
      for (const [segment, present] of Object.entries(g.attendance ?? {})) guest = setGuestAttendance(guest.id, segment, present);
      if (email) { const p = state().parties.get(guest.party_id); if (p && !p.contact.email) state().parties.set(p.id, { ...p, contact: { ...p.contact, email } }); }
    } else {
      created.party ??= createParty(eventId, parsed.data.party);
      guest = createGuest(eventId, created.party.id, { display_name: g.display_name, role: g.role, status: g.status, attendance: g.attendance });
    }
    used.add(guest.id);
    for (const [definitionId, raw] of Object.entries(g.answers ?? {})) writeAnswer(eventId, guest, definitionId, raw, "guest");
    return guest;
  });
  requestFromLateAttendees(eventId);
  afterRsvpWrite(eventId);
  return { party_id: created.party?.id ?? guests[0]?.party_id ?? null, guest_ids: guests.map((g) => g.id) };
  });
}

function writeAnswer(eventId: string, guest: Guest, definitionId: string, raw: unknown, source: string) {
  const def = definitionsFor(eventId).find((d) => d.id === definitionId);
  if (!def) throw new BadRequestError(`No question ${definitionId} on this event.`);
  const subject = def.scope === "party" ? (["party", guest.party_id] as const) : def.scope === "event" ? (["event", eventId] as const) : (["guest", guest.id] as const);
  try {
    return writeValue(subject[0], subject[1], definitionId, raw, source);
  } catch (e) {
    if (e instanceof InvalidValueError) throw new BadRequestError(e.message);
    throw e;
  }
}

export const RsvpPatch = z.object({ status: GuestStatus.optional(), attendance: z.record(z.string(), z.boolean()).optional(), answers: Answers.optional(), source: z.string().default("guest") });

/** A guest edits or cancels from the same link; a locked value rejects the edit with the lock (409). */
export function patchRsvp(eventId: string, guestId: string, body: unknown) {
  const parsed = RsvpPatch.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  let guest = requireGuest(eventId, guestId);
  // One transaction over the edit: a later invalid answer rolls back every earlier write.
  return transactionally(() => {
  for (const [definitionId, raw] of Object.entries(parsed.data.answers ?? {})) writeAnswer(eventId, guest, definitionId, raw, parsed.data.source);
  for (const [segment, present] of Object.entries(parsed.data.attendance ?? {})) guest = setGuestAttendance(guestId, segment, present);
  if (parsed.data.status) guest = setGuestStatus(guestId, parsed.data.status, parsed.data.source);
  requestFromLateAttendees(eventId);
  afterRsvpWrite(eventId);
  return { ...guest, values: valuesFor(guest) };
  });
}

/* ---- Reads the tools map onto ---- */

export function readFilter(raw: unknown): Filter {
  try {
    return parseFilter(raw);
  } catch (e) {
    throw new BadRequestError((e as Error).message);
  }
}

export function guestView(eventId: string, guestId: string, fields?: string[]) {
  const guest = requireGuest(eventId, guestId);
  const values = valuesFor(guest);
  return { ...guest, values: fields ? Object.fromEntries(Object.entries(values).filter(([k]) => fields.includes(k))) : values };
}

export function guestList(eventId: string, filter: Filter, fields?: string[]) {
  requireEvent(eventId);
  return listGuests(eventId, filter).map((g) => guestView(eventId, g.id, fields));
}

export function counts(eventId: string, definitionId: string, filter: Filter) {
  requireEvent(eventId);
  const def = definitionsFor(eventId).find((d) => d.id === definitionId);
  if (!def) throw new NotFoundError(`No definition ${definitionId} on event ${eventId}.`);
  return { definition: def, filter, ...countBy(eventId, definitionId, filter) };
}

export function missing(eventId: string, definitionId: string, filter: Filter) {
  requireEvent(eventId);
  const def = definitionsFor(eventId).find((d) => d.id === definitionId);
  if (!def) throw new NotFoundError(`No definition ${definitionId} on event ${eventId}.`);
  return { definition: def, guests: listMissing(eventId, definitionId, filter).map((g) => ({ id: g.id, display_name: g.display_name, status: g.status })) };
}

export function summary(eventId: string, definitionIds: string[], filter: Filter) {
  requireEvent(eventId);
  const defs = definitionsFor(eventId);
  const chosen = definitionIds.length ? definitionIds : defs.map((d) => d.id);
  const guests = guestsFor(eventId).filter((g) => matches(filter, subjectFor(g)));
  const statusCounts = { going: 0, maybe: 0, cant_go: 0, no_reply: 0 };
  for (const g of guests) statusCounts[g.status] += 1;
  return { filter, guests: guests.length, status: statusCounts, definitions: chosen.map((id) => counts(eventId, id, filter)) };
}

export function changes(eventId: string, since: number) {
  requireEvent(eventId);
  return { since, seq: currentSeq(), entries: changesSince(eventId, since) };
}

/* ---- Vendor updates ---- */

export const UpdateBody = z.object({ kind: UpdateKind, text: z.string().default(""), expected_date: z.string().nullable().default(null), reference: z.string().nullable().default(null), asset: z.string().nullable().default(null), guest_id: z.string().nullable().default(null) });

/** A vendor's or the organizer's post into a gift's thread; each becomes a change-log entry (PRD Section 9). */
export function postUpdate(eventId: string, giftId: string, caller: string, body: unknown): VendorUpdate {
  requireEvent(eventId);
  const parsed = UpdateBody.safeParse(body);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (parsed.data.guest_id) requireGuest(eventId, parsed.data.guest_id);
  const s = state();
  s.seq += 1;
  const update: VendorUpdate = { id: newId("upd"), event_id: eventId, gift_id: giftId, caller, ...parsed.data, created_at: new Date().toISOString(), seq: s.seq };
  s.updates.set(update.id, update);
  s.changes.push({ kind: "update", seq: update.seq, at: update.created_at, event_id: eventId, update_id: update.id, gift_id: giftId, update_kind: update.kind, caller });
  return update;
}

export function updatesFor(eventId: string, giftId: string, since = 0): VendorUpdate[] {
  requireEvent(eventId);
  return [...state().updates.values()].filter((u) => u.event_id === eventId && u.gift_id === giftId && u.seq > since).sort((a, b) => a.seq - b.seq);
}

/* ---- Errors to responses ---- */

export function errorResponse(e: unknown): NextResponse {
  // A malformed request body makes `request.json()` throw a SyntaxError; that is a client error, not a 500.
  if (e instanceof SyntaxError) return NextResponse.json({ error: "The body is not JSON." }, { status: 400 });
  if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
  if (e instanceof BadRequestError) return NextResponse.json({ error: e.message }, { status: 400 });
  if (e instanceof UnauthorizedError) return NextResponse.json({ error: e.message }, { status: 401 });
  if (e instanceof ForbiddenError) return NextResponse.json({ error: e.message }, { status: 403 });
  if (e instanceof LockedValueError) return NextResponse.json({ error: e.message, locked: { definition_id: e.definition.id, label: e.definition.label, ...e.lock } }, { status: 409 });
  throw e;
}

export type Definition = AttributeDefinition;
