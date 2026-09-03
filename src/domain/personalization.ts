/**
 * Personalization mappings: how RSVP definitions, event fields, guest rows, and literals flow into a
 * vendor's personalization fields. The compatibility tables are data, so a new kind or transform
 * is a row here; gifts.ts calls personalizeRow per manifest row and api.ts calls validateMappings
 * before a mapping is stored.
 */
import type { Subject } from "./filter";
import type { AttributeDefinition, Batch, Event, MappingSource, PersonalizationField, PersonalizationKind, PersonalizationMapping, PersonalizationTransform, ValueType, Venue } from "./types";

/**
 * Where one requirement stands for one attendee. A field existing does not resolve a requirement:
 * the value must pass the field's constraints, no store may have rejected it, the mapping must be
 * settled, and it must not have changed since the approval.
 */
export type RequirementResolutionStatus = "resolved" | "missing" | "invalid" | "mapping_unresolved" | "needs_confirmation" | "vendor_rejected" | "changed_after_approval";

/** How a resolved value came to be: an attendee's or organizer's field, a value derived through a transform or from the event, an answer a store's requirement asked for, or a literal the organizer set. */
export type ResolvedValueSource = "existing_field" | "derived" | "vendor_requested_answer" | "literal";

/** The provenance of one resolved value: internal by default, available to the organizer's view and for audit. */
export type ResolvedFulfillmentValue = {
  requirement_id: string;
  attribute_id?: string;
  value: unknown;
  source: ResolvedValueSource;
  /** The definitions a derived value reads and the transform applied. */
  source_attribute_ids?: string[];
  transform?: PersonalizationTransform;
  reconciliation_method?: string;
  updated_at: string;
  revision: number;
};

export type PersonalizationIssue = { guest_id?: string; vendor_field_key: string; code: "missing_source" | "missing_value" | "invalid_type" | "too_long" | "unsupported_value" | "vendor_rejected" | "changed_after_approval" | "needs_confirmation" | "mapping_unresolved"; status: Exclude<RequirementResolutionStatus, "resolved">; message: string };
export type PersonalizationStatus = "ready" | "incomplete" | "invalid";
export type ResolvedField = { value: unknown; source: MappingSource; status: RequirementResolutionStatus; provenance?: ResolvedFulfillmentValue };
export type RowPersonalization = { personalization: Record<string, ResolvedField>; personalization_status: PersonalizationStatus; personalization_issues: PersonalizationIssue[] };

/** What a row's grading reads beyond the gift and the subject; every part is optional so a caller without a store grades on the values alone. */
export type ResolutionContext = {
  /** The event's definitions by id, for the provenance of a definition source. */
  definitions?: Map<string, AttributeDefinition>;
  /** The stored value row a definition source read for this subject, for its time and revision. */
  valueRow?: (definitionId: string) => { updated_at: string; seq: number } | undefined;
  /** The revision the organizer approved; a value written after it reads as changed_after_approval. */
  approvedRevision?: number | null;
  /** The requirement keys a store rejected for this attendee through an open exception. */
  rejected?: ReadonlySet<string>;
};

type EventKey = "title" | "starts_at" | "venue";
type GuestKey = "display_name";

/** The definition value types each field kind accepts. */
export const KIND_VALUE_TYPES: Record<PersonalizationKind, ValueType[]> = {
  text: ["text", "enum", "number"],
  name: ["text"],
  monogram: ["text"],
  date: ["date"],
  time: ["text"],
  location: ["text"],
  star_map: ["text", "date"],
  color: ["text", "enum"],
  word_list: ["text", "multi_enum"],
  image: ["file"]
};

/** The event keys each field kind accepts without a transform. */
export const KIND_EVENT_KEYS: Record<PersonalizationKind, EventKey[]> = {
  text: ["title", "starts_at"],
  name: ["title"],
  monogram: [],
  date: ["starts_at"],
  time: [],
  location: ["venue"],
  star_map: ["starts_at", "venue"],
  color: [],
  word_list: [],
  image: []
};

/** The guest row fields each field kind accepts: the display name fills a name or a text field. */
export const KIND_GUEST_KEYS: Record<PersonalizationKind, GuestKey[]> = {
  text: ["display_name"],
  name: ["display_name"],
  monogram: [],
  date: [],
  time: [],
  location: [],
  star_map: [],
  color: [],
  word_list: [],
  image: []
};

/** The definition value types each transform accepts. */
export const TRANSFORM_VALUE_TYPES: Record<PersonalizationTransform, ValueType[]> = { uppercase: ["text", "enum"], lowercase: ["text", "enum"], date_only: ["date"], location_query: [] };

/** The event keys each transform accepts. */
export const TRANSFORM_EVENT_KEYS: Record<PersonalizationTransform, EventKey[]> = { uppercase: ["title"], lowercase: ["title"], date_only: ["starts_at"], location_query: ["venue"] };

/* ---- Validation (set_personalization_mapping) ---- */

export type MappingError = { vendor_field_key: string; code: "unknown_field" | "unmapped_required" | "unknown_definition" | "scope_mismatch" | "incompatible_type" | "incompatible_transform"; message: string };

/** Every reason a mapping list cannot be stored against the gift's product schema and the event's definitions. */
export function validateMappings(gift: Batch, event: Event, mappings: PersonalizationMapping[], definitions: AttributeDefinition[]): MappingError[] {
  const errors: MappingError[] = [];
  const fields = new Map((gift.personalization?.fields ?? []).map((f) => [f.key, f]));
  const defs = new Map(definitions.map((d) => [d.id, d]));
  for (const mapping of mappings) {
    const field = fields.get(mapping.vendor_field_key);
    if (!field) {
      errors.push({ vendor_field_key: mapping.vendor_field_key, code: "unknown_field", message: `the product has no field ${mapping.vendor_field_key}` });
      continue;
    }
    errors.push(...sourceErrors(mapping, field, defs));
  }
  for (const field of gift.personalization?.fields ?? []) {
    if (field.required && !mappings.some((m) => m.vendor_field_key === field.key)) errors.push({ vendor_field_key: field.key, code: "unmapped_required", message: `${field.label} needs a mapping` });
  }
  return errors;
}

function sourceErrors(mapping: PersonalizationMapping, field: PersonalizationField, defs: Map<string, AttributeDefinition>): MappingError[] {
  const errors: MappingError[] = [];
  const err = (code: MappingError["code"], message: string) => errors.push({ vendor_field_key: mapping.vendor_field_key, code, message });
  const { source, transform } = mapping;
  if (source.type === "definition") {
    const def = defs.get(source.definition_id);
    if (!def) {
      err("unknown_definition", `no definition ${source.definition_id} on this event`);
      return errors;
    }
    if (def.scope !== source.subject_scope) err("scope_mismatch", `${def.label} is ${def.scope} scoped`);
    if (!KIND_VALUE_TYPES[field.kind].includes(def.value_type)) err("incompatible_type", `${def.label} does not fit a ${field.kind} field`);
    if (transform && !TRANSFORM_VALUE_TYPES[transform].includes(def.value_type)) err("incompatible_transform", `${transform} does not fit ${def.label}`);
  } else if (source.type === "event") {
    // A valid transform reshapes the event value into the field's kind, so the untransformed table applies only without one.
    if (transform) {
      if (!TRANSFORM_EVENT_KEYS[transform].includes(source.key)) err("incompatible_transform", `${transform} does not fit the event ${source.key}`);
    } else if (!KIND_EVENT_KEYS[field.kind].includes(source.key)) err("incompatible_type", `the event ${source.key} does not fit a ${field.kind} field`);
  } else if (source.type === "guest") {
    if (!KIND_GUEST_KEYS[field.kind].includes(source.key)) err("incompatible_type", `the guest ${source.key} does not fit a ${field.kind} field`);
  } else if (transform) {
    // Apply the transform to the literal exactly as personalizeRow will later, so a literal the
    // transform can never consume (a "hello" into date_only) is refused here, not per unit downstream.
    const applied = applyTransform(transform, source.value);
    if (!applied.ok) err("incompatible_transform", applied.reason);
  }
  return errors;
}

/* ---- Resolution (get_manifest) ---- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;
/** The clock form a time field takes: HH:MM on a 24-hour clock. */
export const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isMissing = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** True when the gift's product carries personalization fields, so its manifest rows resolve values. */
export function personalized(gift: Batch): boolean {
  return (gift.personalization?.fields.length ?? 0) > 0;
}

/** The venue as one search string for a location autocomplete: name, city, region, country. */
export function locationQuery(venue: Partial<Venue>): string {
  return [venue.name, venue.city, venue.region, venue.country].filter((part) => typeof part === "string" && part.trim() !== "").join(", ");
}

/** The raw value a mapping's source names: the subject's answer, the event field, the guest's display name, or the literal. */
export function resolveSourceValue(source: MappingSource, event: Event, subject: Subject): unknown {
  switch (source.type) {
    case "definition":
      return subject.values[source.definition_id];
    case "event":
      return source.key === "title" ? event.title : source.key === "starts_at" ? event.starts_at : event.venue;
    case "guest":
      return subject.guest.display_name;
    case "literal":
      return source.value;
  }
}

/** Applies one transform; a missing value passes through so the missing-value issue names the real cause. */
export function applyTransform(transform: PersonalizationTransform, value: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (isMissing(value)) return { ok: true, value };
  switch (transform) {
    case "uppercase":
    case "lowercase":
      if (typeof value !== "string") return { ok: false, reason: `${transform} needs text` };
      return { ok: true, value: transform === "uppercase" ? value.toUpperCase() : value.toLowerCase() };
    case "date_only":
      if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) return { ok: false, reason: "date_only needs an ISO date" };
      return { ok: true, value: value.slice(0, 10) };
    case "location_query": {
      if (typeof value !== "object" || value === null) return { ok: false, reason: "location_query needs an address" };
      const query = locationQuery(value as Partial<Venue>);
      if (!query) return { ok: false, reason: "the address has no usable part" };
      return { ok: true, value: query };
    }
  }
}

/** A field's length cap and allowed set, read from the store's constraints block or the older flat keys. */
export function fieldConstraints(field: PersonalizationField): { max_length?: number; allowed: string[] } {
  const max_length = field.constraints?.max_length ?? field.max_length;
  const allowed = field.constraints?.options?.map((o) => o.value) ?? field.allowed_values ?? [];
  return { max_length, allowed };
}

function valueIssue(field: PersonalizationField, value: unknown): Pick<PersonalizationIssue, "code" | "message"> | null {
  const { max_length, allowed } = fieldConstraints(field);
  if (field.kind === "date") {
    if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) return { code: "invalid_type", message: `${field.label} needs a date` };
  } else if (field.kind === "time") {
    if (typeof value !== "string" || !CLOCK_TIME.test(value)) return { code: "invalid_type", message: `${field.label} needs a time as HH:MM` };
  } else if (field.kind === "image") {
    if (typeof value !== "string" || !/^(https:\/\/|data:image\/)/.test(value)) return { code: "invalid_type", message: `${field.label} needs an https address or an image data URL` };
  } else if (field.kind === "word_list") {
    const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : null;
    if (!list || list.some((v) => typeof v !== "string")) return { code: "invalid_type", message: `${field.label} needs words` };
  } else if (typeof value !== "string") {
    return { code: "invalid_type", message: `${field.label} needs text` };
  }
  if (max_length !== undefined && typeof value === "string" && value.length > max_length) return { code: "too_long", message: `${field.label} allows ${max_length} characters` };
  if (allowed.length) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some((v) => !allowed.includes(String(v)))) return { code: "unsupported_value", message: `${field.label} takes ${allowed.join(" or ")}` };
  }
  return null;
}

/** The resolution status each issue code grades the requirement. */
const ISSUE_RESOLUTION: Record<PersonalizationIssue["code"], PersonalizationIssue["status"]> = {
  missing_source: "mapping_unresolved",
  mapping_unresolved: "mapping_unresolved",
  missing_value: "missing",
  invalid_type: "invalid",
  too_long: "invalid",
  unsupported_value: "invalid",
  vendor_rejected: "vendor_rejected",
  changed_after_approval: "changed_after_approval",
  needs_confirmation: "needs_confirmation"
};

/** The row grade each requirement status carries; a changed value stays usable, so it leaves the row ready. */
const ROW_GRADE: Record<RequirementResolutionStatus, PersonalizationStatus> = {
  resolved: "ready",
  changed_after_approval: "ready",
  missing: "incomplete",
  mapping_unresolved: "incomplete",
  needs_confirmation: "incomplete",
  invalid: "invalid",
  vendor_rejected: "invalid"
};

/** The provenance of a value a mapping resolved: which definition or transform it came through and when it was written. */
function provenance(field: PersonalizationField, mapping: PersonalizationMapping, value: unknown, event: Event, context: ResolutionContext): ResolvedFulfillmentValue {
  const { source, transform } = mapping;
  const base = { requirement_id: field.key, value, ...(transform ? { transform } : {}) };
  if (source.type === "definition") {
    const def = context.definitions?.get(source.definition_id);
    const row = context.valueRow?.(source.definition_id);
    const stamp = { updated_at: row?.updated_at ?? event.created_at, revision: row?.seq ?? 0 };
    if (transform) return { ...base, source: "derived", source_attribute_ids: [source.definition_id], ...stamp };
    return { ...base, attribute_id: source.definition_id, source: def?.namespace === "vendor" || def?.vendor_field ? "vendor_requested_answer" : "existing_field", ...stamp };
  }
  const stamp = { updated_at: event.created_at, revision: 0 };
  if (source.type === "literal") return { ...base, source: "literal", ...stamp };
  return { ...base, source: "derived", source_attribute_ids: [], ...stamp };
}

/**
 * Resolves every mapped vendor field for one guest, grades each requirement with its resolution
 * status and provenance, and grades the row: ready, incomplete (a source or value missing or
 * unconfirmed), or invalid (a value that fails its field or that the store rejected).
 */
export function personalizeRow(gift: Batch, event: Event, subject: Subject, context: ResolutionContext = {}): RowPersonalization {
  const mappings = new Map((gift.personalization_mappings ?? []).map((m) => [m.vendor_field_key, m]));
  const issues: PersonalizationIssue[] = [];
  const resolved: Record<string, ResolvedField> = {};
  const guestId = subject.guest.id;
  const issue = (key: string, code: PersonalizationIssue["code"], message: string) => issues.push({ guest_id: guestId, vendor_field_key: key, code, status: ISSUE_RESOLUTION[code], message });
  for (const field of gift.personalization?.fields ?? []) {
    const mapping = mappings.get(field.key);
    if (!mapping) {
      if (field.required) issue(field.key, "missing_source", `${field.label} has not been requested from attendees`);
      continue;
    }
    if (mapping.resolution === "unresolved") {
      issue(field.key, "mapping_unresolved", `${field.label} needs its mapping settled again`);
      resolved[field.key] = { value: null, source: mapping.source, status: "mapping_unresolved" };
      continue;
    }
    let value = resolveSourceValue(mapping.source, event, subject);
    if (mapping.transform) {
      const transformed = applyTransform(mapping.transform, value);
      if (!transformed.ok) {
        issue(field.key, "invalid_type", transformed.reason);
        resolved[field.key] = { value: null, source: mapping.source, status: "invalid" };
        continue;
      }
      value = transformed.value;
    }
    if (isMissing(value)) {
      if (field.required) issue(field.key, "missing_value", `${field.label} is not confirmed by the attendee yet`);
      resolved[field.key] = { value: null, source: mapping.source, status: "missing" };
      continue;
    }
    const failed = valueIssue(field, value);
    const origin = provenance(field, mapping, value, event, context);
    let status: RequirementResolutionStatus = "resolved";
    if (failed) {
      issue(field.key, failed.code, failed.message);
      status = "invalid";
    } else if (context.rejected?.has(field.key)) {
      issue(field.key, "vendor_rejected", `The store rejected ${field.label}`);
      status = "vendor_rejected";
    } else if (mapping.resolution === "needs_confirmation") {
      issue(field.key, "needs_confirmation", `${field.label} waits for the organizer to confirm its mapping`);
      status = "needs_confirmation";
    } else if (typeof context.approvedRevision === "number" && origin.revision > context.approvedRevision) {
      issue(field.key, "changed_after_approval", `${field.label} changed after the approval`);
      status = "changed_after_approval";
    }
    resolved[field.key] = { value, source: mapping.source, status, provenance: origin };
  }
  const grades = issues.map((i) => ROW_GRADE[i.status]);
  return { personalization: resolved, personalization_status: grades.includes("invalid") ? "invalid" : grades.includes("incomplete") ? "incomplete" : "ready", personalization_issues: issues };
}
