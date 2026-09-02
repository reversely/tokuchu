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

export const AttributeDefinition = z.object({
  id: z.string(),
  event_id: z.string(),
  namespace: z.enum(["core", "organizer"]),
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
  /** Set when a store's customization field created the question: the field it came from. */
  vendor_field: z.object({ key: z.string(), label: z.string(), kind: z.string() }).optional()
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
  owner_id: z.string().nullable().default(null)
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
  last_profile_url: z.string().nullable()
});
export type CallerToken = z.infer<typeof CallerToken>;

/** One entry of the change log: a value write, a status change, or a vendor update. */
export const ChangeEntry = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("value"), seq: z.number().int(), at: z.string(), event_id: z.string(), subject_type: z.enum(["guest", "party", "event"]), subject_id: z.string(), definition_id: z.string(), value: z.unknown(), source: z.string() }),
  z.object({ kind: z.literal("status"), seq: z.number().int(), at: z.string(), event_id: z.string(), guest_id: z.string(), from: GuestStatus, to: GuestStatus, source: z.string() }),
  z.object({ kind: z.literal("update"), seq: z.number().int(), at: z.string(), event_id: z.string(), update_id: z.string(), gift_id: z.string(), update_kind: UpdateKind, caller: z.string() })
]);
export type ChangeEntry = z.infer<typeof ChangeEntry>;

/* ---- Personalization ---- */

/** The field kinds a vendor's personalization schema may state; the list is data, so a new kind is a row here (#117). */
export const PERSONALIZATION_KINDS = ["text", "name", "monogram", "date", "time", "location", "star_map", "color", "word_list"] as const;
export const PersonalizationKind = z.enum(PERSONALIZATION_KINDS);
export type PersonalizationKind = z.infer<typeof PersonalizationKind>;

/** The constraints a store states on one field: a length cap and an allowed set. */
export const FieldConstraints = z.object({ max_length: z.number().int().optional(), options: z.array(Option).optional() });
export type FieldConstraints = z.infer<typeof FieldConstraints>;

/** One value a personalized unit carries, as the vendor's schema states it. */
export const PersonalizationField = z.object({ key: z.string(), label: z.string(), kind: PersonalizationKind, max_length: z.number().int().optional(), required: z.boolean(), allowed_values: z.array(z.string()).optional(), constraints: FieldConstraints.optional() });
export type PersonalizationField = z.infer<typeof PersonalizationField>;

/** The transforms a mapping may apply; personalization.ts states what each accepts. */
export const PERSONALIZATION_TRANSFORMS = ["uppercase", "lowercase", "date_only", "location_query"] as const;
export const PersonalizationTransform = z.enum(PERSONALIZATION_TRANSFORMS);
export type PersonalizationTransform = z.infer<typeof PersonalizationTransform>;

/** Where a vendor field's value comes from: an RSVP definition, an event field, the guest's own row, or a fixed value. */
export const MappingSource = z.discriminatedUnion("type", [
  z.object({ type: z.literal("definition"), definition_id: z.string(), subject_scope: z.enum(["guest", "party", "event"]) }),
  z.object({ type: z.literal("event"), key: z.enum(["title", "starts_at", "venue"]) }),
  z.object({ type: z.literal("guest"), key: z.enum(["display_name"]) }),
  z.object({ type: z.literal("literal"), value: z.unknown() })
]);
export type MappingSource = z.infer<typeof MappingSource>;

/** One mapping row: the vendor field it fills, its source, and an optional transform. */
export const PersonalizationMapping = z.object({ vendor_field_key: z.string(), source: MappingSource, transform: PersonalizationTransform.optional() });
export type PersonalizationMapping = z.infer<typeof PersonalizationMapping>;

/* ---- Gifts ---- */

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
  /** Set on a personalized product: the vendor's field schema the search read. */
  personalization: z.object({ fields: z.array(PersonalizationField) }).nullable().optional(),
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
  vendor_seq: z.number().int().nullable().optional()
});
export type Batch = z.infer<typeof Batch>;

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
