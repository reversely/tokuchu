/**
 * The in-memory store (PRD Section 7). A call under `runWithState` reads and writes the State it
 * was given; every other caller reads the process-wide State on `globalThis`, which the Next dev
 * server's module reloads keep, with the same backfill pattern as the planner's
 * src/server/state.ts. Every write to a value, a guest's status, or a vendor thread appends one
 * change-log entry with a rising sequence number; readers poll `changesSince`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import { matches, type Filter, type Subject } from "./filter";
import * as T from "./types";
import type { AttributeDefinition, AttributeValue, Batch, CallerToken, ChangeEntry, ChatMessage, Event, Guest, GuestStatus, Party, Request, RequestDelivery, Schedule, VendorUpdate } from "./types";
import { aggregate, validateValue, type Aggregate } from "./values";
import libraryData from "./library.json";

export type State = {
  events: Map<string, Event>;
  parties: Map<string, Party>;
  guests: Map<string, Guest>;
  definitions: Map<string, AttributeDefinition>;
  /** Keyed by subject type, subject id, and definition id joined with `|`. */
  values: Map<string, AttributeValue>;
  updates: Map<string, VendorUpdate>;
  gifts: Map<string, Batch>;
  tokens: Map<string, CallerToken>;
  /** Keyed by guest id and gift id joined with `|`: one request per attendee per gift. */
  requests: Map<string, Request>;
  messages: Map<string, ChatMessage>;
  schedules: Map<string, Schedule>;
  changes: ChangeEntry[];
  seq: number;
  ids: number;
  /** The guest ids an account has taken over; process-wide bookkeeping that no document carries. */
  consumed_guests: Set<string>;
};

declare global {
  // eslint-disable-next-line no-var
  var __gatherState: State | undefined;
}

export function freshState(): State {
  return { events: new Map(), parties: new Map(), guests: new Map(), definitions: new Map(), values: new Map(), updates: new Map(), gifts: new Map(), tokens: new Map(), requests: new Map(), messages: new Map(), schedules: new Map(), changes: [], seq: 0, ids: 0, consumed_guests: new Set() };
}

const scopedState = new AsyncLocalStorage<State>();

/** Runs fn with `state()` bound to the given State for every call in fn's async context. */
export function runWithState<T>(s: State, fn: () => T): T {
  return scopedState.run(s, fn);
}

export function state(): State {
  const scoped = scopedState.getStore();
  if (scoped) return scoped;
  if (!globalThis.__gatherState) globalThis.__gatherState = freshState();
  const current = globalThis.__gatherState as unknown as Record<string, unknown>;
  const template = freshState() as unknown as Record<string, unknown>;
  for (const key of Object.keys(template)) if (current[key] === undefined) current[key] = template[key];
  return globalThis.__gatherState;
}

/** Test hook: an empty store, in place of the scoped State when one is set and otherwise on `globalThis`. */
export function resetState(): void {
  const scoped = scopedState.getStore();
  if (scoped) Object.assign(scoped, freshState());
  else globalThis.__gatherState = freshState();
}

/* ---- Serialization ---- */

const entries = <V extends z.ZodType>(value: V) => z.array(z.tuple([z.string(), value]));

/** The JSON-safe form of a State: each Map as an array of [key, value] pairs. */
const StateDocument = z.object({
  events: entries(T.Event),
  parties: entries(T.Party),
  guests: entries(T.Guest),
  definitions: entries(T.AttributeDefinition),
  values: entries(T.AttributeValue),
  updates: entries(T.VendorUpdate),
  gifts: entries(T.Batch),
  tokens: entries(T.CallerToken),
  requests: entries(T.Request),
  messages: entries(T.ChatMessage).default([]),
  schedules: entries(T.Schedule).default([]),
  changes: z.array(T.ChangeEntry),
  seq: z.number().int(),
  ids: z.number().int()
});
export type StateDocument = z.infer<typeof StateDocument>;

export function serializeState(s: State): StateDocument {
  return { events: [...s.events], parties: [...s.parties], guests: [...s.guests], definitions: [...s.definitions], values: [...s.values], updates: [...s.updates], gifts: [...s.gifts], tokens: [...s.tokens], requests: [...s.requests], messages: [...s.messages], schedules: [...s.schedules], changes: s.changes, seq: s.seq, ids: s.ids };
}

/**
 * Rebuilds a State from a document `serializeState` produced.
 *
 * Raises:
 *   ZodError: when the document does not have the State shape.
 */
export function deserializeState(doc: unknown): State {
  const d = StateDocument.parse(doc);
  return { events: new Map(d.events), parties: new Map(d.parties), guests: new Map(d.guests), definitions: new Map(d.definitions), values: new Map(d.values), updates: new Map(d.updates), gifts: new Map(d.gifts), tokens: new Map(d.tokens), requests: new Map(d.requests), messages: new Map(d.messages), schedules: new Map(d.schedules), changes: d.changes, seq: d.seq, ids: d.ids, consumed_guests: new Set() };
}

/**
 * Runs fn as one unit: on a throw, every store map and counter returns to the pre-call snapshot, so
 * a multi-write operation (an RSVP over several guests) never leaves earlier writes committed behind
 * a later item's error. Each write replaces a value rather than mutating it in place, so a shallow
 * clone of each map is a sufficient snapshot.
 */
export function transactionally<T>(fn: () => T): T {
  const s = state();
  const snapshot: State = { events: new Map(s.events), parties: new Map(s.parties), guests: new Map(s.guests), definitions: new Map(s.definitions), values: new Map(s.values), updates: new Map(s.updates), gifts: new Map(s.gifts), tokens: new Map(s.tokens), requests: new Map(s.requests), messages: new Map(s.messages), schedules: new Map(s.schedules), changes: [...s.changes], seq: s.seq, ids: s.ids, consumed_guests: s.consumed_guests };
  try {
    return fn();
  } catch (e) {
    Object.assign(s, snapshot);
    throw e;
  }
}

export function newId(prefix: string): string {
  const s = state();
  s.ids += 1;
  return `${prefix}_${s.ids}`;
}

const now = () => new Date().toISOString();

function nextSeq(): number {
  const s = state();
  s.seq += 1;
  return s.seq;
}

export class InvalidValueError extends Error {}

/* ---- Events and definitions ---- */

/**
 * The question library (library.json): rows the organizer picks from on the draft page, edits, or
 * replaces. Entries flagged `seed` are added to a new event; their options list starts empty and
 * the organizer fills it, so no dietary vocabulary lives in code.
 */
export type LibraryQuestion = { key: string; label: string; scope: AttributeDefinition["scope"]; value_type: AttributeDefinition["value_type"]; constraints: AttributeDefinition["constraints"]; required_rule: AttributeDefinition["required_rule"]; seed: boolean };
export type Library = { questions: LibraryQuestion[]; event_defaults: { type: string; response_options: GuestStatus[]; settings: Event["settings"] } };

export function library(): Library {
  return libraryData as Library;
}

export function seedDefinitions(eventId: string): AttributeDefinition[] {
  return library()
    .questions.filter((q) => q.seed)
    .map((q) => ({ id: newId("def"), event_id: eventId, namespace: "core", key: q.key, label: q.label, scope: q.scope, value_type: q.value_type, constraints: q.constraints, default_visibility: [], required_rule: q.required_rule, creator: "library" }));
}

export type EventInput = Omit<Event, "id" | "definition_ids" | "status" | "invite_code" | "created_at" | "contact" | "owner_id" | "demo"> & { contact?: Event["contact"] };

/** An event id unique across every stored document, unlike the per-document `newId` counter. */
export function newEventId(): string {
  return `evt_${crypto.randomUUID()}`;
}

export function createEvent(input: EventInput, id: string = newId("evt"), ownerId: string | null = null, demo = false): Event {
  const s = state();
  const defs = seedDefinitions(id);
  for (const d of defs) s.definitions.set(d.id, d);
  const event: Event = { ...input, contact: input.contact ?? { email: null, phone: null }, id, definition_ids: defs.map((d) => d.id), status: "draft", invite_code: null, created_at: now(), owner_id: ownerId, demo };
  s.events.set(id, event);
  return event;
}

export function getEvent(id: string): Event {
  const event = state().events.get(id);
  if (!event) throw new Error(`No event ${id}.`);
  // An event stored before the delivery choice or the contact existed reads with the field's default.
  const delivery = event.delivery ?? { destination: "venue", address: null, needed_by: null };
  const contact = event.contact ?? { email: null, phone: null };
  return event.delivery && event.contact ? event : { ...event, delivery, contact };
}

export function eventByCode(code: string): Event | undefined {
  return [...state().events.values()].find((e) => e.invite_code === code.toUpperCase());
}

export function updateEvent(id: string, patch: Partial<EventInput>): Event {
  const s = state();
  const event = { ...getEvent(id), ...patch };
  s.events.set(id, event);
  return event;
}

/** Invite codes use letters and digits that read unambiguously (no 0, O, 1, I). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // pragma: allowlist secret
export function publishEvent(id: string): Event {
  const s = state();
  const event = getEvent(id);
  if (event.status === "published" && event.invite_code) return event;
  let code = "";
  do code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  while (eventByCode(code));
  const published: Event = { ...event, status: "published", invite_code: code };
  s.events.set(id, published);
  return published;
}

export function definitionsFor(eventId: string): AttributeDefinition[] {
  const s = state();
  return getEvent(eventId).definition_ids.map((id) => s.definitions.get(id)!).filter(Boolean);
}

export function getDefinition(id: string): AttributeDefinition {
  const def = state().definitions.get(id);
  if (!def) throw new Error(`No definition ${id}.`);
  return def;
}

/** Adds or replaces a definition on the event. A changed definition is what re-asks read (PRD Section 9). */
export function upsertDefinition(eventId: string, def: Omit<AttributeDefinition, "id" | "event_id"> & { id?: string }): AttributeDefinition {
  const s = state();
  const event = getEvent(eventId);
  const row: AttributeDefinition = { ...def, id: def.id ?? newId("def"), event_id: eventId };
  s.definitions.set(row.id, row);
  if (!event.definition_ids.includes(row.id)) s.events.set(eventId, { ...event, definition_ids: [...event.definition_ids, row.id] });
  return row;
}

/* ---- Parties and guests ---- */

export function createParty(eventId: string, input: { contact?: { email?: string | null; phone?: string | null }; plus_one_allowance?: number }): Party {
  const s = state();
  getEvent(eventId);
  const party: Party = { id: newId("party"), event_id: eventId, guest_ids: [], contact: { email: input.contact?.email ?? null, phone: input.contact?.phone ?? null }, plus_one_allowance: input.plus_one_allowance ?? 0 };
  s.parties.set(party.id, party);
  return party;
}

export function createGuest(eventId: string, partyId: string, input: { display_name: string; role?: string; status?: GuestStatus; attendance?: Record<string, boolean> }): Guest {
  const s = state();
  const party = s.parties.get(partyId);
  if (!party || party.event_id !== eventId) throw new Error(`No party ${partyId} on event ${eventId}.`);
  const guest: Guest = { id: newId("guest"), event_id: eventId, party_id: partyId, role: input.role ?? "guest", status: input.status ?? "no_reply", attendance: input.attendance ?? {}, display_name: input.display_name };
  s.guests.set(guest.id, guest);
  s.parties.set(partyId, { ...party, guest_ids: [...party.guest_ids, guest.id] });
  if (guest.status !== "no_reply") s.changes.push({ kind: "status", seq: nextSeq(), at: now(), event_id: eventId, guest_id: guest.id, from: "no_reply", to: guest.status, source: "guest" });
  return guest;
}

export function getGuest(id: string): Guest {
  const guest = state().guests.get(id);
  if (!guest) throw new Error(`No guest ${id}.`);
  return guest;
}

export function guestsFor(eventId: string): Guest[] {
  return [...state().guests.values()].filter((g) => g.event_id === eventId);
}

/** A status change is a change-log entry (PRD Section 7): the write a vendor most needs to see. */
export function setGuestStatus(guestId: string, status: GuestStatus, source: string): Guest {
  const s = state();
  const guest = getGuest(guestId);
  if (guest.status === status) return guest;
  const next = { ...guest, status };
  s.guests.set(guestId, next);
  s.changes.push({ kind: "status", seq: nextSeq(), at: now(), event_id: guest.event_id, guest_id: guestId, from: guest.status, to: status, source });
  return next;
}

export function setGuestAttendance(guestId: string, segmentId: string, present: boolean): Guest {
  const s = state();
  const guest = getGuest(guestId);
  const next = { ...guest, attendance: { ...guest.attendance, [segmentId]: present } };
  s.guests.set(guestId, next);
  return next;
}

/* ---- Values ---- */

const valueKey = (subjectType: string, subjectId: string, definitionId: string) => `${subjectType}|${subjectId}|${definitionId}`;

export function getValue(subjectType: AttributeValue["subject_type"], subjectId: string, definitionId: string): AttributeValue | undefined {
  return state().values.get(valueKey(subjectType, subjectId, definitionId));
}

/**
 * Validates and stores one value at any time; an invalid value rejects with the reason. A write
 * after approval succeeds and its seq marks the guest as changed since approval.
 */
export function writeValue(subjectType: AttributeValue["subject_type"], subjectId: string, definitionId: string, raw: unknown, source: string): AttributeValue {
  const s = state();
  const def = getDefinition(definitionId);
  const checked = validateValue(def, raw);
  if (!checked.ok) throw new InvalidValueError(checked.reason);
  const row: AttributeValue = { subject_type: subjectType, subject_id: subjectId, definition_id: definitionId, value: checked.value, source, updated_at: now(), seq: nextSeq() };
  s.values.set(valueKey(subjectType, subjectId, definitionId), row);
  s.changes.push({ kind: "value", seq: row.seq, at: row.updated_at, event_id: def.event_id, subject_type: subjectType, subject_id: subjectId, definition_id: definitionId, value: checked.value, source });
  return row;
}

/** The value rows a guest's answers read: the guest's own and the party's and the event's under their definitions. */
function valueRowsFor(guest: Guest): AttributeValue[] {
  const rows: AttributeValue[] = [];
  for (const def of definitionsFor(guest.event_id)) {
    const row = def.scope === "party" ? getValue("party", guest.party_id, def.id) : def.scope === "event" ? getValue("event", guest.event_id, def.id) : getValue("guest", guest.id, def.id);
    if (row) rows.push(row);
  }
  return rows;
}

/** The highest change-log seq among a guest's answers, or 0 with none. */
export function latestValueSeq(guest: Guest): number {
  return valueRowsFor(guest).reduce((max, row) => Math.max(max, row.seq), 0);
}

/** A guest's values by definition id, with the party's values under their definition ids as well. */
export function valuesFor(guest: Guest): Record<string, unknown> {
  return Object.fromEntries(valueRowsFor(guest).map((row) => [row.definition_id, row.value]));
}

export function subjectFor(guest: Guest): Subject {
  return { guest, party: state().parties.get(guest.party_id) ?? null, values: valuesFor(guest) };
}

/* ---- Requests ---- */

const requestKey = (guestId: string, giftId: string) => `${guestId}|${giftId}`;

export function requestsFor(eventId: string, giftId?: string): Request[] {
  return [...state().requests.values()].filter((r) => r.event_id === eventId && (giftId === undefined || r.gift_id === giftId));
}

/** Records a send to one guest for one gift; a second send to the same guest replaces the question list and keeps the first send time. */
export function upsertRequest(eventId: string, guestId: string, giftId: string, definitionIds: string[]): Request {
  const s = state();
  const key = requestKey(guestId, giftId);
  const existing = s.requests.get(key);
  const row: Request = existing ? { ...existing, definition_ids: definitionIds } : { id: newId("req"), event_id: eventId, guest_id: guestId, gift_id: giftId, definition_ids: definitionIds, sent_at: now(), followed_up_at: [], last_error: null };
  s.requests.set(key, row);
  return row;
}

export function recordFollowUp(request: Request): Request {
  const s = state();
  const row = { ...request, followed_up_at: [...request.followed_up_at, now()] };
  s.requests.set(requestKey(row.guest_id, row.gift_id), row);
  return row;
}

/** Records how a request's latest email left. A request the transaction rolled back has no row and takes no write. */
export function setRequestDelivery(guestId: string, giftId: string, delivery: RequestDelivery, error: string | null = null): Request | undefined {
  const s = state();
  const key = requestKey(guestId, giftId);
  const existing = s.requests.get(key);
  if (!existing) return undefined;
  const row: Request = { ...existing, delivery, last_error: error };
  s.requests.set(key, row);
  return row;
}

/* ---- Reads the tools map onto ---- */

export function listGuests(eventId: string, filter: Filter = []): Guest[] {
  return guestsFor(eventId).filter((g) => matches(filter, subjectFor(g)));
}

export function countBy(eventId: string, definitionId: string, filter: Filter = []): Aggregate {
  const def = getDefinition(definitionId);
  const guests = listGuests(eventId, filter);
  return aggregate(def, guests.map((g) => valuesFor(g)[definitionId]));
}

export function listMissing(eventId: string, definitionId: string, filter: Filter = []): Guest[] {
  getDefinition(definitionId);
  return listGuests(eventId, filter).filter((g) => {
    const v = valuesFor(g)[definitionId];
    return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
  });
}

export function changesSince(eventId: string, seq: number): ChangeEntry[] {
  return state().changes.filter((c) => c.event_id === eventId && c.seq > seq);
}

export function currentSeq(): number {
  return state().seq;
}
