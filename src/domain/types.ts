/**
 * Tokuchu's records (PRD Section 7). Everything domain-specific is a row: a question is an
 * AttributeDefinition, an answer an AttributeValue, a role a string the organizer chose. Code
 * knows the eight value types, the filter grammar (filter.ts), and the tool list (webmcp/tools.ts).
 * Money is in cents; dates are ISO strings.
 */
import { z } from "zod";
import { OPS } from "./filter";

export const ValueType = z.enum(["text", "number", "boolean", "enum", "multi_enum", "date", "file", "reference"]);
export type ValueType = z.infer<typeof ValueType>;

export const Option = z.object({ value: z.string(), label: z.string() });
export type Option = z.infer<typeof Option>;

export const Constraints = z.object({
  options: z.array(Option).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  max_length: z.number().int().optional(),
  pattern: z.string().optional()
});
export type Constraints = z.infer<typeof Constraints>;

/**
 * The store field a definition came from and where that field lives: the store, the product, the
 * requirement schema and its version, and the requirement's own id (the store's field key). The
 * definition's key is Tokuchu's canonical name for the concept and never carries the store's name.
 */
export const VendorField = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.string(),
  vendor_id: z.string().optional(),
  product_id: z.string().optional(),
  requirement_schema_id: z.string().optional(),
  requirement_schema_version: z.string().optional(),
  requirement_id: z.string().optional()
});
export type VendorField = z.infer<typeof VendorField>;

/** Who a definition belongs to: the library's seed, the organizer's own question, or a store's requirement. */
export const DefinitionNamespace = z.enum(["core", "organizer", "vendor"]);
export type DefinitionNamespace = z.infer<typeof DefinitionNamespace>;

export const AttributeDefinition = z.object({
  id: z.string(),
  event_id: z.string(),
  namespace: DefinitionNamespace,
  key: z.string(),
  label: z.string(),
  scope: z.enum(["guest", "party", "event"]),
  value_type: ValueType,
  constraints: Constraints,
  /** Who may read the value beyond the organizer: vendor token holders listed by id. */
  default_visibility: z.array(z.string()),
  /** When a guest must answer: always, only when going, or never. */
  required_rule: z.enum(["always", "going", "never"]),
  creator: z.string(),
  /** Set when a store's customization field created the question: the field it came from and its provenance. */
  vendor_field: VendorField.optional()
});
export type AttributeDefinition = z.infer<typeof AttributeDefinition>;

export const AttributeValue = z.object({
  subject_type: z.enum(["guest", "party", "event"]),
  subject_id: z.string(),
  definition_id: z.string(),
  value: z.unknown(),
  /** guest, organizer, or the token id of the agent that wrote it. */
  source: z.string(),
  updated_at: z.string(),
  seq: z.number().int()
});
export type AttributeValue = z.infer<typeof AttributeValue>;

export const GuestStatus = z.enum(["going", "maybe", "cant_go", "no_reply"]);
export type GuestStatus = z.infer<typeof GuestStatus>;

export const Segment = z.object({ id: z.string(), name: z.string(), capacity: z.number().int().nullable() });
export type Segment = z.infer<typeof Segment>;

export const Venue = z.object({
  name: z.string(),
  line1: z.string(),
  city: z.string(),
  region: z.string(),
  postal_code: z.string(),
  country: z.string()
});
export type Venue = z.infer<typeof Venue>;

/** Where the gifts go and by when: the organizer's choice, read by the search, the probe, the cart, and the lock date. */
export const Delivery = z.object({
  destination: z.enum(["venue", "address"]),
  /** The address when the destination is not the venue. */
  address: Venue.nullable(),
  /** ISO date the gifts must have arrived by; null until the organizer sets it. */
  needed_by: z.string().nullable()
});
export type Delivery = z.infer<typeof Delivery>;

export const EventSettings = z.object({
  guest_approval: z.boolean(),
  reminders: z.boolean(),
  reask_on_change: z.boolean(),
  order_approval: z.boolean()
});
export type EventSettings = z.infer<typeof EventSettings>;

export const Event = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  host: z.string(),
  starts_at: z.string(),
  venue: Venue,
  spots: z.number().int().nullable(),
  cost_per_person_cents: z.number().int().nullable(),
  rsvp_deadline: z.string().nullable(),
  description: z.string(),
  invite_extras: z.array(z.string()),
  response_options: z.array(GuestStatus),
  settings: EventSettings,
  delivery: Delivery,
  /** The organizer's contact. */
  contact: z.object({ email: z.string().nullable(), phone: z.string().nullable() }),
  segments: z.array(Segment),
  definition_ids: z.array(z.string()),
  status: z.enum(["draft", "published"]),
  invite_code: z.string().nullable(),
  created_at: z.string(),
  /** The organizer's user id; a document stored before ownership existed reads as null. */
  owner_id: z.string().nullable().default(null),
  /** The event `/demo` seeded from the walkthrough; the dashboard mounts the tour on it. */
  demo: z.boolean().default(false)
});
export type Event = z.infer<typeof Event>;

export const Party = z.object({
  id: z.string(),
  event_id: z.string(),
  guest_ids: z.array(z.string()),
  contact: z.object({ email: z.string().nullable(), phone: z.string().nullable() }),
  plus_one_allowance: z.number().int()
});
export type Party = z.infer<typeof Party>;

export const Guest = z.object({
  id: z.string(),
  event_id: z.string(),
  party_id: z.string(),
  /** A row the organizer creates: guest, plus-one, child, speaker, or any word. */
  role: z.string(),
  status: GuestStatus,
  attendance: z.record(z.string(), z.boolean()),
  display_name: z.string()
});
export type Guest = z.infer<typeof Guest>;

export const UpdateKind = z.enum(["confirmed", "in_production", "shipped", "delivered", "issue", "question", "proof", "reply"]);
export type UpdateKind = z.infer<typeof UpdateKind>;

export const VendorUpdate = z.object({
  id: z.string(),
  event_id: z.string(),
  gift_id: z.string(),
  caller: z.string(),
  kind: UpdateKind,
  text: z.string(),
  expected_date: z.string().nullable(),
  reference: z.string().nullable(),
  asset: z.string().nullable(),
  /** A guest the update names, for an issue with one unit. */
  guest_id: z.string().nullable(),
  created_at: z.string(),
  seq: z.number().int()
});
export type VendorUpdate = z.infer<typeof VendorUpdate>;

export const CallerToken = z.object({
  id: z.string(),
  event_id: z.string(),
  holder: z.string(),
  gift_ids: z.array(z.string()),
  readable_definition_ids: z.array(z.string()),
  callable_tools: z.array(z.string()),
  expires_at: z.string().nullable(),
  last_profile_url: z.string().nullable(),
  /** The AccessGrant that authorizes the token; a token minted before grants existed reads as null and keeps its own scope. */
  grant_id: z.string().nullable().default(null)
});
export type CallerToken = z.infer<typeof CallerToken>;

/* ---- Access grants ---- */

/** Who an outside party is: a person at the store, the store itself, or an agent acting for either. */
export const GranteeType = z.enum(["user", "vendor", "agent"]);
export type GranteeType = z.infer<typeof GranteeType>;

/** What a grant lets its holder retrieve or post on one procurement. */
export const GrantPermission = z.enum(["manifest:read", "requirements:read", "changes:read", "updates:read", "updates:write"]);
export type GrantPermission = z.infer<typeof GrantPermission>;

/**
 * The relationship that authorizes a CallerToken: which outside party may reach which procurement
 * and what it may retrieve. A revoked or expired grant retrieves nothing; the data a holder sees
 * derives from the permissions and the allowed attributes.
 */
export const AccessGrant = z.object({
  id: z.string(),
  event_id: z.string(),
  /** The gift's id until a Procurement record exists. */
  procurement_id: z.string(),
  grantee_type: GranteeType,
  grantee_id: z.string(),
  permissions: z.array(GrantPermission),
  /** The definition ids the holder may read; absent means every definition the procurement maps. */
  allowed_attribute_ids: z.array(z.string()).optional(),
  created_by: z.string(),
  created_at: z.string(),
  expires_at: z.string().nullable().default(null),
  revoked_at: z.string().nullable().default(null),
  /** The last revision the holder acknowledged through acknowledge_changes; absent or null before any. */
  acknowledged_revision: z.number().int().nullable().optional()
});
export type AccessGrant = z.infer<typeof AccessGrant>;

/** Who made a change: the attendee on the invite page, the organizer, a store's token holder, an agent acting for one of them, or Tokuchu itself. */
export const ActorType = z.enum(["attendee", "organizer", "vendor", "agent", "system"]);
export type ActorType = z.infer<typeof ActorType>;

/** What a procurement-level change-log entry records. */
export const ProcurementChangeType = z.enum(["mapping_changed", "plan_changed", "approved", "exception_opened", "exception_resolved", "exception_dismissed", "status_changed"]);
export type ProcurementChangeType = z.infer<typeof ProcurementChangeType>;

/** The actor and the procurement context each change-log entry carries; an entry stored before revisions existed reads them as absent. */
const ChangeContext = {
  actor_type: ActorType.optional(),
  actor_id: z.string().optional(),
  gift_id: z.string().optional(),
  /** The guest the change concerns. */
  attendee_ref: z.string().optional(),
  /** The store's requirement key the change concerns. */
  requirement_id: z.string().optional(),
  summary: z.string().optional()
};

/** One entry of the change log: a value write, a status change, a vendor update, or a procurement change. */
export const ChangeEntry = z.discriminatedUnion("kind", [
  z.object({ ...ChangeContext, kind: z.literal("value"), seq: z.number().int(), at: z.string(), event_id: z.string(), subject_type: z.enum(["guest", "party", "event"]), subject_id: z.string(), definition_id: z.string(), value: z.unknown(), source: z.string() }),
  z.object({ ...ChangeContext, kind: z.literal("status"), seq: z.number().int(), at: z.string(), event_id: z.string(), guest_id: z.string(), from: GuestStatus, to: GuestStatus, source: z.string() }),
  z.object({ ...ChangeContext, kind: z.literal("update"), seq: z.number().int(), at: z.string(), event_id: z.string(), update_id: z.string(), gift_id: z.string(), update_kind: UpdateKind, caller: z.string() }),
  z.object({ ...ChangeContext, kind: z.literal("procurement"), seq: z.number().int(), at: z.string(), event_id: z.string(), gift_id: z.string(), type: ProcurementChangeType })
]);
export type ChangeEntry = z.infer<typeof ChangeEntry>;

/* ---- Personalization ---- */

/** The field kinds a vendor's personalization schema may state; the list is data, so a new kind is a row here (#117). */
export const PERSONALIZATION_KINDS = ["text", "name", "monogram", "date", "time", "location", "star_map", "color", "word_list", "image"] as const;
export const PersonalizationKind = z.enum(PERSONALIZATION_KINDS);
export type PersonalizationKind = z.infer<typeof PersonalizationKind>;

/** The constraints a store states on one field: a length cap and an allowed set. */
export const FieldConstraints = z.object({ max_length: z.number().int().optional(), options: z.array(Option).optional() });
export type FieldConstraints = z.infer<typeof FieldConstraints>;

/** One value a personalized unit carries, as the vendor's schema states it. */
export const PersonalizationField = z.object({ key: z.string(), label: z.string(), kind: PersonalizationKind, max_length: z.number().int().optional(), required: z.boolean(), allowed_values: z.array(z.string()).optional(), constraints: FieldConstraints.optional() });
export type PersonalizationField = z.infer<typeof PersonalizationField>;

/** The store's field schema a gift carries: the fields, and the requirement schema's id and version once a read established them. */
export const PersonalizationSchema = z.object({ fields: z.array(PersonalizationField), schema_id: z.string().optional(), schema_version: z.string().optional() });
export type PersonalizationSchema = z.infer<typeof PersonalizationSchema>;

/** The transforms a mapping may apply; personalization.ts states what each accepts. */
export const PERSONALIZATION_TRANSFORMS = ["uppercase", "lowercase", "date_only", "location_query"] as const;
export const PersonalizationTransform = z.enum(PERSONALIZATION_TRANSFORMS);
export type PersonalizationTransform = z.infer<typeof PersonalizationTransform>;

/** Where a vendor field's value comes from: an RSVP definition, an event field, the guest's own row, or a fixed value. */
const DefinitionSource = z.object({ type: z.literal("definition"), definition_id: z.string(), subject_scope: z.enum(["guest", "party", "event"]) });
const EventSource = z.object({ type: z.literal("event"), key: z.enum(["title", "starts_at", "venue"]) });
const GuestSource = z.object({ type: z.literal("guest"), key: z.enum(["display_name"]) });
const LiteralSource = z.object({ type: z.literal("literal"), value: z.unknown() });
export const MappingSource = z.discriminatedUnion("type", [DefinitionSource, EventSource, GuestSource, LiteralSource]);
export type MappingSource = z.infer<typeof MappingSource>;

/** A source that needs no definition: the event, the guest's own row, or a fixed value. */
export const DerivedSource = z.discriminatedUnion("type", [EventSource, GuestSource, LiteralSource]);
export type DerivedSource = z.infer<typeof DerivedSource>;

/** Where a mapping row stands when it is not settled: flagged for the organizer to confirm, or unresolved after the requirement's constraints changed. */
export const MappingResolution = z.enum(["needs_confirmation", "unresolved"]);
export type MappingResolution = z.infer<typeof MappingResolution>;

/** One mapping row: the vendor field it fills, its source, an optional transform, and its resolution when not settled. */
export const PersonalizationMapping = z.object({ vendor_field_key: z.string(), source: MappingSource, transform: PersonalizationTransform.optional(), resolution: MappingResolution.optional() });
export type PersonalizationMapping = z.infer<typeof PersonalizationMapping>;

/* ---- Gifts ---- */

/** Where a store's structured update moved the gift: accepted, in production, or fulfilled. */
export const VendorProcurementStatus = z.enum(["accepted", "in_production", "fulfilled"]);
export type VendorProcurementStatus = z.infer<typeof VendorProcurementStatus>;

/** One clause of the filter grammar (filter.ts) as a schema, so a stored rule validates on write. */
export const FilterClauseSchema = z.object({ field: z.string(), op: z.enum(OPS), value: z.unknown().optional() });
export const FilterSchema = z.array(FilterClauseSchema);

export const Variant = z.object({ id: z.string(), title: z.string(), price_cents: z.number().int(), currency: z.string(), available: z.boolean().optional(), options: z.array(z.object({ name: z.string(), label: z.string() })).optional() });
export type Variant = z.infer<typeof Variant>;

/** One value of one definition sends the guest to one variant; the organizer's rows are the source of truth. */
export const VariantMappingRow = z.object({ definition_id: z.string(), value: z.string(), variant_id: z.string() });
export type VariantMappingRow = z.infer<typeof VariantMappingRow>;

export const MissingValueFallback = z.enum(["default", "blank", "hold"]);
export type MissingValueFallback = z.infer<typeof MissingValueFallback>;

export const PostLockCancellation = z.enum(["keep", "reassign", "drop"]);
export type PostLockCancellation = z.infer<typeof PostLockCancellation>;

export const UnitStatus = z.enum(["open", "locked", "unservable", "held", "cancelled_reassignable", "cancelled_sunk", "excluded"]);
export type UnitStatus = z.infer<typeof UnitStatus>;

/** A plan rule: the first rule whose filter matches a guest assigns the product. */
export const GiftRule = z.object({ filter: FilterSchema, product_id: z.string() });
export type GiftRule = z.infer<typeof GiftRule>;

/** The organizer's per-guest decision; it wins over the computed variant and survives every recompute. */
export const GiftOverride = z.object({ variant_id: z.string().optional(), excluded: z.boolean().optional() });
export type GiftOverride = z.infer<typeof GiftOverride>;

/** One priced line of the shop's cart: the variant, its unit price, and the line total in the currency's minor unit. */
export const ProposalLine = z.object({ variant_id: z.string(), title: z.string().nullable(), unit_price: z.number().nullable(), quantity: z.number().int(), total: z.number().nullable() });
export type ProposalLine = z.infer<typeof ProposalLine>;

/** The cart as the shop last returned it: the priced proposal the organizer approves. */
export const Proposal = z.object({ cart_id: z.string(), currency: z.string().nullable(), lines: z.array(ProposalLine), total: z.number().nullable(), continue_url: z.string().nullable() });
export type Proposal = z.infer<typeof Proposal>;

export const DeliveryWindow = z.object({ earliest: z.string(), latest: z.string() });
export type DeliveryWindow = z.infer<typeof DeliveryWindow>;

export const CartBuyer = z.object({ email: z.string().optional(), phone_number: z.string().optional() });
export type CartBuyer = z.infer<typeof CartBuyer>;

/** The cart job's state: running from approval, done once the store returned the cart, failed with the reason otherwise. */
export const CartFill = z.object({ status: z.enum(["running", "done", "failed"]), started_at: z.string(), reason: z.string().nullable() });
export type CartFill = z.infer<typeof CartFill>;

/** One store cart line the job added for a guest. */
export const CartLine = z.object({ guest_id: z.string(), cart_line_key: z.string(), variant_id: z.string() });
export type CartLine = z.infer<typeof CartLine>;

/** A guest whose item the store refused, with the store's reasons. */
export const CartBlocked = z.object({ guest_id: z.string(), issues: z.array(z.string()) });
export type CartBlocked = z.infer<typeof CartBlocked>;

export const Batch = z.object({
  id: z.string(),
  event_id: z.string(),
  product_id: z.string(),
  shop_domain: z.string(),
  product_title: z.string(),
  recipients: FilterSchema,
  mapping: z.array(VariantMappingRow),
  default_variant_id: z.string().nullable(),
  variants: z.array(Variant),
  /** Set on a personalized product: the vendor's field schema the search read, with the schema's id and version when known. */
  personalization: PersonalizationSchema.nullable().optional(),
  /** Set by set_personalization_mapping: one source per vendor field. */
  personalization_mappings: z.array(PersonalizationMapping).nullable().optional(),
  missing_value_fallback: MissingValueFallback,
  post_lock_cancellation: PostLockCancellation,
  cutoff: z.string().nullable(),
  cart_id: z.string().nullable(),
  checkout_id: z.string().nullable(),
  order_id: z.string().nullable(),
  rules: z.array(GiftRule),
  overrides: z.record(z.string(), GiftOverride),
  /** Set by the checkout at the cutoff: the date the store's checkout was created, after which the cart no longer follows the replies. */
  locked_at: z.string().nullable(),
  /** Set by send: the buyer the cart names and the cart as the shop last priced it, with the change-log seq that cart reflects. */
  buyer: CartBuyer.nullable().optional(),
  proposal: Proposal.nullable().optional(),
  cart_seq: z.number().int().nullable().optional(),
  /** Set by approve: when the organizer last approved and the change-log seq at that moment, so a later answer reads as changed since approval. */
  approved_at: z.string().nullable().optional(),
  approved_seq: z.number().int().nullable().optional(),
  /** When the organizer first requested the gift's missing values from attendees; a later reply then receives the request too. */
  requested_at: z.string().nullable().optional(),
  delivery_window: DeliveryWindow.nullable().optional(),
  /** Set by the cart job or the checkout: the store's checkout page, where the organizer pays. */
  checkout_url: z.string().nullable().optional(),
  /** The product's own page at the store, where the merchant tools run; the shop's root stands in when unset. */
  product_url: z.string().nullable().optional(),
  /** Set by the cart job: where it stands and, on a failure, why. */
  cart_fill: CartFill.nullable().optional(),
  /** Set by the cart job: the store's cart line per guest it added. */
  cart_lines: z.array(CartLine).nullable().optional(),
  /** Set by the cart job: the guests whose item the store refused, with the store's reasons. */
  cart_blocked: z.array(CartBlocked).nullable().optional(),
  /** Set by each poll of a store with a change feed: the last sequence number read from it. */
  vendor_seq: z.number().int().nullable().optional(),
  /** Set by a store's structured update: where the store says the order stands. */
  procurement_status: VendorProcurementStatus.nullable().optional()
});
export type Batch = z.infer<typeof Batch>;

/* ---- Procurement ---- */

/** Where a procurement stands, from the gift's creation to the store's fulfilment; procurement-status.ts states the allowed moves. */
export const ProcurementStatus = z.enum(["draft", "collecting", "ready", "approved", "ordered", "in_production", "fulfilled", "cancelled"]);
export type ProcurementStatus = z.infer<typeof ProcurementStatus>;

/**
 * The relationship between the event, the gift, the store, the requirement schema, the attendee
 * fulfilment data, the approval, and the external order. One exists per gift; the gift keeps
 * describing the product. The revisions are change-log sequence numbers.
 */
export const Procurement = z.object({
  id: z.string(),
  event_id: z.string(),
  gift_id: z.string(),
  vendor_id: z.string().optional(),
  product_id: z.string().optional(),
  product_url: z.string().optional(),
  requirement_schema_id: z.string().optional(),
  requirement_schema_version: z.string().optional(),
  status: ProcurementStatus,
  current_revision: z.number().int(),
  approved_revision: z.number().int().optional(),
  external_cart_id: z.string().optional(),
  checkout_url: z.string().optional(),
  external_order_id: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string()
});
export type Procurement = z.infer<typeof Procurement>;

/* ---- Procurement exceptions ---- */

export const ExceptionSource = z.enum(["vendor", "organizer", "system"]);
export type ExceptionSource = z.infer<typeof ExceptionSource>;

export const ExceptionType = z.enum(["missing_information", "invalid_value", "option_unavailable", "mapping_problem", "other"]);
export type ExceptionType = z.infer<typeof ExceptionType>;

export const ExceptionStatus = z.enum(["open", "resolved", "dismissed"]);
export type ExceptionStatus = z.infer<typeof ExceptionStatus>;

/** A problem a store or the organizer raised on a procurement: for one attendee's requirement, one attendee, or the gift as a whole. It stays open until an answer resolves it or the organizer dismisses it. */
export const ProcurementException = z.object({
  id: z.string(),
  event_id: z.string(),
  /** The gift's id until a Procurement record exists. */
  procurement_id: z.string(),
  attendee_ref: z.string().nullable(),
  /** The store's requirement key the exception concerns. */
  requirement_id: z.string().nullable(),
  source: ExceptionSource,
  type: ExceptionType,
  message: z.string().nullable(),
  /** The value the store cannot take and the values it can, when it said so. */
  unavailable_value: z.string().nullable().default(null),
  allowed_values: z.array(z.string()).nullable().default(null),
  status: ExceptionStatus,
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  created_revision: z.number().int(),
  resolved_revision: z.number().int().nullable()
});
export type ProcurementException = z.infer<typeof ProcurementException>;

/* ---- Reconciliation ---- */

/** How a decision found the definition it maps: the requirement's own key, a row saved on the gift, the alias table, or the model. */
export const MatchMethod = z.enum(["exact", "saved_mapping", "alias", "llm"]);
export type MatchMethod = z.infer<typeof MatchMethod>;

export const DeriveMethod = z.enum(["saved_mapping", "deterministic", "llm"]);
export type DeriveMethod = z.infer<typeof DeriveMethod>;

/** One attribute a decision could map to, with how it was found. */
export const ReconciliationCandidate = z.object({ attribute_id: z.string(), label: z.string(), confidence: z.number(), method: MatchMethod });
export type ReconciliationCandidate = z.infer<typeof ReconciliationCandidate>;

/** The definition a request step creates for a requirement nothing fills. */
export const ProposedDefinition = z.object({ key: z.string(), label: z.string(), scope: z.literal("guest"), value_type: ValueType, constraints: Constraints, required_rule: z.literal("going"), vendor_field: VendorField.optional() });
export type ProposedDefinition = z.infer<typeof ProposedDefinition>;

/** One decision of the reconciliation service per store requirement (#38): map, derive, create, or ask the organizer. */
export const ReconciliationDecision = z.discriminatedUnion("decision", [
  z.object({ requirement_id: z.string(), decision: z.literal("map_existing"), attribute_id: z.string(), confidence: z.number(), method: MatchMethod }),
  z.object({ requirement_id: z.string(), decision: z.literal("derive"), source: DerivedSource, transform: PersonalizationTransform.optional(), confidence: z.number(), method: DeriveMethod }),
  z.object({ requirement_id: z.string(), decision: z.literal("create_field"), proposed_definition: ProposedDefinition, confidence: z.number() }),
  z.object({ requirement_id: z.string(), decision: z.literal("needs_confirmation"), candidates: z.array(ReconciliationCandidate), reason: z.string() })
]);
export type ReconciliationDecision = z.infer<typeof ReconciliationDecision>;

/** Who settled a decision beyond the deterministic steps: the organizer through a confirmation or the model through a verdict. */
export const DecisionConfirmer = z.enum(["organizer", "model"]);
export type DecisionConfirmer = z.infer<typeof DecisionConfirmer>;

/** A decision as stored: the decision and who confirmed it, when someone did. */
export const StoredDecision = z.object({ decision: ReconciliationDecision, confirmed_by: DecisionConfirmer.nullable().default(null), confirmed_at: z.string().nullable().default(null) });
export type StoredDecision = z.infer<typeof StoredDecision>;

/** The organizer's answer to a confirmation: the attribute to map, or a new field. */
export const Confirmation = z.union([z.object({ attribute_id: z.string() }), z.object({ create: z.literal(true) })]);
export type Confirmation = z.infer<typeof Confirmation>;

/** The model's verdict on one requirement and the definition ids it saw, so a definition added since asks again. */
export const ModelVerdict = z.object({ attribute_id: z.string().nullable(), confidence: z.number(), reason: z.string(), seen: z.string(), recorded_at: z.string() });
export type ModelVerdict = z.infer<typeof ModelVerdict>;

/** Which requirement keys a new schema version added, removed, or changed. */
export const SchemaDiffRecord = z.object({ added: z.array(z.string()), removed: z.array(z.string()), changed: z.array(z.string()) });
export type SchemaDiffRecord = z.infer<typeof SchemaDiffRecord>;

/**
 * The reconciliation of one gift against one version of its store's requirement schema (#51): the
 * decision per requirement with who confirmed it, the model's verdicts, the organizer's
 * confirmations, and the change from the version before until the organizer continues past it.
 */
export const Reconciliation = z.object({
  id: z.string(),
  event_id: z.string(),
  gift_id: z.string(),
  schema_id: z.string(),
  schema_version: z.string(),
  decisions: z.array(StoredDecision),
  /** Keyed by requirement key. */
  verdicts: z.record(z.string(), ModelVerdict),
  confirmations: z.record(z.string(), z.object({ choice: Confirmation, confirmed_at: z.string() })),
  /** Set when this version replaced another: the version before, what changed, when, and when the organizer continued past it. */
  previous: z.object({ schema_version: z.string(), diff: SchemaDiffRecord, changed_at: z.string(), continued_at: z.string().nullable() }).nullable().default(null),
  updated_at: z.string()
});
export type Reconciliation = z.infer<typeof Reconciliation>;

/* ---- The event's chat and schedule ---- */

/** Who wrote a chat line: the organizer, the assistant answering, or the system posting a status on its own. */
export const ChatRole = z.enum(["organizer", "assistant", "system"]);
export type ChatRole = z.infer<typeof ChatRole>;

/** One line of the event's chat thread. Tool calls the assistant made while answering ride along for the transcript. */
export const ChatMessage = z.object({
  id: z.string(),
  event_id: z.string(),
  role: ChatRole,
  text: z.string(),
  at: z.string(),
  tool_calls: z.array(z.object({ tool: z.string(), label: z.string() })).default([]),
  /** A scheduled action this line reports on, when it does. */
  schedule_id: z.string().nullable().default(null)
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** What a scheduled action does when it runs: a follow-up to unanswered requests, a status post into the chat, or a message the organizer wrote to be sent then. */
export const ScheduleAction = z.enum(["follow_up", "status", "message"]);
export type ScheduleAction = z.infer<typeof ScheduleAction>;

/** An action the organizer scheduled in the chat: when it runs, what it does, and how it repeats. */
export const Schedule = z.object({
  id: z.string(),
  event_id: z.string(),
  action: ScheduleAction,
  /** The organizer's words for it, shown back in the chat. */
  description: z.string(),
  /** The gift a follow-up is for; null for every gift. */
  gift_id: z.string().nullable().default(null),
  /** The text a message action sends or posts. */
  text: z.string().nullable().default(null),
  run_at: z.string(),
  /** Minutes between runs; null runs once. */
  every_minutes: z.number().int().positive().nullable().default(null),
  last_run_at: z.string().nullable().default(null),
  created_at: z.string(),
  cancelled_at: z.string().nullable().default(null)
});
export type Schedule = z.infer<typeof Schedule>;

/* ---- Requests ---- */

/** How the latest email for a request left: through the provider, into the dev log, skipped for want of an address, or rejected. */
export const RequestDelivery = z.enum(["sent", "logged", "no_address", "failed"]);
export type RequestDelivery = z.infer<typeof RequestDelivery>;

/** The questions sent to one attendee for one gift: when they went out, each follow-up since, and how the latest email left. Delivery is absent until the send settles. */
export const Request = z.object({
  id: z.string(),
  event_id: z.string(),
  guest_id: z.string(),
  gift_id: z.string(),
  definition_ids: z.array(z.string()),
  sent_at: z.string(),
  followed_up_at: z.array(z.string()),
  delivery: RequestDelivery.optional(),
  last_error: z.string().nullable().default(null)
});
export type Request = z.infer<typeof Request>;

/** A synonym row proposes a mapping when a variant title matches the pattern for an option label; the table ships empty. */
export const SynonymRow = z.object({ option_label_pattern: z.string(), variant_title_pattern: z.string() });
export type SynonymRow = z.infer<typeof SynonymRow>;
